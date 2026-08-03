/**
 * Mission definition format.
 *
 * Missions are plain data plus a map builder. Keeping them declarative means
 * the headless runner can load and play any mission without a renderer, which
 * is what makes automated balance passes possible.
 */

import type { Hex } from './hex';
import type {
  GameMap,
  Objective,
  Side,
  UnitDefId,
} from './types';

export interface Deployment {
  readonly defId: UnitDefId;
  readonly side: Side;
  readonly pos: Hex;
  readonly callsign?: string;
  readonly veterancy?: number;
  /** Start with active sensors radiating. */
  readonly emitting?: boolean;
  readonly fortified?: boolean;
  /** Marks a unit as belonging to the player's persistent task force. */
  readonly taskForceId?: string;
}

export interface Reinforcement {
  readonly turn: number;
  readonly deployment: Deployment;
  readonly announcement?: string;
}

export interface MissionDef {
  readonly id: string;
  readonly name: string;
  /** Short operational designation, e.g. "OPERATION IRON CURTAIN". */
  readonly operation: string;
  readonly playerSide: Side;
  readonly maxTurns: number;
  /** Narrative briefing paragraphs. */
  readonly brief: readonly string[];
  /** Bullet-point intelligence summary shown before deployment. */
  readonly intel: readonly string[];
  /**
   * Teaching beats surfaced as contextual prompts during play. The campaign
   * introduces one new idea per mission and this is where that is authored.
   */
  readonly lessons?: readonly MissionLesson[];
  readonly buildMap: () => GameMap;
  readonly deployments: readonly Deployment[];
  readonly reinforcements?: readonly Reinforcement[];
  readonly buildObjectives: () => Objective[];
  /** Par turn count for the after-action rating. */
  readonly parTurns: number;
}

export interface MissionLesson {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** Turn on which to surface it, or 'onFirstContact' style triggers. */
  readonly trigger: 'START' | 'FIRST_CONTACT' | 'FIRST_LOSS' | 'TURN';
  readonly turn?: number;
}
