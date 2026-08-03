/**
 * Game state construction and the turn machinery.
 *
 * GameState is deliberately a plain object graph with Maps: structurally
 * clonable, cheap to snapshot, and free of behaviour. All mutation happens
 * through commands.ts, which is what keeps replays honest.
 */

import { hexEquals, hexKey, type Hex } from './hex';
import { getUnitDef } from './registry';
import { Rng, type RngState } from './rng';
import { recoverSuppression } from './combat';
import { decayDisturbance, expireDesignations, updateContacts } from './sensors';
import type { MissionDef, Deployment } from './mission';
import {
  SIDES,
  opposingSide,
  type GameState,
  type LogEntry,
  type LogSeverity,
  type Side,
  type Unit,
  type UnitId,
} from './types';

/* ------------------------------------------------------------------ */
/* Callsigns                                                           */
/* ------------------------------------------------------------------ */

const CALLSIGN_POOL: Readonly<Record<string, readonly string[]>> = Object.freeze({
  USA: ['HAMMER', 'REAPER', 'OUTLAW', 'VIPER', 'ANVIL', 'DAGGER', 'TALON', 'WARLOCK'],
  JPN: ['KAZE', 'HAYATE', 'ASAHI', 'SHINRAI', 'KOGARASHI', 'TSUBAME'],
  AUS: ['BOOMER', 'STOCKMAN', 'BRUMBY', 'WARATAH', 'DINGO'],
  CHN: ['CHANGCHENG', 'FEILONG', 'HAIYAN', 'LEITING', 'QINGTING', 'BEIDOU'],
});

/**
 * Deterministic callsign assignment. Uses a counter rather than randomness so
 * the same mission always produces the same order of battle — players quote
 * callsigns to each other, and they must be stable across restarts.
 */
function assignCallsign(nation: string, index: number): string {
  const pool = CALLSIGN_POOL[nation] ?? CALLSIGN_POOL.USA!;
  const name = pool[index % pool.length]!;
  const suffix = Math.floor(index / pool.length) + 1;
  return `${name} ${suffix}-${(index % 4) + 1}`;
}

/* ------------------------------------------------------------------ */
/* Unit construction                                                   */
/* ------------------------------------------------------------------ */

export function createUnit(
  id: UnitId,
  deployment: Deployment,
  callsignIndex: number,
): Unit {
  const def = getUnitDef(deployment.defId);
  const ammo: Record<string, number> = {};
  for (const weapon of def.weapons) {
    if (weapon.ammo !== undefined) ammo[weapon.id] = weapon.ammo;
  }

  return {
    id,
    defId: def.id,
    side: deployment.side,
    callsign: deployment.callsign ?? assignCallsign(def.nation, callsignIndex),
    pos: { ...deployment.pos },
    strength: def.maxStrength,
    suppression: 0,
    movementLeft: def.movement,
    hasActed: false,
    emitting: deployment.emitting ?? false,
    onOverwatch: false,
    hunkered: false,
    fortified: deployment.fortified ?? false,
    ammo,
    disturbance: 0,
    veterancy: deployment.veterancy ?? 0,
    experience: 0,
    destroyed: false,
  };
}

/* ------------------------------------------------------------------ */
/* State construction                                                  */
/* ------------------------------------------------------------------ */

export function createGameState(mission: MissionDef, seed: string): GameState {
  const rng = new Rng(seed);

  const state: GameState = {
    missionId: mission.id,
    seed,
    turn: 1,
    maxTurns: mission.maxTurns,
    activeSide: mission.playerSide,
    phase: 'BATTLE',
    outcome: 'ONGOING',
    map: mission.buildMap(),
    units: new Map(),
    contacts: { BLUE: new Map(), RED: new Map() },
    designations: { BLUE: new Map(), RED: new Map() },
    jamming: new Map(),
    decoys: [],
    objectives: mission.buildObjectives(),
    nextEntityId: 1,
    log: [],
    rngState: rng.save(),
  };

  const callsignCounters: Record<string, number> = {};
  for (const deployment of mission.deployments) {
    const def = getUnitDef(deployment.defId);
    const index = callsignCounters[def.nation] ?? 0;
    callsignCounters[def.nation] = index + 1;

    const unit = createUnit(`u${state.nextEntityId++}`, deployment, index);
    state.units.set(unit.id, unit);
  }

  updateContacts(state);

  pushLog(state, {
    turn: 1,
    side: mission.playerSide,
    severity: 'INFO',
    message: `${mission.operation} — ${mission.name}. ${mission.maxTurns} turns.`,
  });

  return state;
}

