/**
 * The opposing commander.
 *
 * A utility-scored, one-ply search over enumerated actions. Not a deep search
 * — depth is the wrong investment here. In a game where the dominant question
 * is "what do I know?", a shallow planner with a correct model of its own
 * ignorance plays far more convincingly than a deep one that cheats.
 *
 * Which leads to the rule this file exists to enforce:
 *
 *   THE AI READS ONLY ITS OWN CONTACT PICTURE.
 *
 * Every enemy lookup goes through visibleEnemies() or the contacts book. It
 * never iterates state.units to find the player. A fog-of-war game whose AI
 * peeks is not a fog-of-war game, and players detect it within one mission —
 * they notice artillery landing on units that were never observed. A test in
 * tests/ai.test.ts asserts the AI behaves identically whether or not hidden
 * enemies exist.
 */

import { hexDistance, hexKey, type Hex } from '../hex';
import { terrainAt } from '../gamemap';
import { getUnitDef } from '../registry';
import { TERRAIN } from '../terrain';
import {
  ammoFor,
  canBarrage,
  canEngage,
  previewFire,
  suppressionState,
} from '../combat';
import { computeReachable } from '../pathfind';
import { contactFor, detect, firingContactLevel, visibleEnemies } from '../sensors';
import { unitsBySide } from '../state';
import type { Command } from '../commands';
import {
  DetectionLevel,
  opposingSide,
  type GameState,
  type Side,
  type Unit,
  type UnitDef,
} from '../types';
import type { Rng } from '../rng';
import { DIFFICULTIES, DOCTRINE_BY_NATION, type DifficultySettings, type Doctrine } from './doctrine';

export interface ScoredCommand {
  readonly command: Command;
  readonly score: number;
  readonly rationale: string;
}

/* ------------------------------------------------------------------ */
/* Valuation                                                           */
/* ------------------------------------------------------------------ */

/**
 * What a unit is worth as a target. Requisition cost is the baseline, then
 * adjusted for the role it plays in the *opponent's* system rather than its
 * own stat line — a scout is cheap and is nearly always the correct thing to
 * kill first, because it is what makes the expensive things work.
 */
function targetValue(def: UnitDef, unit: Unit): number {
  let value = def.cost;

  switch (def.unitClass) {
    case 'RECON':
    case 'UAV':
      value *= 1.7;
      break;
    case 'EW':
      value *= 1.6;
      break;
    case 'MRL':
    case 'ASM':
      value *= 1.5;
      break;
    case 'SAM':
      value *= 1.35;
      break;
    default:
      break;
  }

  // A nearly dead unit is worth finishing.
  const ratio = unit.strength / Math.max(1, def.maxStrength);
  if (ratio < 0.4) value *= 1.25;

  return value;
}

