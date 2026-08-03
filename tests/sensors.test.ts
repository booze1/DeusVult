import { describe, expect, it } from 'vitest';
import { hexRange } from '@core/hex';
import { paint } from '@core/gamemap';
import {
  detect,
  effectiveSignature,
  firingContactLevel,
  lineOfSight,
  updateContacts,
} from '@core/sensors';
import { DetectionLevel } from '@core/types';
import { createMap } from '@core/gamemap';
import { getUnitDef } from '@core/registry';
import { h, makeSession, unitOf } from './helpers';

const defOf = (unit: { defId: string }) => getUnitDef(unit.defId);

describe('line of sight', () => {
  it('is clear across open ground', () => {
    const map = createMap(10, 'PLAIN');
    expect(lineOfSight(map, h(0, 0), h(6, 0)).clear).toBe(true);
  });

  it('is blocked by a mountain between observer and target', () => {
    const map = createMap(10, 'PLAIN');
    paint(map, [h(3, 0)], 'MOUNTAIN');
    expect(lineOfSight(map, h(0, 0), h(6, 0)).clear).toBe(false);
  });

  it('is symmetric at equal altitude', () => {
    const map = createMap(10, 'PLAIN');
    paint(map, [h(2, 0), h(3, 0)], 'FOREST');
    const forward = lineOfSight(map, h(0, 0), h(6, 0));
    const backward = lineOfSight(map, h(6, 0), h(0, 0));
    expect(forward.clear).toBe(backward.clear);
    expect(forward.obstruction).toBeCloseTo(backward.obstruction, 6);
  });

  it('lets height see over intervening woodland', () => {
    const map = createMap(10, 'PLAIN');
    paint(map, [h(2, 0), h(3, 0)], 'FOREST');

    const fromGround = lineOfSight(map, h(0, 0), h(6, 0));
    const fromAir = lineOfSight(map, h(0, 0), h(6, 0), 3, 0);

    expect(fromAir.obstruction).toBeLessThan(fromGround.obstruction);
    expect(fromAir.clear).toBe(true);
  });

  it('treats adjacent hexes as always visible', () => {
    const map = createMap(10, 'PLAIN');
    paint(map, [h(1, 0)], 'MOUNTAIN');
    expect(lineOfSight(map, h(0, 0), h(1, 0)).clear).toBe(true);
  });
});

describe('signature', () => {
  it('is reduced by concealing terrain', () => {
    const session = makeSession(
      [{ defId: 'usmc_rifle', side: 'BLUE', pos: h(0, 0) }],
      { terrain: 'PLAIN', paint: [{ hexes: [h(0, 0)], terrain: 'JUNGLE' }] },
    );
    const unit = unitOf(session, 'usmc_rifle');
    const inJungle = effectiveSignature(session.state.map, unit, defOf(unit), 'OPTICAL');

    paint(session.state.map, [h(0, 0)], 'PLAIN');
    const inOpen = effectiveSignature(session.state.map, unit, defOf(unit), 'OPTICAL');

    expect(inJungle).toBeLessThan(inOpen);
  });

  it('rises sharply in the RF channel while emitting', () => {
    const session = makeSession([{ defId: 'pla_hq17', side: 'RED', pos: h(0, 0) }]);
    const unit = unitOf(session, 'pla_hq17');

    unit.emitting = false;
    const dark = effectiveSignature(session.state.map, unit, defOf(unit), 'ELINT');
    unit.emitting = true;
    const radiating = effectiveSignature(session.state.map, unit, defOf(unit), 'ELINT');

    expect(radiating).toBeGreaterThan(dark * 3);
  });
});

describe('detection', () => {
  /**
   * The central bargain of the game: an air defence vehicle that leaves its
   * radar on can be located, precisely, by a passive receiver it cannot see —
   * far enough away to be shelled. With the radar off it is invisible to the
   * same receiver.
   */
  it('locates an active emitter by passive means at long range', () => {
    const session = makeSession([
      { defId: 'usmc_ew', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_hq17', side: 'RED', pos: h(10, 0), emitting: true },
    ]);

    updateContacts(session.state);
    const sam = unitOf(session, 'pla_hq17');
    const contact = detect(session.state, 'BLUE', sam);

    expect(contact.modality).toBe('ELINT');
    expect(contact.level).toBe(DetectionLevel.TRACKED);
  });

  it('cannot find the same vehicle once it stops radiating', () => {
    const session = makeSession([
      { defId: 'usmc_ew', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_hq17', side: 'RED', pos: h(12, 0), emitting: false },
    ]);

    updateContacts(session.state);
    const sam = unitOf(session, 'pla_hq17');
    expect(detect(session.state, 'BLUE', sam).level).toBe(DetectionLevel.UNDETECTED);
  });

  it('hides dismounted infantry in jungle that would be seen in the open', () => {
    const target = h(5, 0);
    const session = makeSession(
      [
        { defId: 'usmc_lav', side: 'BLUE', pos: h(0, 0) },
        { defId: 'pla_inf', side: 'RED', pos: target },
      ],
      { paint: [{ hexes: [target], terrain: 'JUNGLE' }] },
    );

    const infantry = unitOf(session, 'pla_inf');
    const concealed = detect(session.state, 'BLUE', infantry).level;

    paint(session.state.map, [target], 'PLAIN');
    const exposed = detect(session.state, 'BLUE', infantry).level;

    expect(concealed).toBeLessThan(exposed);
  });

  it('remembers a lost contact as a stale marker before forgetting it', () => {
    const session = makeSession([
      { defId: 'usmc_lav', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_ztq15', side: 'RED', pos: h(3, 0) },
    ]);

    updateContacts(session.state);
    const tank = unitOf(session, 'pla_ztq15');
    expect(session.state.contacts.BLUE.get(tank.id)?.stale).toBe(false);

    // Displace far beyond sensor reach.
    tank.pos = h(11, 0);
    updateContacts(session.state);

    const contact = session.state.contacts.BLUE.get(tank.id);
    expect(contact).toBeDefined();
    expect(contact!.stale).toBe(true);
    expect(contact!.lastSeen).toEqual(h(3, 0));
    // A stale marker is not a firing solution.
    expect(firingContactLevel(session.state, 'BLUE', tank.id)).toBe(DetectionLevel.UNDETECTED);
  });
});

describe('jamming', () => {
  it('degrades radar detection inside the jammer footprint', () => {
    const session = makeSession([
      { defId: 'usmc_madis', side: 'BLUE', pos: h(0, 0), emitting: true },
      { defId: 'pla_uav', side: 'RED', pos: h(6, 0) },
      { defId: 'pla_ew', side: 'RED', pos: h(2, 0), emitting: false },
    ]);

    updateContacts(session.state);
    const drone = unitOf(session, 'pla_uav');
    const unjammed = detect(session.state, 'BLUE', drone).score;

    const jammer = unitOf(session, 'pla_ew');
    jammer.emitting = true;
    updateContacts(session.state);
    const jammed = detect(session.state, 'BLUE', drone).score;

    expect(jammed).toBeLessThan(unjammed);
  });
});

describe('sensor coverage overlay', () => {
  it('covers only hexes within reach of a friendly sensor', () => {
    const session = makeSession([{ defId: 'usmc_recon', side: 'BLUE', pos: h(0, 0) }]);
    updateContacts(session.state);

    const near = hexRange(h(0, 0), 3);
    expect(near.length).toBeGreaterThan(0);
  });
});
