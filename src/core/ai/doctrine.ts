/**
 * Doctrine profiles.
 *
 * The AI is one algorithm with different weights. Making doctrine a data
 * table rather than separate code paths means a designer can retune how an
 * opponent behaves without touching the search, and the difference between
 * forces stays legible: the reconnaissance-strike opponent really does prize
 * designation and standoff, and it shows in play.
 */

import type { Nation } from '../types';

export interface Doctrine {
  /** Appetite for closing with the enemy. Higher pushes forward harder. */
  readonly aggression: number;
  /** Weight on holding and taking ground. */
  readonly objectiveDrive: number;
  /** Weight on avoiding known enemy weapons envelopes. */
  readonly caution: number;
  /** Weight on generating and maintaining tracked contacts. */
  readonly reconValue: number;
  /** Weight on keeping scarce munitions for high-value targets. */
  readonly munitionDiscipline: number;
  /** Willingness to radiate for detection advantage. */
  readonly emissionTolerance: number;
  /** Preference for suppressing over destroying. */
  readonly suppressionBias: number;
}

const RECON_STRIKE: Doctrine = {
  aggression: 0.85,
  objectiveDrive: 1.0,
  caution: 0.7,
  // Finding is the whole doctrine: cheap sensors feed massed precision fires.
  reconValue: 1.5,
  munitionDiscipline: 0.9,
  emissionTolerance: 0.8,
  suppressionBias: 0.8,
};

const DISPERSED_LITTORAL: Doctrine = {
  aggression: 0.5,
  objectiveDrive: 0.9,
  caution: 1.2,
  reconValue: 1.3,
  munitionDiscipline: 1.4,
  emissionTolerance: 0.4,
  suppressionBias: 0.6,
};

const PREPARED_DEFENCE: Doctrine = {
  aggression: 0.35,
  objectiveDrive: 1.2,
  caution: 1.1,
  reconValue: 1.0,
  munitionDiscipline: 1.2,
  emissionTolerance: 0.5,
  suppressionBias: 0.9,
};

const CAVALRY: Doctrine = {
  aggression: 1.0,
  objectiveDrive: 0.9,
  caution: 0.8,
  reconValue: 1.2,
  munitionDiscipline: 1.0,
  emissionTolerance: 0.6,
  suppressionBias: 0.7,
};

export const DOCTRINE_BY_NATION: Readonly<Record<Nation, Doctrine>> = Object.freeze({
  CHN: RECON_STRIKE,
  USA: DISPERSED_LITTORAL,
  JPN: PREPARED_DEFENCE,
  AUS: CAVALRY,
});

/** Difficulty scales how well the AI evaluates, not how much it cheats. */
export interface DifficultySettings {
  readonly name: string;
  /** Fraction of candidate moves considered. Lower = more oversights. */
  readonly searchBreadth: number;
  /** Random noise added to action scores, as a fraction of score magnitude. */
  readonly noise: number;
  /** Probability of skipping an available reaction such as overwatch. */
  readonly lapseChance: number;
}

export const DIFFICULTIES: Readonly<Record<string, DifficultySettings>> = Object.freeze({
  RECRUIT: { name: 'Recruit', searchBreadth: 0.45, noise: 0.35, lapseChance: 0.3 },
  REGULAR: { name: 'Regular', searchBreadth: 0.75, noise: 0.18, lapseChance: 0.12 },
  VETERAN: { name: 'Veteran', searchBreadth: 1.0, noise: 0.08, lapseChance: 0.03 },
  ELITE: { name: 'Elite', searchBreadth: 1.0, noise: 0.0, lapseChance: 0.0 },
});
