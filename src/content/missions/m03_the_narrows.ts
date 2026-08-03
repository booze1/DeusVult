/**
 * Mission 03 — THE NARROWS
 *
 * The graduation mission. Everything the first two taught is required at once
 * and under time pressure, with the roles reversed: the player is now the one
 * being found. Hostile reconnaissance is on the board from turn one, hostile
 * rockets will service anything it designates, and an electronic warfare
 * vehicle is jamming allied radar.
 *
 * Design intent: this is where a player learns that emissions discipline is
 * not a puzzle solution but a habit. The winning line involves holding fire
 * with the missile batteries until the crossing is committed — which is
 * uncomfortable, and is meant to be.
 */

import { createMapFromRows } from '@core/gamemap';
import type { MissionDef } from '@core/mission';
import type { Objective } from '@core/types';
import { LEGEND, oh } from './util';

const ROWS = [
  '~ ~ , . - " f h R h f " - - c c',
  '~ , . - - " f h R R h f " - c c',
  '~ , . - = = " f h R h f " - - c',
  ', . - = U U = " f h h f " - - -',
  ', . - = U P U = " f f " - c c -',
  ', . - = U U = = " f " - c c c -',
  '~ , . - = = = - " f " - c c - -',
  '~ , . - - - - " f h f " - - - -',
  '~ ~ , . - " " f h R h f " - - -',
  '~ ~ , . - " f h R R h f " - - -',
  '~ ~ ~ , . - " f h R h f " - - -',
  '~ ~ ~ , . - - " f h f " - - - -',
];

