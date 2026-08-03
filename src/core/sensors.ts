/**
 * Detection, line of sight and electronic warfare — the signature system.
 *
 * This is the game's defining mechanic, so the reasoning is worth stating
 * plainly. In modern combat, finding a target is harder than killing it. Once
 * something is located precisely enough, a weapon is almost always available
 * to service it. We model that directly:
 *
 *   1. Sensing and shooting are separate capabilities on separate units.
 *      A drone finds; a rocket battery forty hexes away kills. Neither can
 *      do the other's job.
 *
 *   2. Contact has *quality*, not just presence. Knowing "something is out
 *      there" (CONTACT) is nearly useless for precision fires; you need
 *      TRACKED, and most shooters cannot generate that themselves.
 *
 *   3. Active sensing is a trade, not a free upgrade. Switching on a radar
 *      buys long-range detection and simultaneously broadcasts your position
 *      to every passive receiver in the theatre — usually further than the
 *      radar itself reaches. Emissions control is therefore a genuine, and
 *      constantly re-evaluated, tactical decision.
 *
 * Everything here is a pure function of state. No randomness: detection is
 * deterministic, so a player who loses a unit can always reconstruct exactly
 * which of their choices exposed it.
 */

import { hexDistance, hexKey, hexLine, hexRange, type Hex } from './hex';
import { elevationAt, terrainAt } from './gamemap';
import { getUnitDef } from './registry';
import { TERRAIN } from './terrain';
import {
  DetectionLevel,
  SIDES,
  opposingSide,
  type Contact,
  type GameMap,
  type GameState,
  type Sensor,
  type SensorType,
  type Side,
  type Signature,
  type Unit,
  type UnitDef,
} from './types';

/* ------------------------------------------------------------------ */
/* Tuning constants                                                    */
/* ------------------------------------------------------------------ */

/** Score thresholds for each contact tier. See docs/BALANCE.md. */
export const DETECTION_THRESHOLDS = Object.freeze({
  CONTACT: 25,
  IDENTIFIED: 55,
  TRACKED: 85,
});

/** Signature added to a unit's RF profile while its active sensors are on. */
export const EMISSION_RF_PENALTY = 65;

/**
 * Signature that a sensor of a given power is calibrated against. Lowering
 * this makes every sensor in the game more capable; it is the single global
 * dial for how thick the fog is, and is tuned in docs/BALANCE.md.
 */
export const SIGNATURE_REFERENCE = 24;

/** Disturbance added when a unit moves, and the decay applied each turn. */
export const MOVE_DISTURBANCE = 14;
export const DISTURBANCE_DECAY = 0.5;

/** Turns a stale contact is remembered before it drops off the map entirely. */
export const STALE_MEMORY_TURNS = 3;

/** Which signature channel each sensor modality reads. */
const SPECTRUM: Readonly<Record<SensorType, keyof Signature>> = Object.freeze({
  OPTICAL: 'visual',
  THERMAL: 'thermal',
  RADAR: 'radar',
  ELINT: 'rf',
  ACOUSTIC: 'acoustic',
});

/**
 * How much terrain concealment suppresses each channel. Foliage hides you
 * from eyes almost completely, from thermal partially, and does very little
 * against radar or a radio direction finder — which is why a jungle is not a
 * universal answer.
 */
const CONCEALMENT_WEIGHT: Readonly<Record<SensorType, number>> = Object.freeze({
  OPTICAL: 1.0,
  // Canopy and heavy foliage defeat thermal nearly as well as they defeat
  // the eye — it is overhead cover, not darkness, that thermal sees through.
  THERMAL: 0.8,
  RADAR: 0.3,
  ELINT: 0.0,
  ACOUSTIC: 0.25,
});

/** How strongly recent activity feeds each channel. */
const DISTURBANCE_WEIGHT: Readonly<Record<SensorType, number>> = Object.freeze({
  OPTICAL: 0.8,
  THERMAL: 1.0,
  RADAR: 0.4,
  ELINT: 0.7,
  ACOUSTIC: 1.2,
});

