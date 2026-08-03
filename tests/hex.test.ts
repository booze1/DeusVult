import { describe, expect, it } from 'vitest';
import {
  hex,
  hexDistance,
  hexFromKey,
  hexKey,
  hexLine,
  hexNeighbors,
  hexRange,
  hexRing,
  hexRound,
  hexS,
  pixelToHex,
  hexToPixel,
  HEX_DIRECTIONS,
} from '@core/hex';

describe('hex coordinates', () => {
  it('keeps cube coordinates summing to zero', () => {
    for (const dir of HEX_DIRECTIONS) {
      expect(dir.q + dir.r + hexS(dir)).toBe(0);
    }
  });

  it('round-trips through packed keys, including negatives', () => {
    for (const [q, r] of [
      [0, 0],
      [5, -3],
      [-7, 11],
      [-511, 511],
      [128, -256],
    ] as const) {
      const original = hex(q, r);
      expect(hexFromKey(hexKey(original))).toEqual(original);
    }
  });

  it('produces distinct keys for distinct hexes', () => {
    const seen = new Set<number>();
    for (const h of hexRange(hex(0, 0), 12)) {
      const key = hexKey(h);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('gives every neighbour distance one', () => {
    const origin = hex(3, -2);
    for (const neighbor of hexNeighbors(origin)) {
      expect(hexDistance(origin, neighbor)).toBe(1);
    }
  });

  it('computes symmetric distances', () => {
    const a = hex(-4, 7);
    const b = hex(9, -2);
    expect(hexDistance(a, b)).toBe(hexDistance(b, a));
  });

  it('places every ring member at exactly the ring radius', () => {
    for (let radius = 1; radius <= 6; radius++) {
      const ring = hexRing(hex(0, 0), radius);
      expect(ring).toHaveLength(6 * radius);
      for (const h of ring) {
        expect(hexDistance(hex(0, 0), h)).toBe(radius);
      }
    }
  });

  it('returns the centred hex count for a range', () => {
    // 1 + 3n(n+1) is the closed form for a hexagonal area.
    for (let n = 0; n <= 5; n++) {
      expect(hexRange(hex(0, 0), n)).toHaveLength(1 + 3 * n * (n + 1));
    }
  });

  describe('line drawing', () => {
    it('starts and ends on the endpoints with the right length', () => {
      const a = hex(-3, 1);
      const b = hex(4, -2);
      const line = hexLine(a, b);
      expect(line[0]).toEqual(a);
      expect(line[line.length - 1]).toEqual(b);
      expect(line).toHaveLength(hexDistance(a, b) + 1);
    });

    it('steps exactly one hex at a time', () => {
      const line = hexLine(hex(-5, 2), hex(6, -3));
      for (let i = 1; i < line.length; i++) {
        expect(hexDistance(line[i - 1]!, line[i]!)).toBe(1);
      }
    });

    /**
     * Symmetry is the property that matters for line of sight: if A can see B
     * along a tile sequence, B must see A along the same tiles reversed, or
     * players get asymmetric visibility that reads as a bug.
     */
    it('is symmetric under reversal', () => {
      const pairs: Array<[ReturnType<typeof hex>, ReturnType<typeof hex>]> = [
        [hex(0, 0), hex(5, 0)],
        [hex(0, 0), hex(3, -3)],
        [hex(-2, 4), hex(4, -1)],
        [hex(1, 1), hex(-4, 6)],
      ];
      for (const [a, b] of pairs) {
        expect(hexLine(a, b)).toEqual([...hexLine(b, a)].reverse());
      }
    });
  });

  it('rounds fractional hexes to a valid cube coordinate', () => {
    const rounded = hexRound({ q: 1.4, r: -0.7, s: -0.7 });
    expect(rounded.q + rounded.r + hexS(rounded)).toBe(0);
  });

  it('round-trips through pixel space', () => {
    const layout = { size: 32, originX: 400, originY: 300 };
    for (const h of hexRange(hex(0, 0), 6)) {
      const point = hexToPixel(h, layout);
      expect(pixelToHex(point.x, point.y, layout)).toEqual(h);
    }
  });
});
