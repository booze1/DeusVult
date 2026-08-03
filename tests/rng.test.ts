import { describe, expect, it } from 'vitest';
import { Rng, binomialInterval, binomialPmf } from '@core/rng';

describe('Rng', () => {
  it('is reproducible from the same seed', () => {
    const a = new Rng('stone-lantern');
    const b = new Rng('stone-lantern');
    for (let i = 0; i < 500; i++) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
  });

  it('diverges for different seeds', () => {
    const a = new Rng('alpha');
    const b = new Rng('beta');
    const first = Array.from({ length: 20 }, () => a.nextUint32());
    const second = Array.from({ length: 20 }, () => b.nextUint32());
    expect(first).not.toEqual(second);
  });

  it('restores exactly from a saved state', () => {
    const rng = new Rng(12345);
    for (let i = 0; i < 37; i++) rng.nextUint32();

    const snapshot = rng.save();
    const expected = Array.from({ length: 25 }, () => rng.nextUint32());

    const restored = new Rng(snapshot);
    const actual = Array.from({ length: 25 }, () => restored.nextUint32());
    expect(actual).toEqual(expected);
  });

  it('produces floats strictly within [0, 1)', () => {
    const rng = new Rng('floats');
    for (let i = 0; i < 20000; i++) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  /**
   * Modulo bias is easy to introduce and invisible until a balance sweep
   * produces subtly wrong numbers, so it is asserted directly.
   */
  it('draws unbiased integers for non-power-of-two bounds', () => {
    const rng = new Rng('unbiased');
    const bound = 6;
    const counts = new Array<number>(bound).fill(0);
    const draws = 240000;

    for (let i = 0; i < draws; i++) counts[rng.nextInt(bound)]! += 1;

    const expected = draws / bound;
    for (const count of counts) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.03);
    }
  });

  it('respects nextRange bounds inclusively', () => {
    const rng = new Rng('range');
    let sawMin = false;
    let sawMax = false;
    for (let i = 0; i < 5000; i++) {
      const value = rng.nextRange(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      if (value === 3) sawMin = true;
      if (value === 7) sawMax = true;
    }
    expect(sawMin && sawMax).toBe(true);
  });

  describe('forked streams', () => {
    it('produce independent sequences', () => {
      const parent = new Rng('parent');
      const combat = parent.fork('combat');
      const ai = parent.fork('ai');
      const combatDraws = Array.from({ length: 30 }, () => combat.nextUint32());
      const aiDraws = Array.from({ length: 30 }, () => ai.nextUint32());
      expect(combatDraws).not.toEqual(aiDraws);
    });

    it('are stable for the same label from the same parent state', () => {
      const state = new Rng('seed').save();
      const first = new Rng(state).fork('combat');
      const second = new Rng(state).fork('combat');
      expect(
        Array.from({ length: 20 }, () => first.nextUint32()),
      ).toEqual(Array.from({ length: 20 }, () => second.nextUint32()));
    });
  });

  describe('binomial', () => {
    it('never exceeds the trial count and never goes negative', () => {
      const rng = new Rng('binomial-bounds');
      for (let i = 0; i < 5000; i++) {
        const n = rng.nextRange(1, 12);
        const result = rng.binomial(n, 0.5);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(n);
      }
    });

    it('converges on n*p', () => {
      const rng = new Rng('binomial-mean');
      const n = 8;
      const p = 0.6;
      let total = 0;
      const samples = 50000;
      for (let i = 0; i < samples; i++) total += rng.binomial(n, p);
      expect(total / samples).toBeCloseTo(n * p, 1);
    });

    it('handles degenerate probabilities without drawing', () => {
      const rng = new Rng('degenerate');
      expect(rng.binomial(5, 0)).toBe(0);
      expect(rng.binomial(5, 1)).toBe(5);
      expect(rng.binomial(0, 0.5)).toBe(0);
    });

    /**
     * The whole point of resolving at platoon scale: with a realistic volley
     * the outcome clusters, so a player is very rarely handed a total whiff
     * on a strong attack. This is the anti-frustration property the design
     * depends on, so it is asserted rather than assumed.
     */
    it('almost never produces a total miss at realistic volumes', () => {
      const rng = new Rng('no-whiff');
      const n = 6;
      const p = 0.6;
      let zeroes = 0;
      const samples = 20000;
      for (let i = 0; i < samples; i++) {
        if (rng.binomial(n, p) === 0) zeroes++;
      }
      // (1 - 0.6)^6 is about 0.41%.
      expect(zeroes / samples).toBeLessThan(0.01);
    });
  });

  describe('binomial helpers', () => {
    it('has a probability mass function summing to one', () => {
      for (const [n, p] of [
        [6, 0.6],
        [10, 0.25],
        [3, 0.9],
      ] as const) {
        let total = 0;
        for (let k = 0; k <= n; k++) total += binomialPmf(n, k, p);
        expect(total).toBeCloseTo(1, 6);
      }
    });

    it('returns an interval containing the mean', () => {
      const { lo, hi, mean } = binomialInterval(8, 0.55, 0.8);
      expect(mean).toBeCloseTo(4.4, 5);
      expect(lo).toBeLessThanOrEqual(Math.round(mean));
      expect(hi).toBeGreaterThanOrEqual(Math.round(mean));
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(8);
    });
  });

  it('shuffles deterministically for a given seed', () => {
    const a = new Rng('shuffle').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Rng('shuffle').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
