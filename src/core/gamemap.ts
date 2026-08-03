/**
 * Map construction and tile queries.
 */

import { hexKey, hexRange, type Hex } from './hex';
import { TERRAIN } from './terrain';
import type { GameMap, MapTile, TerrainId } from './types';

export function createMap(radius: number, fill: TerrainId = 'PLAIN'): GameMap {
  const tiles = new Map<number, MapTile>();
  for (const h of hexRange({ q: 0, r: 0 }, radius)) {
    tiles.set(hexKey(h), { hex: h, terrain: fill });
  }
  return { width: radius * 2 + 1, height: radius * 2 + 1, tiles };
}

/**
 * Build a map from a row-based ASCII sketch. Missions author terrain this way
 * because a designer can read and edit the whole battlefield at a glance,
 * which matters far more than storage efficiency for ~400 tiles.
 *
 * Rows are offset ("odd-r") and converted to axial on load.
 */
export function createMapFromRows(
  rows: readonly string[],
  legend: Readonly<Record<string, TerrainId>>,
): GameMap {
  const tiles = new Map<number, MapTile>();
  let width = 0;

  rows.forEach((row, rowIndex) => {
    const cells = row.trim().split(/\s+/);
    width = Math.max(width, cells.length);
    cells.forEach((cell, colIndex) => {
      const terrain = legend[cell];
      if (!terrain) {
        throw new Error(`Unknown terrain glyph "${cell}" at row ${rowIndex}, col ${colIndex}`);
      }
      // odd-r offset -> axial
      const q = colIndex - ((rowIndex - (rowIndex & 1)) >> 1);
      const r = rowIndex;
      tiles.set(hexKey({ q, r }), { hex: { q, r }, terrain });
    });
  });

  return { width, height: rows.length, tiles };
}

export function tileAt(map: GameMap, h: Hex): MapTile | undefined {
  return map.tiles.get(hexKey(h));
}

export function inBounds(map: GameMap, h: Hex): boolean {
  return map.tiles.has(hexKey(h));
}

export function terrainAt(map: GameMap, h: Hex): TerrainId {
  return map.tiles.get(hexKey(h))?.terrain ?? 'OCEAN';
}

export function elevationAt(map: GameMap, h: Hex): number {
  return TERRAIN[terrainAt(map, h)].elevation;
}

export function allTiles(map: GameMap): MapTile[] {
  return [...map.tiles.values()];
}

/** Convenience for missions: stamp terrain over a list of hexes. */
export function paint(map: GameMap, hexes: readonly Hex[], terrain: TerrainId): void {
  for (const h of hexes) {
    const tile = map.tiles.get(hexKey(h));
    if (tile) tile.terrain = terrain;
  }
}

export function setObjectiveMarker(map: GameMap, h: Hex, objectiveId: string): void {
  const tile = map.tiles.get(hexKey(h));
  if (tile) tile.objective = objectiveId;
}