/**
 * Ceiling on contact quality per modality. Acoustic bearing tells you
 * something heavy is moving out there and nothing more; optics and radar can
 * generate a firing solution. ELINT is special-cased below: against an active
 * emitter it reaches TRACKED, which is precisely how anti-radiation targeting
 * works, and is the punishment for leaving a radar on.
 */
const SENSOR_CEILING: Readonly<Record<SensorType, DetectionLevel>> = Object.freeze({
  OPTICAL: DetectionLevel.TRACKED,
  THERMAL: DetectionLevel.TRACKED,
  RADAR: DetectionLevel.TRACKED,
  ELINT: DetectionLevel.IDENTIFIED,
  ACOUSTIC: DetectionLevel.CONTACT,
});

/* ------------------------------------------------------------------ */
/* Line of sight                                                       */
/* ------------------------------------------------------------------ */

export interface LosResult {
  readonly clear: boolean;
  /** Accumulated obstruction, 0 (clear) to 1 (fully blocked). */
  readonly obstruction: number;
}

/**
 * Line of sight from one hex to another, accounting for elevation and
 * intervening cover.
 *
 * Elevation works two ways: a tile taller than both endpoints blocks
 * outright, and height advantage lets an observer see over lower features.
 * The result is symmetric for equal altitudes, which the tests assert — an
 * asymmetric LOS model produces situations players correctly read as bugs.
 */
export function lineOfSight(
  map: GameMap,
  from: Hex,
  to: Hex,
  fromAltitude = 0,
  toAltitude = 0,
): LosResult {
  if (hexDistance(from, to) <= 1) return { clear: true, obstruction: 0 };

  const fromElev = elevationAt(map, from) + fromAltitude;
  const toElev = elevationAt(map, to) + toAltitude;
  const highestEnd = Math.max(fromElev, toElev);

  const line = hexLine(from, to);
  let obstruction = 0;

  for (let i = 1; i < line.length - 1; i++) {
    const h = line[i]!;
    const def = TERRAIN[terrainAt(map, h)];

    // Ground higher than both observer and target blocks completely.
    if (def.elevation > highestEnd) return { clear: false, obstruction: 1 };

    // Height advantage progressively defeats surface features.
    const advantage = Math.max(fromElev - def.elevation, toElev - def.elevation);
    const relief = Math.max(0, 1 - Math.max(0, advantage) * 0.35);
    obstruction += def.losBlock * relief;

    if (obstruction >= 1) return { clear: false, obstruction: 1 };
  }

  return { clear: true, obstruction };
}

/* ------------------------------------------------------------------ */
/* Signature                                                           */
/* ------------------------------------------------------------------ */

/**
 * A unit's effective signature in one modality, after terrain, posture and
 * recent activity. This is the number the player is implicitly managing all
 * game, and the UI surfaces it directly on the unit panel.
 */
export function effectiveSignature(
  map: GameMap,
  unit: Unit,
  def: UnitDef,
  modality: SensorType,
): number {
  const channel = SPECTRUM[modality];
  let value = def.signature[channel];

  const terrain = TERRAIN[terrainAt(map, unit.pos)];
  value *= 1 - terrain.concealment * CONCEALMENT_WEIGHT[modality];

  // Posture. Hunkering is a real reduction, which is what makes it worth
  // giving up an action for.
  if (unit.hunkered) value *= 0.55;
  if (unit.fortified) value *= 0.8;

  // Damaged units burn, shed crew and lose discipline — they get louder.
  const strengthRatio = unit.strength / Math.max(1, def.maxStrength);
  if (strengthRatio < 0.5 && modality === 'THERMAL') value *= 1.15;

  value += unit.disturbance * DISTURBANCE_WEIGHT[modality];

  // Emissions control. A unit running dark is not merely quieter by default —
  // it is actively minimising transmissions, so its residual RF falls well
  // below the roster's nominal figure. Switching an emitter on reverses that
  // completely. Modelling the gap here rather than in per-unit signature data
  // keeps the trade sharp across the whole roster and means a designer cannot
  // accidentally author a unit that defeats emissions control.
  if (modality === 'ELINT') {
    value = unit.emitting ? value + EMISSION_RF_PENALTY : value * 0.3;
  }

  return Math.max(0, value);
}

