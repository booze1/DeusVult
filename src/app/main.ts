/**
 * Application shell: title, briefing, battle, after-action, campaign.
 */

import '../styles.css';
import { initContent, MISSIONS } from '@content/index';
import { Session } from '@core/session';
import {
  campaignMission,
  clearCampaign,
  createCampaign,
  loadCampaign,
  rebuild,
  rebuildOptions,
  recordMission,
  saveCampaign,
  type CampaignState,
} from '@core/campaign';
import type { MissionDef } from '@core/mission';
import { Hud } from '@ui/hud';
import { BattleScreen } from './battle';

initContent();

const boardHost = document.getElementById('board');
const hudHost = document.getElementById('hud');

if (!boardHost || !hudHost) {
  throw new Error('Missing #board or #hud host element');
}

let campaign: CampaignState = loadCampaign() ?? createCampaign('BLUE');
let battle: BattleScreen | null = null;

const hud = new Hud(hudHost, {
  onEndTurn: () => battle?.endTurn(),
  onToggleThreat: (on) => battle?.setThreatOverlay(on),
  onToggleSensors: (on) => battle?.setSensorOverlay(on),
  onMenu: () => showPauseMenu(),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function currentMission(): MissionDef | null {
  return MISSIONS[campaign.missionIndex] ?? null;
}

/* ------------------------------------------------------------------ */
/* Title                                                               */
/* ------------------------------------------------------------------ */

function showTitle(): void {
  const mission = currentMission();
  const hasProgress = campaign.history.length > 0;

  hud.showModal({
    eyebrow: 'First Island Chain · 2031',
    title: 'DEUS VULT',
    body: [
      'A fictional escalation in the Western Pacific, fought with real forces and real equipment.',
      'You command a dispersed allied task force. Your weapons reach much further than your eyes do — the whole of your job is closing that gap before the other side closes theirs.',
    ],
    sections: [
      {
        heading: 'The one rule that matters',
        items: [
          'Sensors and shooters are different units. A missile battery cannot fire on a contact nobody has handed it.',
          'Switching on a radar lets you see further — and lets the enemy hear you from further still.',
          'Losses are permanent. Formations you lose are gone, and rebuilding costs their experience.',
        ],
      },
    ],
    buttons: [
      ...(mission
        ? [
            {
              label: hasProgress ? 'Continue operation' : 'Begin operation',
              primary: true,
              onSelect: () => showBriefing(mission),
            },
          ]
        : [
            {
              label: 'Campaign complete',
              primary: true,
              onSelect: () => showCampaignComplete(),
            },
          ]),
      ...(hasProgress
        ? [
            {
              label: 'Restart campaign',
              onSelect: () => {
                clearCampaign();
                campaign = createCampaign('BLUE');
                showTitle();
              },
            },
          ]
        : []),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Briefing                                                            */
/* ------------------------------------------------------------------ */

function showBriefing(mission: MissionDef): void {
  const lessons = (mission.lessons ?? []).filter((l) => l.trigger === 'START');

  const extra = el('div');
  if (lessons.length > 0) {
    extra.append(el('div', 'modal__section', 'Doctrine note'));
    for (const lesson of lessons) {
      const block = el('div', 'lesson');
      block.append(
        el('div', 'lesson__title', lesson.title),
        el('div', 'lesson__body', lesson.body),
      );
      extra.append(block);
    }
  }

  const taskForce = Object.values(campaign.taskForce);
  if (taskForce.length > 0) {
    extra.append(el('div', 'modal__section', 'Task force'));
    const list = el('div', 'taskforce');
    for (const entry of taskForce) {
      const row = el('div', `tf-row${entry.lost ? ' tf-row--lost' : ''}`);
      row.append(el('div', 'tf-row__callsign', entry.callsign));
      row.append(
        el(
          'div',
          undefined,
          entry.lost ? 'Destroyed' : `${'★'.repeat(entry.veterancy) || '—'} · ${entry.missions} missions`,
        ),
      );
      list.append(row);
    }
    extra.append(list);
  }

  hud.showModal({
    eyebrow: mission.operation,
    title: mission.name,
    body: [...mission.brief],
    sections: [{ heading: 'Intelligence', items: [...mission.intel] }],
    extra,
    buttons: [
      { label: 'Deploy', primary: true, onSelect: () => void startMission(mission) },
      { label: 'Back', onSelect: () => showTitle() },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Battle                                                              */
/* ------------------------------------------------------------------ */

async function startMission(mission: MissionDef): Promise<void> {
  hud.hideModal();
  battle?.destroy();

  // Substitute the persistent task force into the authored order of battle.
  const staffed = campaignMission(campaign, mission);
  const session = new Session(staffed, {
    seed: `${mission.id}:${campaign.id}:${campaign.history.length}`,
    difficulty: 'VETERAN',
  });

  battle = new BattleScreen(session, hud, {
    onResolved: () => showAfterAction(session, mission),
  });

  await battle.mount(boardHost!);
  hud.setHint('Select a formation to begin.');
}

function showPauseMenu(): void {
  hud.showModal({
    title: 'Operation paused',
    body: ['The battle is held. Nothing is lost while this screen is open.'],
    buttons: [
      { label: 'Resume', primary: true, onSelect: () => hud.hideModal() },
      {
        label: 'Abandon mission',
        onSelect: () => {
          battle?.destroy();
          battle = null;
          boardHost!.replaceChildren();
          showTitle();
        },
      },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* After action                                                        */
/* ------------------------------------------------------------------ */

function showAfterAction(session: Session, mission: MissionDef): void {
  const report = session.afterAction();
  campaign = recordMission(campaign, session.state, report);
  saveCampaign(campaign);

  const extra = el('div');

  const grid = el('div', 'aar-grid');
  grid.append(
    stat('Turns', `${report.turnsTaken}`, `par ${report.parTurns}`),
    stat('Losses', `${report.friendlyLosses}`),
    stat('Enemy losses', `${report.enemyLosses}`),
    stat('Intel picture', `${report.intelScore}%`),
  );
  extra.append(grid);

  // Reconstitution, if anything was lost and can be paid for.
  const options = rebuildOptions(campaign);
  if (options.length > 0) {
    extra.append(
      el('div', 'modal__section', `Reconstitution — ${campaign.requisition} requisition available`),
    );
    const list = el('div', 'taskforce');
    for (const option of options) {
      const row = el('div', 'tf-row tf-row--lost');
      row.append(el('div', 'tf-row__callsign', option.callsign));
      row.append(el('div', undefined, option.designation));
      row.append(el('div', 'tf-row__spacer'));

      const button = el('button', undefined, `Rebuild · ${option.cost}`);
      button.disabled = !option.affordable;
      button.addEventListener('click', () => {
        if (rebuild(campaign, option.callsign)) {
          saveCampaign(campaign);
          showAfterActionRefresh(session, mission, report.outcome === 'VICTORY');
        }
      });
      row.append(button);
      list.append(row);
    }
    extra.append(list);
  }

  const won = report.outcome === 'VICTORY';
  const next = currentMission();

  hud.showModal({
    eyebrow: mission.operation,
    title: won ? 'Mission accomplished' : 'Mission failed',
    body: [
      won
        ? 'Objectives secured. The task force consolidates.'
        : 'The operation did not achieve its objectives. Survivors withdraw and reconstitute.',
      report.rating === 3
        ? 'Exemplary — inside the time allowance and without a single loss.'
        : report.intelScore >= 80
          ? 'The intelligence picture was held throughout. That is how this is meant to be fought.'
          : 'A tighter contact picture would have cost fewer formations.',
    ],
    extra: withRating(report.rating, extra),
    buttons: [
      ...(won && next
        ? [{ label: `Next: ${next.name}`, primary: true, onSelect: () => showBriefing(next) }]
        : won
          ? [{ label: 'Campaign complete', primary: true, onSelect: () => showCampaignComplete() }]
          : [
              {
                label: 'Retry mission',
                primary: true,
                onSelect: () => void startMission(mission),
              },
            ]),
      { label: 'Main menu', onSelect: () => showTitle() },
    ],
  });
}

/** Re-render the after-action screen in place after a reconstitution. */
function showAfterActionRefresh(session: Session, mission: MissionDef, _won: boolean): void {
  void _won;
  // recordMission has already run; re-entering it would double-count, so the
  // refresh path rebuilds the modal from current campaign state only.
  const options = rebuildOptions(campaign);
  const extra = el('div');
  extra.append(el('div', 'modal__section', `Requisition remaining — ${campaign.requisition}`));

  const list = el('div', 'taskforce');
  for (const entry of Object.values(campaign.taskForce)) {
    const row = el('div', `tf-row${entry.lost ? ' tf-row--lost' : ''}`);
    row.append(el('div', 'tf-row__callsign', entry.callsign));
    row.append(el('div', undefined, entry.lost ? 'Destroyed' : `${'★'.repeat(entry.veterancy) || '—'}`));
    row.append(el('div', 'tf-row__spacer'));

    const option = options.find((o) => o.callsign === entry.callsign);
    if (option) {
      const button = el('button', undefined, `Rebuild · ${option.cost}`);
      button.disabled = !option.affordable;
      button.addEventListener('click', () => {
        if (rebuild(campaign, option.callsign)) {
          saveCampaign(campaign);
          showAfterActionRefresh(session, mission, _won);
        }
      });
      row.append(button);
    }
    list.append(row);
  }
  extra.append(list);

  const next = currentMission();
  hud.showModal({
    eyebrow: mission.operation,
    title: 'Reconstitution',
    body: ['Replacement crews are green. Experience does not transfer.'],
    extra,
    buttons: [
      ...(next
        ? [{ label: `Next: ${next.name}`, primary: true, onSelect: () => showBriefing(next) }]
        : [{ label: 'Campaign complete', primary: true, onSelect: () => showCampaignComplete() }]),
      { label: 'Main menu', onSelect: () => showTitle() },
    ],
  });
}

function withRating(rating: number, extra: HTMLElement): HTMLElement {
  const wrapper = el('div');
  wrapper.append(el('div', 'rating', '★'.repeat(rating) + '☆'.repeat(3 - rating)));
  wrapper.append(extra);
  return wrapper;
}

function stat(label: string, value: string, note?: string): HTMLElement {
  const node = el('div', 'aar-stat');
  node.append(el('div', 'aar-stat__label', label), el('div', 'aar-stat__value', value));
  if (note) {
    const noteNode = el('div', 'aar-stat__label', note);
    noteNode.style.marginTop = '2px';
    node.append(noteNode);
  }
  return node;
}

function showCampaignComplete(): void {
  const totalStars = campaign.history.reduce((sum, r) => sum + r.rating, 0);
  const losses = campaign.history.reduce((sum, r) => sum + r.friendlyLosses, 0);
  const avgIntel = campaign.history.length
    ? Math.round(
        campaign.history.reduce((sum, r) => sum + r.intelScore, 0) / campaign.history.length,
      )
    : 0;

  const extra = el('div', 'aar-grid');
  extra.append(
    stat('Rating', `${totalStars}/${campaign.history.length * 3}`),
    stat('Total losses', `${losses}`),
    stat('Avg intel', `${avgIntel}%`),
  );

  hud.showModal({
    eyebrow: 'OPERATION STONE LANTERN',
    title: 'Operation concluded',
    body: [
      'The island chain holds. The crossing was contested, found, and stopped short of the ports it needed.',
      'This is the end of the vertical slice — three missions of a campaign designed for twenty.',
    ],
    extra,
    buttons: [
      {
        label: 'Restart campaign',
        primary: true,
        onSelect: () => {
          clearCampaign();
          campaign = createCampaign('BLUE');
          showTitle();
        },
      },
    ],
  });
}

/* ------------------------------------------------------------------ */

showTitle();
