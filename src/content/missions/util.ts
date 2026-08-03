/**
 * Mission authoring helpers.
 *
 * Designers lay out maps and deployments in offset (column, row) coordinates
 * because that is what the ASCII sketch is in. Everything downstream is
 * axial, so conversion happens here, once.
 */

import type { Hex } from '@core/hex';
import type { TerrainId } from '@core/types';

/** Offset ("odd-r") column/row to axial. */
export function oh(col: number, row: number): Hex {
  return { q: col - ((row - (row & 1)) >> 1), r: row };
}

/** Several offset coordinates at once. */
export function ohs(...pairs: Array<[number, number]>): Hex[] {
  return pairs.map(([col, row]) => oh(col, row));
}

/** Shared glyph legend for every mission sketch. */
export const LEGEND: Readonly<Record<string, TerrainId>> = Object.freeze({
  '~': 'OCEAN',
  ',': 'SHALLOWS',
  '.': 'BEACH',
  '-': 'PLAIN',
  c: 'FIELD',
  '"': 'SCRUB',
  f: 'FOREST',
  J: 'JUNGLE',
  h: 'HILL',
  R: 'RIDGE',
  M: 'MOUNTAIN',
  U: 'URBAN',
  A: 'AIRFIELD',
  P: 'PORT',
  '=': 'ROAD',
});
