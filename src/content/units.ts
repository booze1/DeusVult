/**
 * Order of battle.
 *
 * Real hardware, fictional flashpoint. Units are characterised by *doctrine* —
 * how a force fights — rather than by any other quality. The allied roster is
 * built around dispersed sensing and long-range precision fires handed off
 * between platforms; the opposing roster around massed reconnaissance-strike,
 * layered air defence and aggressive electronic attack. Both are competent.
 * Neither is a punching bag, and neither is written as a villain.
 *
 * Balance philosophy: no unit is good at both finding and killing. Every
 * long-range shooter in this file is dependent on someone else's eyes, and
 * every good sensor is fragile. That dependency is the game.
 */

import { DetectionLevel } from '@core/types';
import type { UnitDef } from '@core/types';
import { leth, sensor, sig, weapon, DOMAINS } from './builders';

/* ================================================================== */
/* Allied forces                                                       */
/* ================================================================== */

const usmcRecon: UnitDef = {
  id: 'usmc_recon',
  name: 'Reconnaissance Team',
  designation: 'USMC Force Recon',
  nation: 'USA',
  unitClass: 'RECON',
  domain: 'LAND',
  armor: 'SOFT',
  maxStrength: 6,
  movement: 3,
  mobility: 'FOOT',
  altitude: 0,
  discipline: 0.85,
  cost: 40,
  sensors: [
    sensor('OPTICAL', 7, 62),
    sensor('THERMAL', 5, 52),
  ],
  // Almost nothing to detect. A dismounted team that stays still is the
  // hardest thing on the board to find, and that is its entire value.
  signature: sig(18, 15, 6, 3, 10),
  weapons: [
    weapon('sr_smallarms', 'Small arms', 'DIRECT', 1, 4, 0.5, 0.6, leth(0.8, 0.1, 0.02, 0.05, 0), 8),
  ],
  abilities: ['DESIGNATE', 'EMCON', 'HUNKER', 'FORTIFY', 'OVERWATCH'],
  description:
    'Dismounted reconnaissance. Sees far, is barely visible, and cannot fight. Its purpose is to hand targets to somebody who can.',
};

const usmcRifle: UnitDef = {
  id: 'usmc_rifle',
  name: 'Rifle Platoon',
  designation: 'USMC Rifle Plt',
  nation: 'USA',
  unitClass: 'INFANTRY',
  domain: 'LAND',
  armor: 'SOFT',
  maxStrength: 10,
  movement: 3,
  mobility: 'FOOT',
  altitude: 0,
  discipline: 0.75,
  cost: 55,
  sensors: [sensor('OPTICAL', 4, 48), sensor('THERMAL', 3, 42)],
  signature: sig(40, 34, 10, 4, 22),
  weapons: [
    weapon('ri_smallarms', 'Small arms', 'DIRECT', 2, 8, 0.55, 0.5, leth(0.9, 0.15, 0.02, 0.08, 0), 14),
    weapon('ri_javelin', 'Javelin', 'DIRECT', 4, 2, 0.7, 2.2, leth(0.4, 1.2, 1.45, 0, 0.2), 10, {
      ammo: 3,
      firingSignature: 20,
    }),
  ],
  abilities: ['FORTIFY', 'OVERWATCH', 'HUNKER', 'EMCON'],
  description:
    'Holds ground and kills armour at short range. In cover it is stubborn out of all proportion to its cost.',
};

const usmcLav: UnitDef = {
  id: 'usmc_lav',
  name: 'Light Armored Recon',
  designation: 'LAV-25A2',
  nation: 'USA',
  unitClass: 'RECON',
  domain: 'LAND',
  armor: 'LIGHT',
  maxStrength: 8,
  movement: 7,
  mobility: 'WHEELED',
  altitude: 0,
  discipline: 0.7,
  cost: 70,
  sensors: [sensor('OPTICAL', 6, 55), sensor('THERMAL', 6, 58)],
  signature: sig(42, 48, 34, 12, 44),
  weapons: [
    weapon('lav_25mm', '25mm chain gun', 'DIRECT', 3, 6, 0.62, 0.9, leth(1.0, 0.85, 0.15, 0.25, 0.1), 16),
  ],
  abilities: ['OVERWATCH', 'HUNKER', 'EMCON', 'DESIGNATE'],
  description:
    'Fast wheeled reconnaissance with good optics. Fights only what it must, and is meant to be moving before the counter-battery lands.',
};