/* ------------------------------------------------------------------ */
/* Jamming                                                             */
/* ------------------------------------------------------------------ */

/**
 * Recompute jamming footprints. Jammers degrade RADAR and ELINT scores
 * within their radius. They are themselves extremely loud in RF — jamming is
 * the single most conspicuous thing a unit can do, and an alert opponent
 * should always be able to find and kill a jammer that stays put.
 */
export function computeJamming(state: GameState): void {
  state.jamming.clear();
  for (const unit of state.units.values()) {
    if (unit.destroyed || !unit.emitting) continue;
    const def = getUnitDef(unit.defId);
    if (!def.abilities.includes('JAM')) continue;

    const radius = 5;
    const power = 30 * (unit.strength / Math.max(1, def.maxStrength));
    for (const h of hexRange(unit.pos, radius)) {
      const falloff = 1 - hexDistance(unit.pos, h) / (radius + 1);
      const key = hexKey(h);
      const existing = state.jamming.get(key) ?? 0;
      // Overlapping jammers do not stack linearly; take the strongest.
      state.jamming.set(key, Math.max(existing, power * falloff));
    }
  }
}

export function jammingAt(state: GameState, h: Hex): number {
  return state.jamming.get(hexKey(h)) ?? 0;
}

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

export interface DetectionResult {
  readonly level: DetectionLevel;
  readonly score: number;
  readonly modality: SensorType | null;
}

/** Whether a sensor is usable this instant, given emissions control. */
export function sensorAvailable(sensor: Sensor, observer: Unit): boolean {
  if (!sensor.active) return true;
  return observer.emitting;
}

/**
 * Score one observer's single sensor against one target.
 * Returns 0 when the sensor cannot engage the problem at all.
 */
export function sensorScore(
  state: GameState,
  observer: Unit,
  observerDef: UnitDef,
  sensor: Sensor,
  target: Unit,
  targetDef: UnitDef,
): number {
  if (!sensor.detects.includes(targetDef.domain)) return 0;
  if (!sensorAvailable(sensor, observer)) return 0;

  const distance = hexDistance(observer.pos, target.pos);
  if (distance > sensor.range) return 0;

  let obstructionPenalty = 0;
  if (sensor.needsLineOfSight) {
    const los = lineOfSight(
      state.map,
      observer.pos,
      target.pos,
      observerDef.altitude,
      targetDef.altitude,
    );
    if (!los.clear) return 0;
    obstructionPenalty = los.obstruction * 45;
  }

  const signature = effectiveSignature(state.map, target, targetDef, sensor.type);
  if (signature <= 0) return 0;

  // Sensors degrade with range but never fall off a cliff inside their
  // envelope; the cliff is at the envelope edge.
  const rangeFactor = 1 - 0.55 * (distance / Math.max(1, sensor.range));

  // Degraded crews sense worse as well as shoot worse.
  const crewFactor = 0.6 + 0.4 * (observer.strength / Math.max(1, observerDef.maxStrength));

  let score = sensor.power * rangeFactor * crewFactor * (signature / SIGNATURE_REFERENCE);
  score -= obstructionPenalty;

  if (sensor.type === 'RADAR' || sensor.type === 'ELINT') {
    score -= jammingAt(state, observer.pos);
  }

  score = Math.max(0, score);

  // Concealment buys distance, not immunity.
  //
  // Without this floor, very low-signature units — dismounted reconnaissance
  // above all — stay below the identification threshold even when adjacent,
  // and since direct fire requires a positive identification they become
  // literally unengageable at point-blank range. A scout should be able to
  // hide from an observer a kilometre away and not from one in the next
  // field.
  if (sensor.needsLineOfSight) {
    if (distance <= 1) score = Math.max(score, DETECTION_THRESHOLDS.IDENTIFIED + 2);
    else if (distance <= 2) score = Math.max(score, DETECTION_THRESHOLDS.CONTACT + 2);
  }

  return score;
}

