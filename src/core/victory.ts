/**
 * Objective evaluation and mission outcome.
 *
 * Objectives are re-evaluated after every command rather than only at end of
 * turn, so the player sees a capture tick over the instant they take the
 * ground. Immediate feedback on objectives is worth the trivial cost of
 * recomputation at these unit counts.
 */

import { hexDistance, hexEquals } from './hex';
import { getUnitDef } from './registry';
import { lineOfSight } from './sensors';
import { unitsBySide } from './state';
import {
  DetectionLevel,
  opposingSide,
  type GameState,
  type MissionOutcome,
  type Objective,
  type Side,
} from './types';

function holdsAllHexes(state: GameState, side: Side, objective: Objective): boolean {
  if (!objective.hexes || objective.hexes.length === 0) return false;
  const held = unitsBySide(state, side);
  return objective.hexes.every((h) => held.some((u) => hexEquals(u.pos, h)));
}

function enemyHoldsAny(state: GameState, side: Side, objective: Objective): boolean {
  if (!objective.hexes) return false;
  const enemies = unitsBySide(state, opposingSide(side));
  return objective.hexes.some((h) => enemies.some((u) => hexEquals(u.pos, h)));
}

/** Recon objectives: has this side got eyes on the ground in question? */
function hasObserved(state: GameState, side: Side, objective: Objective): boolean {
  if (!objective.hexes) return false;
  const observers = unitsBySide(state, side);

  return objective.hexes.every((h) =>
    observers.some((observer) => {
      const def = getUnitDef(observer.defId);
      const best = def.sensors.reduce((max, s) => Math.max(max, s.range), 0);
      if (hexDistance(observer.pos, h) > best) return false;
      return lineOfSight(state.map, observer.pos, h, def.altitude, 0).clear;
    }),
  );
}

/**
 * DESTROY completion. Resolves against explicit ids when given, otherwise
 * against unit types on the opposing side, otherwise against that side's
 * entire order of battle.
 */
function allDestroyed(state: GameState, objective: Objective): boolean {
  if (objective.unitIds && objective.unitIds.length > 0) {
    return objective.unitIds.every((id) => state.units.get(id)?.destroyed ?? true);
  }

  const enemySide = opposingSide(objective.side);
  const pool = [...state.units.values()].filter((u) => {
    if (u.side !== enemySide) return false;
    if (objective.defIds && objective.defIds.length > 0) {
      return objective.defIds.includes(u.defId);
    }
    return true;
  });

  if (pool.length === 0) return false;
  return pool.every((u) => u.destroyed);
}

function anyDestroyed(state: GameState, objective: Objective): boolean {
  if (!objective.unitIds) return false;
  return objective.unitIds.some((id) => state.units.get(id)?.destroyed ?? false);
}

/**
 * Update every objective's complete/failed flags in place.
 *
 * Capture objectives are intentionally *not* sticky — ground you take can be
 * taken back, and a mission is not won until the clock runs out or every
 * mandatory objective is simultaneously satisfied. That keeps the last turns
 * of a defensive mission tense instead of a formality.
 */
export function evaluateObjectives(state: GameState): void {
  for (const objective of state.objectives) {
    if (objective.failed) continue;

    switch (objective.kind) {
      case 'CAPTURE':
        objective.complete = holdsAllHexes(state, objective.side, objective);
        break;

      case 'DESTROY':
        objective.complete = allDestroyed(state, objective);
        break;

      case 'SURVIVE': {
        const survivors = objective.unitIds
          ? objective.unitIds.filter((id) => !(state.units.get(id)?.destroyed ?? true))
          : unitsBySide(state, objective.side)
              .filter(
                (u) =>
                  !objective.defIds ||
                  objective.defIds.length === 0 ||
                  objective.defIds.includes(u.defId),
              )
              .map((u) => u.id);
        if (survivors.length === 0) {
          objective.failed = true;
        } else if (objective.byTurn !== undefined && state.turn > objective.byTurn) {
          objective.complete = true;
        }
        break;
      }

      case 'ESCORT':
        if (anyDestroyed(state, objective)) {
          objective.failed = true;
        } else if (objective.hexes && objective.unitIds) {
          const escorted = objective.unitIds
            .map((id) => state.units.get(id))
            .filter((u) => u && !u.destroyed);
          objective.complete =
            escorted.length > 0 &&
            escorted.every((u) => objective.hexes!.some((h) => hexEquals(u!.pos, h)));
        }
        break;

      case 'DENY':
        // Ground changes hands. What matters is who holds it when the clock
        // stops, so a timed DENY resolves only at the deadline — failing the
        // instant an enemy sets foot on the hex would make a counterattack
        // pointless and a fighting withdrawal impossible, which is not what
        // "hold this position" has ever meant.
        if (objective.byTurn === undefined) {
          if (enemyHoldsAny(state, objective.side, objective)) objective.failed = true;
        } else if (state.turn > objective.byTurn) {
          if (enemyHoldsAny(state, objective.side, objective)) objective.failed = true;
          else objective.complete = true;
        }
        break;

      case 'RECON':
        // Recon is sticky: once seen, the intelligence is banked.
        if (!objective.complete) objective.complete = hasObserved(state, objective.side, objective);
        break;
    }
  }
}