const usmcNemesis: UnitDef = {
  id: 'usmc_nemesis',
  name: 'Anti-Ship Missile Battery',
  designation: 'NMESIS / NSM',
  nation: 'USA',
  unitClass: 'ASM',
  domain: 'LAND',
  armor: 'LIGHT',
  maxStrength: 6,
  movement: 5,
  mobility: 'WHEELED',
  altitude: 0,
  discipline: 0.7,
  cost: 130,
  // Deliberately blind. It cannot see a fraction of the distance it can shoot.
  sensors: [sensor('OPTICAL', 3, 40)],
  signature: sig(38, 34, 30, 8, 30),
  weapons: [
    weapon('nem_nsm', 'Naval Strike Missile', 'MISSILE', 16, 2, 0.82, 4.5, leth(0.8, 1.3, 1.7, 0, 2.2), 12, {
      rangeMin: 3,
      requires: DetectionLevel.TRACKED,
      ammo: 2,
      engages: DOMAINS.LAND_SEA,
      firingSignature: 45,
    }),
  ],
  abilities: ['EMCON', 'HUNKER'],
  description:
    'Reaches sixteen hexes and sees three. Without a scout feeding it a tracked contact it is an expensive truck.',
};

const usmcHimars: UnitDef = {
  id: 'usmc_himars',
  name: 'Rocket Artillery',
  designation: 'M142 HIMARS',
  nation: 'USA',
  unitClass: 'MRL',
  domain: 'LAND',
  armor: 'LIGHT',
  maxStrength: 6,
  movement: 6,
  mobility: 'WHEELED',
  altitude: 0,
  discipline: 0.7,
  cost: 110,
  sensors: [sensor('OPTICAL', 3, 38)],
  signature: sig(36, 32, 28, 8, 32),
  weapons: [
    weapon('hi_gmlrs', 'GMLRS precision', 'MISSILE', 14, 3, 0.8, 2.6, leth(1.2, 1.0, 0.65, 0, 0.4), 18, {
      rangeMin: 3,
      requires: DetectionLevel.TRACKED,
      ammo: 3,
      firingSignature: 50,
    }),
    weapon('hi_area', 'Area fire mission', 'INDIRECT', 12, 6, 0.55, 1.1, leth(0.9, 0.6, 0.25, 0, 0.2), 22, {
      rangeMin: 3,
      ammo: 3,
      firingSignature: 50,
    }),
  ],
  abilities: ['EMCON', 'HUNKER'],
  description:
    'Precision rounds need a tracked contact; area missions need only a map reference. Firing either lights it up for counter-battery.',
};

const usmcMadis: UnitDef = {
  id: 'usmc_madis',
  name: 'Air Defence Section',
  designation: 'MADIS',
  nation: 'USA',
  unitClass: 'SAM',
  domain: 'LAND',
  armor: 'LIGHT',
  maxStrength: 6,
  movement: 6,
  mobility: 'WHEELED',
  altitude: 0,
  discipline: 0.72,
  cost: 95,
  sensors: [
    sensor('RADAR', 10, 74, { detects: DOMAINS.LAND_AIR_SEA }),
    sensor('OPTICAL', 4, 44),
  ],
  signature: sig(34, 32, 30, 18, 28),
  weapons: [
    weapon('ma_sam', 'Surface-to-air missiles', 'DIRECT', 7, 4, 0.72, 3.0, leth(0, 0, 0, 1.6, 0), 6, {
      requires: DetectionLevel.IDENTIFIED,
      ammo: 6,
      engages: DOMAINS.AIR_ONLY,
      firingSignature: 40,
    }),
    weapon('ma_30mm', '30mm', 'DIRECT', 2, 5, 0.6, 0.8, leth(0.9, 0.6, 0.1, 0.9, 0), 12),
  ],
  abilities: ['RADAR_ON', 'EMCON', 'HUNKER', 'OVERWATCH'],
  description:
    'The only reliable answer to hostile drones. Its radar is also the loudest thing in the task force — switch it on late, and move it after.',
};