/** How dangerous a known enemy is to us, used for threat mapping. */
function threatRating(def: UnitDef): number {
  let best = 0;
  for (const weapon of def.weapons) {
    const power = weapon.volley * weapon.accuracy * weapon.damage;
    best = Math.max(best, power);
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Threat map                                                          */
/* ------------------------------------------------------------------ */

/**
 * Danger at each hex, computed strictly from enemies this side has contact
 * on. Positions of stale contacts still contribute, at a discount — the AI
 * treats a last-known-position as a place something dangerous probably still
 * is, which is exactly the inference a human commander makes.
 */
export function buildThreatMap(state: GameState, side: Side): Map<number, number> {
  const threat = new Map<number, number>();
  const enemySide = opposingSide(side);

  for (const [unitId, contact] of state.contacts[side]) {
    const enemy = state.units.get(unitId);
    if (!enemy || enemy.destroyed || enemy.side !== enemySide) continue;

    const def = getUnitDef(enemy.defId);
    const rating = threatRating(def);
    if (rating <= 0) continue;

    const origin = contact.lastSeen;
    const reach = def.weapons.reduce((max, w) => Math.max(max, w.rangeMax), 1);
    const confidence = contact.stale ? 0.5 : 1;

    for (const tile of state.map.tiles.values()) {
      const distance = hexDistance(origin, tile.hex);
      if (distance > reach) continue;
      const falloff = 1 - (distance / (reach + 1)) * 0.5;
      const key = hexKey(tile.hex);
      threat.set(key, (threat.get(key) ?? 0) + rating * falloff * confidence);
    }
  }

  return threat;
}

/* ------------------------------------------------------------------ */
/* Goals                                                               */
/* ------------------------------------------------------------------ */

/**
 * Ground this side cares about. Its own objectives first; failing that, the
 * ground the *enemy* has been told to hold, which is a reliable proxy for
 * where the fight is.
 */
export function goalHexes(state: GameState, side: Side): Hex[] {
  const own = state.objectives.filter((o) => o.side === side && o.hexes?.length);
  if (own.length > 0) return own.flatMap((o) => [...(o.hexes ?? [])]);

  const enemyHeld = state.objectives.filter(
    (o) => o.side !== side && o.hexes?.length && (o.kind === 'DENY' || o.kind === 'CAPTURE'),
  );
  return enemyHeld.flatMap((o) => [...(o.hexes ?? [])]);
}

function distanceToNearestGoal(goals: readonly Hex[], from: Hex): number {
  if (goals.length === 0) return 0;
  let best = Infinity;
  for (const goal of goals) best = Math.min(best, hexDistance(from, goal));
  return best;
}

/* ------------------------------------------------------------------ */
/* Action scoring                                                      */
/* ------------------------------------------------------------------ */

interface PlanContext {
  readonly state: GameState;
  readonly side: Side;
  readonly doctrine: Doctrine;
  readonly difficulty: DifficultySettings;
  readonly threat: Map<number, number>;
  readonly goals: Hex[];
  readonly known: Unit[];
  readonly rng: Rng;
}

function scoreFireOptions(ctx: PlanContext, unit: Unit, out: ScoredCommand[]): void {
  const def = getUnitDef(unit.defId);

  for (const weapon of def.weapons) {
    if (ammoFor(unit, weapon) <= 0) continue;

    for (const target of ctx.known) {
      const check = canEngage(ctx.state, unit, weapon, target);
      if (!check.ok) continue;

      const targetDef = getUnitDef(target.defId);
      const preview = previewFire(ctx.state, unit, weapon, target);

      const value = targetValue(targetDef, target);
      const damageFraction = preview.expectedDamage / Math.max(1, targetDef.maxStrength);

      let score = damageFraction * value;

      // Finishing a unit is worth more than the raw damage suggests.
      if (preview.expectedDamage >= target.strength) score += value * 0.5;

      // Suppression has real value even when nothing dies.
      score += preview.expectedSuppression * ctx.doctrine.suppressionBias * 0.4;

      // Scarce munitions should not be spent on cheap targets.
      if (weapon.ammo !== undefined) {
        const scarcity = 1 / Math.max(1, ammoFor(unit, weapon));
        score -= scarcity * 60 * ctx.doctrine.munitionDiscipline;
      }

      // Firing is conspicuous; a battery that reveals itself may not survive.
      score -= weapon.firingSignature * 0.35 * ctx.doctrine.caution;

      out.push({
        command: { type: 'FIRE', unitId: unit.id, weaponId: weapon.id, targetId: target.id },
        score,
        rationale: `${weapon.name} on ${targetDef.designation}`,
      });
    }
  }
}

/**
 * Area fire onto remembered positions. This is how the AI acts on suspicion
 * rather than certainty, and it is what makes stale contacts dangerous to
 * leave lying around near your own units.
 */
function scoreBarrageOptions(ctx: PlanContext, unit: Unit, out: ScoredCommand[]): void {
  const def = getUnitDef(unit.defId);

  for (const weapon of def.weapons) {
    if (weapon.mode !== 'INDIRECT') continue;
    if (ammoFor(unit, weapon) <= 0) continue;

    const candidates = new Map<number, { hex: Hex; value: number }>();

    for (const [unitId, contact] of ctx.state.contacts[ctx.side]) {
      const enemy = ctx.state.units.get(unitId);
      if (!enemy || enemy.destroyed) continue;

      const enemyDef = getUnitDef(enemy.defId);
      const confidence = contact.stale ? 0.45 : 1;
      const aim = contact.lastSeen;

      if (!canBarrage(unit, weapon, aim).ok) continue;

      const key = hexKey(aim);
      const existing = candidates.get(key);
      const value = targetValue(enemyDef, enemy) * confidence;
      candidates.set(key, { hex: aim, value: (existing?.value ?? 0) + value });
    }

    for (const candidate of candidates.values()) {
      let score = candidate.value * 0.35;
      score -= weapon.firingSignature * 0.35 * ctx.doctrine.caution;

      out.push({
        command: { type: 'BARRAGE', unitId: unit.id, weaponId: weapon.id, at: candidate.hex },
        score,
        rationale: 'Fire mission on last known position',
      });
    }
  }
}

/**
 * Designation. Scored by what it *unlocks* rather than by itself: a scout
 * spending its turn painting a target is only worth it if somebody on the
 * net has a round to fire and the reach to deliver it.
 */
function scoreDesignateOptions(ctx: PlanContext, unit: Unit, out: ScoredCommand[]): void {
  const def = getUnitDef(unit.defId);
  if (!def.abilities.includes('DESIGNATE')) return;
  if (unit.hasActed) return;

  const shooters = unitsBySide(ctx.state, ctx.side).filter((u) => {
    if (u.id === unit.id || u.hasActed) return false;
    const d = getUnitDef(u.defId);
    return d.weapons.some(
      (w) => w.requires === DetectionLevel.TRACKED && ammoFor(u, w) > 0,
    );
  });
  if (shooters.length === 0) return;

  for (const target of ctx.known) {
    if (firingContactLevel(ctx.state, ctx.side, target.id) >= DetectionLevel.TRACKED) continue;

    const seen = detect(ctx.state, ctx.side, target);
    if (seen.level < DetectionLevel.IDENTIFIED) continue;

    const targetDef = getUnitDef(target.defId);

    // Only worth it if a shooter can actually reach this target.
    const reachable = shooters.some((shooter) => {
      const shooterDef = getUnitDef(shooter.defId);
      const distance = hexDistance(shooter.pos, target.pos);
      return shooterDef.weapons.some(
        (w) =>
          w.requires === DetectionLevel.TRACKED &&
          ammoFor(shooter, w) > 0 &&
          distance <= w.rangeMax &&
          distance >= w.rangeMin,
      );
    });
    if (!reachable) continue;

    const score = targetValue(targetDef, target) * 0.55 * ctx.doctrine.reconValue;
    out.push({
      command: { type: 'DESIGNATE', unitId: unit.id, targetId: target.id },
      score,
      rationale: `Designate ${targetDef.designation} for fires`,
    });
  }
}

/**
 * Positional scoring. The AI is willing to give up ground for cover and to
 * refuse a fight it cannot see into — the caution term is what stops it
 * driving vehicles one at a time into a prepared position.
 */
function scoreMoveOptions(ctx: PlanContext, unit: Unit, out: ScoredCommand[]): void {
  if (suppressionState(unit) === 'PINNED') return;
  if (unit.movementLeft <= 0) return;

  const def = getUnitDef(unit.defId);
  const reachable = computeReachable(ctx.state, unit);
  const currentGoalDistance = distanceToNearestGoal(ctx.goals, unit.pos);

  const entries = [...reachable.values()].filter((n) => n.from !== null);
  const sampled = sampleFor(ctx, entries);

  for (const node of sampled) {
    const terrain = TERRAIN[terrainAt(ctx.state.map, node.hex)];
    let score = 0;

    if (isStandoffPlatform(def)) {
      // Batteries do not take ground. A missile battery that advances onto an
      // objective has thrown away the only advantage it possesses — reach —
      // and will be overrun by whatever infantry arrives first. Keep it back.
      score += standoffValue(ctx, node.hex, def);
    } else {
      // Progress toward the ground that matters.
      const goalDistance = distanceToNearestGoal(ctx.goals, node.hex);
      score += (currentGoalDistance - goalDistance) * 22 * ctx.doctrine.objectiveDrive;
    }

    // Terrain quality, weighted by what this unit needs from it.
    score += terrain.cover * 40;
    score += terrain.concealment * 34;
    score += terrain.elevation * 10;

    // Threat avoidance.
    const threatHere = ctx.threat.get(hexKey(node.hex)) ?? 0;
    score -= threatHere * 2.2 * ctx.doctrine.caution;

    // Shooters want range on something; scouts want eyes on something.
    if (def.unitClass === 'RECON' || def.unitClass === 'UAV') {
      score += observationValue(ctx, node.hex, def) * ctx.doctrine.reconValue;
    } else {
      score += engagementValue(ctx, node.hex, def) * ctx.doctrine.aggression;
    }

    // Moving is conspicuous; standing still in good terrain is often correct.
    score -= node.cost * 1.5;

    out.push({
      command: { type: 'MOVE', unitId: unit.id, to: node.hex },
      score,
      rationale: 'Reposition',
    });
  }
}

/**
 * Long-reach indirect and missile platforms, which fight by staying away.
 * Identified by capability rather than by unit class so that a newly authored
 * weapon system gets the right behaviour without touching the planner.
 */
function isStandoffPlatform(def: UnitDef): boolean {
  return def.weapons.some(
    (w) => w.rangeMax >= 10 && (w.mode === 'MISSILE' || w.mode === 'INDIRECT'),
  );
}

/**
 * Positional value for a standoff platform: hold roughly two-thirds of your
 * reach away from anything you know about, and treat closing as a real cost.
 */
function standoffValue(ctx: PlanContext, from: Hex, def: UnitDef): number {
  let nearest = Infinity;
  for (const enemy of ctx.known) {
    nearest = Math.min(nearest, hexDistance(from, enemy.pos));
  }
  if (!Number.isFinite(nearest)) return 0;

  const reach = def.weapons.reduce((max, w) => Math.max(max, w.rangeMax), 1);
  const desired = Math.max(6, Math.round(reach * 0.6));

  return nearest >= desired ? 12 : (nearest - desired) * 14 * ctx.doctrine.caution;
}

/** How many known enemies this hex could observe, for scouts. */
function observationValue(ctx: PlanContext, from: Hex, def: UnitDef): number {
  const bestSensor = def.sensors.reduce((max, s) => Math.max(max, s.range), 0);
  let value = 0;
  for (const enemy of ctx.known) {
    const distance = hexDistance(from, enemy.pos);
    if (distance <= bestSensor) value += 18 * (1 - distance / (bestSensor + 1));
  }
  return value;
}

/** How many known enemies this hex could engage, for shooters. */
function engagementValue(ctx: PlanContext, from: Hex, def: UnitDef): number {
  let value = 0;
  for (const enemy of ctx.known) {
    const distance = hexDistance(from, enemy.pos);
    const enemyDef = getUnitDef(enemy.defId);
    for (const weapon of def.weapons) {
      if (!weapon.engages.includes(enemyDef.domain)) continue;
      if (distance > weapon.rangeMax || distance < weapon.rangeMin) continue;
      value += 16;
      break;
    }
  }
  return value;
}

function scorePostureOptions(ctx: PlanContext, unit: Unit, out: ScoredCommand[]): void {
  if (unit.hasActed) return;
  const def = getUnitDef(unit.defId);

  const threatHere = ctx.threat.get(hexKey(unit.pos)) ?? 0;

  if (def.abilities.includes('OVERWATCH') && suppressionState(unit) === 'STEADY') {
    const hasDirect = def.weapons.some((w) => w.mode === 'DIRECT' && ammoFor(unit, w) > 0);
    if (hasDirect) {
      // Overwatch is most valuable when we expect movement we cannot yet see.
      const score = 24 + (ctx.known.length === 0 ? 26 : 0);
      out.push({
        command: { type: 'OVERWATCH', unitId: unit.id },
        score,
        rationale: 'Hold overwatch',
      });
    }
  }

  if (threatHere > 40) {
    out.push({
      command: { type: 'HUNKER', unitId: unit.id },
      score: 14 + threatHere * 0.15,
      rationale: 'Take cover',
    });
  }
}

/**
 * Emissions control. The AI runs the same trade the player does: radiate when
 * there is an air threat it must engage, go dark when the cost of being heard
 * outweighs what the radar buys.
 */
function scoreEmissionOptions(ctx: PlanContext, unit: Unit, out: ScoredCommand[]): void {
  const def = getUnitDef(unit.defId);
  const hasActive = def.sensors.some((s) => s.active) || def.abilities.includes('JAM');
  if (!hasActive) return;

  const airThreat = ctx.known.some((e) => getUnitDef(e.defId).domain === 'AIR');
  const enemyHasElint = enemyFieldsElint(ctx);

  if (!unit.emitting && airThreat) {
    out.push({
      command: { type: 'SET_EMISSION', unitId: unit.id, on: true },
      score: 40 * ctx.doctrine.emissionTolerance,
      rationale: 'Radar on — air threat present',
    });
  }

  if (unit.emitting && !airThreat && enemyHasElint) {
    out.push({
      command: { type: 'SET_EMISSION', unitId: unit.id, on: false },
      score: 34 * ctx.doctrine.caution,
      rationale: 'EMCON — no air threat, hostile ELINT suspected',
    });
  }
}

/**
 * Whether the enemy is believed to field signals intelligence.
 *
 * Deliberately inferred from *observed* units only. If the AI has never seen
 * the ELINT team it will happily leave its radar on — which is precisely the
 * mistake a real commander makes, and precisely the opening the player is
 * meant to exploit in mission two.
 */
function enemyFieldsElint(ctx: PlanContext): boolean {
  return ctx.known.some((enemy) => {
    const def = getUnitDef(enemy.defId);
    return def.sensors.some((s) => s.type === 'ELINT') || def.abilities.includes('JAM');
  });
}

/** Trim candidate moves according to difficulty, deterministically. */
function sampleFor<T>(ctx: PlanContext, items: T[]): T[] {
  const breadth = ctx.difficulty.searchBreadth;
  if (breadth >= 1 || items.length <= 8) return items;
  const keep = Math.max(6, Math.floor(items.length * breadth));
  const copy = [...items];
  ctx.rng.shuffle(copy);
  return copy.slice(0, keep);
}

/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */

export interface AiOptions {
  readonly difficulty?: keyof typeof DIFFICULTIES;
}

function buildContext(
  state: GameState,
  side: Side,
  rng: Rng,
  options: AiOptions,
): PlanContext {
  const sample = unitsBySide(state, side)[0];
  const nation = sample ? getUnitDef(sample.defId).nation : 'CHN';

  return {
    state,
    side,
    doctrine: DOCTRINE_BY_NATION[nation],
    difficulty: DIFFICULTIES[options.difficulty ?? 'VETERAN']!,
    threat: buildThreatMap(state, side),
    goals: goalHexes(state, side),
    // The single source of enemy knowledge. Nothing else in this file may
    // read the opposing order of battle.
    known: visibleEnemies(state, side),
    rng,
  };
}

/**
 * Choose the single best action available to this side right now, or null if
 * there is nothing worth doing. Returning one command at a time — rather than
 * a whole turn's plan — lets the AI react to what its own first move reveals,
 * which matters enormously in a fog game.
 */
export function chooseAction(
  state: GameState,
  side: Side,
  rng: Rng,
  options: AiOptions = {},
): ScoredCommand | null {
  const ctx = buildContext(state, side, rng, options);
  const candidates: ScoredCommand[] = [];

  for (const unit of unitsBySide(state, side)) {
    if (unit.hasActed && unit.movementLeft <= 0) continue;

    scoreFireOptions(ctx, unit, candidates);
    scoreBarrageOptions(ctx, unit, candidates);
    scoreDesignateOptions(ctx, unit, candidates);
    scoreMoveOptions(ctx, unit, candidates);
    scorePostureOptions(ctx, unit, candidates);
    scoreEmissionOptions(ctx, unit, candidates);
  }

  if (candidates.length === 0) return null;

  // Difficulty noise is applied here, once, so lower difficulties make
  // genuine misjudgements rather than being handicapped mechanically.
  let best: ScoredCommand | null = null;
  for (const candidate of candidates) {
    const jitter =
      ctx.difficulty.noise > 0
        ? 1 + (ctx.rng.nextFloat() * 2 - 1) * ctx.difficulty.noise
        : 1;
    const adjusted = candidate.score * jitter;
    if (!best || adjusted > best.score) {
      best = { ...candidate, score: adjusted };
    }
  }

  // Doing nothing is better than doing something actively bad.
  if (!best || best.score <= 0) return null;
  return best;
}

/**
 * Contact quality the AI holds on a unit — exposed for tests asserting that
 * the planner cannot see through fog.
 */
export function aiContactLevel(state: GameState, side: Side, unitId: string): DetectionLevel {
  const contact = contactFor(state, side, unitId);
  if (!contact || contact.stale) return DetectionLevel.UNDETECTED;
  return contact.level;
}
