/**
 * The heads-up display.
 *
 * DOM rather than canvas, deliberately. Text in a WebGL scene graph is a
 * constant fight with accessibility, text scaling, selection and input method
 * editors; the browser already solves all of that. The board is WebGL, the
 * interface is HTML, and each does what it is good at.
 */

import { binomialPmf } from '@core/rng';
import { suppressionState } from '@core/combat';
import { DETECTION_LABELS, type DetectionLevel } from '@core/types';
import type { FirePreview } from '@core/combat';
import type { LogEntry, Objective, Side, Unit, UnitDef } from '@core/types';

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
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

/* ------------------------------------------------------------------ */
/* Public shapes                                                       */
/* ------------------------------------------------------------------ */

export interface ActionButton {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly hint?: string;
  readonly hostile?: boolean;
  readonly primary?: boolean;
  readonly onSelect: () => void;
}

export interface UnitView {
  readonly unit: Unit;
  readonly def: UnitDef;
  readonly friendly: boolean;
  readonly detection: DetectionLevel;
}

export interface ModalButton {
  readonly label: string;
  readonly primary?: boolean;
  readonly onSelect: () => void;
}

export interface ModalSpec {
  readonly eyebrow?: string;
  readonly title: string;
  /** Rendered as paragraphs. */
  readonly body?: readonly string[];
  /** Rendered as a bulleted intel list under a heading. */
  readonly sections?: ReadonlyArray<{ heading: string; items: readonly string[] }>;
  /** Arbitrary extra content, appended before the buttons. */
  readonly extra?: HTMLElement;
  readonly buttons: readonly ModalButton[];
}

export interface HudCallbacks {
  readonly onEndTurn: () => void;
  readonly onToggleThreat: (on: boolean) => void;
  readonly onToggleSensors: (on: boolean) => void;
  readonly onMenu: () => void;
}

/* ------------------------------------------------------------------ */
/* Hud                                                                 */
/* ------------------------------------------------------------------ */

export class Hud {
  private readonly root: HTMLElement;
  private readonly callbacks: HudCallbacks;

  private readonly missionLabel = el('div', 'topbar__mission');
  private readonly nameLabel = el('div', 'topbar__name');
  private readonly turnChip = el('div', 'turn-chip');

  private readonly objectivesCard = el('div', 'card');
  private readonly objectivesBody = el('div');
  private readonly logCard = el('div', 'card');
  private readonly logBody = el('div', 'log');

  private readonly unitCard = el('div', 'unitcard');
  private readonly actionBar = el('div', 'actionbar');
  private readonly hintLine = el('div', 'hint');
  private readonly previewHost = el('div');

  private readonly threatButton = el('button', 'icon', 'THREAT');
  private readonly sensorButton = el('button', 'icon', 'SENSORS');
  // Styled distinctly rather than as a second primary: when a Confirm fire
  // button is on screen, two blue buttons compete for the same glance and the
  // player presses the wrong one.
  private readonly endTurnButton = el('button', 'endturn', 'End turn');

  private modalHost: HTMLElement | null = null;
  private threatOn = false;
  private sensorsOn = false;

  constructor(root: HTMLElement, callbacks: HudCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.build();
  }

  private build(): void {
    this.root.replaceChildren();

    // Top bar
    const topbar = el('div', 'topbar');
    const titleBlock = el('div');
    titleBlock.append(this.missionLabel, this.nameLabel);
    const menuButton = el('button', 'icon', 'MENU');
    menuButton.addEventListener('click', () => this.callbacks.onMenu());
    topbar.append(titleBlock, el('div', 'topbar__spacer'), this.turnChip, menuButton);

    // Overlay toggles
    const overlaybar = el('div', 'overlaybar');
    this.threatButton.addEventListener('click', () => {
      this.threatOn = !this.threatOn;
      this.threatButton.classList.toggle('toggle--on', this.threatOn);
      this.callbacks.onToggleThreat(this.threatOn);
    });
    this.sensorButton.addEventListener('click', () => {
      this.sensorsOn = !this.sensorsOn;
      this.sensorButton.classList.toggle('toggle--on', this.sensorsOn);
      this.callbacks.onToggleSensors(this.sensorsOn);
    });
    overlaybar.append(this.threatButton, this.sensorButton);

    // Side panel
    const sidepanel = el('div', 'sidepanel');
    this.objectivesCard.append(el('div', 'card__title', 'Objectives'), this.objectivesBody);
    this.logCard.append(el('div', 'card__title', 'Net traffic'), this.logBody);
    sidepanel.append(this.objectivesCard, this.logCard);

    // Bottom
    const bottom = el('div', 'bottom');
    this.endTurnButton.addEventListener('click', () => this.callbacks.onEndTurn());
    bottom.append(this.hintLine, this.previewHost, this.unitCard, this.actionBar);

    this.root.append(topbar, overlaybar, sidepanel, bottom);
  }

  /* ---------------------------------------------------------------- */

  setMission(operation: string, name: string): void {
    this.missionLabel.textContent = operation;
    this.nameLabel.textContent = name;
  }