export const MISSION_THE_NARROWS: MissionDef = {
  id: 'm03_the_narrows',
  name: 'The Narrows',
  operation: 'OPERATION STONE LANTERN',
  playerSide: 'BLUE',
  maxTurns: 16,
  parTurns: 12,
  brief: [
    'The crossing comes tonight. A reinforced battalion will put armour ashore on the western beaches and drive for the port at Sakihama — and unlike the first landing, this one arrives with its own reconnaissance, its own rockets, and electronic attack.',
    'You hold the port with a composite task force. You will not stop them by trading shots; the opposing battery outranges everything you own except the missile batteries, and those have four rounds between them.',
    'Hold the port for sixteen turns. Do not let them find your batteries before you fire them.',
  ],
  intel: [
    'Hostile EW vehicle in the assault echelon — expect allied radar to be degraded near the beach.',
    'Hostile SOF reconnaissance is already ashore. Assume you are being watched from the ridges.',
    'PHL-11 rocket battery in support. It will fire on any position their recon designates.',
    'Your Type 12 and NMESIS batteries carry two missiles each. There are more targets than missiles.',
  ],
  lessons: [
    {
      id: 'counter_recon',
      title: 'Kill the eyes, not the guns',
      body: 'Their rocket battery cannot fire precision rounds without a tracked contact. Hunt the reconnaissance team and the drone, and the artillery becomes little more than harassment.',
      trigger: 'START',
    },
    {
      id: 'displace',
      title: 'Nothing fires twice from the same hex',
      body: 'Your batteries are conspicuous for a full turn after firing. Fire, then move — every time, without exception.',
      trigger: 'FIRST_LOSS',
    },
  ],
  buildMap: () => createMapFromRows(ROWS, LEGEND),
  deployments: [
    // Allied — holding the port and the central ridge.
    { defId: 'usmc_nemesis', side: 'BLUE', pos: oh(13, 4), callsign: 'ANVIL 1-1', veterancy: 2 },
    { defId: 'jgsdf_type12', side: 'BLUE', pos: oh(14, 7), callsign: 'KAZE 1-1', veterancy: 2 },
    { defId: 'usmc_ew', side: 'BLUE', pos: oh(12, 2), callsign: 'WARLOCK 1-1', veterancy: 2 },
    { defId: 'usmc_recon', side: 'BLUE', pos: oh(9, 9), callsign: 'OUTLAW 1-1', veterancy: 3 },
    { defId: 'usmc_rifle', side: 'BLUE', pos: oh(5, 4), callsign: 'HAMMER 2-1', veterancy: 2, fortified: true },
    { defId: 'jgsdf_rifle', side: 'BLUE', pos: oh(4, 3), callsign: 'HAYATE 1-1', veterancy: 2, fortified: true },
    { defId: 'jgsdf_type16', side: 'BLUE', pos: oh(8, 5), callsign: 'ASAHI 1-1', veterancy: 2 },
    { defId: 'aus_boxer', side: 'BLUE', pos: oh(10, 7), callsign: 'BRUMBY 1-1', veterancy: 2 },
    { defId: 'usmc_madis', side: 'BLUE', pos: oh(12, 5), callsign: 'DAGGER 1-1', veterancy: 1 },

    // Opposing — the assault echelon, plus what is already ashore.
    { defId: 'pla_recon', side: 'RED', pos: oh(7, 1), callsign: 'QINGTING 1', veterancy: 3 },
    { defId: 'pla_recon', side: 'RED', pos: oh(8, 10), callsign: 'QINGTING 2', veterancy: 3 },
    { defId: 'pla_ztd05', side: 'RED', pos: oh(0, 3), callsign: 'LEITING 1' },
    { defId: 'pla_ztd05', side: 'RED', pos: oh(0, 6), callsign: 'LEITING 2' },
    { defId: 'pla_zbd05', side: 'RED', pos: oh(1, 4), callsign: 'HAIYAN 1' },
    { defId: 'pla_zbd05', side: 'RED', pos: oh(1, 8), callsign: 'HAIYAN 2' },
    { defId: 'pla_zbd05', side: 'RED', pos: oh(0, 9), callsign: 'HAIYAN 3' },
    { defId: 'pla_inf', side: 'RED', pos: oh(2, 5), callsign: 'FEILONG 1' },
    { defId: 'pla_inf', side: 'RED', pos: oh(2, 7), callsign: 'FEILONG 2' },
    { defId: 'pla_phl11', side: 'RED', pos: oh(1, 11), callsign: 'CHANGCHENG 3' },
    { defId: 'pla_ew', side: 'RED', pos: oh(2, 10), callsign: 'CHANGCHENG 4', emitting: true },
    { defId: 'pla_uav', side: 'RED', pos: oh(3, 0), callsign: 'BEIDOU 1' },
  ],
  reinforcements: [
    {
      turn: 6,
      deployment: { defId: 'pla_ztq15', side: 'RED', pos: oh(0, 5), callsign: 'CHANGCHENG 5' },
      announcement: 'Second wave ashore — armour on the western beach.',
    },
    {
      turn: 6,
      deployment: { defId: 'pla_aft10', side: 'RED', pos: oh(0, 7), callsign: 'CHANGCHENG 6' },
    },
    {
      turn: 10,
      deployment: { defId: 'usmc_lav', side: 'BLUE', pos: oh(15, 5), callsign: 'VIPER 4-1' },
      announcement: 'Light armoured reconnaissance arriving from the east.',
    },
  ],
  buildObjectives: (): Objective[] => [
    {
      id: 'hold_port',
      kind: 'DENY',
      label: 'Hold the port at Sakihama',
      side: 'BLUE',
      hexes: [oh(5, 4)],
      byTurn: 16,
      optional: false,
      complete: false,
      failed: false,
    },
    {
      id: 'batteries_survive',
      kind: 'SURVIVE',
      label: 'Preserve at least one missile battery',
      side: 'BLUE',
      defIds: ['usmc_nemesis', 'jgsdf_type12'],
      byTurn: 16,
      optional: false,
      complete: false,
      failed: false,
    },
    {
      id: 'break_landing',
      kind: 'DESTROY',
      label: 'Bonus: destroy the amphibious echelon',
      side: 'BLUE',
      defIds: ['pla_zbd05', 'pla_ztd05'],
      optional: true,
      complete: false,
      failed: false,
    },
    {
      id: 'kill_recon',
      kind: 'DESTROY',
      label: 'Bonus: eliminate hostile reconnaissance',
      side: 'BLUE',
      defIds: ['pla_recon', 'pla_uav'],
      optional: true,
      complete: false,
      failed: false,
    },
  ],
};
