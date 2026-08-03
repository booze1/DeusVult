/**
 * Combat resolution.
 *
 * The design problem with percentage-to-hit tactics games is the whiff: a
 * single coin flip decides an entire turn, and a missed 95% feels like the
 * game cheated. We keep genuine probability but remove the whiff by
 * resolving at the correct scale.
 *
 * A counter is a platoon. When it attacks it is not taking one shot, it is
 * putting `volley` rounds of effective fire downrange. Outcomes are therefore
 * binomial, and a binomial with n around 4-10 clusters hard around its mean:
 * the player sees "expected 3, likely 2-5" and gets 2-5 almost every time.
 * Variance is real, and it is bounded and legible.
 *
 * Two further consequences fall out of modelling it this way, both good:
 *
 *   - Damaged units fire *fewer* rounds rather than becoming inaccurate,
 *     which is both truer and mechanically clearer.
 *   - Rounds that do not kill still suppress. There is no wasted attack, so
 *     firing to pin an enemy is a real tactic rather than a consolation.
 */

import { hexDistance, type Hex } from './hex';
import { terrainAt } from './gamemap';
import { getUnitDef } from './registry';
import { binomialInterval } from './rng';
import { TERRAIN } from './terrain';
import { firingContactLevel, lineOfSight } from './sensors';
import {
  DetectionLevel,
  type GameState,
  type Unit,
  type UnitDef,
  type Weapon,
} from './types';
import type { Rng } from './rng';

/* ------------------------------------------------------------------ */
/* Suppression                                                         */
/* ------------------------------------------------------------------ */

export const SUPPRESSION_SUPPRESSED = 40;
export const SUPPRESSION_PINNED = 75;
export const SUPPRESSION_MAX = 100;

export type SuppressionState = 'STEADY' | 'SUPPRESSED' | 'PINNED';

export function suppressionState(unit: Unit): SuppressionState {
  if (unit.suppression >= SUPPRESSION_PINNED) return 'PINNED';
  if (unit.suppression >= SUPPRESSION_SUPPRESSED) return 'SUPPRESSED';
  return 'STEADY';
}

/** Accuracy multiplier applied to a shooter based on its own suppression. */
export function suppressionAccuracyFactor(unit: Unit): number {
  switch (suppressionState(unit)) {
    case 'PINNED':
      return 0.35;
    case 'SUPPRESSED':
      return 0.65;
    default:
      return 1;
  }
}

/** Movement multiplier from suppression. Pinned units do not move. */
export function suppressionMovementFactor(unit: Unit): number {
  switch (suppressionState(unit)) {
    case 'PINNED':
      return 0;
    case 'SUPPRESSED':
      return 0.5;
    default:
      return 1;
  }
}

/**
 * Suppression recovery at the start of the owner's turn. Discipline is the
 * main differentiator between a veteran mechanised platoon and a hastily
 * mobilised one, and it compounds with campaign veterancy.
 */
export function recoverSuppression(unit: Unit, def: UnitDef): void {
  const veterancyBonus = unit.veterancy * 3;
  let recovery = 18 + def.discipline * 22 + veterancyBonus;
  if (unit.hunkered) recovery += 15;
  unit.suppression = Math.max(0, unit.suppression - recovery);
}

/* ------------------------------------------------------------------ */
/* Engagement legality                                                 */
/* ------------------------------------------------------------------ */

export interface EngagementCheck {
  readonly ok: boolean;
  readonly reason?: string;
}

export function ammoFor(unit: Unit, weapon: Weapon): number {
  if (weapon.ammo === undefined) return Infinity;
  return unit.ammo[weapon.id] ?? 0;
}

/**
 * Whether `attacker` may fire `weapon` at `target` right now.
 *
 * The contact-quality gate is the load-bearing rule of the whole game: a
 * missile battery with a forty-hex reach is inert until somebody else
 * generates a TRACKED contact for it.
 */