const usmcReaper: UnitDef = {
  id: 'usmc_mq9',
  name: 'Reconnaissance UAV',
  designation: 'MQ-9A',
  nation: 'USA',
  unitClass: 'UAV',
  domain: 'AIR',
  armor: 'AIR',
  maxStrength: 4,
  movement: 10,
  mobility: 'AIR',
  altitude: 3,
  discipline: 0.9,
  cost: 105,
  sensors: [
    sensor('OPTICAL', 11, 66),
    sensor('THERMAL', 9, 62),
  ],
  signature: sig(18, 22, 26, 22, 6),
  weapons: [
    weapon('mq_hellfire', 'Hellfire', 'MISSILE', 4, 2, 0.75, 2.4, leth(0.6, 1.2, 1.2, 0, 0.3), 8, {
      requires: DetectionLevel.IDENTIFIED,
      ammo: 2,
      firingSignature: 25,
    }),
  ],
  abilities: ['DESIGNATE', 'EMCON'],
  description:
    'The task force’s eyes. Sees eleven hexes over any terrain and designates for everyone. Dies instantly to any air defence that is switched on.',
};

const usmcEw: UnitDef = {
  id: 'usmc_ew',
  name: 'Electronic Warfare Team',
  designation: 'USMC Radio Bn',
  nation: 'USA',
  unitClass: 'EW',
  domain: 'LAND',
  armor: 'SOFT',
  maxStrength: 6,
  movement: 4,
  mobility: 'WHEELED',
  altitude: 0,
  discipline: 0.8,
  cost: 90,
  sensors: [
    // Passive, long, and blind to anything that is not transmitting.
    sensor('ELINT', 18, 66),
    sensor('OPTICAL', 3, 40),
  ],
  signature: sig(26, 22, 18, 10, 18),
  weapons: [],
  abilities: ['JAM', 'DECOY', 'EMCON', 'HUNKER'],
  description:
    'Hears every emitter on the map and cannot see anything that stays quiet. Jamming blinds hostile radar — and announces its own position to anyone listening.',
};

const jgsdfType16: UnitDef = {
  id: 'jgsdf_type16',
  name: 'Mobile Combat Vehicle',
  designation: 'Type 16 MCV',
  nation: 'JPN',
  unitClass: 'ARMOR',
  domain: 'LAND',
  armor: 'LIGHT',
  maxStrength: 8,
  movement: 7,
  mobility: 'WHEELED',
  altitude: 0,
  discipline: 0.8,
  cost: 100,
  sensors: [sensor('OPTICAL', 5, 52), sensor('THERMAL', 5, 56)],
  signature: sig(46, 52, 40, 12, 48),
  weapons: [
    weapon('t16_105', '105mm gun', 'DIRECT', 4, 4, 0.68, 1.8, leth(0.9, 1.25, 1.0, 0, 0.25), 18),
  ],
  abilities: ['OVERWATCH', 'HUNKER', 'EMCON'],
  description:
    'Wheeled direct fire built for island roads. Hits like a tank, is armoured like a truck, and must not be caught in the open.',
};

const jgsdfType12: UnitDef = {
  id: 'jgsdf_type12',
  name: 'Surface-to-Ship Battery',
  designation: 'Type 12 SSM',
  nation: 'JPN',
  unitClass: 'ASM',
  domain: 'LAND',
  armor: 'LIGHT',
  maxStrength: 6,
  movement: 5,
  mobility: 'WHEELED',
  altitude: 0,
  discipline: 0.82,
  cost: 125,
  sensors: [sensor('OPTICAL', 3, 40)],
  signature: sig(36, 32, 28, 8, 30),
  weapons: [
    weapon('t12_ssm', 'Type 12 missile', 'MISSILE', 15, 2, 0.8, 4.2, leth(0.8, 1.25, 1.6, 0, 2.1), 12, {
      rangeMin: 3,
      requires: DetectionLevel.TRACKED,
      ammo: 2,
      engages: DOMAINS.LAND_SEA,
      firingSignature: 45,
    }),
  ],
  abilities: ['EMCON', 'HUNKER'],
  description:
    'Japanese coastal defence battery. Same bargain as every long-range shooter here: someone else has to find the target.',
};

