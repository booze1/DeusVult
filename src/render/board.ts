/**
 * Board renderer.
 *
 * Draws the map, the overlays and the contact picture. The critical rule
 * enforced here: the board renders the *viewing side's picture*, not the
 * truth. Enemy markers are drawn at their last observed position, which for
 * a stale contact is not where the unit actually is. Rendering ground truth
 * would silently defeat the entire information layer, so the real position of
 * an undetected unit never reaches this file's output.
 */

import { Container, Graphics, Text } from 'pixi.js';
import {
  hexCorners,
  hexDistance,
  hexKey,
  hexToPixel,
  pixelToHex,
  type Hex,
  type HexLayout,
} from '@core/hex';
import { TERRAIN } from '@core/terrain';
import { getUnitDef } from '@core/registry';
import { sensorCoverage } from '@core/sensors';
import { suppressionState } from '@core/combat';
import {
  DetectionLevel,
  type GameState,
  type Side,
  type Unit,
} from '@core/types';
import { PALETTE, strengthColor } from './palette';
import { drawUnitSymbol } from './symbols';

export const HEX_SIZE = 38;

export interface FitOptions {
  readonly viewWidth: number;
  readonly viewHeight: number;
  /** Screen space reserved by the HUD's top bar. */
  readonly insetTop?: number;
  /** Screen space reserved by the unit panel and action bar. */
  readonly insetBottom?: number;
  /**
   * Never zoom out past this, even if the map then overflows. Protects hex
   * tap targets on small screens.
   */
  readonly minScale?: number;
  /** Hexes to centre on when the map does not fit at `minScale`. */
  readonly focusOn?: readonly Hex[];
}

export interface BoardOverlays {
  readonly move?: readonly Hex[];
  readonly fire?: readonly Hex[];
  readonly threat?: boolean;
  readonly sensors?: boolean;
  readonly selected?: Hex | null;
  readonly hovered?: Hex | null;
  readonly path?: readonly Hex[];
}

/** What the viewing side believes is at a hex. */
interface Marker {
  readonly unit: Unit;
  readonly at: Hex;
  readonly friendly: boolean;
  readonly level: DetectionLevel;
  readonly stale: boolean;
}

export class Board {
  readonly root = new Container();

  private readonly terrainLayer = new Container();
  private readonly overlayLayer = new Container();
  private readonly markerLayer = new Container();

  private readonly terrainGfx = new Graphics();
  private readonly overlayGfx = new Graphics();

  private layout: HexLayout = { size: HEX_SIZE, originX: 0, originY: 0 };
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor() {
    this.root.addChild(this.terrainLayer, this.overlayLayer, this.markerLayer);
    this.terrainLayer.addChild(this.terrainGfx);
    this.overlayLayer.addChild(this.overlayGfx);
  }

  /* ---------------------------------------------------------------- */
  /* Camera                                                            */
  /* ---------------------------------------------------------------- */

  setCamera(offsetX: number, offsetY: number, scale: number): void {
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.scale = scale;
    this.root.position.set(offsetX, offsetY);
    this.root.scale.set(scale);
  }

  get cameraScale(): number {
    return this.scale;
  }

  panBy(dx: number, dy: number): void {
    this.setCamera(this.offsetX + dx, this.offsetY + dy, this.scale);
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    const next = Math.min(2.2, Math.max(0.45, this.scale * factor));
    // Keep the point under the cursor fixed while zooming.
    const worldX = (screenX - this.offsetX) / this.scale;
    const worldY = (screenY - this.offsetY) / this.scale;
    this.setCamera(screenX - worldX * next, screenY - worldY * next, next);
  }

  /**
   * Centre the camera on the map's extent.
   *
   * `insetTop` and `insetBottom` reserve the space the HUD occupies, so the
   * board is fitted to the *visible* area rather than to the raw viewport —
   * without them the bottom rank of hexes sits permanently under the action
   * bar, which is exactly where a defending player's units tend to be.
   */
  fitTo(state: GameState, options: FitOptions): void {
    const {
      viewWidth,
      viewHeight,
      insetTop = 0,
      insetBottom = 0,
      minScale = 1,
      focusOn = [],
    } = options;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const tile of state.map.tiles.values()) {
      const p = hexToPixel(tile.hex, this.layout);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }

    const mapWidth = maxX - minX + HEX_SIZE * 3;
    const mapHeight = maxY - minY + HEX_SIZE * 3;
    const usableHeight = Math.max(120, viewHeight - insetTop - insetBottom);

    // On a phone, fitting the whole map produces hexes around twelve pixels
    // across — legible in a screenshot and impossible to tap. Readability wins
    // over seeing everything: clamp to a scale where a hex is still a target,
    // and let the player pan.
    const wholeMap = Math.min(viewWidth / mapWidth, usableHeight / mapHeight, 1.2);
    const scale = Math.max(wholeMap, minScale);

    // If the map no longer fits, centre on what the player commands rather
    // than on the geometric middle of the island.
    let centreX = (minX + maxX) / 2;
    let centreY = (minY + maxY) / 2;

    if (scale > wholeMap && focusOn.length > 0) {
      let sumX = 0;
      let sumY = 0;
      for (const h of focusOn) {
        const p = hexToPixel(h, this.layout);
        sumX += p.x;
        sumY += p.y;
      }
      centreX = sumX / focusOn.length;
      centreY = sumY / focusOn.length;
    }

    this.setCamera(
      viewWidth / 2 - centreX * scale,
      insetTop + usableHeight / 2 - centreY * scale,
      scale,
    );
  }

  /** Convert a screen point to a hex, accounting for the camera. */
  screenToHex(screenX: number, screenY: number): Hex {
    return pixelToHex(
      (screenX - this.offsetX) / this.scale,
      (screenY - this.offsetY) / this.scale,
      this.layout,
    );
  }

  hexToScreen(h: Hex): { x: number; y: number } {
    const p = hexToPixel(h, this.layout);
    return { x: p.x * this.scale + this.offsetX, y: p.y * this.scale + this.offsetY };
  }

  /* ---------------------------------------------------------------- */
  /* Drawing                                                           */
  /* ---------------------------------------------------------------- */

  draw(state: GameState, viewSide: Side, overlays: BoardOverlays = {}): void {
    this.drawTerrain(state);
    this.drawOverlays(state, viewSide, overlays);
    this.drawMarkers(state, viewSide, overlays);
  }

  private drawTerrain(state: GameState): void {
    const g = this.terrainGfx;
    g.clear();

    for (const tile of state.map.tiles.values()) {
      const centre = hexToPixel(tile.hex, this.layout);
      const corners = hexCorners(centre, HEX_SIZE - 1);
      const points = corners.flatMap((c) => [c.x, c.y]);
      const def = TERRAIN[tile.terrain];

      g.poly(points).fill({ color: def.color, alpha: 1 });
      g.poly(points).stroke({ width: 1, color: PALETTE.grid, alpha: 0.85 });

      // Elevation is read as a brighter upper edge — enough to see relief at
      // a glance without a heightmap or shading pass.
      if (def.elevation > 0) {
        const brightness = 0.12 + def.elevation * 0.1;
        g.moveTo(corners[4]!.x, corners[4]!.y)
          .lineTo(corners[5]!.x, corners[5]!.y)
          .lineTo(corners[0]!.x, corners[0]!.y)
          .stroke({ width: 1 + def.elevation, color: 0xffffff, alpha: brightness });
      }

      if (tile.objective) {
        g.poly(hexCorners(centre, HEX_SIZE - 7).flatMap((c) => [c.x, c.y])).stroke({
          width: 2,
          color: PALETTE.objective,
          alpha: 0.8,
        });
      }
    }
  }

  private drawOverlays(state: GameState, viewSide: Side, overlays: BoardOverlays): void {
    const g = this.overlayGfx;
    g.clear();

    if (overlays.sensors) {
      const coverage = sensorCoverage(state, viewSide);
      for (const [key, score] of coverage) {
        const tile = state.map.tiles.get(key);
        if (!tile) continue;
        const alpha = Math.min(0.32, (score / 140) * 0.32);
        this.fillHex(g, tile.hex, PALETTE.sensor, alpha);
      }
    }

    if (overlays.threat) {
      for (const [unitId, contact] of state.contacts[viewSide]) {
        const enemy = state.units.get(unitId);
        if (!enemy || enemy.destroyed) continue;
        const def = getUnitDef(enemy.defId);
        const reach = def.weapons.reduce((max, w) => Math.max(max, w.rangeMax), 0);
        if (reach === 0) continue;

        // Threat is drawn from the last *observed* position, which is what
        // the player actually knows.
        for (const tile of state.map.tiles.values()) {
          const distance = hexDistance(contact.lastSeen, tile.hex);
          if (distance > reach) continue;
          this.fillHex(g, tile.hex, PALETTE.threat, contact.stale ? 0.05 : 0.09);
        }
      }
    }

    for (const h of overlays.move ?? []) {
      this.fillHex(g, h, PALETTE.moveRange, 0.22);
      this.strokeHex(g, h, PALETTE.moveRange, 0.5, 1.5, 4);
    }

    for (const h of overlays.fire ?? []) {
      this.strokeHex(g, h, PALETTE.fireRange, 0.75, 2, 3);
    }

    if (overlays.path && overlays.path.length > 1) {
      const points = overlays.path.map((h) => hexToPixel(h, this.layout));
      g.moveTo(points[0]!.x, points[0]!.y);
      for (const p of points.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: 3, color: PALETTE.friendlyGlow, alpha: 0.85 });
    }

    if (overlays.hovered) {
      this.strokeHex(g, overlays.hovered, PALETTE.text, 0.35, 1.5, 2);
    }

    if (overlays.selected) {
      this.strokeHex(g, overlays.selected, PALETTE.selected, 0.95, 3, 2);
    }
  }

  private fillHex(g: Graphics, h: Hex, color: number, alpha: number): void {
    const centre = hexToPixel(h, this.layout);
    const points = hexCorners(centre, HEX_SIZE - 1).flatMap((c) => [c.x, c.y]);
    g.poly(points).fill({ color, alpha });
  }

  private strokeHex(
    g: Graphics,
    h: Hex,
    color: number,
    alpha: number,
    width: number,
    inset: number,
  ): void {
    const centre = hexToPixel(h, this.layout);
    const points = hexCorners(centre, HEX_SIZE - inset).flatMap((c) => [c.x, c.y]);
    g.poly(points).stroke({ width, color, alpha });
  }

  /* ---------------------------------------------------------------- */
  /* Markers                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Build the viewing side's picture. Friendly units are drawn from truth;
   * enemy units are drawn only where a contact exists, at the position that
   * contact records.
   */
  private buildMarkers(state: GameState, viewSide: Side): Marker[] {
    const markers: Marker[] = [];

    for (const unit of state.units.values()) {
      if (unit.destroyed) continue;

      if (unit.side === viewSide) {
        markers.push({
          unit,
          at: unit.pos,
          friendly: true,
          level: DetectionLevel.TRACKED,
          stale: false,
        });
        continue;
      }

      const contact = state.contacts[viewSide].get(unit.id);
      if (!contact) continue;

      markers.push({
        unit,
        at: contact.lastSeen,
        friendly: false,
        level: contact.stale ? DetectionLevel.CONTACT : contact.level,
        stale: contact.stale,
      });
    }

    return markers;
  }

  private drawMarkers(state: GameState, viewSide: Side, overlays: BoardOverlays): void {
    this.markerLayer.removeChildren().forEach((child) => child.destroy({ children: true }));

    for (const marker of this.buildMarkers(state, viewSide)) {
      this.markerLayer.addChild(this.buildMarkerNode(marker, overlays));
    }
  }

  private buildMarkerNode(marker: Marker, overlays: BoardOverlays): Container {
    const node = new Container();
    const centre = hexToPixel(marker.at, this.layout);
    node.position.set(centre.x, centre.y);

    const { unit, friendly, level, stale } = marker;
    const def = getUnitDef(unit.defId);
    const color = friendly ? PALETTE.friendly : PALETTE.hostile;
    const identified = level >= DetectionLevel.IDENTIFIED;

    const body = new Graphics();
    const r = HEX_SIZE * 0.62;

    if (!identified) {
      // Unidentified return: a diamond and a question mark. Deliberately
      // unlike any real unit marker so it never reads as a known type.
      body
        .poly([0, -r, r, 0, 0, r, -r, 0])
        .fill({ color: PALETTE.contact, alpha: stale ? 0.16 : 0.26 })
        .stroke({ width: 2, color: PALETTE.contact, alpha: stale ? 0.5 : 0.95 });
      node.addChild(body);
      node.addChild(
        label('?', HEX_SIZE * 0.5, PALETTE.contact, stale ? 0.6 : 1),
      );
      if (stale) node.alpha = 0.65;
      return node;
    }

    // Friendly markers are rounded, hostile markers angular — the side is
    // readable from shape alone, without relying on colour.
    if (friendly) {
      body
        .roundRect(-r, -r * 0.82, r * 2, r * 1.64, 7)
        .fill({ color: PALETTE.background, alpha: 0.82 })
        .stroke({ width: 2.5, color, alpha: 1 });
    } else {
      body
        .poly([-r, 0, -r * 0.55, -r * 0.85, r * 0.55, -r * 0.85, r, 0, r * 0.55, r * 0.85, -r * 0.55, r * 0.85])
        .fill({ color: PALETTE.background, alpha: 0.82 })
        .stroke({ width: 2.5, color, alpha: 1 });
    }
    node.addChild(body);

    const glyph = new Graphics();
    glyph.position.set(0, -r * 0.12);
    drawUnitSymbol(glyph, def.unitClass, r * 0.95, color);
    node.addChild(glyph);

    // Strength bar.
    const fraction = Math.max(0, unit.strength / Math.max(1, def.maxStrength));
    const bar = new Graphics();
    const barWidth = r * 1.5;
    bar
      .rect(-barWidth / 2, r * 0.72, barWidth, 4)
      .fill({ color: 0x000000, alpha: 0.55 });
    bar
      .rect(-barWidth / 2, r * 0.72, barWidth * fraction, 4)
      .fill({ color: strengthColor(fraction) });
    node.addChild(bar);

    node.addChild(statusRow(unit, r));

    if (stale) node.alpha = 0.55;
    if (unit.hasActed && friendly && overlays.selected) node.alpha = Math.min(node.alpha, 0.8);

    return node;
  }
}