  setTurn(turn: number, maxTurns: number, side: Side, isPlayerTurn: boolean): void {
    this.turnChip.textContent = isPlayerTurn
      ? `TURN ${turn}/${maxTurns}`
      : `${side} ACTING…`;
    this.turnChip.classList.toggle('turn-chip--enemy', !isPlayerTurn);
    this.endTurnButton.disabled = !isPlayerTurn;
  }

  setObjectives(objectives: readonly Objective[], playerSide: Side): void {
    this.objectivesBody.replaceChildren();

    for (const objective of objectives) {
      if (objective.side !== playerSide) continue;

      const row = el('div', 'objective');
      if (objective.complete) row.classList.add('objective--done');
      else if (objective.failed) row.classList.add('objective--failed');
      else if (objective.optional) row.classList.add('objective--optional');

      const mark = objective.complete ? '✓' : objective.failed ? '✕' : '□';
      row.append(el('div', 'objective__mark', mark), el('div', undefined, objective.label));
      this.objectivesBody.append(row);
    }
  }

  setLog(entries: readonly LogEntry[]): void {
    this.logBody.replaceChildren();
    // Most recent last, scrolled into view — a radio net reads forward.
    for (const entry of entries.slice(-40)) {
      const row = el('div', `log__entry log__entry--${entry.severity}`);
      row.append(el('span', 'log__turn', `T${entry.turn}`));
      row.append(document.createTextNode(entry.message));
      this.logBody.append(row);
    }
    this.logBody.scrollTop = this.logBody.scrollHeight;
  }

  /* ---------------------------------------------------------------- */
  /* Unit panel                                                        */
  /* ---------------------------------------------------------------- */

  showUnit(view: UnitView | null): void {
    if (!view) {
      this.unitCard.classList.remove('unitcard--visible');
      this.unitCard.replaceChildren();
      return;
    }

    const { unit, def, friendly, detection } = view;
    this.unitCard.classList.add('unitcard--visible');
    this.unitCard.replaceChildren();

    const head = el('div', 'unitcard__head');
    const callsign = el(
      'div',
      `unitcard__callsign unitcard__callsign--${friendly ? 'friendly' : 'hostile'}`,
      unit.callsign,
    );
    head.append(callsign, el('div', 'unitcard__designation', def.designation));
    if (unit.veterancy > 0) {
      head.append(el('div', 'unitcard__vet', '★'.repeat(unit.veterancy)));
    }
    this.unitCard.append(head);

    const grid = el('div', 'statgrid');

    const strengthFraction = unit.strength / Math.max(1, def.maxStrength);
    grid.append(
      meterStat(
        'Strength',
        `${unit.strength.toFixed(1)}/${def.maxStrength}`,
        strengthFraction,
        strengthFraction > 0.6 ? 'var(--good)' : strengthFraction > 0.3 ? 'var(--warn)' : 'var(--bad)',
      ),
    );

    const suppression = suppressionState(unit);
    grid.append(
      meterStat(
        'Suppression',
        suppression === 'STEADY' ? 'Steady' : suppression === 'SUPPRESSED' ? 'Suppressed' : 'PINNED',
        unit.suppression / 100,
        suppression === 'PINNED' ? 'var(--bad)' : 'var(--warn)',
      ),
    );

    if (friendly) {
      grid.append(simpleStat('Movement', `${unit.movementLeft.toFixed(1)}/${def.movement}`));
      grid.append(
        simpleStat('Emissions', unit.emitting ? 'RADIATING' : 'EMCON'),
      );
    } else {
      grid.append(simpleStat('Contact', DETECTION_LABELS[detection]));
      grid.append(simpleStat('Class', def.unitClass));
    }

    this.unitCard.append(grid);

    if (friendly) {
      // Sensors and reach, so the player can reason about the handoff without
      // opening a codex.
      const sensors = def.sensors
        .map((s) => `${s.type[0]}${s.type.slice(1).toLowerCase()} ${s.range}`)
        .join(' · ');
      const weapons = def.weapons
        .map((w) => {
          const ammo = w.ammo !== undefined ? ` (${unit.ammo[w.id] ?? 0})` : '';
          return `${w.name} ${w.rangeMin}–${w.rangeMax}${ammo}`;
        })
        .join(' · ');

      if (sensors) this.unitCard.append(detailRow('Sensors', sensors));
      if (weapons) this.unitCard.append(detailRow('Weapons', weapons));
      else this.unitCard.append(detailRow('Weapons', 'None — this unit does not shoot'));
    }
  }

  setActions(actions: readonly ActionButton[]): void {
    this.actionBar.replaceChildren();

    for (const action of actions) {
      const button = el('button', action.hostile ? 'action--hostile' : undefined, action.label);
      if (action.primary) button.classList.add('primary');
      button.disabled = !action.enabled;
      if (action.hint) button.title = action.hint;
      button.addEventListener('click', () => action.onSelect());
      this.actionBar.append(button);
    }

    this.actionBar.append(this.endTurnButton);
  }

  setHint(text: string, warn = false): void {
    this.hintLine.textContent = text;
    this.hintLine.classList.toggle('hint--warn', warn);
  }