const jgsdfRifle: UnitDef = {
  id: 'jgsdf_rifle',
  name: 'Infantry Platoon',
  designation: 'JGSDF Rifle Plt',
  nation: 'JPN',
  unitClass: 'INFANTRY',
  domain: 'LAND',
  armor: 'SOFT',
  maxStrength: 10,
  movement: 3,
  mobility: 'FOOT',
  altitude: 0,
  discipline: 0.8,
  cost: 55,
  sensors: [sensor('OPTICAL', 4, 48), sensor('THERMAL', 3, 40)],
  signature: sig(40, 34, 10, 4, 22),
  weapons: [
    weapon('jg_smallarms', 'Small arms', 'DIRECT', 2, 8, 0.55, 0.5, leth(0.9, 0.15, 0.02, 0.08, 0), 14),
    weapon('jg_atgm', 'Type 01 LMAT', 'DIRECT', 3, 2, 0.68, 2.0, leth(0.4, 1.15, 1.35, 0, 0.2), 10, {
      ammo: 3,
      firingSignature: 20,
    }),
  ],
  abilities: ['FORTIFY', 'OVERWATCH', 'HUNKER', 'EMCON'],
  description: 'Disciplined defensive infantry. Fortified in urban terrain it is a genuine problem.',
};

const ausBoxer: UnitDef = {
  id: 'aus_boxer',
  name: 'Cavalry Reconnaissance',
  designation: 'Boxer CRV',
  nation: 'AUS',
  unitClass: 'RECON',
  domain: 'LAND',
  armor: 'LIGHT',
  maxStrength: 8,
  movement: 7,
  mobility: 'WHEELED',
  altitude: 0,
  discipline: 0.78,
  cost: 95,
  sensors: [sensor('OPTICAL', 7, 60), sensor('THERMAL', 6, 60)],
  signature: sig(44, 50, 36, 12, 42),
  weapons: [
    weapon('bx_30mm', '30mm cannon', 'DIRECT', 3, 6, 0.65, 1.1, leth(1.0, 0.95, 0.2, 0.3, 0.1), 16),
    weapon('bx_spike', 'Spike LR2', 'DIRECT', 5, 2, 0.72, 2.3, leth(0.5, 1.25, 1.4, 0, 0.25), 10, {
      ammo: 2,
      firingSignature: 22,
    }),
  ],
  abilities: ['OVERWATCH', 'HUNKER', 'EMCON', 'DESIGNATE'],
  description:
    'Australian cavalry. The best-protected scout on the allied roster and the only one that can genuinely fight for its information.',
};

/* ================================================================== */
/* Opposing forces                                                     */
/* ================================================================== */

const plaRecon: UnitDef = {
  id: 'pla_recon',
  name: 'Special Reconnaissance Team',
  designation: 'PLA SOF Recon',
  nation: 'CHN',
  unitClass: 'RECON',
  domain: 'LAND',
  armor: 'SOFT',
  maxStrength: 6,
  movement: 3,
  mobility: 'FOOT',
  altitude: 0,
  discipline: 0.85,
  cost: 40,
  sensors: [sensor('OPTICAL', 7, 60), sensor('THERMAL', 5, 50)],
  signature: sig(18, 15, 6, 3, 10),
  weapons: [
    weapon('pr_smallarms', 'Small arms', 'DIRECT', 1, 4, 0.5, 0.6, leth(0.8, 0.1, 0.02, 0.05, 0), 8),
  ],
  abilities: ['DESIGNATE', 'EMCON', 'HUNKER', 'FORTIFY', 'OVERWATCH'],
  description: 'Infiltrating reconnaissance. Finds the batteries that the rocket regiment then services.',
};