export function canEngage(
  state: GameState,
  attacker: Unit,
  weapon: Weapon,
  target: Unit,
): EngagementCheck {
  if (attacker.destroyed) return { ok: false, reason: 'Unit destroyed' };
  if (target.destroyed) return { ok: false, reason: 'Target destroyed' };
  if (attacker.side === target.side) return { ok: false, reason: 'Friendly unit' };
  if (attacker.hasActed) return { ok: false, reason: 'Already acted this turn' };

  if (suppressionState(attacker) === 'PINNED' && weapon.mode !== 'DIRECT') {
    return { ok: false, reason: 'Pinned — direct fire only' };
  }

  const targetDef = getUnitDef(target.defId);
  if (!weapon.engages.includes(targetDef.domain)) {
    return { ok: false, reason: `Cannot engage ${targetDef.domain.toLowerCase()} targets` };
  }

  if (ammoFor(attacker, weapon) <= 0) {
    return { ok: false, reason: 'No rounds remaining' };
  }

  const distance = hexDistance(attacker.pos, target.pos);
  if (distance > weapon.rangeMax) return { ok: false, reason: 'Out of range' };
  if (distance < weapon.rangeMin) return { ok: false, reason: 'Inside minimum range' };

  const contact = firingContactLevel(state, attacker.side, target.id);
  if (contact < weapon.requires) {
    const needed =
      weapon.requires === DetectionLevel.TRACKED
        ? 'a tracked contact — designate the target with a scout or drone'
        : 'a positive identification';
    return { ok: false, reason: `Requires ${needed}` };
  }

  if (weapon.mode === 'DIRECT') {
    const attackerDef = getUnitDef(attacker.defId);
    const los = lineOfSightBetween(state, attacker, attackerDef, target, targetDef);
    if (!los) return { ok: false, reason: 'No line of sight' };
  }

  return { ok: true };
}

function lineOfSightBetween(
  state: GameState,
  attacker: Unit,
  attackerDef: UnitDef,
  target: Unit,
  targetDef: UnitDef,
): boolean {
  return lineOfSight(
    state.map,
    attacker.pos,
    target.pos,
    attackerDef.altitude,
    targetDef.altitude,
  ).clear;
}

/* ------------------------------------------------------------------ */
/* Hit probability and volume                                          */
/* ------------------------------------------------------------------ */

/**
 * Rounds of effective fire this attack puts out. Scales with the shooter's
 * remaining strength: a platoon down to a third of its vehicles simply cannot
 * generate the same volume.
 */
export function fireVolume(attacker: Unit, attackerDef: UnitDef, weapon: Weapon): number {
  const ratio = attacker.strength / Math.max(1, attackerDef.maxStrength);
  return Math.max(1, Math.round(weapon.volley * ratio));
}

/**
 * Per-round hit probability, after every modifier.
 *
 * Kept as one auditable function because the fire preview shows the player
 * this exact number, and a preview that disagrees with resolution by even a
 * point destroys trust in the whole system.
 */
