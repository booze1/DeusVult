/**
 * Hex grid mathematics — pointy-top, axial storage, cube arithmetic.
 *
 * Conventions (see docs/ARCHITECTURE.md §Hex):
 *   - Axial coordinates (q, r). Implicit cube s = -q - r.
 *   - Pointy-top orientation: flat sides left/right, vertices up/down.
 *     Chosen because tactical maps read wider than tall on a phone in
 *     landscape, and pointy-top gives clean E/W movement lanes.
 *   - Direction 0 is East, then counter-clockwise.
 *
 * Every function here is pure and integer-exact except the pixel-space and
 * line-drawing helpers, which are documented individually. The simulation
 * never depends on floating point for legality decisions.
 */

export interface Hex {
  readonly q: number;
  readonly r: number;
}

/**
 * Packed integer key for Map/Set use. Encodes coordinates in [-512, 511].
 * Integer keys hash markedly faster than strings, and the sim does a great
 * deal of per-tile lookup during pathfinding and sensor sweeps.
 */
export type HexKey = number;

const KEY_OFFSET = 512;
const KEY_STRIDE = 1024;

/** Largest absolute axial coordinate representable by {@link hexKey}. */
export const MAX_COORD = KEY_OFFSET - 1;

export function hex(q: number, r: number): Hex {
  return { q, r };
}

export function hexKey(h: Hex): HexKey {
  return (h.q + KEY_OFFSET) * KEY_STRIDE + (h.r + KEY_OFFSET);
}

