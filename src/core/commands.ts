/**
 * Command processing — the only path through which the world changes.
 *
 * Every player and AI decision becomes a Command. Commands are plain data,
 * validated before application, and appended to a log alongside the seed.
 * That gives us, from one mechanism: undo-free determinism, replays that are
 * a few hundred bytes, headless balance runs, and a straightforward path to
 * server-side validation if this ever grows a competitive mode.
 *
 * Reaction fire lives here rather than in combat.ts because it is a *turn
 * structure* concern: it interrupts a move mid-path and can cut it short.
 */

import { hexDistance, hexEquals, hexKey, hexNeighbors, type Hex } from './hex';
import { inBounds, terrainAt } from './gamemap';
import { getUnitDef } from './registry';
import { isPassable } from './terrain';
import {
  ammoFor,
  canBarrage,
  canEngage,
  fireVolume,
  hitProbability,
  resolveBarrage,
  resolveFire,
  suppressionState,
  type BarrageResult,
  type FireResult,
} from './combat';
import { computeReachable, findPath } from './pathfind';
import { detect, lineOfSight, updateContacts, MOVE_DISTURBANCE } from './sensors';
import { endSideTurn, logMessage, occupancyIndex, requireUnit, unitAt } from './state';
import { applyOutcome } from './victory';
import { DetectionLevel, type GameState, type Side, type Unit, type UnitId, type Weapon } from './types';
import { Rng } from './rng';

/* ------------------------------------------------------------------ */
/* Command and event types                                             */
/* ------------------------------------------------------------------ */

export type Command =
  | { readonly type: 'MOVE'; readonly unitId: UnitId; readonly to: Hex }
  | {
      readonly type: 'FIRE';
      readonly unitId: UnitId;
      readonly weaponId: string;
      readonly targetId: UnitId;
    }
  | {
      readonly type: 'BARRAGE';
      readonly unitId: UnitId;
      readonly weaponId: string;
      readonly at: Hex;
    }
  | { readonly type: 'OVERWATCH'; readonly unitId: UnitId }
  | { readonly type: 'HUNKER'; readonly unitId: UnitId }
  | { readonly type: 'FORTIFY'; readonly unitId: UnitId }
  | { readonly type: 'SET_EMISSION'; readonly unitId: UnitId; readonly on: boolean }
  | { readonly type: 'DESIGNATE'; readonly unitId: UnitId; readonly targetId: UnitId }
  | { readonly type: 'DEPLOY_DECOY'; readonly unitId: UnitId; readonly at: Hex }
  | { readonly type: 'END_TURN' };

export type GameEvent =
  | { readonly type: 'MOVED'; readonly unitId: UnitId; readonly path: Hex[]; readonly interrupted: boolean }
  | { readonly type: 'FIRED'; readonly result: FireResult }
  | { readonly type: 'BARRAGE'; readonly result: BarrageResult }
  | { readonly type: 'REACTION_FIRE'; readonly result: FireResult }
  | { readonly type: 'DESTROYED'; readonly unitId: UnitId }
  | {
      readonly type: 'CONTACT_GAINED';
      readonly side: Side;
      readonly unitId: UnitId;
      readonly level: DetectionLevel;
    }
  | { readonly type: 'CONTACT_LOST'; readonly side: Side; readonly unitId: UnitId }
  | { readonly type: 'EMISSION_CHANGED'; readonly unitId: UnitId; readonly on: boolean }
  | { readonly type: 'DESIGNATED'; readonly unitId: UnitId; readonly targetId: UnitId }
  | { readonly type: 'POSTURE'; readonly unitId: UnitId; readonly posture: string }
  | { readonly type: 'DECOY_DEPLOYED'; readonly unitId: UnitId; readonly at: Hex }
  | { readonly type: 'TURN_ENDED'; readonly side: Side; readonly turn: number }
  | { readonly type: 'OUTCOME'; readonly outcome: string; readonly reason: string };

export interface CommandResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly events: GameEvent[];
}

function fail(error: string): CommandResult {
  return { ok: false, error, events: [] };
}

/* ------------------------------------------------------------------ */
/* Contact diffing                                                     */
/* ------------------------------------------------------------------ */

