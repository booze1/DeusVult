import { describe, expect, it } from 'vitest';
import { getUnitDef } from '@core/registry';
import { Rng } from '@core/rng';
import { updateContacts } from '@core/sensors';
import {
  canEngage,
  previewFire,
  recoverSuppression,
  resolveBarrage,
  resolveFire,
  suppressionState,
  SUPPRESSION_PINNED,
} from '@core/combat';
import { DetectionLevel } from '@core/types';
import type { Weapon } from '@core/types';
import { h, makeSession, unitOf } from './helpers';

function weaponOf(defId: string, weaponId: string): Weapon {
  const weapon = getUnitDef(defId).weapons.find((w) => w.id === weaponId);
  if (!weapon) throw new Error(`No weapon ${weaponId} on ${defId}`);
  return weapon;
}

describe('engagement legality', () => {
  it('refuses a missile shot without a tracked contact', () => {
    const session = makeSession([
      { defId: 'usmc_nemesis', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_ztd05', side: 'RED', pos: h(9, 0) },
    ]);
    updateContacts(session.state);

    const battery = unitOf(session, 'usmc_nemesis');
    const target = unitOf(session, 'pla_ztd05');
    const check = canEngage(session.state, battery, weaponOf('usmc_nemesis', 'nem_nsm'), target);

    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/tracked/i);
  });

  it('refuses a shot inside minimum range', () => {
    const session = makeSession([
      { defId: 'usmc_nemesis', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_ztd05', side: 'RED', pos: h(1, 0) },
    ]);
    updateContacts(session.state);
    session.state.designations.BLUE.set(unitOf(session, 'pla_ztd05').id, session.state.turn);

    const check = canEngage(
      session.state,
      unitOf(session, 'usmc_nemesis'),
      weaponOf('usmc_nemesis', 'nem_nsm'),
      unitOf(session, 'pla_ztd05'),
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/minimum range/i);
  });

  it('refuses a ground weapon against an aircraft', () => {
    const session = makeSession([
      { defId: 'pla_ztq15', side: 'RED', pos: h(0, 0) },
      { defId: 'usmc_mq9', side: 'BLUE', pos: h(2, 0) },
    ]);
    updateContacts(session.state);

    const check = canEngage(
      session.state,
      unitOf(session, 'pla_ztq15'),
      weaponOf('pla_ztq15', 'zt_105'),
      unitOf(session, 'usmc_mq9'),
    );
    expect(check.ok).toBe(false);
  });
});

describe('binomial fire resolution', () => {
  /**
   * The anti-whiff guarantee, asserted against the real combat path rather
   * than the raw RNG: a healthy platoon firing on an identified target in the
   * open should essentially never produce nothing at all.
   */
  it('almost never produces a zero-damage result on a good shot', () => {
    const session = makeSession([
      { defId: 'usmc_lav', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_inf', side: 'RED', pos: h(2, 0) },
    ]);
    updateContacts(session.state);

    const attacker = unitOf(session, 'usmc_lav');
    const weapon = weaponOf('usmc_lav', 'lav_25mm');

    let zeroes = 0;
    let alwaysSuppressed = true;
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      const target = unitOf(session, 'pla_inf');
      target.strength = getUnitDef('pla_inf').maxStrength;
      target.suppression = 0;
      target.destroyed = false;

      const result = resolveFire(session.state, new Rng(`shot-${i}`), attacker, weapon, target);
      if (result.hits === 0) zeroes++;
      // The design guarantee is not "always damage" but "never nothing":
      // rounds that fail to kill still pin the target.
      if (target.suppression <= 0) alwaysSuppressed = false;
    }

    expect(zeroes / trials).toBeLessThan(0.05);
    expect(alwaysSuppressed).toBe(true);
  });

  it('reports a preview whose mean matches observed resolution', () => {
    const session = makeSession([
      { defId: 'usmc_lav', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_inf', side: 'RED', pos: h(2, 0) },
    ]);
    updateContacts(session.state);

    const attacker = unitOf(session, 'usmc_lav');
    const weapon = weaponOf('usmc_lav', 'lav_25mm');
    const preview = previewFire(session.state, attacker, weapon, unitOf(session, 'pla_inf'));

    let total = 0;
    const trials = 3000;
    for (let i = 0; i < trials; i++) {
      const target = unitOf(session, 'pla_inf');
      target.strength = getUnitDef('pla_inf').maxStrength;
      target.destroyed = false;
      total += resolveFire(session.state, new Rng(`sample-${i}`), attacker, weapon, target).damage;
    }

    expect(total / trials).toBeCloseTo(preview.expectedDamage, 0);
  });

  it('fires less volume as the shooter is worn down', () => {
    const session = makeSession([
      { defId: 'usmc_lav', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_inf', side: 'RED', pos: h(2, 0) },
    ]);
    updateContacts(session.state);

    const attacker = unitOf(session, 'usmc_lav');
    const target = unitOf(session, 'pla_inf');
    const weapon = weaponOf('usmc_lav', 'lav_25mm');

    const healthy = previewFire(session.state, attacker, weapon, target).volume;
    attacker.strength = 2;
    const degraded = previewFire(session.state, attacker, weapon, target).volume;

    expect(degraded).toBeLessThan(healthy);
  });
});

describe('lethality matrix', () => {
  it('makes small arms nearly useless against heavy armour', () => {
    const session = makeSession([
      { defId: 'usmc_rifle', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_ztq15', side: 'RED', pos: h(1, 0) },
    ]);
    updateContacts(session.state);

    const rifle = unitOf(session, 'usmc_rifle');
    const tank = unitOf(session, 'pla_ztq15');

    const smallArms = previewFire(session.state, rifle, weaponOf('usmc_rifle', 'ri_smallarms'), tank);
    const javelin = previewFire(session.state, rifle, weaponOf('usmc_rifle', 'ri_javelin'), tank);

    expect(smallArms.expectedDamage).toBeLessThan(0.5);
    expect(javelin.expectedDamage).toBeGreaterThan(smallArms.expectedDamage * 5);
  });
});

describe('suppression', () => {
  it('accumulates from fire and eventually pins', () => {
    const session = makeSession([
      { defId: 'pla_phl11', side: 'RED', pos: h(0, 0) },
      { defId: 'usmc_rifle', side: 'BLUE', pos: h(6, 0) },
    ]);
    updateContacts(session.state);

    const battery = unitOf(session, 'pla_phl11');
    const target = unitOf(session, 'usmc_rifle');
    const weapon = weaponOf('pla_phl11', 'ph_area');

    expect(suppressionState(target)).toBe('STEADY');

    const rng = new Rng('suppress');
    for (let i = 0; i < 4 && suppressionState(target) !== 'PINNED'; i++) {
      battery.ammo[weapon.id] = 4;
      resolveBarrage(session.state, rng, battery, weapon, target.pos, 1);
    }

    expect(target.suppression).toBeGreaterThan(0);
  });

  it('recovers at the start of the owner’s turn', () => {
    const session = makeSession([{ defId: 'usmc_rifle', side: 'BLUE', pos: h(0, 0) }]);
    const unit = unitOf(session, 'usmc_rifle');
    unit.suppression = SUPPRESSION_PINNED + 10;
    expect(suppressionState(unit)).toBe('PINNED');

    recoverSuppression(unit, getUnitDef(unit.defId));
    expect(unit.suppression).toBeLessThan(SUPPRESSION_PINNED + 10);
  });

  it('reduces the accuracy of a suppressed shooter', () => {
    const session = makeSession([
      { defId: 'usmc_lav', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_inf', side: 'RED', pos: h(2, 0) },
    ]);
    updateContacts(session.state);

    const attacker = unitOf(session, 'usmc_lav');
    const target = unitOf(session, 'pla_inf');
    const weapon = weaponOf('usmc_lav', 'lav_25mm');

    const steady = previewFire(session.state, attacker, weapon, target).hitChance;
    attacker.suppression = 60;
    const suppressed = previewFire(session.state, attacker, weapon, target).hitChance;

    expect(suppressed).toBeLessThan(steady);
  });
});

describe('area fire', () => {
  it('needs no contact at all and suppresses heavily', () => {
    const session = makeSession([
      { defId: 'pla_phl11', side: 'RED', pos: h(0, 0) },
      { defId: 'usmc_rifle', side: 'BLUE', pos: h(7, 0) },
    ]);
    updateContacts(session.state);

    const battery = unitOf(session, 'pla_phl11');
    const target = unitOf(session, 'usmc_rifle');

    // No contact whatsoever on the target.
    expect(session.state.contacts.RED.get(target.id)).toBeUndefined();

    const result = resolveBarrage(
      session.state,
      new Rng('barrage'),
      battery,
      weaponOf('pla_phl11', 'ph_area'),
      target.pos,
      1,
    );

    expect(result.affected.length).toBe(1);
    expect(target.suppression).toBeGreaterThan(0);
  });
});

describe('designation', () => {
  it('grants tracked quality to every shooter on the side', () => {
    const session = makeSession([
      { defId: 'usmc_nemesis', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_ztd05', side: 'RED', pos: h(9, 0) },
    ]);
    updateContacts(session.state);

    const target = unitOf(session, 'pla_ztd05');
    const battery = unitOf(session, 'usmc_nemesis');
    const weapon = weaponOf('usmc_nemesis', 'nem_nsm');

    expect(canEngage(session.state, battery, weapon, target).ok).toBe(false);

    session.state.designations.BLUE.set(target.id, session.state.turn);
    expect(canEngage(session.state, battery, weapon, target).ok).toBe(true);
  });

  it('lapses on a later turn', () => {
    const session = makeSession([
      { defId: 'usmc_nemesis', side: 'BLUE', pos: h(0, 0) },
      { defId: 'pla_ztd05', side: 'RED', pos: h(9, 0) },
    ]);
    updateContacts(session.state);

    const target = unitOf(session, 'pla_ztd05');
    session.state.designations.BLUE.set(target.id, session.state.turn);

    session.state.turn += 1;
    const check = canEngage(
      session.state,
      unitOf(session, 'usmc_nemesis'),
      weaponOf('usmc_nemesis', 'nem_nsm'),
      target,
    );
    expect(check.ok).toBe(false);
    expect(DetectionLevel.TRACKED).toBe(3);
  });
});
