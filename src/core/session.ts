/**
 * Session — one playthrough of one mission.
 *
 * Owns the state, drives the opposing commander, and applies reinforcements.
 * Both the app and the headless balance runner talk to this and nothing else,
 * which is what guarantees the thing being balanced offline is the same thing
 * the player actually plays.
 */

import { createGameState, unitsBySide, logMessage } from './state';
import { execute, type Command, type CommandResult, type GameEvent } from './commands';
import { chooseAction, type AiOptions } from './ai/ai';
import { buildAfterActionReport, type AfterActionReport } from './victory';
import { Rng } from './rng';
import { getUnitDef } from './registry';
import type { MissionDef } from './mission';
import { opposingSide, type GameState, type Side, type Unit } from './types';
import { createUnit } from './state';

/**
 * Hard ceiling on actions the opposing commander may take in one turn.
 * Not expected to bind — it exists so that a scoring bug degrades into a
 * passed turn rather than a hung tab.
 */
const AI_ACTION_LIMIT = 300;

export interface SessionOptions extends AiOptions {
  readonly seed?: string;
}

export class Session {
  readonly mission: MissionDef;
  readonly playerSide: Side;
  readonly aiSide: Side;
  state: GameState;

  private readonly aiOptions: AiOptions;
  private readonly reinforcementsApplied = new Set<number>();

  constructor(mission: MissionDef, options: SessionOptions = {}) {
    this.mission = mission;
    this.playerSide = mission.playerSide;
    this.aiSide = opposingSide(mission.playerSide);
    this.aiOptions = { ...(options.difficulty ? { difficulty: options.difficulty } : {}) };
    this.state = createGameState(mission, options.seed ?? `${mission.id}:default`);
  }

  get turn(): number {
    return this.state.turn;
  }

  get isPlayerTurn(): boolean {
    return this.state.activeSide === this.playerSide;
  }

  get isOver(): boolean {
    return this.state.outcome !== 'ONGOING';
  }

  playerUnits(): Unit[] {
    return unitsBySide(this.state, this.playerSide);
  }

  /** Issue a player command. Rejected commands leave state untouched. */
  issue(command: Command): CommandResult {
    if (!this.isPlayerTurn) {
      return { ok: false, error: 'Not your turn', events: [] };
    }
    return execute(this.state, command, this.playerSide, this.playerSide);
  }

  /**
   * End the player's turn and play the opposing turn to completion.
   * Returns every event produced, in order, for the UI to animate.
   */
  endTurn(): GameEvent[] {
    if (this.isOver) return [];

    const events: GameEvent[] = [];

    const handover = execute(
      this.state,
      { type: 'END_TURN' },
      this.playerSide,
      this.playerSide,
    );
    events.push(...handover.events);

    this.applyReinforcements(events);
    if (this.isOver) return events;

    events.push(...this.runAiTurn());

    this.applyReinforcements(events);
    return events;
  }

  /** Play the opposing side's turn. Exposed for tests and the headless runner. */
  runAiTurn(): GameEvent[] {
    const events: GameEvent[] = [];
    if (this.state.activeSide !== this.aiSide) return events;

    const rng = new Rng(`${this.state.seed}:ai:${this.state.turn}`);

    for (let i = 0; i < AI_ACTION_LIMIT; i++) {
      if (this.isOver) break;

      const choice = chooseAction(this.state, this.aiSide, rng, this.aiOptions);
      if (!choice) break;

      const result = execute(this.state, choice.command, this.playerSide, this.playerSide);
      events.push(...result.events);

      if (!result.ok) {
        // A rejected command means the scorer proposed something illegal.
        // Retire the unit for this turn rather than looping on it.
        const unitId = 'unitId' in choice.command ? choice.command.unitId : undefined;
        const unit = unitId ? this.state.units.get(unitId) : undefined;
        if (unit) {
          unit.hasActed = true;
          unit.movementLeft = 0;
        } else {
          break;
        }
      }
    }

    if (!this.isOver) {
      const end = execute(this.state, { type: 'END_TURN' }, this.playerSide, this.playerSide);
      events.push(...end.events);
    }

    return events;
  }

  /**
   * Bring on any reinforcements scheduled for the current turn.
   * Applied once per turn number, tracked explicitly so that a mission with
   * two arrivals on the same turn works and a re-entrant call does not
   * duplicate them.
   */
  private applyReinforcements(events: GameEvent[]): void {
    const scheduled = this.mission.reinforcements ?? [];
    if (scheduled.length === 0) return;
    if (this.reinforcementsApplied.has(this.state.turn)) return;

    const due = scheduled.filter((r) => r.turn === this.state.turn);
    if (due.length === 0) return;

    this.reinforcementsApplied.add(this.state.turn);

    for (const reinforcement of due) {
      const occupied = [...this.state.units.values()].some(
        (u) =>
          !u.destroyed &&
          u.pos.q === reinforcement.deployment.pos.q &&
          u.pos.r === reinforcement.deployment.pos.r,
      );
      if (occupied) continue;

      const def = getUnitDef(reinforcement.deployment.defId);
      const index = unitsBySide(this.state, reinforcement.deployment.side).length;
      const unit = createUnit(`u${this.state.nextEntityId++}`, reinforcement.deployment, index);
      this.state.units.set(unit.id, unit);

      logMessage(
        this.state,
        reinforcement.deployment.side,
        'INFO',
        reinforcement.announcement ?? `${def.designation} arrives.`,
        unit.pos,
      );
      events.push({ type: 'MOVED', unitId: unit.id, path: [unit.pos], interrupted: false });
    }
  }

  afterAction(): AfterActionReport {
    return buildAfterActionReport(this.state, this.playerSide, this.mission.parTurns);
  }
}