export function hitProbability(
  state: GameState,
  attacker: Unit,
  attackerDef: UnitDef,
  weapon: Weapon,
  target: Unit,
  targetDef: UnitDef,
): number {
  let p = weapon.accuracy;

  // Range. Weapons are most accurate in the first third of their envelope
  // and degrade toward the edge.
  const distance = hexDistance(attacker.pos, target.pos);
  const span = Math.max(1, weapon.rangeMax - weapon.rangeMin);
  const reach = (distance - weapon.rangeMin) / span;
  p *= 1 - 0.4 * Math.max(0, reach);

  // Shooter condition. Discipline blunts the accuracy loss from being under
  // fire — a well-drilled crew keeps shooting straight when the rounds come
  // in, which is most of what separates a veteran formation from a green one.
  const suppressionPenalty = 1 - suppressionAccuracyFactor(attacker);
  p *= 1 - suppressionPenalty * (1 - attackerDef.discipline * 0.4);
  p *= 1 + attacker.veterancy * 0.05;

  // Target cover and posture.
  const terrain = TERRAIN[terrainAt(state.map, target.pos)];
  p *= 1 - terrain.cover;
  if (target.hunkered) p *= 0.7;
  if (target.fortified) p *= 0.8;

  // Contact quality. IDENTIFIED is the baseline for direct fire, not a
  // penalty — you are shooting at something you can see. A bare CONTACT is
  // area fire against a position rather than an engagement of a target, and
  // a TRACKED handoff is slightly better than your own eyes.
  const contact = firingContactLevel(state, attacker.side, target.id);
  if (contact === DetectionLevel.CONTACT) p *= 0.5;
  else if (contact === DetectionLevel.TRACKED) p *= 1.1;

  // Small arms are markedly worse against armour even before lethality.
  if (targetDef.armor === 'HEAVY' && weapon.lethality.HEAVY < 0.3) p *= 0.7;

  return clamp(p, 0.02, 0.95);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

export interface FirePreview {
  readonly volume: number;
  readonly hitChance: number;
  readonly expectedDamage: number;
  /** 80% credible interval on strength steps removed. */
  readonly damageLo: number;
  readonly damageHi: number;
  readonly expectedSuppression: number;
  readonly lethality: number;
  readonly ammoAfter: number;
  /** How much this shot will raise the attacker's own signature. */
  readonly signatureCost: number;
  readonly targetDestroyedLikely: boolean;
}

/**
 * Everything the player sees before committing. Deliberately expressed as a
 * damage *range* rather than a hit percentage — players reason far better
 * about "kills 2-5 steps" than about "68% per round, nine rounds".
 */
export function previewFire(
  state: GameState,
  attacker: Unit,
  weapon: Weapon,
  target: Unit,
): FirePreview {
  const attackerDef = getUnitDef(attacker.defId);
  const targetDef = getUnitDef(target.defId);

  const volume = fireVolume(attacker, attackerDef, weapon);
  const p = hitProbability(state, attacker, attackerDef, weapon, target, targetDef);
  const lethality = weapon.lethality[targetDef.armor];
  const perHit = weapon.damage * lethality;

  const interval = binomialInterval(volume, p, 0.8);
  const expectedDamage = interval.mean * perHit;

  const suppression = suppressionInflicted(volume, weapon, targetDef, state, target);
  const ammo = ammoFor(attacker, weapon);

  return {
    volume,
    hitChance: p,
    expectedDamage,
    damageLo: round1(interval.lo * perHit),
    damageHi: round1(interval.hi * perHit),
    expectedSuppression: Math.round(suppression),
    lethality,
    ammoAfter: Number.isFinite(ammo) ? ammo - 1 : Infinity,
    signatureCost: weapon.firingSignature,
    targetDestroyedLikely: interval.lo * perHit >= target.strength,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function suppressionInflicted(
  volume: number,
  weapon: Weapon,
  targetDef: UnitDef,
  state: GameState,
  target: Unit,
): number {
  const terrain = TERRAIN[terrainAt(state.map, target.pos)];
  const resistance = targetDef.discipline * 0.5 + terrain.cover * 0.4;
  const posture = target.fortified ? 0.7 : 1;
  return volume * weapon.suppression * (1 - resistance) * posture;
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

export interface FireResult {
  readonly attackerId: string;
  readonly targetId: string;
  readonly weaponId: string;
  readonly volume: number;
  readonly hits: number;
  readonly damage: number;
  readonly suppression: number;
  readonly destroyed: boolean;
  readonly narrative: string;
}

/**
 * Resolve a single attack. Mutates target strength and suppression, attacker
 * ammunition and signature. All randomness comes from the passed Rng, which
 * the caller has forked to the combat stream.
 */
export function resolveFire(
  state: GameState,
  rng: Rng,
  attacker: Unit,
  weapon: Weapon,
  target: Unit,
): FireResult {
  const attackerDef = getUnitDef(attacker.defId);
  const targetDef = getUnitDef(target.defId);

  const volume = fireVolume(attacker, attackerDef, weapon);
  const p = hitProbability(state, attacker, attackerDef, weapon, target, targetDef);
  const hits = rng.binomial(volume, p);

  const lethality = weapon.lethality[targetDef.armor];
  const damage = round1(hits * weapon.damage * lethality);

  target.strength = Math.max(0, round1(target.strength - damage));

  const suppression = suppressionInflicted(volume, weapon, targetDef, state, target);
  target.suppression = Math.min(SUPPRESSION_MAX, target.suppression + suppression);

  // Firing is conspicuous. This is what makes shoot-and-scoot matter.
  attacker.disturbance += weapon.firingSignature;

  if (weapon.ammo !== undefined) {
    attacker.ammo[weapon.id] = Math.max(0, (attacker.ammo[weapon.id] ?? 0) - 1);
  }

  const destroyed = target.strength <= 0;
  if (destroyed) {
    target.destroyed = true;
    target.destroyedTurn = state.turn;
  }

  return {
    attackerId: attacker.id,
    targetId: target.id,
    weaponId: weapon.id,
    volume,
    hits,
    damage,
    suppression: Math.round(suppression),
    destroyed,
    narrative: describeFire(attacker, attackerDef, target, targetDef, hits, damage, destroyed),
  };
}

function describeFire(
  attacker: Unit,
  attackerDef: UnitDef,
  target: Unit,
  targetDef: UnitDef,
  hits: number,
  damage: number,
  destroyed: boolean,
): string {
  const shooter = `${attacker.callsign} (${attackerDef.designation})`;
  const victim = `${target.callsign} (${targetDef.designation})`;
  if (destroyed) return `${shooter} destroys ${victim}.`;
  if (hits === 0) return `${shooter} engages ${victim} — no effect, target suppressed.`;
  return `${shooter} hits ${victim} for ${damage} steps.`;
}

/* ------------------------------------------------------------------ */
/* Area fire                                                           */
/* ------------------------------------------------------------------ */

export interface BarrageResult {
  readonly center: Hex;
  readonly weaponId: string;
  readonly affected: FireResult[];
}

/**
 * Indirect fire onto a *location* rather than a tracked unit.
 *
 * This is the answer to "my artillery has no target". Area fire needs no
 * contact at all, does modest damage, and suppresses heavily across a small
 * footprint. It lets a commander act on suspicion — shell the treeline they
 * think holds an anti-tank position — which is exactly the decision the
 * information layer is meant to produce.
 */
export function resolveBarrage(
  state: GameState,
  rng: Rng,
  attacker: Unit,
  weapon: Weapon,
  center: Hex,
  radius = 1,
): BarrageResult {
  const attackerDef = getUnitDef(attacker.defId);
  const affected: FireResult[] = [];

  const volume = fireVolume(attacker, attackerDef, weapon);

  for (const unit of state.units.values()) {
    if (unit.destroyed) continue;
    const distance = hexDistance(unit.pos, center);
    if (distance > radius) continue;

    const targetDef = getUnitDef(unit.defId);
    if (!weapon.engages.includes(targetDef.domain)) continue;

    // Area fire is imprecise by nature and falls off from the aim point.
    const falloff = 1 - distance * 0.35;
    const terrain = TERRAIN[terrainAt(state.map, unit.pos)];
    const p = clamp(weapon.accuracy * 0.45 * falloff * (1 - terrain.cover), 0.02, 0.6);

    const hits = rng.binomial(volume, p);
    const lethality = weapon.lethality[targetDef.armor];
    const damage = round1(hits * weapon.damage * lethality * 0.8);

    unit.strength = Math.max(0, round1(unit.strength - damage));

    // Suppression is the point of a barrage, so it is not reduced by falloff
    // nearly as much as damage is.
    const suppression =
      suppressionInflicted(volume, weapon, targetDef, state, unit) * (1 - distance * 0.2) * 1.3;
    unit.suppression = Math.min(SUPPRESSION_MAX, unit.suppression + suppression);

    const destroyed = unit.strength <= 0;
    if (destroyed) {
      unit.destroyed = true;
      unit.destroyedTurn = state.turn;
    }

    affected.push({
      attackerId: attacker.id,
      targetId: unit.id,
      weaponId: weapon.id,
      volume,
      hits,
      damage,
      suppression: Math.round(suppression),
      destroyed,
      narrative: destroyed
        ? `${unit.callsign} destroyed by indirect fire.`
        : `${unit.callsign} under indirect fire — ${damage} steps, heavy suppression.`,
    });
  }

  attacker.disturbance += weapon.firingSignature;
  if (weapon.ammo !== undefined) {
    attacker.ammo[weapon.id] = Math.max(0, (attacker.ammo[weapon.id] ?? 0) - 1);
  }

  return { center, weaponId: weapon.id, affected };
}

/**
 * Whether a weapon may be used for area fire. Only indirect systems can
 * shell a map reference; a tank cannot area-fire a hex it cannot see.
 */
export function canBarrage(attacker: Unit, weapon: Weapon, center: Hex): EngagementCheck {
  if (weapon.mode !== 'INDIRECT') return { ok: false, reason: 'Direct-fire weapon' };
  if (attacker.hasActed) return { ok: false, reason: 'Already acted this turn' };
  if (suppressionState(attacker) === 'PINNED') return { ok: false, reason: 'Pinned' };
  if (ammoFor(attacker, weapon) <= 0) return { ok: false, reason: 'No rounds remaining' };
  const distance = hexDistance(attacker.pos, center);
  if (distance > weapon.rangeMax) return { ok: false, reason: 'Out of range' };
  if (distance < weapon.rangeMin) return { ok: false, reason: 'Inside minimum range' };
  return { ok: true };
}
