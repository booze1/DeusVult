/**
 * Mission 02 — SILENT WATCH
 *
 * Teaching mission for emissions control, built around a single hard problem:
 * the player's drone is the best sensor in the theatre, and a hostile air
 * defence vehicle will kill it the moment it flies within eleven hexes while
 * that vehicle's radar is radiating.
 *
 * The intended solution chain is deliberately not signposted:
 *   - The ELINT team sees emitters at eighteen hexes and nothing else.
 *   - While the HQ-17's radar is on, ELINT holds it at TRACKED quality.
 *   - TRACKED is exactly what HIMARS precision rounds require.
 * So the enemy's own radar is what kills it. Players who work that out once
 * never forget the emissions rule again.
 *
 * The opposing AI is given a genuine reason to keep the radar on — it has a
 * drone of its own to protect — so the window is real rather than scripted.
 */

import { createMapFromRows } from '@core/gamemap';
import type { MissionDef } from '@core/mission';
import type { Objective } from '@core/types';
import { LEGEND, oh } from './util';

const ROWS = [
  '- - " f h R R h f " - - - c c c',
  '- " f h R M R h f " - - c c c -',
  '" f h R R h h f " - - c c c - -',
  'f h R h f f " " - - c c c - - -',
  'h R h f " " - - - c c A A c - -',
  'R h f " - - - = = = A A A c - -',
  'h f " - - = = U U = A A c c - -',
  'f " - - = U U P = = c c c - - -',
  '" - - = U U = = - c c c - - - ,',
  '- - = = = - - - c c c - - , , ,',
  '- - - - - - c c c - - , , , ~ ~',
  '- - - - c c c - - , , , ~ ~ ~ ~',
];

export const MISSION_SILENT_WATCH: MissionDef = {
  id: 'm02_silent_watch',
  name: 'Silent Watch',
  operation: 'OPERATION STONE LANTERN',
  playerSide: 'BLUE',
  maxTurns: 14,
  parTurns: 10,
  brief: [
    'The airfield at Nakagusuku has to be denied before the next transport wave. Our problem is not the airfield. Our problem is what is parked beside it.',
    'An HQ-17 section is providing air defence over the objective. While its radar is radiating, nothing we fly survives inside eleven hexes — and the Reaper is the only asset that can see across the ridge line in time.',
    'Signals intelligence is attached. It hears emitters at eighteen hexes and is deaf to anything that stays quiet.',
  ],
  intel: [
    'HQ-17A air defence vehicle, sited at the airfield. Radar assessed active.',
    'One hostile UAV operating overhead — expect the air defence to stay switched on to protect it.',
    'HIMARS precision rounds require a TRACKED contact. Your ELINT team can generate exactly that against a live emitter.',
    'Fly the Reaper into the radar envelope and you will lose it.',
  ],
  lessons: [
    {
      id: 'emissions',
      title: 'An active radar is a target',
      body: 'Switching a radar on buys long-range detection and broadcasts your position further than the radar itself reaches. Your ELINT team holds any live emitter at tracked quality — which is precisely what your rocket battery needs to fire.',
      trigger: 'START',
    },
    {
      id: 'shoot_and_scoot',
      title: 'Displace after firing',
      body: 'Firing leaves you conspicuous for a turn. Hostile rocket artillery is on the board and will service your battery’s last known position. Move after every fire mission.',
      trigger: 'TURN',
      turn: 3,
    },
  ],
  buildMap: () => createMapFromRows(ROWS, LEGEND),
  deployments: [
    // Allied — assembled in the western hills.
    { defId: 'usmc_ew', side: 'BLUE', pos: oh(2, 2), callsign: 'WARLOCK 1-1', veterancy: 2 },
    { defId: 'usmc_himars', side: 'BLUE', pos: oh(1, 4), callsign: 'ANVIL 2-1', veterancy: 1 },
    { defId: 'usmc_mq9', side: 'BLUE', pos: oh(3, 6), callsign: 'REAPER 1-1', veterancy: 2 },
    { defId: 'usmc_lav', side: 'BLUE', pos: oh(4, 8), callsign: 'VIPER 3-1', veterancy: 1 },
    { defId: 'aus_boxer', side: 'BLUE', pos: oh(3, 9), callsign: 'BRUMBY 1-1', veterancy: 2 },
    { defId: 'usmc_rifle', side: 'BLUE', pos: oh(5, 7), callsign: 'HAMMER 2-1', veterancy: 1 },

    // Opposing — dug in around the airfield.
    { defId: 'pla_hq17', side: 'RED', pos: oh(11, 5), callsign: 'QINGTING 1', emitting: true },
    { defId: 'pla_uav', side: 'RED', pos: oh(9, 3), callsign: 'BEIDOU 1' },
    { defId: 'pla_phl11', side: 'RED', pos: oh(13, 4), callsign: 'LEITING 2' },
    { defId: 'pla_inf', side: 'RED', pos: oh(10, 6), callsign: 'FEILONG 1', fortified: true },
    { defId: 'pla_inf', side: 'RED', pos: oh(11, 7), callsign: 'FEILONG 2', fortified: true },
    { defId: 'pla_ztq15', side: 'RED', pos: oh(12, 6), callsign: 'CHANGCHENG 1' },
    { defId: 'pla_aft10', side: 'RED', pos: oh(13, 7), callsign: 'CHANGCHENG 2' },
  ],
  buildObjectives: (): Objective[] => [
    {
      id: 'kill_sam',
      kind: 'DESTROY',
      label: 'Destroy the air defence vehicle',
      side: 'BLUE',
      defIds: ['pla_hq17'],
      optional: false,
      complete: false,
      failed: false,
    },
    {
      id: 'take_airfield',
      kind: 'CAPTURE',
      label: 'Seize the airfield',
      side: 'BLUE',
      hexes: [oh(11, 5), oh(10, 4)],
      optional: false,
      complete: false,
      failed: false,
    },
    {
      id: 'kill_arty',
      kind: 'DESTROY',
      label: 'Bonus: silence the rocket battery',
      side: 'BLUE',
      defIds: ['pla_phl11'],
      optional: true,
      complete: false,
      failed: false,
    },
    {
      id: 'keep_reaper',
      kind: 'SURVIVE',
      label: 'Bonus: Reaper survives the operation',
      side: 'BLUE',
      defIds: ['usmc_mq9'],
      byTurn: 14,
      optional: true,
      complete: false,
      failed: false,
    },
  ],
};
