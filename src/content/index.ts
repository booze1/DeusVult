/**
 * Content entry point. Registers all data with the core registry.
 *
 * Idempotent, because tests, the headless runner and the app all call it and
 * none of them should have to care whether another already did.
 */

import { registerNation, registerUnitDefs, tryGetUnitDef } from '@core/registry';
import type { MissionDef } from '@core/mission';
import { ALL_UNITS } from './units';
import { NATIONS } from './nations';
import { MISSION_FIRST_LIGHT } from './missions/m01_first_light';
import { MISSION_SILENT_WATCH } from './missions/m02_silent_watch';
import { MISSION_THE_NARROWS } from './missions/m03_the_narrows';

let initialised = false;

export function initContent(): void {
  if (initialised) return;
  // Guard against a partially-populated registry from a prior partial load.
  if (!tryGetUnitDef(ALL_UNITS[0]!.id)) {
    registerUnitDefs(ALL_UNITS);
  }
  for (const nation of NATIONS) registerNation(nation);
  initialised = true;
}

/** Campaign order. Index is the mission's position in the operation. */
export const MISSIONS: readonly MissionDef[] = [
  MISSION_FIRST_LIGHT,
  MISSION_SILENT_WATCH,
  MISSION_THE_NARROWS,
];

export function getMission(id: string): MissionDef {
  const mission = MISSIONS.find((m) => m.id === id);
  if (!mission) throw new Error(`Unknown mission: ${id}`);
  return mission;
}

export { ALL_UNITS, ALLIED_UNITS, OPPOSING_UNITS } from './units';
export { NATIONS } from './nations';
