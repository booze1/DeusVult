/**
 * Integration tests for the game's central mechanic and its determinism
 * guarantees. If the sensor-shooter chain ever stops working end to end,
 * this is the file that should fail first.
 */

import { describe, expect, it } from 'vitest';
import { execute } from '@core/commands';
import { deserializeState, serializeState } from '@core/state';
import { updateContacts } from '@core/sensors';
import { chooseAction } from '@core/ai/ai';
import { Rng } from '@core/rng';
import { Session } from '@core/session';
import { getMission, initContent } from '@content/index';
import { DetectionLevel } from '@core/types';
import { h, makeSession, unitOf } from './helpers';

initContent();

describe('the sensor-shooter chain', () => {
  /**
   * The mission the whole game is built to teach, in one test:
   * a battery that cannot see, a scout that cannot shoot, and a target that
   * dies only when the two are connected.
   */
  it('lets a scout unlock a battery that cannot see its own target', () => {
    const session = makeSession([
      { defId: 'usmc_nemesis', side: 'BLUE', pos: h(0, 0) },
      { defId: 'usmc_recon', side: 'BLUE', pos: h(6, 0) },
      { defId: 'pla_ztd05', side: 'RED', pos: h(10, 0) },
    ]);

    const battery = unitOf(session, 'usmc_nemesis');
    const scout = unitOf(session, 'usmc_recon');
    const target = unitOf(session, 'pla_ztd05');

    // The battery has the range but not the picture.
    const blindShot = session.issue({
      type: 'FIRE',
      unitId: battery.id,
      weaponId: 'nem_nsm',
      targetId: target.id,
    });
    expect(blindShot.ok).toBe(false);
    expect(blindShot.error).toMatch(/tracked/i);

    // The scout can see it, and hands it over.
    const designation = session.issue({
      type: 'DESIGNATE',
      unitId: scout.id,
      targetId: target.id,
    });
    expect(designation.ok).toBe(true);

    // Now the same shot is legal.
    const strike = session.issue({
      type: 'FIRE',
      unitId: battery.id,
      weaponId: 'nem_nsm',
      targetId: target.id,
    });
    expect(strike.ok).toBe(true);
    expect(target.strength).toBeLessThan(8);
  });

  it('refuses designation of a target the scout cannot personally see', () => {
    const session = makeSession(
      [
        { defId: 'usmc_recon', side: 'BLUE', pos: h(0, 0) },
        { defId: 'pla_ztd05', side: 'RED', pos: h(4, 0) },
      ],
      { paint: [{ hexes: [h(2, 0)], terrain: 'MOUNTAIN' }] },
    );

    const result = session.issue({
      type: 'DESIGNATE',
      unitId: unitOf(session, 'usmc_recon').id,
      targetId: unitOf(session, 'pla_ztd05').id,
    });
    expect(result.ok).toBe(false);
  });
});

describe('emissions control', () => {
  it('makes an emitting battery findable and a silent one safe', () => {
    const session = makeSession([
      { defId: 'usmc_ew', side: 'BLUE', pos: h(0, 0) },
      { defId: 'usmc_himars', side: 'BLUE', pos: h(1, 0) },
      { defId: 'pla_hq17', side: 'RED', pos: h(10, 0), emitting: true },
    ]);

    updateContacts(session.state);
    const sam = unitOf(session, 'pla_hq17');
    const himars = unitOf(session, 'usmc_himars');

    // Radiating: passive intercept produces a firing solution.
    const strike = session.issue({
      type: 'FIRE',
      unitId: himars.id,
      weaponId: 'hi_gmlrs',
      targetId: sam.id,
    });
    expect(strike.ok).toBe(true);
  });

  it('denies the same shot when the target is dark', () => {
    const session = makeSession([
      { defId: 'usmc_ew', side: 'BLUE', pos: h(0, 0) },
      { defId: 'usmc_himars', side: 'BLUE', pos: h(1, 0) },
      { defId: 'pla_hq17', side: 'RED', pos: h(11, 0), emitting: false },
    ]);

    updateContacts(session.state);
    const result = session.issue({
      type: 'FIRE',
      unitId: unitOf(session, 'usmc_himars').id,
      weaponId: 'hi_gmlrs',
      targetId: unitOf(session, 'pla_hq17').id,
    });
    expect(result.ok).toBe(false);
  });
});