function levelFromScore(score: number): DetectionLevel {
  if (score >= DETECTION_THRESHOLDS.TRACKED) return DetectionLevel.TRACKED;
  if (score >= DETECTION_THRESHOLDS.IDENTIFIED) return DetectionLevel.IDENTIFIED;
  if (score >= DETECTION_THRESHOLDS.CONTACT) return DetectionLevel.CONTACT;
  return DetectionLevel.UNDETECTED;
}

function ceilingFor(modality: SensorType, target: Unit): DetectionLevel {
  // Anti-radiation case: a live emitter can be tracked precisely by passive
  // means alone. This is the whole cost of leaving the radar on.
  if (modality === 'ELINT' && target.emitting) return DetectionLevel.TRACKED;
  return SENSOR_CEILING[modality];
}

/** Best detection any of `side`'s units currently holds on `target`. */
export function detect(state: GameState, side: Side, target: Unit): DetectionResult {
  let best: DetectionResult = { level: DetectionLevel.UNDETECTED, score: 0, modality: null };
  const targetDef = getUnitDef(target.defId);

  for (const observer of state.units.values()) {
    if (observer.side !== side || observer.destroyed) continue;
    const observerDef = getUnitDef(observer.defId);

    for (const sensor of observerDef.sensors) {
      const score = sensorScore(state, observer, observerDef, sensor, target, targetDef);
      if (score <= 0) continue;

      const raw = levelFromScore(score);
      const level = Math.min(raw, ceilingFor(sensor.type, target)) as DetectionLevel;
      if (level === DetectionLevel.UNDETECTED) continue;

      if (level > best.level || (level === best.level && score > best.score)) {
        best = { level, score, modality: sensor.type };
      }
    }
  }

  return best;
}

/** Every modality currently holding a contact, for the UI's contact readout. */
export function detectingModalities(state: GameState, side: Side, target: Unit): SensorType[] {
  const found = new Set<SensorType>();
  const targetDef = getUnitDef(target.defId);

  for (const observer of state.units.values()) {
    if (observer.side !== side || observer.destroyed) continue;
    const observerDef = getUnitDef(observer.defId);
    for (const sensor of observerDef.sensors) {
      if (found.has(sensor.type)) continue;
      const score = sensorScore(state, observer, observerDef, sensor, target, targetDef);
      if (score > 0 && levelFromScore(score) > DetectionLevel.UNDETECTED) {
        found.add(sensor.type);
      }
    }
  }
  return [...found];
}

/* ------------------------------------------------------------------ */
/* Contact bookkeeping                                                 */
/* ------------------------------------------------------------------ */

/**
 * Recompute both sides' contact pictures.
 *
 * Losing sight of something does not erase it: the contact degrades to a
 * stale marker at its last known position and lingers for a few turns. That
 * ghost is what makes displacement worthwhile — you are not hiding from the
 * enemy so much as invalidating their picture.
 */
export function updateContacts(state: GameState): void {
  computeJamming(state);

  for (const side of SIDES) {
    const enemy = opposingSide(side);
    const book = state.contacts[side];

    for (const unit of state.units.values()) {
      if (unit.side !== enemy) continue;

      if (unit.destroyed) {
        book.delete(unit.id);
        continue;
      }

      const result = detect(state, side, unit);
      const existing = book.get(unit.id);

      if (result.level > DetectionLevel.UNDETECTED) {
        const modalities = detectingModalities(state, side, unit);
        const contact: Contact = {
          unitId: unit.id,
          level: result.level,
          lastSeen: { ...unit.pos },
          lastSeenTurn: state.turn,
          by: modalities,
          stale: false,
        };
        book.set(unit.id, contact);
      } else if (existing) {
        const age = state.turn - existing.lastSeenTurn;
        if (age >= STALE_MEMORY_TURNS) {
          book.delete(unit.id);
        } else {
          existing.stale = true;
          // A remembered contact is only ever "something was here".
          existing.level = DetectionLevel.CONTACT;
          existing.by = [];
        }
      }
    }
  }
}

