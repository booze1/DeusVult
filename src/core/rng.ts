/**
 * Deterministic pseudo-random number generation.
 *
 * The entire simulation draws randomness from here and nowhere else. No
 * `Math.random()` may appear under src/core — a lint-level rule enforced by
 * tests/determinism.test.ts. This buys us:
 *
 *   - Replays that are just (seed + command list), a few hundred bytes.
 *   - Reproducible balance sweeps: 10k headless battles, same result twice.
 *   - Server-authoritative validation later, if PvP ever ships.
 *
 * Algorithm is sfc32 (Small Fast Counter, 128-bit state). Chosen over
 * mulberry32 because a 32-bit state visibly correlates across the many short
 * streams we fork per battle; sfc32 passes PractRand to 32TB and costs the
 * same handful of ops.
 */

const TWO_POW_32 = 4294967296;

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | string | RngState) {
    if (typeof seed === 'object') {
      this.a = seed.a >>> 0;
      this.b = seed.b >>> 0;
      this.c = seed.c >>> 0;
      this.d = seed.d >>> 0;
      return;
    }
    const h = typeof seed === 'string' ? hashString(seed) : hashInt(seed);
    // Scramble the single seed into four words, then discard early output.
    this.a = h[0]!;
    this.b = h[1]!;
    this.c = h[2]!;
    this.d = h[3]!;
    for (let i = 0; i < 12; i++) this.nextUint32();
  }

  /** Snapshot for save games and replay checkpoints. */
  save(): RngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  restore(state: RngState): void {
    this.a = state.a >>> 0;
    this.b = state.b >>> 0;
    this.c = state.c >>> 0;
    this.d = state.d >>> 0;
  }

  clone(): Rng {
    return new Rng(this.save());
  }

  /**
   * Derive an independent child stream.
   *
   * Used to isolate subsystems: AI search must never perturb the combat
   * stream, or the same battle would resolve differently depending on how
   * long the opponent thought about it. Each subsystem forks by label.
   */
  fork(label: string): Rng {
    const h = hashString(label);
    return new Rng({
      a: (this.a ^ h[0]!) >>> 0,
      b: (this.b ^ h[1]!) >>> 0,
      c: (this.c ^ h[2]!) >>> 0,
      d: (this.nextUint32() ^ h[3]!) >>> 0,
    });
  }

  nextUint32(): number {
    // sfc32
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / TWO_POW_32;
  }

  /**
   * Uniform integer in [0, bound). Rejection-sampled, so it is genuinely
   * unbiased rather than the usual modulo skew — which matters because we
   * draw small bounds (2..8) millions of times across a balance sweep.
   */
  nextInt(bound: number): number {
    if (bound <= 0) throw new RangeError(`nextInt bound must be positive, got ${bound}`);
    if ((bound & (bound - 1)) === 0) {
      // 2^32 is an exact multiple of any power of two, so modulo is already
      // unbiased here and we can skip rejection entirely.
      return this.nextUint32() % bound;
    }
    const limit = TWO_POW_32 - (TWO_POW_32 % bound);
    let value = this.nextUint32();
    while (value >= limit) value = this.nextUint32();
    return value % bound;
  }

  /** Integer in [min, max] inclusive. */
  nextRange(min: number, max: number): number {
    return min + this.nextInt(max - min + 1);
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.nextFloat() < p;
  }

  /**
   * Number of successes in `n` independent trials at probability `p`.
   *
   * This is the heart of the combat model. A squad's attack is not one coin
   * flip, it is n rounds of effective fire, so outcomes cluster around the
   * mean instead of producing the binary hit/miss whiff that makes
   * percentage-based tactics games feel arbitrary.
   *
   * Direct simulation (rather than an inversion method) keeps the draw count
   * a pure function of n, which preserves stream alignment across replays.
   * n is bounded by MAX_VOLLEY in combat.ts, so this stays cheap.
   */
  binomial(n: number, p: number): number {
    if (n <= 0) return 0;
    if (p <= 0) return 0;
    if (p >= 1) return n;
    let successes = 0;
    for (let i = 0; i < n; i++) {
      if (this.nextFloat() < p) successes++;
    }
    return successes;
  }

  /** Uniformly pick an element. Returns undefined for an empty array. */
  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[this.nextInt(items.length)];
  }

  /**
   * Pick by weight. Weights need not sum to 1; non-positive weights are
   * skipped. Returns undefined if every weight is non-positive.
   */
  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T | undefined {
    let total = 0;
    for (const item of items) {
      const w = weightOf(item);
      if (w > 0) total += w;
    }
    if (total <= 0) return undefined;

    let roll = this.nextFloat() * total;
    for (const item of items) {
      const w = weightOf(item);
      if (w <= 0) continue;
      roll -= w;
      if (roll < 0) return item;
    }
    return items[items.length - 1];
  }

  /** In-place Fisher-Yates. Mutates and returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
    return items;
  }
}

/* ------------------------------------------------------------------ */
/* Seed hashing                                                        */
/* ------------------------------------------------------------------ */

