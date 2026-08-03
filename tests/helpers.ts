/**
 * Test scaffolding: build small, fully-controlled scenarios.
 *
 * Tests construct their own missions rather than using shipped content
 * wherever possible, so that a balance tweak to a real mission never breaks a
 * rules test.
 */

import { createMap, paint } from '@core/gamemap';
import type { Deployment, MissionDef } from '@core/mission';
import { Session } from '@core/session';
import { initContent } from '@content/index';
import { hexRange, type Hex } from '@core/hex';
import type { Objective, TerrainId } from '@core/types';

initContent();

export interface ScenarioOptions {
  readonly radius?: number;
  readonly terrain?: TerrainId;
  readonly maxTurns?: number;
  readonly objectives?: () => Objective[];
  readonly paint?: Array<{ hexes: Hex[]; terrain: TerrainId }>;
}

export function scenario(
  deployments: readonly Deployment[],
  options: ScenarioOptions = {},
): MissionDef {
  const radius = options.radius ?? 12;
  return {
    id: 'test_scenario',
    name: 'Test Scenario',
    operation: 'TEST',
    playerSide: 'BLUE',
    maxTurns: options.maxTurns ?? 20,
    parTurns: 10,
    brief: [],
    intel: [],
    buildMap: () => {
      const map = createMap(radius, options.terrain ?? 'PLAIN');
      for (const patch of options.paint ?? []) {
        paint(map, patch.hexes, patch.terrain);
      }
      return map;
    },
    deployments,
    buildObjectives: options.objectives ?? (() => []),
  };
}

export function makeSession(
  deployments: readonly Deployment[],
  options: ScenarioOptions & { seed?: string } = {},
): Session {
  return new Session(scenario(deployments, options), { seed: options.seed ?? 'test' });
}

/** Every hex within `radius` of origin, for terrain painting. */
export function around(center: Hex, radius: number): Hex[] {
  return hexRange(center, radius);
}

export function h(q: number, r: number): Hex {
  return { q, r };
}

/** Find the single unit with a given definition id. */
export function unitOf(session: Session, defId: string) {
  const unit = [...session.state.units.values()].find((u) => u.defId === defId && !u.destroyed);
  if (!unit) throw new Error(`No living unit with defId ${defId}`);
  return unit;
}
