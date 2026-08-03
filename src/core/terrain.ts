/**
 * Terrain table.
 *
 * Four numbers do all the work, and they are deliberately independent so that
 * terrain choices are genuinely trade-offs rather than a single "good tile"
 * axis:
 *
 *   elevation   — see further, be seen further
 *   losBlock    — hides what is behind it
 *   cover       — reduces incoming hit probability
 *   concealment — reduces your own visual/thermal signature
 *
 * A ridge line sees everything and is seen by everything. A jungle hides you
 * completely but blinds you too. Urban gives cover without concealment from
 * radar. There is no tile that is simply best.
 */

import type { MobilityType, TerrainDef, TerrainId } from './types';

const IMPASSABLE = Infinity;

function costs(
  foot: number,
  wheeled: number,
  tracked: number,
  amphibious: number,
): Record<MobilityType, number> {
  return {
    FOOT: foot,
    WHEELED: wheeled,
    TRACKED: tracked,
    AMPHIBIOUS: amphibious,
    // Aircraft ignore ground terrain entirely; naval handled per-tile below.
    AIR: 1,
    NAVAL: IMPASSABLE,
  };
}

function navalCosts(cost: number): Record<MobilityType, number> {
  return {
    FOOT: IMPASSABLE,
    WHEELED: IMPASSABLE,
    TRACKED: IMPASSABLE,
    AMPHIBIOUS: cost * 2,
    AIR: 1,
    NAVAL: cost,
  };
}

export const TERRAIN: Readonly<Record<TerrainId, TerrainDef>> = Object.freeze({
  OCEAN: {
    id: 'OCEAN',
    name: 'Open water',
    cost: navalCosts(1),
    elevation: 0,
    losBlock: 0,
    cover: 0,
    concealment: 0,
    color: 0x16303f,
  },
  SHALLOWS: {
    id: 'SHALLOWS',
    name: 'Shallows',
    cost: navalCosts(2),
    elevation: 0,
    losBlock: 0,
    cover: 0,
    concealment: 0.05,
    color: 0x1e4557,
  },
  BEACH: {
    id: 'BEACH',
    name: 'Beach',
    cost: costs(1, 2, 1, 1),
    elevation: 0,
    losBlock: 0,
    cover: 0.05,
    concealment: 0.05,
    color: 0x6b6244,
  },
  PLAIN: {
    id: 'PLAIN',
    name: 'Open ground',
    cost: costs(1, 1, 1, 1),
    elevation: 0,
    losBlock: 0,
    cover: 0.05,
    concealment: 0.1,
    color: 0x3f4a35,
  },
  FIELD: {
    id: 'FIELD',
    name: 'Cultivated',
    cost: costs(1, 1, 1, 1),
    elevation: 0,
    losBlock: 0,
    cover: 0.1,
    concealment: 0.15,
    color: 0x4b5436,
  },
  SCRUB: {
    id: 'SCRUB',
    name: 'Scrub',
    cost: costs(1, 2, 1, 1),
    elevation: 0,
    losBlock: 0.3,
    cover: 0.15,
    concealment: 0.3,
    color: 0x3c4a2e,
  },
  FOREST: {
    id: 'FOREST',
    name: 'Woodland',
    cost: costs(2, 3, 2, 2),
    elevation: 0,
    losBlock: 0.8,
    cover: 0.3,
    concealment: 0.5,
    color: 0x2b3d26,
  },
  JUNGLE: {
    id: 'JUNGLE',
    name: 'Dense jungle',
    cost: costs(3, IMPASSABLE, 3, 3),
    elevation: 0,
    losBlock: 1.0,
    cover: 0.35,
    concealment: 0.65,
    color: 0x1f3320,
  },
  HILL: {
    id: 'HILL',
    name: 'Rising ground',
    cost: costs(2, 2, 2, 2),
    elevation: 1,
    losBlock: 0.4,
    cover: 0.2,
    concealment: 0.15,
    color: 0x4d4a30,
  },
  RIDGE: {
    id: 'RIDGE',
    name: 'Ridge line',
    cost: costs(2, 3, 2, 2),
    elevation: 2,
    losBlock: 0.9,
    cover: 0.25,
    concealment: 0.1,
    color: 0x5b543a,
  },
  MOUNTAIN: {
    id: 'MOUNTAIN',
    name: 'Mountain',
    cost: costs(4, IMPASSABLE, IMPASSABLE, 4),
    elevation: 3,
    losBlock: 1.0,
    cover: 0.3,
    concealment: 0.15,
    color: 0x6a6350,
  },
  URBAN: {
    id: 'URBAN',
    name: 'Built-up area',
    cost: costs(1, 1, 2, 1),
    elevation: 1,
    losBlock: 0.85,
    cover: 0.45,
    concealment: 0.4,
    color: 0x54565c,
  },
  AIRFIELD: {
    id: 'AIRFIELD',
    name: 'Airfield',
    cost: costs(1, 1, 1, 1),
    elevation: 0,
    losBlock: 0,
    cover: 0.05,
    concealment: 0,
    color: 0x4a4c50,
  },
  PORT: {
    id: 'PORT',
    name: 'Port facility',
    cost: costs(1, 1, 1, 1),
    elevation: 0,
    losBlock: 0.4,
    cover: 0.25,
    concealment: 0.15,
    color: 0x4e5257,
  },
  ROAD: {
    id: 'ROAD',
    name: 'Road',
    cost: costs(1, 0.5, 0.5, 0.5),
    elevation: 0,
    losBlock: 0,
    cover: 0,
    concealment: 0,
    color: 0x5c5748,
  },
});

export function terrainDef(id: TerrainId): TerrainDef {
  return TERRAIN[id];
}

export function movementCost(terrain: TerrainId, mobility: MobilityType): number {
  return TERRAIN[terrain].cost[mobility];
}

export function isPassable(terrain: TerrainId, mobility: MobilityType): boolean {
  return Number.isFinite(TERRAIN[terrain].cost[mobility]);
}

/** Terrain a naval or amphibious unit can float on. */
export function isWater(terrain: TerrainId): boolean {
  return terrain === 'OCEAN' || terrain === 'SHALLOWS';
}
