/**
 * Mission 01 — FIRST LIGHT
 *
 * Teaching mission for the sensor-shooter split, and nothing else. The player
 * is handed a missile battery that can reach the whole map and see almost
 * none of it, plus a reconnaissance team that can see a great deal and hurt
 * nobody. The mission is unwinnable until those two facts are connected, and
 * trivially winnable once they are.
 *
 * Design intent: the "aha" should arrive in under three turns without a
 * tutorial box explaining it. The disabled fire button says "requires a
 * tracked contact", the recon team has a DESIGNATE action, and that is
 * sufficient scaffolding for the idea to land on its own.
 */

import { createMapFromRows } from '@core/gamemap';
import type { MissionDef } from '@core/mission';
import type { Objective } from '@core/types';
import { LEGEND, oh } from './util';

const ROWS = [
  '~ ~ ~ ~ , . - - " f h h f - - -',
  '~ ~ ~ , . - - " f f h R h f - -',
  '~ ~ , . - - " " f h R R h f - -',
  '~ ~ , . - = = - " f h R h f - -',
  '~ , . - = U U = - " f h f - - -',
  '~ , . - = U P = - " f f - - c c',
  '~ , . - = = = - - " f - - c c c',
  '~ ~ , . - - - " " f h f - c c -',
  '~ ~ , . - " " f h R h f - - - -',
  '~ ~ ~ , . - " f h R R h f - - -',
  '~ ~ ~ , . - - " f h h f - - - -',
  '~ ~ ~ ~ , . - - " f f - - - - -',
];

export const MISSION_FIRST_LIGHT: MissionDef = {
  id: 'm01_first_light',
  name: 'First Light',
  operation: 'OPERATION STONE LANTERN',
  playerSide: 'BLUE',
  maxTurns: 12,
  parTurns: 8,
  brief: [
    'A reinforced amphibious company is closing on the western shore of Kamiya-jima before dawn. There is no allied surface combatant within four hundred kilometres, and there will not be one today.',
    'You have a Naval Strike Missile battery sited in the eastern fields and a reconnaissance team on the central ridge. The battery ranges the entire island and the water beyond it. It also cannot see past the ridge in front of it.',
    'Stop the landing.',
  ],
  intel: [
    'Three amphibious vehicles and a rifle element, approaching from the west.',
    'No hostile air defence identified in the objective area.',
    'NMESIS carries two missiles. There are three armoured vehicles. The Type 16 and the LAV will have to account for the third.',
    'A missile battery cannot fire on a contact it has not been handed. Somebody has to designate.',
  ],
  lessons: [
    {
      id: 'sensor_shooter',
      title: 'Sensors and shooters are different units',
      body: 'NMESIS reaches sixteen hexes and sees three. Move your reconnaissance team where it can observe the beach, spend its action to DESIGNATE a target, and the battery will have a firing solution for the rest of the turn.',
      trigger: 'START',
    },
    {
      id: 'emcon_hint',
      title: 'Being seen is a choice',
      body: 'Your recon team is nearly invisible while it stays still in cover. It becomes conspicuous the moment it moves. Get into position early, then stop.',
      trigger: 'FIRST_CONTACT',
    },
  ],
  buildMap: () => createMapFromRows(ROWS, LEGEND),
  deployments: [
    // Allied — deployed east and centre.
    { defId: 'usmc_recon', side: 'BLUE', pos: oh(10, 2), callsign: 'OUTLAW 1-1', veterancy: 2 },
    { defId: 'usmc_nemesis', side: 'BLUE', pos: oh(14, 5), callsign: 'ANVIL 1-1', veterancy: 1 },
    { defId: 'usmc_rifle', side: 'BLUE', pos: oh(5, 4), callsign: 'HAMMER 2-1', veterancy: 1 },
    { defId: 'usmc_lav', side: 'BLUE', pos: oh(12, 7), callsign: 'VIPER 3-1', veterancy: 1 },
    // The direct-fire half of the lesson: missiles are for the targets guns
    // cannot reach, not for every target on the board.
    { defId: 'jgsdf_type16', side: 'BLUE', pos: oh(9, 5), callsign: 'ASAHI 1-1', veterancy: 1 },

    // Opposing — still afloat at H-hour. Starting them in open water rather
    // than on the beach buys the player two turns to work out the designate-
    // then-fire chain before anything is in contact, which is the entire
    // point of the mission.
    { defId: 'pla_zbd05', side: 'RED', pos: oh(0, 4), callsign: 'HAIYAN 1' },
    { defId: 'pla_zbd05', side: 'RED', pos: oh(0, 6), callsign: 'HAIYAN 2' },
    { defId: 'pla_ztd05', side: 'RED', pos: oh(0, 5), callsign: 'LEITING 1' },
    // Already ashore — a foothold to find, and the reason to look north.
    { defId: 'pla_inf', side: 'RED', pos: oh(3, 3), callsign: 'FEILONG 1' },
  ],
  buildObjectives: (): Objective[] => [
    {
      id: 'destroy_landing',
      kind: 'DESTROY',
      label: 'Destroy the amphibious landing force',
      side: 'BLUE',
      defIds: ['pla_zbd05', 'pla_ztd05'],
      optional: false,
      complete: false,
      failed: false,
    },
    {
      id: 'hold_port',
      kind: 'DENY',
      label: 'Deny the port facility',
      side: 'BLUE',
      hexes: [oh(6, 5)],
      byTurn: 12,
      optional: false,
      complete: false,
      failed: false,
    },
    {
      id: 'preserve_recon',
      kind: 'SURVIVE',
      label: 'Bonus: reconnaissance team survives',
      side: 'BLUE',
      defIds: ['usmc_recon'],
      byTurn: 12,
      optional: true,
      complete: false,
      failed: false,
    },
  ],
};
