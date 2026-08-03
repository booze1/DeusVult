/**
 * Participating nations.
 *
 * Each is described by doctrine only — the way it prefers to fight. That is
 * the axis that matters tactically, it is the axis the AI reads, and it keeps
 * the fiction about militaries rather than about peoples.
 */

import type { NationProfile } from '@core/types';

export const NATIONS: readonly NationProfile[] = [
  {
    id: 'USA',
    name: 'United States Marine Corps',
    shortName: 'USMC',
    side: 'BLUE',
    doctrine:
      'Disperse, sense, and strike from beyond the enemy’s reach. Small teams hold ground nobody wants in order to range weapons on the water nobody can cross.',
  },
  {
    id: 'JPN',
    name: 'Japan Ground Self-Defense Force',
    shortName: 'JGSDF',
    side: 'BLUE',
    doctrine:
      'Prepared defence of known terrain. Fortified positions, prepared fields of fire, and coastal batteries sited years in advance.',
  },
  {
    id: 'AUS',
    name: 'Australian Army',
    shortName: 'ADF',
    side: 'BLUE',
    doctrine:
      'Armoured cavalry reconnaissance. Fights for information rather than waiting for it, and is equipped to survive the contact it starts.',
  },
  {
    id: 'CHN',
    name: "People's Liberation Army",
    shortName: 'PLA',
    side: 'RED',
    doctrine:
      'Reconnaissance-strike. Cheap sensors find, massed precision rockets service the grid reference, and layered air defence blinds anything that flies.',
  },
];