/** FNV-1a derived 128-bit expansion of a string seed. */
export function hashString(input: string): [number, number, number, number] {
  let h1 = 0x9e3779b9 ^ input.length;
  let h2 = 0x85ebca6b ^ input.length;
  let h3 = 0xc2b2ae35 ^ input.length;
  let h4 = 0x27d4eb2f ^ input.length;

  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 2246822519);
    h4 = Math.imul(h4 ^ ch, 3266489917);
  }

  h1 = (h1 ^ (h1 >>> 16)) >>> 0;
  h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  h3 = (h3 ^ (h3 >>> 16)) >>> 0;
  h4 = (h4 ^ (h4 >>> 13)) >>> 0;
  // Ensure the state is never all-zero, which is an sfc32 fixed point.
  if ((h1 | h2 | h3 | h4) === 0) h1 = 0x9e3779b9;
  return [h1, h2, h3, h4];
}

export function hashInt(seed: number): [number, number, number, number] {
  return hashString(`seed:${Math.trunc(seed)}`);
}

/**
 * Exact binomial probability mass, used by the UI to draw the damage
 * distribution the player sees before committing to a shot. Not used by the
 * simulation itself — display only, so floating point drift is harmless.
 */
export function binomialPmf(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  // Work in log space; n is small but factorials still overflow quickly.
  const logC = logFactorial(n) - logFactorial(k) - logFactorial(n - k);
  const logP = logC + k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logP);
}

const LOG_FACTORIAL_CACHE: number[] = [0, 0];

function logFactorial(n: number): number {
  if (n < 0) return NaN;
  const cached = LOG_FACTORIAL_CACHE[n];
  if (cached !== undefined) return cached;
  let value = LOG_FACTORIAL_CACHE[LOG_FACTORIAL_CACHE.length - 1]!;
  for (let i = LOG_FACTORIAL_CACHE.length; i <= n; i++) {
    value += Math.log(i);
    LOG_FACTORIAL_CACHE[i] = value;
  }
  return LOG_FACTORIAL_CACHE[n]!;
}

/**
 * Smallest interval [lo, hi] of successes covering at least `mass` of the
 * distribution, centred on the mean. This is what the fire preview shows:
 * "expected 4, likely 2-6" reads far better to a player than "62% to hit".
 */
export function binomialInterval(
  n: number,
  p: number,
  mass = 0.8,
): { lo: number; hi: number; mean: number } {
  const mean = n * p;
  if (n <= 0) return { lo: 0, hi: 0, mean: 0 };

  const pmf: number[] = [];
  for (let k = 0; k <= n; k++) pmf.push(binomialPmf(n, k, p));

  let lo = Math.min(n, Math.max(0, Math.round(mean)));
  let hi = lo;
  let covered = pmf[lo] ?? 0;

  while (covered < mass && (lo > 0 || hi < n)) {
    const below = lo > 0 ? pmf[lo - 1]! : -1;
    const above = hi < n ? pmf[hi + 1]! : -1;
    if (above >= below) {
      hi++;
      covered += above;
    } else {
      lo--;
      covered += below;
    }
  }
  return { lo, hi, mean };
}