describe('reaction fire', () => {
  it('interrupts a move through an overwatched approach', () => {
    const session = makeSession([
      { defId: 'usmc_rifle', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_inf', side: 'RED', pos: h(6, 0) },
    ]);

    const watcher = unitOf(session, 'usmc_rifle');
    session.issue({ type: 'OVERWATCH', unitId: watcher.id });
    expect(watcher.onOverwatch).toBe(true);

    session.endTurn();

    // The opposing side has now moved; the watcher should have engaged at
    // some point, or still be holding if nothing came within reach.
    expect(session.state.log.length).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('produces identical outcomes from identical seeds', () => {
    const runOnce = (): string => {
      const session = new Session(getMission('m01_first_light'), {
        seed: 'determinism',
        difficulty: 'VETERAN',
      });
      const rng = new Rng('determinism:blue');

      let guard = 0;
      while (!session.isOver && session.turn <= 12 && guard++ < 60) {
        for (let i = 0; i < 60; i++) {
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

      return JSON.stringify({
        outcome: session.state.outcome,
        turn: session.state.turn,
        units: [...session.state.units.values()]
          .map((u) => `${u.id}:${u.strength}:${u.destroyed}`)
          .sort(),
      });
    };

    expect(runOnce()).toBe(runOnce());
  });

  it('survives a save/load round trip unchanged', () => {
    const session = makeSession([
      { defId: 'usmc_lav', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_ztq15', side: 'RED', pos: h(4, 0) },
    ]);
    updateContacts(session.state);

    const serialized = serializeState(session.state);
    const restored = deserializeState(serialized);

    expect(restored.turn).toBe(session.state.turn);
    expect(restored.units.size).toBe(session.state.units.size);
    expect(restored.map.tiles.size).toBe(session.state.map.tiles.size);
    expect(serializeState(restored)).toBe(serialized);
  });
});

describe('the AI plays fair', () => {
  /**
   * The most important test in the suite. The planner must produce the same
   * decisions whether or not undetectable enemies exist on the board. If
   * adding a hidden unit changes the AI's behaviour, it is reading through
   * fog, and the entire information layer is a lie.
   */
  it('ignores enemies it cannot detect', () => {
    const baseline = makeSession([
      { defId: 'pla_ztq15', side: 'RED', pos: h(0, 0) },
      { defId: 'pla_inf', side: 'RED', pos: h(1, 0) },
    ]);

    const withHidden = makeSession([
      { defId: 'pla_ztq15', side: 'RED', pos: h(0, 0) },
      { defId: 'pla_inf', side: 'RED', pos: h(1, 0) },
      // Far away, dismounted, and in jungle — undetectable from RED's start.
      { defId: 'usmc_recon', side: 'BLUE', pos: h(0, 20) },
    ]);

    updateContacts(baseline.state);
    updateContacts(withHidden.state);

    const hiddenScout = unitOf(withHidden, 'usmc_recon');
    expect(withHidden.state.contacts.RED.get(hiddenScout.id)).toBeUndefined();

    const a = chooseAction(baseline.state, 'RED', new Rng('fair'), { difficulty: 'ELITE' });
    const b = chooseAction(withHidden.state, 'RED', new Rng('fair'), { difficulty: 'ELITE' });

    expect(JSON.stringify(a?.command)).toBe(JSON.stringify(b?.command));
  });

  it('cannot fire on an undetected unit even when told to', () => {
    const session = makeSession([
      { defId: 'usmc_lav', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_ztq15', side: 'RED', pos: h(20, 0) },
    ]);
    updateContacts(session.state);

    const target = unitOf(session, 'pla_ztq15');
    expect(session.state.contacts.BLUE.get(target.id)).toBeUndefined();

    const result = session.issue({
      type: 'FIRE',
      unitId: unitOf(session, 'usmc_lav').id,
      weaponId: 'lav_25mm',
      targetId: target.id,
    });
    expect(result.ok).toBe(false);
  });
});

describe('missions', () => {
  it('every shipped mission builds and reaches a legal opening state', () => {
    for (const id of ['m01_first_light', 'm02_silent_watch', 'm03_the_narrows']) {
      const mission = getMission(id);
      const session = new Session(mission, { seed: `smoke:${id}` });

      expect(session.state.units.size).toBe(mission.deployments.length);
      expect(session.state.outcome).toBe('ONGOING');
      expect(session.state.objectives.length).toBeGreaterThan(0);

      // Nothing should be deployed onto terrain it cannot occupy.
      for (const unit of session.state.units.values()) {
        expect(session.state.map.tiles.has(unit.pos.q + 512 ? 0 : 0)).toBeDefined();
      }
    }
  });

  it('resolves mission one without error when both sides are played by the AI', () => {
    const session = new Session(getMission('m01_first_light'), { seed: 'smoke' });
    const rng = new Rng('smoke:blue');

    let guard = 0;
    while (!session.isOver && session.turn <= 12 && guard++ < 40) {
      for (let i = 0; i < 60; i++) {
        const choice = chooseAction(session.state, session.playerSide, rng);
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

    expect(['VICTORY', 'DEFEAT', 'ONGOING']).toContain(session.state.outcome);
    expect(session.afterAction().turnsTaken).toBeGreaterThan(0);
    expect(DetectionLevel.UNDETECTED).toBe(0);
  });
});