  /* ---------------------------------------------------------------- */
  /* Fire preview                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Show the shot before it is taken, as a damage *distribution* rather than
   * a hit percentage. Players reason far better about "kills 2 to 5 steps"
   * than about "nine rounds at sixty-two percent", and seeing the spread is
   * what makes a probabilistic system feel honest instead of arbitrary.
   */
  showFirePreview(preview: FirePreview | null, weaponName: string, targetName: string): void {
    this.previewHost.replaceChildren();
    if (!preview) return;

    const card = el('div', 'firepreview');
    card.append(el('div', 'firepreview__head', `${weaponName} → ${targetName}`));

    const dist = el('div', 'dist');
    const bars: number[] = [];
    let peak = 0;
    for (let k = 0; k <= preview.volume; k++) {
      const p = binomialPmf(preview.volume, k, preview.hitChance);
      bars.push(p);
      peak = Math.max(peak, p);
    }

    const perHit = preview.volume > 0 ? preview.expectedDamage / (preview.volume * preview.hitChance || 1) : 0;
    bars.forEach((p, k) => {
      const bar = el('div', 'dist__bar');
      bar.style.height = `${Math.max(2, (p / peak) * 100)}%`;
      const damage = k * perHit;
      if (damage >= preview.damageLo && damage <= preview.damageHi) {
        bar.classList.add('dist__bar--likely');
      }
      dist.append(bar);
    });
    card.append(dist);

    const axis = el('div', 'dist__axis');
    axis.append(el('span', undefined, '0'), el('span', undefined, `${preview.volume} hits`));
    card.append(axis);

    card.append(
      previewRow('Likely damage', `${preview.damageLo}–${preview.damageHi} steps`),
      previewRow('Expected', `${preview.expectedDamage.toFixed(1)} steps`),
      previewRow('Per-round hit', `${Math.round(preview.hitChance * 100)}%`),
      previewRow('Suppression', `+${preview.expectedSuppression}`),
    );

    if (Number.isFinite(preview.ammoAfter)) {
      card.append(previewRow('Rounds after', `${preview.ammoAfter}`));
    }
    if (preview.signatureCost > 25) {
      card.append(previewRow('Exposure', 'Firing will reveal this unit'));
    }
    if (preview.targetDestroyedLikely) {
      card.append(previewRow('Assessment', 'Target likely destroyed'));
    }

    this.previewHost.append(card);
  }

  /* ---------------------------------------------------------------- */
  /* Modals                                                            */
  /* ---------------------------------------------------------------- */

  showModal(spec: ModalSpec): void {
    this.hideModal();

    const host = el('div', 'modal');
    const inner = el('div', 'modal__inner');

    if (spec.eyebrow) inner.append(el('div', 'modal__eyebrow', spec.eyebrow));
    inner.append(el('div', 'modal__title', spec.title));

    if (spec.body?.length) {
      const body = el('div', 'modal__body');
      for (const paragraph of spec.body) body.append(el('p', undefined, paragraph));
      inner.append(body);
    }

    for (const section of spec.sections ?? []) {
      inner.append(el('div', 'modal__section', section.heading));
      const list = el('ul', 'intel-list');
      for (const item of section.items) list.append(el('li', undefined, item));
      inner.append(list);
    }

    if (spec.extra) inner.append(spec.extra);

    const actions = el('div', 'modal__actions');
    for (const button of spec.buttons) {
      const node = el('button', button.primary ? 'primary' : undefined, button.label);
      node.addEventListener('click', () => button.onSelect());
      actions.append(node);
    }
    inner.append(actions);

    host.append(inner);
    this.root.append(host);
    this.modalHost = host;
  }

  hideModal(): void {
    this.modalHost?.remove();
    this.modalHost = null;
  }

  get modalOpen(): boolean {
    return this.modalHost !== null;
  }
}

/* ------------------------------------------------------------------ */
/* Small builders                                                      */
/* ------------------------------------------------------------------ */

function simpleStat(label: string, value: string): HTMLElement {
  const node = el('div', 'stat');
  node.append(el('div', 'stat__label', label), el('div', 'stat__value', value));
  return node;
}

function meterStat(
  label: string,
  value: string,
  fraction: number,
  color: string,
): HTMLElement {
  const node = simpleStat(label, value);
  const meter = el('div', 'meter');
  const fill = el('div', 'meter__fill');
  fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  fill.style.background = color;
  meter.append(fill);
  node.append(meter);
  return node;
}

function detailRow(label: string, value: string): HTMLElement {
  const node = el('div', 'stat');
  node.style.marginTop = '8px';
  node.append(el('div', 'stat__label', label));
  const text = el('div', undefined, value);
  text.style.fontSize = '11.5px';
  text.style.color = 'var(--text-dim)';
  text.style.lineHeight = '1.45';
  node.append(text);
  return node;
}

function previewRow(label: string, value: string): HTMLElement {
  const row = el('div', 'firepreview__row');
  row.append(el('span', undefined, label), el('span', 'firepreview__value', value));
  return row;
}