const plaInfantry: UnitDef = {
  id: 'pla_inf',
  name: 'Motorised Infantry',
  designation: 'PLA Mot Rifle Plt',
  nation: 'CHN',
  unitClass: 'INFANTRY',
  domain: 'LAND',
  armor: 'SOFT',
  maxStrength: 10,
  movement: 3,
  mobility: 'FOOT',
  altitude: 0,
  discipline: 0.7,
  cost: 50,
  sensors: [sensor('OPTICAL', 4, 46), sensor('THERMAL', 3, 38)],
  signature: sig(40, 34, 10, 4, 22),
  weapons: [
    weapon('pi_smallarms', 'Small arms', 'DIRECT', 2, 8, 0.54, 0.5, leth(0.9, 0.15, 0.02, 0.08, 0), 14),
    weapon('pi_hj12', 'HJ-12', 'DIRECT', 3, 2, 0.66, 2.0, leth(0.4, 1.15, 1.35, 0, 0.2), 10, {
      ammo: 2,
      firingSignature: 20,
    }),
  ],
  abilities: ['FORTIFY', 'OVERWATCH', 'HUNKER', 'EMCON'],
  description: 'Numerous, adequate, and dangerous in quantity.',
};

const plaZtq15: UnitDef = {
  id: 'pla_ztq15',
  name: 'Light Tank',
  designation: 'ZTQ-15',
  nation: 'CHN',
  unitClass: 'ARMOR',
  domain: 'LAND',
  armor: 'HEAVY',
  maxStrength: 8,
  movement: 5,
  mobility: 'TRACKED',
  altitude: 0,
  discipline: 0.75,
  cost: 115,
  sensors: [sensor('OPTICAL', 5, 50), sensor('THERMAL', 5, 56)],
  signature: sig(52, 66, 55, 12, 62),
  weapons: [
    weapon('zt_105', '105mm gun', 'DIRECT', 4, 4, 0.68, 2.0, leth(0.95, 1.3, 1.05, 0, 0.25), 20),
  ],
  abilities: ['OVERWATCH', 'HUNKER', 'EMCON'],
  description:
    'Built for terrain that will not take a main battle tank. Frontally tough — small arms will not touch it — and very loud.',
};

const plaZbd05: UnitDef = {
  id: 'pla_zbd05',
  name: 'Amphibious IFV',
  designation: 'ZBD-05',
  nation: 'CHN',
  unitClass: 'IFV',
  domain: 'LAND',
  armor: 'LIGHT',
  maxStrength: 8,
  movement: 6,
  mobility: 'AMPHIBIOUS',
  altitude: 0,
  discipline: 0.7,
  cost: 85,
  sensors: [sensor('OPTICAL', 5, 48), sensor('THERMAL', 4, 50)],
  signature: sig(46, 52, 40, 12, 50),
  weapons: [
    weapon('zb_30mm', '30mm cannon', 'DIRECT', 3, 6, 0.62, 1.0, leth(1.0, 0.9, 0.18, 0.25, 0.1), 16),
  ],
  abilities: ['OVERWATCH', 'HUNKER', 'EMCON'],
  description: 'Swims. Crosses the shallows that every wheeled allied vehicle has to drive around.',
};

const plaPhl11: UnitDef = {
  id: 'pla_phl11',
  name: 'Rocket Artillery',
  designation: 'PHL-11',
  nation: 'CHN',
  unitClass: 'MRL',
  domain: 'LAND',
  armor: 'LIGHT',
  maxStrength: 6,
  movement: 5,
  mobility: 'TRACKED',
  altitude: 0,
  discipline: 0.68,
  cost: 100,
  sensors: [sensor('OPTICAL', 3, 38)],
  signature: sig(40, 38, 32, 10, 40),
  weapons: [
    weapon('ph_precision', 'Guided rockets', 'MISSILE', 12, 3, 0.76, 2.4, leth(1.15, 0.95, 0.6, 0, 0.35), 18, {
      rangeMin: 3,
      requires: DetectionLevel.TRACKED,
      ammo: 3,
      firingSignature: 50,
    }),
    weapon('ph_area', 'Area fire mission', 'INDIRECT', 11, 7, 0.55, 1.0, leth(0.95, 0.6, 0.25, 0, 0.2), 24, {
      rangeMin: 2,
      ammo: 4,
      firingSignature: 50,
    }),
  ],
  abilities: ['EMCON', 'HUNKER'],
  description: 'The opposing doctrine in one vehicle: find with something cheap, then bury the location in rockets.',
};

