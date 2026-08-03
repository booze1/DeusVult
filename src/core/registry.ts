/**
 * Content registry.
 *
 * Core defines the shape of content; the content package fills it in. This
 * inversion keeps src/core free of any dependency on src/content, so the
 * simulation stays independently testable and could be lifted onto a server
 * with the content loaded from data rather than code.
 */

import type { Nation, NationProfile, UnitDef, UnitDefId } from './types';

const unitDefs = new Map<UnitDefId, UnitDef>();
const nations = new Map<Nation, NationProfile>();

export function registerUnitDef(def: UnitDef): void {
  if (unitDefs.has(def.id)) {
    throw new Error(`Duplicate unit definition id: ${def.id}`);
  }
  unitDefs.set(def.id, def);
}

export function registerUnitDefs(defs: readonly UnitDef[]): void {
  for (const def of defs) registerUnitDef(def);
}

export function getUnitDef(id: UnitDefId): UnitDef {
  const def = unitDefs.get(id);
  if (!def) throw new Error(`Unknown unit definition: ${id}`);
  return def;
}

export function tryGetUnitDef(id: UnitDefId): UnitDef | undefined {
  return unitDefs.get(id);
}

export function allUnitDefs(): UnitDef[] {
  return [...unitDefs.values()];
}

export function registerNation(profile: NationProfile): void {
  nations.set(profile.id, profile);
}

export function getNation(id: Nation): NationProfile {
  const profile = nations.get(id);
  if (!profile) throw new Error(`Unknown nation: ${id}`);
  return profile;
}

export function allNations(): NationProfile[] {
  return [...nations.values()];
}

/** Test helper — clears the registry between suites. */
export function resetRegistry(): void {
  unitDefs.clear();
  nations.clear();
}
