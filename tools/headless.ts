/**
 * Headless mission runner.
 *
 * Plays missions with the AI driving both sides. Used for smoke testing, for
 * balance sweeps, and for catching the class of bug that only appears on turn
 * fourteen of a real game.
 *
 *   npm run sim                       -- play every mission once
 *   npm run sim -- m01_first_light 50 -- 50 runs of one mission
 */

import { initContent, MISSIONS, getMission } from '../src/content/index';
import { Session } from '../src/core/session';
import { chooseAction } from '../src/core/ai/ai';
import { execute } from '../src/core/commands';
import { Rng } from '../src/core/rng';
import type { MissionDef } from '../src/core/mission';

const PLAYER_ACTION_LIMIT = 300;

interface RunResult {
  readonly outcome: string;
  readonly turns: number;
  readonly friendlyLosses: number;
  readonly enemyLosses: number;
  readonly rating: number;
  readonly intelScore: number;
}

/** Play one mission to completion with the AI driving the player side too. */
function playOnce(mission: MissionDef, seed: string): RunResult {
  const session = new Session(mission, { seed, difficulty: 'VETERAN' });
  const rng = new Rng(`${seed}:blue`);

  let guard = 0;
  while (!session.isOver && session.turn <= mission.maxTurns && guard++ < 200) {
    // Drive the player side with the same planner.
    for (let i = 0; i < PLAYER_ACTION_LIMIT; i++) {
      if (session.isOver) break;
      const choice = chooseAction(session.state, session.playerSide, rng, {
        difficulty: 'VETERAN',
      });
      if (!choice) break;

      const result = execute(
        session.state,
        choice.command,
        session.playerSide,
        session.playerSide,
      );
      if (!result.ok) {
        const unitId = 'unitId' in choice.command ? choice.command.unitId : undefined;
        const unit = unitId ? session.state.units.get(unitId) : undefined;
        if (!unit) break;
        unit.hasActed = true;
        unit.movementLeft = 0;
      }
    }

    if (session.isOver) break;
    session.endTurn();
  }

  const report = session.afterAction();
  return {
    outcome: report.outcome,
    turns: report.turnsTaken,
    friendlyLosses: report.friendlyLosses,
    enemyLosses: report.enemyLosses,
    rating: report.rating,
    intelScore: report.intelScore,
  };
}

function summarise(mission: MissionDef, runs: number): void {
  const results: RunResult[] = [];
  const started = Date.now();

  for (let i = 0; i < runs; i++) {
    results.push(playOnce(mission, `${mission.id}:sweep:${i}`));
  }

  const elapsed = Date.now() - started;
  const wins = results.filter((r) => r.outcome === 'VICTORY').length;
  const avg = (pick: (r: RunResult) => number): string =>
    (results.reduce((sum, r) => sum + pick(r), 0) / results.length).toFixed(1);

  console.log(`\n${mission.operation} — ${mission.name} (${mission.id})`);
  console.log('  runs               ', runs);
  console.log('  blue win rate      ', `${((wins / runs) * 100).toFixed(0)}%`);
  console.log('  avg turns          ', avg((r) => r.turns), `(par ${mission.parTurns})`);
  console.log('  avg friendly losses', avg((r) => r.friendlyLosses));
  console.log('  avg enemy losses   ', avg((r) => r.enemyLosses));
  console.log('  avg intel score    ', avg((r) => r.intelScore));
  console.log('  elapsed            ', `${elapsed}ms (${(elapsed / runs).toFixed(1)}ms/run)`);
}

function main(): void {
  initContent();

  const [missionArg, runsArg] = process.argv.slice(2);
  const runs = runsArg ? Number.parseInt(runsArg, 10) : 1;

  const missions = missionArg ? [getMission(missionArg)] : [...MISSIONS];

  console.log('DEUS VULT — headless mission runner');
  for (const mission of missions) {
    summarise(mission, Number.isFinite(runs) && runs > 0 ? runs : 1);
  }
  console.log('');
}

main();