const plaHq17: UnitDef = {
  id: 'pla_hq17',
  name: 'Air Defence Vehicle',
  designation: 'HQ-17A',
  nation: 'CHN',
  unitClass: 'SAM',
  domain: 'LAND',
  armor: 'LIGHT',
  maxStrength: 6,
  movement: 5,
  mobility: 'TRACKED',
  altitude: 0,
  discipline: 0.74,
  cost: 105,
  sensors: [
    sensor('RADAR', 11, 76, { detects: DOMAINS.LAND_AIR_SEA }),
    sensor('OPTICAL', 4, 44),
  ],
  signature: sig(38, 40, 34, 20, 36),
  weapons: [
    weapon('hq_sam', 'HQ-17 missiles', 'DIRECT', 8, 4, 0.74, 3.2, leth(0, 0, 0, 1.7, 0), 6, {
      requires: DetectionLevel.IDENTIFIED,
      ammo: 6,
      engages: DOMAINS.AIR_ONLY,
      firingSignature: 40,
    }),
  ],
  abilities: ['RADAR_ON', 'EMCON', 'HUNKER'],
  description:
    'Denies the airspace to allied drones. While its radar is radiating, every ELINT receiver in the theatre knows precisely where it is.',
};

const plaUav: UnitDef = {
  id: 'pla_uav',
  name: 'Reconnaissance UAV',
  designation: 'Wing Loong II',
  nation: 'CHN',
  unitClass: 'UAV',
  domain: 'AIR',
  armor: 'AIR',
  maxStrength: 4,
  movement: 9,
  mobility: 'AIR',
  altitude: 3,
  discipline: 0.88,
  cost: 100,
  sensors: [sensor('OPTICAL', 10, 64), sensor('THERMAL', 8, 60)],
  signature: sig(18, 22, 26, 22, 6),
  weapons: [
    weapon('wl_missile', 'Blue Arrow 7', 'MISSILE', 4, 2, 0.72, 2.2, leth(0.6, 1.15, 1.15, 0, 0.3), 8, {
      requires: DetectionLevel.IDENTIFIED,
      ammo: 2,
      firingSignature: 25,
    }),
  ],
  abilities: ['DESIGNATE', 'EMCON'],
  description: 'Provides the tracked contacts the rocket batteries cannot generate for themselves.',
};

const plaEw: UnitDef = {
  id: 'pla_ew',
  name: 'Electronic Warfare Vehicle',
  designation: 'PLA EW Section',
  nation: 'CHN',
  unitClass: 'EW',
  domain: 'LAND',
  armor: 'LIGHT',
  maxStrength: 6,
  movement: 5,
  mobility: 'WHEELED',
  altitude: 0,
  discipline: 0.76,
  cost: 95,
  sensors: [sensor('ELINT', 18, 68), sensor('OPTICAL', 3, 40)],
  signature: sig(34, 30, 26, 12, 26),
  weapons: [],
  abilities: ['JAM', 'DECOY', 'EMCON', 'HUNKER'],
  description:
    'Electronic attack. Suppresses allied radar and feeds the targeting picture — and is worth every rocket spent killing it.',
};