export function contactFor(state: GameState, side: Side, unitId: string): Contact | undefined {
  return state.contacts[side].get(unitId);
}

/** Contact quality `side` holds on `unitId`, UNDETECTED if none. */
export function contactLevel(state: GameState, side: Side, unitId: string): DetectionLevel {
  const contact = state.contacts[side].get(unitId);
  if (!contact || contact.stale) {
    return contact?.stale ? DetectionLevel.CONTACT : DetectionLevel.UNDETECTED;
  }
  return contact.level;
}

/**
 * Live (non-stale) contact quality — what weapons are actually allowed to use.
 *
 * An active designation overrides the organic sensor picture and grants
 * TRACKED. This is the handoff that makes long-range fires usable: the drone
 * holds the target, the battery forty hexes away shoots it.
 */
export function firingContactLevel(
  state: GameState,
  side: Side,
  unitId: string,
): DetectionLevel {
  const designatedUntil = state.designations[side].get(unitId);
  if (designatedUntil !== undefined && designatedUntil >= state.turn) {
    return DetectionLevel.TRACKED;
  }
  const contact = state.contacts[side].get(unitId);
  if (!contact || contact.stale) return DetectionLevel.UNDETECTED;
  return contact.level;
}

/** Drop designations that have lapsed. Called at the start of each turn. */
export function expireDesignations(state: GameState): void {
  for (const side of SIDES) {
    for (const [unitId, until] of [...state.designations[side]]) {
      if (until < state.turn) state.designations[side].delete(unitId);
    }
  }
}

/** All enemy units `side` can currently see, at any contact quality. */
export function visibleEnemies(state: GameState, side: Side): Unit[] {
  const out: Unit[] = [];
  for (const [unitId, contact] of state.contacts[side]) {
    if (contact.stale) continue;
    const unit = state.units.get(unitId);
    if (unit && !unit.destroyed) out.push(unit);
  }
  return out;
}

/**
 * Decay recent-activity signature at the start of a side's turn. Called by
 * the turn machinery in state.ts.
 */
export function decayDisturbance(state: GameState, side: Side): void {
  for (const unit of state.units.values()) {
    if (unit.side !== side || unit.destroyed) continue;
    unit.disturbance = Math.max(0, unit.disturbance * DISTURBANCE_DECAY);
    if (unit.disturbance < 0.5) unit.disturbance = 0;
  }
}

/**
 * Total sensor footprint of a side, for the UI's coverage overlay. Returns
 * the best detection score achievable against a notional average target at
 * each hex, which is what lets a player see the shape of their own coverage
 * and, more importantly, its gaps.
 */
export function sensorCoverage(state: GameState, side: Side): Map<number, number> {
  const coverage = new Map<number, number>();
  const REFERENCE_SIGNATURE = 45;

  for (const observer of state.units.values()) {
    if (observer.side !== side || observer.destroyed) continue;
    const observerDef = getUnitDef(observer.defId);

    for (const sensor of observerDef.sensors) {
      if (!sensorAvailable(sensor, observer)) continue;
      if (!sensor.detects.includes('LAND')) continue;

      for (const h of hexRange(observer.pos, sensor.range)) {
        if (!state.map.tiles.has(hexKey(h))) continue;

        if (sensor.needsLineOfSight) {
          const los = lineOfSight(state.map, observer.pos, h, observerDef.altitude, 0);
          if (!los.clear) continue;
        }

        const distance = hexDistance(observer.pos, h);
        const rangeFactor = 1 - 0.55 * (distance / Math.max(1, sensor.range));
        const score = sensor.power * rangeFactor * (REFERENCE_SIGNATURE / SIGNATURE_REFERENCE);

        const key = hexKey(h);
        coverage.set(key, Math.max(coverage.get(key) ?? 0, score));
      }
    }
  }

  return coverage;
}
