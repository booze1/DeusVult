/**
 * Unit symbology.
 *
 * Simplified NATO-style glyphs — legible at phone size, and carrying role
 * information in shape so the board reads without colour. These are drawn as
 * vectors rather than sprites so they stay crisp at any zoom and on any
 * pixel density, which matters more here than it would for a game with
 * illustrated units.
 */

import { Graphics } from 'pixi.js';
import type { UnitClass } from '@core/types';

/**
 * Draw the role glyph for a unit class into `g`, centred on the origin and
 * sized to fit a box of `size` across.
 */
export function drawUnitSymbol(
  g: Graphics,
  unitClass: UnitClass,
  size: number,
  color: number,
): void {
  const h = size / 2;
  const line = Math.max(1.5, size * 0.11);
  const stroke = { width: line, color, alpha: 1, cap: 'round' as const };

  switch (unitClass) {
    case 'INFANTRY':
      // Crossed straps.
      g.moveTo(-h, -h).lineTo(h, h).moveTo(h, -h).lineTo(-h, h).stroke(stroke);
      break;

    case 'RECON':
      // Single oblique.
      g.moveTo(-h, h).lineTo(h, -h).stroke(stroke);
      break;

    case 'ARMOR':
      // Track oval.
      g.ellipse(0, 0, h, h * 0.62).stroke(stroke);
      break;

    case 'IFV':
      // Track oval with the infantry bar.
      g.ellipse(0, 0, h, h * 0.62).stroke(stroke);
      g.moveTo(-h * 0.5, -h * 0.5).lineTo(h * 0.5, h * 0.5).stroke(stroke);
      break;

    case 'ARTILLERY':
      g.circle(0, 0, h * 0.42).fill({ color });
      break;

    case 'MRL':
      // Filled round plus launch rails.
      g.circle(0, 0, h * 0.34).fill({ color });
      g.moveTo(-h, -h * 0.75).lineTo(h, -h * 0.75).stroke(stroke);
      break;

    case 'ASM':
      // Arrow over water line — a shooter that reaches past the horizon.
      g.moveTo(-h, h * 0.6).lineTo(h, h * 0.6).stroke(stroke);
      g.moveTo(0, h * 0.35).lineTo(0, -h).moveTo(-h * 0.45, -h * 0.45).lineTo(0, -h).lineTo(h * 0.45, -h * 0.45).stroke(stroke);
      break;

    case 'SAM':
      // Upward chevron.
      g.moveTo(-h, h * 0.5).lineTo(0, -h * 0.8).lineTo(h, h * 0.5).stroke(stroke);
      break;

    case 'UAV':
      // Wing.
      g.moveTo(-h, 0).lineTo(0, -h * 0.55).lineTo(h, 0).stroke(stroke);
      g.moveTo(0, -h * 0.55).lineTo(0, h * 0.6).stroke(stroke);
      break;

    case 'EW':
      // Radiating arcs.
      g.moveTo(0, h * 0.7).lineTo(0, -h * 0.2).stroke(stroke);
      g.arc(0, -h * 0.2, h * 0.45, Math.PI, 0).stroke(stroke);
      g.arc(0, -h * 0.2, h * 0.8, Math.PI, 0).stroke(stroke);
      break;

    case 'ENGINEER':
      g.moveTo(-h, h * 0.6).lineTo(0, -h * 0.6).lineTo(h, h * 0.6).closePath().stroke(stroke);
      break;

    case 'TRANSPORT':
      g.rect(-h * 0.8, -h * 0.45, h * 1.6, h * 0.9).stroke(stroke);
      break;

    case 'HELO':
      g.moveTo(-h, -h * 0.5).lineTo(h, -h * 0.5).stroke(stroke);
      g.ellipse(0, h * 0.2, h * 0.6, h * 0.4).stroke(stroke);
      break;

    case 'SHIP':
      g.moveTo(-h, 0).lineTo(h, 0).lineTo(h * 0.6, h * 0.5).lineTo(-h * 0.6, h * 0.5).closePath().stroke(stroke);
      break;
  }
}

/** Short label used on the marker when space allows. */
export const CLASS_ABBREVIATION: Readonly<Record<UnitClass, string>> = Object.freeze({
  INFANTRY: 'INF',
  RECON: 'RCN',
  ARMOR: 'ARM',
  IFV: 'IFV',
  ARTILLERY: 'ART',
  MRL: 'MRL',
  SAM: 'SAM',
  UAV: 'UAV',
  EW: 'EW',
  ASM: 'ASM',
  ENGINEER: 'ENG',
  TRANSPORT: 'TPT',
  HELO: 'HEL',
  SHIP: 'SHP',
});