type ContactSnapshot = Record<Side, Map<UnitId, DetectionLevel>>;

function snapshotContacts(state: GameState): ContactSnapshot {
  const snap: ContactSnapshot = { BLUE: new Map(), RED: new Map() };
  for (const side of ['BLUE', 'RED'] as const) {
    for (const [unitId, contact] of state.contacts[side]) {
      snap[side].set(unitId, contact.stale ? DetectionLevel.UNDETECTED : contact.level);
    }
  }
  return snap;
}

/**
 * Emit events for contacts gained and lost. The UI uses these to flash new
 * contacts and ghost lost ones — the moment a hidden enemy resolves into a
 * marker is the game's best beat and deserves explicit signalling.
 */
function diffContacts(state: GameState, before: ContactSnapshot, events: GameEvent[]): void {
  for (const side of ['BLUE', 'RED'] as const) {
    const after = state.contacts[side];

    for (const [unitId, contact] of after) {
      const previous = before[side].get(unitId) ?? DetectionLevel.UNDETECTED;
      const current = contact.stale ? DetectionLevel.UNDETECTED : contact.level;
      if (current > previous) {
        events.push({ type: 'CONTACT_GAINED', side, unitId, level: current });
      }
    }

    for (const [unitId, previous] of before[side]) {
      if (previous === DetectionLevel.UNDETECTED) continue;
      const contact = after.get(unitId);
      const current = !contact || contact.stale ? DetectionLevel.UNDETECTED : contact.level;
      if (current === DetectionLevel.UNDETECTED) {
        events.push({ type: 'CONTACT_LOST', side, unitId });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Reaction fire                                                       */
/* ------------------------------------------------------------------ */

/**
 * Whether an overwatching unit can engage a mover it has just spotted.
 * Deliberately stricter than a normal engagement: reaction fire is direct
 * fire only, and requires the reacting unit to see the target *itself*
 * rather than relying on a shared track.
 */
function canReact(
  state: GameState,
  watcher: Unit,
  weapon: Weapon,
  mover: Unit,
): boolean {
  if (weapon.mode !== 'DIRECT') return false;
  if (ammoFor(watcher, weapon) <= 0) return false;
  if (suppressionState(watcher) === 'PINNED') return false;

  const watcherDef = getUnitDef(watcher.defId);
  const moverDef = getUnitDef(mover.defId);
  if (!weapon.engages.includes(moverDef.domain)) return false;

  const distance = hexDistance(watcher.pos, mover.pos);
  if (distance > weapon.rangeMax || distance < weapon.rangeMin) return false;

  if (!lineOfSight(state.map, watcher.pos, mover.pos, watcherDef.altitude, moverDef.altitude).clear) {
    return false;
  }

  // The watcher must personally hold the contact at identified quality.
  const seen = detect(state, watcher.side, mover);
  return seen.level >= DetectionLevel.IDENTIFIED;
}

/**
 * Check every enemy on overwatch against a mover at its current hex.
 * Returns the reaction that fired, if any. One reaction per watcher.
 */
function triggerOverwatch(
  state: GameState,
  rng: Rng,
  mover: Unit,
  events: GameEvent[],
): boolean {
  for (const watcher of state.units.values()) {
    if (watcher.destroyed || watcher.side === mover.side) continue;
    if (!watcher.onOverwatch) continue;

    const watcherDef = getUnitDef(watcher.defId);
    const weapon = watcherDef.weapons.find((w) => canReact(state, watcher, w, mover));
    if (!weapon) continue;

    watcher.onOverwatch = false;
    const result = resolveFire(state, rng, watcher, weapon, mover);
    events.push({ type: 'REACTION_FIRE', result });
    logMessage(state, watcher.side, 'COMBAT', `Overwatch: ${result.narrative}`, mover.pos);

    if (result.destroyed) {
      events.push({ type: 'DESTROYED', unitId: mover.id });
      return true;
    }
    // A mover caught in the open stops where it was hit.
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Command execution                                                   */
/* ------------------------------------------------------------------ */

/**
 * Apply a command. `missionOpener` identifies which side starts each turn, so
 * END_TURN knows when to advance the turn counter.
 */
export function execute(
  state: GameState,
  command: Command,
  missionOpener: Side,
  playerSide: Side,
): CommandResult {
  if (state.outcome !== 'ONGOING' && command.type !== 'END_TURN') {
    return fail('Mission already resolved');
  }

  const before = snapshotContacts(state);
  const events: GameEvent[] = [];

  const result = dispatch(state, command, missionOpener, events);
  if (!result.ok) return result;

  updateContacts(state);
  diffContacts(state, before, events);

  const outcome = applyOutcome(state, playerSide);
  if (outcome.outcome !== 'ONGOING') {
    events.push({ type: 'OUTCOME', outcome: outcome.outcome, reason: outcome.reason });
  }

  return { ok: true, events };
}

function dispatch(
  state: GameState,
  command: Command,
  missionOpener: Side,
  events: GameEvent[],
): CommandResult {
  switch (command.type) {
    case 'MOVE':
      return doMove(state, command.unitId, command.to, events);
    case 'FIRE':
      return doFire(state, command.unitId, command.weaponId, command.targetId, events);
    case 'BARRAGE':
      return doBarrage(state, command.unitId, command.weaponId, command.at, events);
    case 'OVERWATCH':
      return doPosture(state, command.unitId, 'OVERWATCH', events);
    case 'HUNKER':
      return doPosture(state, command.unitId, 'HUNKER', events);
    case 'FORTIFY':
      return doPosture(state, command.unitId, 'FORTIFY', events);
    case 'SET_EMISSION':
      return doSetEmission(state, command.unitId, command.on, events);
    case 'DESIGNATE':
      return doDesignate(state, command.unitId, command.targetId, events);
    case 'DEPLOY_DECOY':
      return doDeployDecoy(state, command.unitId, command.at, events);
    case 'END_TURN':
      return doEndTurn(state, missionOpener, events);
  }
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

function activeUnit(state: GameState, unitId: UnitId): Unit | string {
  const unit = state.units.get(unitId);
  if (!unit) return `Unknown unit ${unitId}`;
  if (unit.destroyed) return 'Unit destroyed';
  if (unit.side !== state.activeSide) return 'Not this side’s turn';
  return unit;
}

function doMove(state: GameState, unitId: UnitId, to: Hex, events: GameEvent[]): CommandResult {
  const found = activeUnit(state, unitId);
  if (typeof found === 'string') return fail(found);
  const unit = found;

  if (!inBounds(state.map, to)) return fail('Destination off map');
  if (hexEquals(unit.pos, to)) return fail('Already there');

  const def = getUnitDef(unit.defId);
  if (!isPassable(terrainAt(state.map, to), def.mobility)) {
    return fail('Impassable terrain');
  }
  if (suppressionState(unit) === 'PINNED') return fail('Unit is pinned');

  const reachable = computeReachable(state, unit);
  const node = reachable.get(hexKey(to));
  if (!node) return fail('Out of movement range');

  const path = findPath(state, unit, to);
  if (!path || path.length < 2) return fail('No route');

  // Moving breaks any held posture.
  unit.onOverwatch = false;
  unit.hunkered = false;
  unit.fortified = false;

  const rng = forkStream(state, `move:${unit.id}`);
  const travelled: Hex[] = [path[0]!];
  let interrupted = false;

  for (let i = 1; i < path.length; i++) {
    const step = path[i]!;
    unit.pos = step;
    travelled.push(step);

    // Movement is conspicuous, and it accrues as you go.
    unit.disturbance += MOVE_DISTURBANCE * 0.35;

    if (triggerOverwatch(state, rng, unit, events)) {
      interrupted = true;
      break;
    }
    if (unit.destroyed) {
      interrupted = true;
      break;
    }
  }

  const finalNode = reachable.get(hexKey(unit.pos));
  unit.movementLeft = Math.max(0, unit.movementLeft - (finalNode?.cost ?? node.cost));
  unit.disturbance += MOVE_DISTURBANCE * 0.5;

  events.push({ type: 'MOVED', unitId: unit.id, path: travelled, interrupted });
  if (!interrupted) {
    logMessage(state, unit.side, 'INFO', `${unit.callsign} repositions.`, unit.pos);
  }

  return { ok: true, events };
}

function doFire(
  state: GameState,
  unitId: UnitId,
  weaponId: string,
  targetId: UnitId,
  events: GameEvent[],
): CommandResult {
  const found = activeUnit(state, unitId);
  if (typeof found === 'string') return fail(found);
  const unit = found;

  const def = getUnitDef(unit.defId);
  const weapon = def.weapons.find((w) => w.id === weaponId);
  if (!weapon) return fail(`Unit has no weapon ${weaponId}`);

  const target = state.units.get(targetId);
  if (!target) return fail('Unknown target');

  const check = canEngage(state, unit, weapon, target);
  if (!check.ok) return fail(check.reason ?? 'Cannot engage');

  const rng = forkStream(state, `fire:${unit.id}:${target.id}:${weaponId}`);
  const result = resolveFire(state, rng, unit, weapon, target);

  unit.hasActed = true;
  unit.movementLeft = 0;

  events.push({ type: 'FIRED', result });
  logMessage(state, unit.side, result.destroyed ? 'LOSS' : 'COMBAT', result.narrative, target.pos);
  if (result.destroyed) events.push({ type: 'DESTROYED', unitId: target.id });

  return { ok: true, events };
}

function doBarrage(
  state: GameState,
  unitId: UnitId,
  weaponId: string,
  at: Hex,
  events: GameEvent[],
): CommandResult {
  const found = activeUnit(state, unitId);
  if (typeof found === 'string') return fail(found);
  const unit = found;

  const def = getUnitDef(unit.defId);
  const weapon = def.weapons.find((w) => w.id === weaponId);
  if (!weapon) return fail(`Unit has no weapon ${weaponId}`);
  if (!inBounds(state.map, at)) return fail('Target reference off map');

  const check = canBarrage(unit, weapon, at);
  if (!check.ok) return fail(check.reason ?? 'Cannot fire');

  const rng = forkStream(state, `barrage:${unit.id}:${hexKey(at)}`);
  const result = resolveBarrage(state, rng, unit, weapon, at);

  unit.hasActed = true;
  unit.movementLeft = 0;

  events.push({ type: 'BARRAGE', result });
  logMessage(
    state,
    unit.side,
    'COMBAT',
    result.affected.length === 0
      ? `${unit.callsign} fires a mission — no observed effect.`
      : `${unit.callsign} fires a mission — ${result.affected.length} unit(s) affected.`,
    at,
  );
  for (const hit of result.affected) {
    if (hit.destroyed) events.push({ type: 'DESTROYED', unitId: hit.targetId });
  }

  return { ok: true, events };
}

function doPosture(
  state: GameState,
  unitId: UnitId,
  posture: 'OVERWATCH' | 'HUNKER' | 'FORTIFY',
  events: GameEvent[],
): CommandResult {
  const found = activeUnit(state, unitId);
  if (typeof found === 'string') return fail(found);
  const unit = found;

  if (unit.hasActed) return fail('Already acted this turn');

  const def = getUnitDef(unit.defId);

  if (posture === 'OVERWATCH') {
    if (!def.abilities.includes('OVERWATCH')) return fail('Unit cannot set overwatch');
    if (suppressionState(unit) !== 'STEADY') return fail('Too suppressed to hold overwatch');
    const hasDirect = def.weapons.some((w) => w.mode === 'DIRECT' && ammoFor(unit, w) > 0);
    if (!hasDirect) return fail('No direct-fire weapon available');
    unit.onOverwatch = true;
  } else if (posture === 'HUNKER') {
    unit.hunkered = true;
  } else {
    if (!def.abilities.includes('FORTIFY')) return fail('Unit cannot fortify');
    if (unit.movementLeft < def.movement) return fail('Must fortify before moving');
    unit.fortified = true;
  }

  unit.hasActed = true;
  unit.movementLeft = 0;

  events.push({ type: 'POSTURE', unitId: unit.id, posture });
  logMessage(state, unit.side, 'INFO', `${unit.callsign} goes ${posture.toLowerCase()}.`, unit.pos);
  return { ok: true, events };
}

/**
 * Emissions control. Free to toggle — it must be, because the decision has to
 * be re-made constantly as the tactical picture changes, and charging an
 * action for it would simply mean nobody ever turns a radar off.
 */
function doSetEmission(
  state: GameState,
  unitId: UnitId,
  on: boolean,
  events: GameEvent[],
): CommandResult {
  const found = activeUnit(state, unitId);
  if (typeof found === 'string') return fail(found);
  const unit = found;

  const def = getUnitDef(unit.defId);
  const hasActive = def.sensors.some((s) => s.active) || def.abilities.includes('JAM');
  if (!hasActive) return fail('Unit has no active emitters');
  if (unit.emitting === on) return fail(on ? 'Already radiating' : 'Already dark');

  unit.emitting = on;
  if (on) unit.disturbance += 10;

  events.push({ type: 'EMISSION_CHANGED', unitId: unit.id, on });
  logMessage(
    state,
    unit.side,
    'INFO',
    on
      ? `${unit.callsign} goes active — emissions detectable.`
      : `${unit.callsign} goes EMCON silent.`,
    unit.pos,
  );
  return { ok: true, events };
}

/**
 * Designate a target for someone else's weapons. This is the sensor-shooter
 * handoff made explicit, and it costs the scout its action — finding is a
 * job, not a passive bonus.
 */
function doDesignate(
  state: GameState,
  unitId: UnitId,
  targetId: UnitId,
  events: GameEvent[],
): CommandResult {
  const found = activeUnit(state, unitId);
  if (typeof found === 'string') return fail(found);
  const unit = found;

  if (unit.hasActed) return fail('Already acted this turn');

  const def = getUnitDef(unit.defId);
  if (!def.abilities.includes('DESIGNATE')) return fail('Unit cannot designate targets');

  const target = state.units.get(targetId);
  if (!target || target.destroyed) return fail('Unknown target');
  if (target.side === unit.side) return fail('Friendly unit');

  // You cannot designate what you personally cannot see.
  const seen = detect(state, unit.side, target);
  if (seen.level < DetectionLevel.IDENTIFIED) {
    return fail('Target not identified — close the range or use another sensor');
  }
  const targetDef = getUnitDef(target.defId);
  const los = lineOfSight(state.map, unit.pos, target.pos, def.altitude, targetDef.altitude);
  if (!los.clear) return fail('No line of sight to target');

  state.designations[unit.side].set(target.id, state.turn);
  unit.hasActed = true;
  unit.movementLeft = 0;

  events.push({ type: 'DESIGNATED', unitId: unit.id, targetId: target.id });
  logMessage(
    state,
    unit.side,
    'CONTACT',
    `${unit.callsign} designates ${targetDef.designation} — fire mission available.`,
    target.pos,
  );
  return { ok: true, events };
}

function doDeployDecoy(
  state: GameState,
  unitId: UnitId,
  at: Hex,
  events: GameEvent[],
): CommandResult {
  const found = activeUnit(state, unitId);
  if (typeof found === 'string') return fail(found);
  const unit = found;

  if (unit.hasActed) return fail('Already acted this turn');

  const def = getUnitDef(unit.defId);
  if (!def.abilities.includes('DECOY')) return fail('Unit carries no decoys');
  if (!inBounds(state.map, at)) return fail('Deployment point off map');
  if (hexDistance(unit.pos, at) > 2) return fail('Deployment point too far');
  if (unitAt(state, at)) return fail('Hex occupied');

  const decoyDefId = `decoy_${def.nation.toLowerCase()}`;
  const decoyDef = getUnitDef(decoyDefId);

  const decoyUnit: Unit = {
    id: `u${state.nextEntityId++}`,
    defId: decoyDef.id,
    side: unit.side,
    callsign: `${unit.callsign} DECOY`,
    pos: { ...at },
    strength: decoyDef.maxStrength,
    suppression: 0,
    movementLeft: 0,
    hasActed: true,
    emitting: true,
    onOverwatch: false,
    hunkered: false,
    fortified: false,
    ammo: {},
    disturbance: 0,
    veterancy: 0,
    experience: 0,
    destroyed: false,
  };

  state.units.set(decoyUnit.id, decoyUnit);
  state.decoys.push({ unitId: decoyUnit.id, ttl: 3 });

  unit.hasActed = true;
  unit.movementLeft = 0;

  events.push({ type: 'DECOY_DEPLOYED', unitId: decoyUnit.id, at });
  logMessage(state, unit.side, 'INFO', `${unit.callsign} deploys a decoy emitter.`, at);
  return { ok: true, events };
}

function doEndTurn(state: GameState, missionOpener: Side, events: GameEvent[]): CommandResult {
  const ending = state.activeSide;
  events.push({ type: 'TURN_ENDED', side: ending, turn: state.turn });
  endSideTurn(state, missionOpener);
  return { ok: true, events };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Fork a labelled RNG stream and persist the advanced parent.
 *
 * The label includes the acting unit and target so that the dice for a given
 * attack depend only on the game state and the attack itself — never on how
 * many other actions happened first. That property is what lets the AI search
 * freely without desynchronising a replay.
 */
function forkStream(state: GameState, label: string): Rng {
  const parent = new Rng(state.rngState);
  const child = parent.fork(`${label}:t${state.turn}`);
  state.rngState = parent.save();
  return child;
}

/* ------------------------------------------------------------------ */
/* Action enumeration                                                  */
/* ------------------------------------------------------------------ */

export interface AvailableAction {
  readonly command: Command;
  readonly label: string;
  readonly enabled: boolean;
  readonly reason?: string;
}

/**
 * Every action a unit could take right now, with disabled entries retained
 * and annotated. Showing *why* an option is unavailable — "requires a tracked
 * contact" — is how the player learns the sensor-shooter rule without a
 * tutorial pop-up.
 */
export function availableActions(state: GameState, unit: Unit): AvailableAction[] {
  const actions: AvailableAction[] = [];
  const def = getUnitDef(unit.defId);

  for (const weapon of def.weapons) {
    for (const target of state.units.values()) {
      if (target.destroyed || target.side === unit.side) continue;
      const contact = state.contacts[unit.side].get(target.id);
      if (!contact) continue;

      const check = canEngage(state, unit, weapon, target);
      actions.push({
        command: { type: 'FIRE', unitId: unit.id, weaponId: weapon.id, targetId: target.id },
        label: `${weapon.name} → ${target.callsign}`,
        enabled: check.ok,
        ...(check.reason ? { reason: check.reason } : {}),
      });
    }
  }

  if (def.abilities.includes('OVERWATCH')) {
    const enabled = !unit.hasActed && suppressionState(unit) === 'STEADY';
    actions.push({
      command: { type: 'OVERWATCH', unitId: unit.id },
      label: 'Overwatch',
      enabled,
      ...(enabled ? {} : { reason: unit.hasActed ? 'Already acted' : 'Suppressed' }),
    });
  }

  actions.push({
    command: { type: 'HUNKER', unitId: unit.id },
    label: 'Hunker down',
    enabled: !unit.hasActed,
    ...(unit.hasActed ? { reason: 'Already acted' } : {}),
  });

  const hasActive = def.sensors.some((s) => s.active) || def.abilities.includes('JAM');
  if (hasActive) {
    actions.push({
      command: { type: 'SET_EMISSION', unitId: unit.id, on: !unit.emitting },
      label: unit.emitting ? 'Go EMCON silent' : 'Radiate',
      enabled: true,
    });
  }

  return actions;
}

/** Hexes a unit may legally move to this turn. */
export function legalMoves(state: GameState, unit: Unit): Hex[] {
  if (suppressionState(unit) === 'PINNED') return [];
  const reachable = computeReachable(state, unit);
  const occupied = occupancyIndex(state);
  const out: Hex[] = [];
  for (const [key, node] of reachable) {
    if (hexEquals(node.hex, unit.pos)) continue;
    if (occupied.has(key)) continue;
    out.push(node.hex);
  }
  return out;
}

/** Adjacent hexes suitable for deploying a decoy. */
export function decoySites(state: GameState, unit: Unit): Hex[] {
  return hexNeighbors(unit.pos).filter(
    (h) => inBounds(state.map, h) && !unitAt(state, h),
  );
}

export { requireUnit, fireVolume, hitProbability };