export interface OutcomeReport {
  readonly outcome: MissionOutcome;
  readonly reason: string;
}

/**
 * Determine mission outcome from the player's perspective.
 *
 * A timed-out mission with all mandatory objectives held counts as a victory:
 * defensive missions are won by still being there at the end, and punishing
 * that would make the whole objective class feel broken.
 */
export function evaluateOutcome(state: GameState, playerSide: Side): OutcomeReport {
  evaluateObjectives(state);

  const mine = state.objectives.filter((o) => o.side === playerSide && !o.optional);

  const failed = mine.find((o) => o.failed);
  if (failed) return { outcome: 'DEFEAT', reason: `Objective failed: ${failed.label}` };

  const survivors = unitsBySide(state, playerSide);
  if (survivors.length === 0) {
    return { outcome: 'DEFEAT', reason: 'Task force destroyed' };
  }

  const allComplete = mine.length > 0 && mine.every((o) => o.complete);
  if (allComplete) {
    return { outcome: 'VICTORY', reason: 'All objectives secured' };
  }

  // Reaching here past the deadline means at least one mandatory objective
  // is still outstanding; the all-complete case returned VICTORY above.
  if (state.turn > state.maxTurns) {
    return { outcome: 'DEFEAT', reason: 'Operation timed out' };
  }

  return { outcome: 'ONGOING', reason: '' };
}

/** Apply the outcome to state, logging the transition once. */
export function applyOutcome(state: GameState, playerSide: Side): OutcomeReport {
  const report = evaluateOutcome(state, playerSide);
  if (report.outcome !== 'ONGOING' && state.outcome === 'ONGOING') {
    state.outcome = report.outcome;
    state.phase = 'RESOLVED';
    state.log.push({
      turn: state.turn,
      side: playerSide,
      severity: 'OBJECTIVE',
      message:
        report.outcome === 'VICTORY'
          ? `Mission accomplished — ${report.reason}.`
          : `Mission failed — ${report.reason}.`,
    });
  }
  return report;
}

/* ------------------------------------------------------------------ */
/* After-action scoring                                                */
/* ------------------------------------------------------------------ */

export interface AfterActionReport {
  readonly outcome: MissionOutcome;
  readonly turnsTaken: number;
  readonly parTurns: number;
  readonly friendlyLosses: number;
  readonly enemyLosses: number;
  readonly objectivesComplete: number;
  readonly objectivesTotal: number;
  readonly optionalComplete: number;
  /** 0-3 stars, the campaign's progression currency. */
  readonly rating: number;
  readonly intelScore: number;
}

/**
 * Score the mission. Note that intelligence is rated explicitly: a player who
 * won while never losing sight of the enemy played the game the way it is
 * designed to be played, and the rating should say so.
 */
export function buildAfterActionReport(
  state: GameState,
  playerSide: Side,
  parTurns: number,
): AfterActionReport {
  const friendly = [...state.units.values()].filter((u) => u.side === playerSide);
  const enemy = [...state.units.values()].filter((u) => u.side !== playerSide);

  const friendlyLosses = friendly.filter((u) => u.destroyed).length;
  const enemyLosses = enemy.filter((u) => u.destroyed).length;

  const mandatory = state.objectives.filter((o) => o.side === playerSide && !o.optional);
  const optional = state.objectives.filter((o) => o.side === playerSide && o.optional);
  const objectivesComplete = mandatory.filter((o) => o.complete).length;
  const optionalComplete = optional.filter((o) => o.complete).length;

  // Intelligence score: what fraction of the surviving enemy force does the
  // player currently hold at identified quality or better?
  const livingEnemy = enemy.filter((u) => !u.destroyed);
  const tracked = livingEnemy.filter((u) => {
    const contact = state.contacts[playerSide].get(u.id);
    return contact && !contact.stale && contact.level >= DetectionLevel.IDENTIFIED;
  }).length;
  const intelScore =
    livingEnemy.length === 0 ? 100 : Math.round((tracked / livingEnemy.length) * 100);

  let rating = 0;
  if (state.outcome === 'VICTORY') {
    rating = 1;
    if (state.turn <= parTurns) rating += 1;
    if (friendlyLosses === 0) rating += 1;
    else if (optionalComplete === optional.length && optional.length > 0) rating += 1;
  }

  return {
    outcome: state.outcome,
    turnsTaken: state.turn,
    parTurns,
    friendlyLosses,
    enemyLosses,
    objectivesComplete,
    objectivesTotal: mandatory.length,
    optionalComplete,
    rating: Math.min(3, rating),
    intelScore,
  };
}
