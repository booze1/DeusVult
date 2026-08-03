/**
 * Small builders for roster data.
 *
 * The roster is the most-edited file in the project, so it is worth making
 * each unit fit on a screen. These helpers exist purely so a designer can see
 * a whole unit at once and compare it against its neighbours.
 */

import { DetectionLevel } from '@core/types';
import type {
  ArmorClass,
  Domain,
  Sensor,
  SensorType,
  Signature,
  Weapon,
} from '@core/types';

const ALL_LAND: readonly Domain[] = ['LAND'];
const LAND_SEA: readonly Domain[] = ['LAND', 'SEA'];
const LAND_AIR_SEA: readonly Domain[] = ['LAND', 'AIR', 'SEA'];
const AIR_ONLY: readonly Domain[] = ['AIR'];

export const DOMAINS = { ALL_LAND, LAND_SEA, LAND_AIR_SEA, AIR_ONLY };

/** visual, thermal, radar cross-section, RF emissions, acoustic. */
export function sig(
  visual: number,
  thermal: number,
  radar: number,
  rf: number,
  acoustic: number,
): Signature {
  return { visual, thermal, radar, rf, acoustic };
}

export interface SensorOptions {
  readonly active?: boolean;
  readonly needsLineOfSight?: boolean;
  readonly detects?: readonly Domain[];
}

export function sensor(
  type: SensorType,
  range: number,
  power: number,
  options: SensorOptions = {},
): Sensor {
  const defaults: Record<SensorType, { active: boolean; los: boolean }> = {
    OPTICAL: { active: false, los: true },
    THERMAL: { active: false, los: true },
    RADAR: { active: true, los: true },
    // Radio waves do not care about treelines the way light does.
    ELINT: { active: false, los: false },
    ACOUSTIC: { active: false, los: false },
  };
  const d = defaults[type];
  return {
    type,
    range,
    power,
    active: options.active ?? d.active,
    needsLineOfSight: options.needsLineOfSight ?? d.los,
    detects: options.detects ?? LAND_AIR_SEA,
  };
}

/** Lethality by target armour class, in fixed order. */
export function leth(
  soft: number,
  light: number,
  heavy: number,
  air: number,
  naval: number,
): Record<ArmorClass, number> {
  return { SOFT: soft, LIGHT: light, HEAVY: heavy, AIR: air, NAVAL: naval };
}

export interface WeaponOptions {
  readonly rangeMin?: number;
  readonly requires?: DetectionLevel;
  readonly ammo?: number;
  readonly engages?: readonly Domain[];
  readonly firingSignature?: number;
}

export function weapon(
  id: string,
  name: string,
  mode: Weapon['mode'],
  rangeMax: number,
  volley: number,
  accuracy: number,
  damage: number,
  lethality: Record<ArmorClass, number>,
  suppression: number,
  options: WeaponOptions = {},
): Weapon {
  const defaultRequires =
    mode === 'DIRECT' ? DetectionLevel.IDENTIFIED : DetectionLevel.TRACKED;

  // Firing a large system is far more conspicuous than a rifle squad.
  const defaultSignature = mode === 'DIRECT' ? 12 : 30;

  return {
    id,
    name,
    mode,
    rangeMin: options.rangeMin ?? 0,
    rangeMax,
    volley,
    accuracy,
    damage,
    lethality,
    engages: options.engages ?? ALL_LAND,
    requires: options.requires ?? defaultRequires,
    suppression,
    ...(options.ammo !== undefined ? { ammo: options.ammo } : {}),
    firingSignature: options.firingSignature ?? defaultSignature,
  };
}