export function hexFromKey(key: HexKey): Hex {
  const r = (key % KEY_STRIDE) - KEY_OFFSET;
  const q = Math.floor(key / KEY_STRIDE) - KEY_OFFSET;
  return { q, r };
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexToString(h: Hex): string {
  return `${h.q},${h.r}`;
}

/** Implicit third cube coordinate. */
export function hexS(h: Hex): number {
  return -h.q - h.r;
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexSub(a: Hex, b: Hex): Hex {
  return { q: a.q - b.q, r: a.r - b.r };
}

export function hexScale(a: Hex, k: number): Hex {
  return { q: a.q * k, r: a.r * k };
}

/**
 * The six axial direction vectors, index 0 = East, proceeding
 * counter-clockwise: E, NE, NW, W, SW, SE.
 */
export const HEX_DIRECTIONS: readonly Hex[] = Object.freeze([
  Object.freeze({ q: 1, r: 0 }),
  Object.freeze({ q: 1, r: -1 }),
  Object.freeze({ q: 0, r: -1 }),
  Object.freeze({ q: -1, r: 0 }),
  Object.freeze({ q: -1, r: 1 }),
  Object.freeze({ q: 0, r: 1 }),
]);

/** Human-readable direction labels, parallel to {@link HEX_DIRECTIONS}. */
export const HEX_DIRECTION_NAMES: readonly string[] = Object.freeze([
  'E',
  'NE',
  'NW',
  'W',
  'SW',
  'SE',
]);

export function hexNeighbor(h: Hex, direction: number): Hex {
  const dir = HEX_DIRECTIONS[((direction % 6) + 6) % 6]!;
  return hexAdd(h, dir);
}

export function hexNeighbors(h: Hex): Hex[] {
  const out: Hex[] = [];
  for (let d = 0; d < 6; d++) out.push(hexAdd(h, HEX_DIRECTIONS[d]!));
  return out;
}

/** Exact integer hex distance (cube metric). */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = hexS(a) - hexS(b);
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/**
 * Direction index from `a` toward `b`, or -1 when they coincide.
 * Used for facing, flanking checks and arc-of-fire.
 */
export function hexDirectionTo(a: Hex, b: Hex): number {
  if (hexEquals(a, b)) return -1;
  let best = 0;
  let bestDot = -Infinity;
  const d = hexSub(b, a);
  // Compare against each unit direction using a cube-space dot product.
  for (let i = 0; i < 6; i++) {
    const u = HEX_DIRECTIONS[i]!;
    const dot = d.q * u.q + d.r * u.r + hexS(d) * hexS(u);
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

/** All hexes exactly `radius` steps from `center`. Radius 0 yields center. */
export function hexRing(center: Hex, radius: number): Hex[] {
  if (radius <= 0) return [{ ...center }];
  const results: Hex[] = [];
  // Start on the SW spoke so the ring walks in a consistent, testable order.
  let current = hexAdd(center, hexScale(HEX_DIRECTIONS[4]!, radius));
  for (let d = 0; d < 6; d++) {
    for (let step = 0; step < radius; step++) {
      results.push(current);
      current = hexNeighbor(current, d);
    }
  }
  return results;
}

/** Every hex within `radius` of `center`, center first, then outward. */
export function hexRange(center: Hex, radius: number): Hex[] {
  const results: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    const rLo = Math.max(-radius, -q - radius);
    const rHi = Math.min(radius, -q + radius);
    for (let r = rLo; r <= rHi; r++) {
      results.push({ q: center.q + q, r: center.r + r });
    }
  }
  return results;
}

/** Hexes with distance in [min, max] of center. */
export function hexAnnulus(center: Hex, min: number, max: number): Hex[] {
  const out: Hex[] = [];
  for (let radius = min; radius <= max; radius++) {
    out.push(...hexRing(center, radius));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Fractional hexes and line drawing                                   */
/* ------------------------------------------------------------------ */

interface FractionalHex {
  q: number;
  r: number;
  s: number;
}

/** Round a fractional cube coordinate to the nearest hex. */
export function hexRound(frac: FractionalHex): Hex {
  let rq = Math.round(frac.q);
  let rr = Math.round(frac.r);
  const rs = Math.round(frac.s);

  const dq = Math.abs(rq - frac.q);
  const dr = Math.abs(rr - frac.r);
  const ds = Math.abs(rs - frac.s);

  // Discard the component with the largest rounding error so q + r + s === 0.
  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  // `| 0` normalises negative zero, which Math.round produces for inputs in
  // (-0.5, 0]. Without this, hexes that compare equal serialise differently
  // and fail structural equality checks.
  return { q: rq | 0, r: rr | 0 };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Hexes traversed by the straight line from `a` to `b`, inclusive of both.
 *
 * The 1e-6 nudge is the standard Red Blob epsilon: it breaks ties consistently
 * when the line runs exactly along a hex edge, so LOS is never ambiguous and,
 * critically, is symmetric — A sees B if and only if B sees A along the same
 * tile sequence. Tested in tests/hex.test.ts.
 */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = hexDistance(a, b);
  if (n === 0) return [{ ...a }];

  const aq = a.q + 1e-6;
  const ar = a.r + 1e-6;
  const as = hexS(a) - 2e-6;
  const bq = b.q + 1e-6;
  const br = b.r + 1e-6;
  const bs = hexS(b) - 2e-6;

  const results: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    results.push(
      hexRound({
        q: lerp(aq, bq, t),
        r: lerp(ar, br, t),
        s: lerp(as, bs, t),
      }),
    );
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Screen-space layout (pointy-top)                                    */
/* ------------------------------------------------------------------ */

export interface HexLayout {
  /** Horizontal radius of a hex in pixels (centre to vertex, on the x axis). */
  readonly size: number;
  readonly originX: number;
  readonly originY: number;
}

const SQRT3 = Math.sqrt(3);

export function hexToPixel(h: Hex, layout: HexLayout): { x: number; y: number } {
  const x = layout.size * (SQRT3 * h.q + (SQRT3 / 2) * h.r);
  const y = layout.size * (1.5 * h.r);
  return { x: x + layout.originX, y: y + layout.originY };
}

export function pixelToHex(x: number, y: number, layout: HexLayout): Hex {
  const px = (x - layout.originX) / layout.size;
  const py = (y - layout.originY) / layout.size;
  const q = (SQRT3 / 3) * px - (1 / 3) * py;
  const r = (2 / 3) * py;
  return hexRound({ q, r, s: -q - r });
}

/** The six vertex offsets of a pointy-top hex, for polygon rendering. */
export function hexCorners(
  center: { x: number; y: number },
  size: number,
): Array<{ x: number; y: number }> {
  const corners: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    // Pointy-top: first vertex at 30°, stepping 60°.
    const angle = (Math.PI / 180) * (60 * i - 30);
    corners.push({
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle),
    });
  }
  return corners;
}