/* ------------------------------------------------------------------ */
/* Marker decoration                                                   */
/* ------------------------------------------------------------------ */

function label(text: string, size: number, color: number, alpha = 1): Text {
  const node = new Text({
    text,
    style: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: size,
      fill: color,
      fontWeight: '700',
    },
  });
  node.anchor.set(0.5);
  node.alpha = alpha;
  return node;
}

/**
 * The status strip under a marker. Every icon here answers a question the
 * player would otherwise have to open a panel to ask, and the emissions
 * indicator in particular needs to be visible at all times — a radiating
 * unit is in danger and the player must never be surprised by that.
 */
function statusRow(unit: Unit, r: number): Container {
  const row = new Container();
  const icons: Array<{ text: string; color: number }> = [];

  if (unit.emitting) icons.push({ text: '((•))', color: PALETTE.hostileGlow });

  const suppression = suppressionState(unit);
  if (suppression === 'PINNED') icons.push({ text: 'PIN', color: PALETTE.strengthBad });
  else if (suppression === 'SUPPRESSED') icons.push({ text: 'SUP', color: PALETTE.strengthWarn });

  if (unit.onOverwatch) icons.push({ text: 'OW', color: PALETTE.friendlyGlow });
  if (unit.hunkered) icons.push({ text: 'HD', color: PALETTE.textDim });
  if (unit.fortified) icons.push({ text: 'FTF', color: PALETTE.sensor });

  const gap = r * 0.06;
  const nodes = icons.map((icon) => label(icon.text, r * 0.34, icon.color));
  const total = nodes.reduce((sum, n) => sum + n.width + gap, -gap);
  let x = -total / 2;

  nodes.forEach((node) => {
    node.anchor.set(0, 0.5);
    node.position.set(x, -r * 1.05);
    x += node.width + gap;
    row.addChild(node);
  });

  return row;
}

export { hexKey };