/* ------------------------------------------------------------------ */
/* RNG access                                                          */
/* ------------------------------------------------------------------ */

/**
 * Run `fn` with a forked stream, persisting the parent state afterwards.
 *
 * Forking by label is what stops the AI's deliberation from perturbing combat
 * rolls: however long the opponent thinks, the dice for a given attack are
 * the same. Without this, replays desync the moment AI depth changes.
 */
export function withRng<T>(state: GameState, label: string, fn: (rng: Rng) => T): T {
  const parent = new Rng(state.rngState);
  const child = parent.fork(`${label}:t${state.turn}:${state.activeSide}`);
  const result = fn(child);
  state.rngState = parent.save();
  return result;
}

export function rngState(state: GameState): RngState {
  return state.rngState;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export function unitAt(state: GameState, h: Hex): Unit | undefined {
  for (const unit of state.units.values()) {
    if (!unit.destroyed && hexEquals(unit.pos, h)) return unit;
  }
  return undefined;
}

export function unitsBySide(state: GameState, side: Side): Unit[] {
  const out: Unit[] = [];
  for (const unit of state.units.values()) {
    if (unit.side === side && !unit.destroyed) out.push(unit);
  }
  return out;
}

export function livingUnits(state: GameState): Unit[] {
  return [...state.units.values()].filter((u) => !u.destroyed);
}

export function requireUnit(state: GameState, id: UnitId): Unit {
  const unit = state.units.get(id);
  if (!unit) throw new Error(`Unknown unit: ${id}`);
  return unit;
}

/** Occupancy index, rebuilt on demand. Cheap at our unit counts. */
export function occupancyIndex(state: GameState): Map<number, Unit> {
  const index = new Map<number, Unit>();
  for (const unit of state.units.values()) {
    if (!unit.destroyed) index.set(hexKey(unit.pos), unit);
  }
  return index;
}

/* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */

export function pushLog(state: GameState, entry: LogEntry): void {
  state.log.push(entry);
}

export function logMessage(
  state: GameState,
  side: Side,
  severity: LogSeverity,
  message: string,
  at?: Hex,
): void {
  state.log.push({ turn: state.turn, side, severity, message, ...(at ? { at } : {}) });
}

/* ------------------------------------------------------------------ */
/* Turn machinery                                                      */
/* ------------------------------------------------------------------ */

/**
 * Start-of-turn housekeeping for one side: reset action budgets, recover
 * suppression, decay recent-activity signature, expire decoys, then rebuild
 * the contact picture so the player sees the world as it is now.
 */
export function beginSideTurn(state: GameState, side: Side): void {
  state.activeSide = side;

  for (const unit of state.units.values()) {
    if (unit.side !== side || unit.destroyed) continue;
    const def = getUnitDef(unit.defId);

    recoverSuppression(unit, def);
    unit.movementLeft = def.movement;
    unit.hasActed = false;
    // Overwatch and hunkering are postures held only until your next turn.
    unit.onOverwatch = false;
    unit.hunkered = false;
  }

  decayDisturbance(state, side);
  expireDesignations(state);

  for (const decoy of state.decoys) {
    const unit = state.units.get(decoy.unitId);
    if (!unit || unit.destroyed) continue;
    if (unit.side !== side) continue;
    decoy.ttl -= 1;
    if (decoy.ttl <= 0) {
      unit.destroyed = true;
      unit.destroyedTurn = state.turn;
      logMessage(state, side, 'INFO', `${unit.callsign} decoy emitter exhausted.`, unit.pos);
    }
  }
  state.decoys = state.decoys.filter((d) => {
    const unit = state.units.get(d.unitId);
    return d.ttl > 0 && unit && !unit.destroyed;
  });

  updateContacts(state);
}

/**
 * Advance to the other side, incrementing the turn counter when play returns
 * to the side that opened the mission.
 */
export function endSideTurn(state: GameState, missionOpener: Side): void {
  const next = opposingSide(state.activeSide);
  if (next === missionOpener) state.turn += 1;
  beginSideTurn(state, next);
}

/** True when every unit on the active side has finished acting. */
export function sideIsDone(state: GameState, side: Side): boolean {
  return unitsBySide(state, side).every((u) => u.hasActed && u.movementLeft <= 0);
}

/* ------------------------------------------------------------------ */
/* Serialization                                                       */
/* ------------------------------------------------------------------ */

interface SerializedState {
  readonly version: 1;
  readonly missionId: string;
  readonly seed: string;
  readonly turn: number;
  readonly maxTurns: number;
  readonly activeSide: Side;
  readonly phase: GameState['phase'];
  readonly outcome: GameState['outcome'];
  readonly tiles: Array<[number, { hex: Hex; terrain: string; objective?: string }]>;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly units: Unit[];
  readonly contacts: Record<Side, Array<[string, unknown]>>;
  readonly designations: Record<Side, Array<[string, number]>>;
  readonly decoys: GameState['decoys'];
  readonly objectives: GameState['objectives'];
  readonly nextEntityId: number;
  readonly log: LogEntry[];
  readonly rngState: RngState;
}

/**
 * JSON-safe snapshot. Maps do not survive JSON.stringify, so they are
 * flattened to entry arrays here and rehydrated on load.
 */
export function serializeState(state: GameState): string {
  const payload: SerializedState = {
    version: 1,
    missionId: state.missionId,
    seed: state.seed,
    turn: state.turn,
    maxTurns: state.maxTurns,
    activeSide: state.activeSide,
    phase: state.phase,
    outcome: state.outcome,
    tiles: [...state.map.tiles].map(([key, tile]) => [
      key,
      { hex: tile.hex, terrain: tile.terrain, ...(tile.objective ? { objective: tile.objective } : {}) },
    ]),
    mapWidth: state.map.width,
    mapHeight: state.map.height,
    units: [...state.units.values()],
    contacts: {
      BLUE: [...state.contacts.BLUE],
      RED: [...state.contacts.RED],
    },
    designations: {
      BLUE: [...state.designations.BLUE],
      RED: [...state.designations.RED],
    },
    decoys: state.decoys,
    objectives: state.objectives,
    nextEntityId: state.nextEntityId,
    log: state.log,
    rngState: state.rngState,
  };
  return JSON.stringify(payload);
}

export function deserializeState(json: string): GameState {
  const data = JSON.parse(json) as SerializedState;
  if (data.version !== 1) throw new Error(`Unsupported save version: ${data.version}`);

  const tiles = new Map(
    data.tiles.map(([key, tile]) => [
      key,
      { hex: tile.hex, terrain: tile.terrain as never, objective: tile.objective },
    ]),
  );

  const state: GameState = {
    missionId: data.missionId,
    seed: data.seed,
    turn: data.turn,
    maxTurns: data.maxTurns,
    activeSide: data.activeSide,
    phase: data.phase,
    outcome: data.outcome,
    map: { width: data.mapWidth, height: data.mapHeight, tiles },
    units: new Map(data.units.map((u) => [u.id, u])),
    contacts: {
      BLUE: new Map(data.contacts.BLUE as Array<[string, never]>),
      RED: new Map(data.contacts.RED as Array<[string, never]>),
    },
    designations: {
      BLUE: new Map(data.designations?.BLUE ?? []),
      RED: new Map(data.designations?.RED ?? []),
    },
    jamming: new Map(),
    decoys: data.decoys,
    objectives: data.objectives,
    nextEntityId: data.nextEntityId,
    log: data.log,
    rngState: data.rngState,
  };

  updateContacts(state);
  return state;
}

export { SIDES };