const plaAft10: UnitDef = {
  id: 'pla_aft10',
  name: 'Anti-Tank Missile Carrier',
  designation: 'AFT-10',
  nation: 'CHN',
  unitClass: 'ARMOR',
  domain: 'LAND',
  armor: 'LIGHT',
  maxStrength: 6,
  movement: 5,
  mobility: 'TRACKED',
  altitude: 0,
  discipline: 0.72,
  cost: 110,
  sensors: [sensor('OPTICAL', 5, 50), sensor('THERMAL', 5, 54)],
  signature: sig(44, 48, 38, 12, 46),
  weapons: [
    weapon('af_hj10', 'HJ-10 ATGM', 'DIRECT', 7, 3, 0.74, 2.8, leth(0.5, 1.35, 1.55, 0, 0.35), 12, {
      rangeMin: 1,
      requires: DetectionLevel.IDENTIFIED,
      ammo: 4,
      firingSignature: 28,
    }),
  ],
  abilities: ['OVERWATCH', 'HUNKER', 'EMCON'],
  description:
    'Outranges every allied direct-fire weapon. Kill it with artillery, or accept losses closing the distance.',
};

const plaZtd05: UnitDef = {
  id: 'pla_ztd05',
  name: 'Amphibious Assault Gun',
  designation: 'ZTD-05',
  nation: 'CHN',
  unitClass: 'ARMOR',
  domain: 'LAND',
  armor: 'LIGHT',
  maxStrength: 8,
  movement: 6,
  mobility: 'AMPHIBIOUS',
  altitude: 0,
  discipline: 0.72,
  cost: 105,
  sensors: [sensor('OPTICAL', 5, 48), sensor('THERMAL', 4, 52)],
  signature: sig(48, 56, 42, 12, 54),
  weapons: [
    weapon('zd_105', '105mm gun', 'DIRECT', 4, 4, 0.66, 1.9, leth(0.95, 1.25, 1.0, 0, 0.25), 19),
  ],
  abilities: ['OVERWATCH', 'HUNKER', 'EMCON'],
  description: 'Direct fire support that arrives from the water, usually before you are ready for it.',
};

/* ================================================================== */
/* Decoys                                                              */
/* ================================================================== */

/**
 * Decoys are ordinary units with an inflated RF and radar signature, one
 * strength step and no weapons. Because they are real units, every system
 * treats them correctly without special-casing — including the enemy AI,
 * which can be genuinely induced to spend a scarce missile on one.
 */
function makeDecoy(id: string, nation: UnitDef['nation'], designation: string): UnitDef {
  return {
    id,
    name: 'Decoy Emitter',
    designation,
    nation,
    unitClass: 'EW',
    domain: 'LAND',
    armor: 'SOFT',
    maxStrength: 1,
    movement: 0,
    mobility: 'FOOT',
    altitude: 0,
    discipline: 1,
    cost: 0,
    sensors: [],
    // Loud in exactly the channels a targeting cell trusts most.
    signature: sig(30, 44, 58, 55, 20),
    weapons: [],
    abilities: [],
    description: 'An emitter and a corner reflector on a tripod. Looks like a battery to anything that is not looking closely.',
  };
}

const decoyUsa = makeDecoy('decoy_usa', 'USA', 'Decoy emitter');
const decoyJpn = makeDecoy('decoy_jpn', 'JPN', 'Decoy emitter');
const decoyAus = makeDecoy('decoy_aus', 'AUS', 'Decoy emitter');
const decoyChn = makeDecoy('decoy_chn', 'CHN', 'Decoy emitter');

/* ================================================================== */

export const ALLIED_UNITS: readonly UnitDef[] = [
  usmcRecon,
  usmcRifle,
  usmcLav,
  usmcNemesis,
  usmcHimars,
  usmcMadis,
  usmcReaper,
  usmcEw,
  jgsdfType16,
  jgsdfType12,
  jgsdfRifle,
  ausBoxer,
];

export const OPPOSING_UNITS: readonly UnitDef[] = [
  plaRecon,
  plaInfantry,
  plaZtq15,
  plaZbd05,
  plaPhl11,
  plaHq17,
  plaUav,
  plaEw,
  plaAft10,
  plaZtd05,
];

export const DECOY_UNITS: readonly UnitDef[] = [decoyUsa, decoyJpn, decoyAus, decoyChn];

export const ALL_UNITS: readonly UnitDef[] = [
  ...ALLIED_UNITS,
  ...OPPOSING_UNITS,
  ...DECOY_UNITS,
];
