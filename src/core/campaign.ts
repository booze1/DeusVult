/**
 * The operational layer.
 *
 * Between battles the player commands a task force rather than a shopping
 * list. Formations are tracked by callsign, carry their veterancy forward,
 * and when they are destroyed they are *gone* — rebuilding costs requisition
 * and returns a green crew with none of the experience that died with the
 * old one.
 *
 * This is the system that gives reconnaissance its weight. Scouting carefully
 * is abstractly correct in any tactics game; it becomes emotionally correct
 * when the crew you are risking has a name, four missions behind it, and
 * cannot be replaced this side of the campaign's end.
 */

import type { Deployment, MissionDef } from './mission';
import type { AfterActionReport } from './victory';
import type { GameState, Side, UnitDefId } from './types';
import { getUnitDef } from './registry';

/** Experience needed for each veterancy step. Index is the target level. */
const VETERANCY_THRESHOLDS = [0, 2, 5, 9, 14, 20];

export const MAX_VETERANCY = VETERANCY_THRESHOLDS.length - 1;

export interface TaskForceEntry {
  readonly callsign: string;
  readonly defId: UnitDefId;
  veterancy: number;
  experience: number;
  /** Missions this formation has survived. */
  missions: number;
  /** True once destroyed and not yet rebuilt. */
  lost: boolean;
  /** Strength carried into the next mission, before repair. */
  strength: number;
}

export interface CampaignRecord {
  readonly missionId: string;
  readonly rating: number;
  readonly turnsTaken: number;
  readonly friendlyLosses: number;
  readonly intelScore: number;
}

export interface CampaignState {
  readonly id: string;
  /** Index into the campaign's mission order. */
  missionIndex: number;
  requisition: number;
  taskForce: Record<string, TaskForceEntry>;
  history: CampaignRecord[];
  playerSide: Side;
}

export function createCampaign(playerSide: Side = 'BLUE'): CampaignState {
  return {
    id: `campaign-${Date.now()}`,
    missionIndex: 0,
    requisition: 0,
    taskForce: {},
    history: [],
    playerSide,
  };
}

/* ------------------------------------------------------------------ */
/* Applying the campaign to a mission                                  */
/* ------------------------------------------------------------------ */

/**
 * Produce the deployment list for a mission, with campaign state applied.
 *
 * Formations the campaign already knows about arrive with their accumulated
 * veterancy. Formations recorded as lost do not arrive at all — that is what
 * makes a loss permanent rather than cosmetic.
 */
export function applyCampaignToMission(
  campaign: CampaignState,
  mission: MissionDef,
): Deployment[] {
  return mission.deployments.filter((deployment) => {
    if (deployment.side !== campaign.playerSide) return true;
    const callsign = deployment.callsign;
    if (!callsign) return true;
    const entry = campaign.taskForce[callsign];
    return !entry?.lost;
  }).map((deployment) => {
    if (deployment.side !== campaign.playerSide) return deployment;
    const callsign = deployment.callsign;
    if (!callsign) return deployment;

    const entry = campaign.taskForce[callsign];
    if (!entry) return deployment;

    return { ...deployment, veterancy: entry.veterancy };
  });
}

/** A mission definition with the campaign's task force substituted in. */
export function campaignMission(
  campaign: CampaignState,
  mission: MissionDef,
): MissionDef {
  const deployments = applyCampaignToMission(campaign, mission);
  return { ...mission, deployments };
}

/* ------------------------------------------------------------------ */
/* Recording results                                                   */
/* ------------------------------------------------------------------ */

/** Requisition awarded for a completed mission. */
export function requisitionFor(report: AfterActionReport): number {
  let award = 60 + report.rating * 45 + report.enemyLosses * 12;
  if (report.outcome !== 'VICTORY') award = Math.floor(award * 0.35);
  // Reward playing the information game well, not only the shooting game.
  award += Math.floor(report.intelScore * 0.25);
  return award;
}

function veterancyFor(experience: number): number {
  let level = 0;
  for (let i = 1; i < VETERANCY_THRESHOLDS.length; i++) {
    if (experience >= VETERANCY_THRESHOLDS[i]!) level = i;
  }
  return level;
}

/**
 * Fold a completed mission into the campaign: survivors gain experience,
 * casualties are recorded as lost, and requisition is paid out.
 */
export function recordMission(
  campaign: CampaignState,
  state: GameState,
  report: AfterActionReport,
): CampaignState {
  for (const unit of state.units.values()) {
    if (unit.side !== campaign.playerSide) continue;

    const existing = campaign.taskForce[unit.callsign];
    const entry: TaskForceEntry = existing ?? {
      callsign: unit.callsign,
      defId: unit.defId,
      veterancy: unit.veterancy,
      experience: 0,
      missions: 0,
      lost: false,
      strength: unit.strength,
    };

    if (unit.destroyed) {
      entry.lost = true;
      entry.strength = 0;
    } else {
      // Experience comes from surviving contact, with a bonus for winning.
      entry.experience += 1 + (report.outcome === 'VICTORY' ? 1 : 0);
      entry.missions += 1;
      entry.veterancy = Math.min(MAX_VETERANCY, veterancyFor(entry.experience));
      entry.strength = unit.strength;
      entry.lost = false;
    }

    campaign.taskForce[unit.callsign] = entry;
  }

  campaign.requisition += requisitionFor(report);
  campaign.history.push({
    missionId: state.missionId,
    rating: report.rating,
    turnsTaken: report.turnsTaken,
    friendlyLosses: report.friendlyLosses,
    intelScore: report.intelScore,
  });

  if (report.outcome === 'VICTORY') campaign.missionIndex += 1;

  return campaign;
}

/* ------------------------------------------------------------------ */
/* Requisition                                                         */
/* ------------------------------------------------------------------ */

export interface RebuildOption {
  readonly callsign: string;
  readonly defId: UnitDefId;
  readonly designation: string;
  readonly cost: number;
  readonly affordable: boolean;
}

/** Formations that were lost and could be reconstituted. */
export function rebuildOptions(campaign: CampaignState): RebuildOption[] {
  return Object.values(campaign.taskForce)
    .filter((entry) => entry.lost)
    .map((entry) => {
      const def = getUnitDef(entry.defId);
      // Reconstituting is cheaper than raising a new formation, but the
      // experience is not coming back.
      const cost = Math.round(def.cost * 0.75);
      return {
        callsign: entry.callsign,
        defId: entry.defId,
        designation: def.designation,
        cost,
        affordable: campaign.requisition >= cost,
      };
    });
}

export function rebuild(campaign: CampaignState, callsign: string): boolean {
  const entry = campaign.taskForce[callsign];
  if (!entry || !entry.lost) return false;

  const def = getUnitDef(entry.defId);
  const cost = Math.round(def.cost * 0.75);
  if (campaign.requisition < cost) return false;

  campaign.requisition -= cost;
  entry.lost = false;
  entry.strength = def.maxStrength;
  // A rebuilt formation is a new crew. The experience died with the old one.
  entry.experience = 0;
  entry.veterancy = 0;
  return true;
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'deusvult.campaign.v1';

export function saveCampaign(campaign: CampaignState): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(campaign));
  } catch {
    // Private browsing and storage quotas both surface here. A campaign that
    // cannot be saved should still be playable.
  }
}

export function loadCampaign(): CampaignState | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CampaignState;
  } catch {
    return null;
  }
}

export function clearCampaign(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Ignored, as above.
  }
}
