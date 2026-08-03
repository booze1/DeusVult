/**
 * The battle screen: input, selection and action flow.
 *
 * Interaction is built around one rule — nothing irreversible happens on a
 * single tap. Choosing a weapon shows the shot; a second, explicit press
 * fires it. On a phone, where a stray thumb is a constant hazard and a
 * misfired missile can lose a mission, that second press is not friction, it
 * is the difference between a game people trust and one they do not.
 */

import { Application } from 'pixi.js';
import { hexDistance, hexEquals, hexKey, type Hex } from '@core/hex';
import { getUnitDef } from '@core/registry';
import { canBarrage, canEngage, previewFire, suppressionState } from '@core/combat';
import { computeReachable, findPath } from '@core/pathfind';
import { detect } from '@core/sensors';
import { unitAt } from '@core/state';
import type { Session } from '@core/session';
import type { Command, GameEvent } from '@core/commands';
import { DetectionLevel, type Unit } from '@core/types';
import { Board } from '@render/board';
import { PALETTE } from '@render/palette';
import type { ActionButton, Hud, UnitView } from '@ui/hud';

type Mode =
  | { readonly kind: 'IDLE' }
  | { readonly kind: 'TARGETING'; readonly targetId: string }
  | { readonly kind: 'CONFIRM_FIRE'; readonly targetId: string; readonly weaponId: string }
  | { readonly kind: 'BARRAGE'; readonly weaponId: string };

export interface BattleCallbacks {
  readonly onResolved: () => void;
}

export class BattleScreen {
  private readonly app = new Application();
  private readonly board = new Board();
  private readonly session: Session;
  private readonly hud: Hud;
  private readonly callbacks: BattleCallbacks;

  private selectedId: string | null = null;
  private mode: Mode = { kind: 'IDLE' };
  private hovered: Hex | null = null;
  private showThreat = false;
  private showSensors = false;
  private busy = false;

  private pointerStart: { x: number; y: number } | null = null;
  private dragging = false;
  private lastPointer: { x: number; y: number } | null = null;
  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;

  constructor(session: Session, hud: Hud, callbacks: BattleCallbacks) {
    this.session = session;
    this.hud = hud;
    this.callbacks = callbacks;
  }

  async mount(container: HTMLElement): Promise<void> {
    await this.app.init({
      background: PALETTE.background,
      resizeTo: container,
      antialias: true,
      resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    container.replaceChildren(this.app.canvas);
    this.app.stage.addChild(this.board.root);

    // Reserve the HUD's top bar and the unit panel + action bar below.
    this.board.fitTo(
      this.session.state,
      container.clientWidth || 800,
      container.clientHeight || 600,
      64,
      190,
    );

    this.attachInput();
    this.hud.setMission(this.session.mission.operation, this.session.mission.name);
    this.refresh();
    this.exposeDevProbe();
  }

  /**
   * Development-only handle for automated interface tests.
   *
   * Driving a canvas game from a browser test otherwise means hard-coding
   * pixel coordinates, which silently rot the moment the camera changes. This
   * exposes real marker positions instead. Stripped from production builds.
   */
  private exposeDevProbe(): void {
    if (!import.meta.env.DEV) return;
    (globalThis as unknown as Record<string, unknown>).__deusvult = {
      markers: () =>
        [...this.session.state.units.values()]
          .filter((u) => !u.destroyed)
          .map((u) => ({
            id: u.id,
            callsign: u.callsign,
            side: u.side,
            defId: u.defId,
            ...this.board.hexToScreen(u.pos),
          })),
      state: () => ({
        turn: this.session.turn,
        outcome: this.session.state.outcome,
        activeSide: this.session.state.activeSide,
      }),
    };
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  private attachInput(): void {
    const canvas = this.app.canvas;

    canvas.addEventListener('pointerdown', (event) => {
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.activePointers.size === 2) {
        this.pinchDistance = this.currentPinchDistance();
        return;
      }
      this.pointerStart = { x: event.clientX, y: event.clientY };
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.dragging = false;
    });

    canvas.addEventListener('pointermove', (event) => {
      if (this.activePointers.has(event.pointerId)) {
        this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (this.activePointers.size === 2) {
        const distance = this.currentPinchDistance();
        if (this.pinchDistance > 0 && distance > 0) {
          const centre = this.pinchCentre();
          this.board.zoomAt(centre.x, centre.y, distance / this.pinchDistance);
        }
        this.pinchDistance = distance;
        return;
      }

      if (this.pointerStart && this.lastPointer) {
        const dx = event.clientX - this.pointerStart.x;
        const dy = event.clientY - this.pointerStart.y;
        if (!this.dragging && Math.hypot(dx, dy) > 9) this.dragging = true;

        if (this.dragging) {
          this.board.panBy(event.clientX - this.lastPointer.x, event.clientY - this.lastPointer.y);
          this.lastPointer = { x: event.clientX, y: event.clientY };
        }
        return;
      }

      // Hover preview on pointer devices.
      const rect = canvas.getBoundingClientRect();
      const hex = this.board.screenToHex(event.clientX - rect.left, event.clientY - rect.top);
      if (!this.hovered || !hexEquals(this.hovered, hex)) {
        this.hovered = hex;
        this.draw();
      }
    });

    const endPointer = (event: PointerEvent): void => {
      this.activePointers.delete(event.pointerId);
      if (this.activePointers.size < 2) this.pinchDistance = 0;

      if (!this.dragging && this.pointerStart) {
        const rect = canvas.getBoundingClientRect();
        this.onTap(
          this.board.screenToHex(event.clientX - rect.left, event.clientY - rect.top),
        );
      }
      this.pointerStart = null;
      this.lastPointer = null;
      this.dragging = false;
    };

    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', () => {
      this.hovered = null;
    });

    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        this.board.zoomAt(
          event.clientX - rect.left,
          event.clientY - rect.top,
          event.deltaY > 0 ? 0.9 : 1.1,
        );
        this.draw();
      },
      { passive: false },
    );
  }

  private currentPinchDistance(): number {
    const [a, b] = [...this.activePointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private pinchCentre(): { x: number; y: number } {
    const [a, b] = [...this.activePointers.values()];
    if (!a || !b) return { x: 0, y: 0 };
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
  }

  /* ---------------------------------------------------------------- */
  /* Tap handling                                                      */
  /* ---------------------------------------------------------------- */

  private onTap(hex: Hex): void {
    if (this.busy || this.hud.modalOpen || !this.session.isPlayerTurn) return;

    // Fire missions are aimed at ground, not at units.
    if (this.mode.kind === 'BARRAGE') {
      this.issueBarrage(this.mode.weaponId, hex);
      return;
    }

    const occupant = unitAt(this.session.state, hex);

    if (occupant && occupant.side === this.session.playerSide) {
      this.selectedId = occupant.id;
      this.mode = { kind: 'IDLE' };
      this.refresh();
      return;
    }

    // Enemy markers are only tappable where the player believes something is.
    const marker = this.enemyMarkerAt(hex);
    if (marker) {
      this.mode = { kind: 'TARGETING', targetId: marker.id };
      this.refresh();
      return;
    }

    const selected = this.selected();
    if (selected && this.canMoveTo(selected, hex)) {
      this.issue({ type: 'MOVE', unitId: selected.id, to: hex });
      return;
    }

    this.selectedId = null;
    this.mode = { kind: 'IDLE' };
    this.refresh();
  }

  /**
   * The enemy unit the player believes occupies this hex, based on the
   * contact picture rather than on the board's true state.
   */
  private enemyMarkerAt(hex: Hex): Unit | null {
    for (const [unitId, contact] of this.session.state.contacts[this.session.playerSide]) {
      if (!hexEquals(contact.lastSeen, hex)) continue;
      const unit = this.session.state.units.get(unitId);
      if (unit && !unit.destroyed) return unit;
    }
    return null;
  }

  private selected(): Unit | null {
    if (!this.selectedId) return null;
    const unit = this.session.state.units.get(this.selectedId);
    return unit && !unit.destroyed ? unit : null;
  }

  private canMoveTo(unit: Unit, hex: Hex): boolean {
    if (suppressionState(unit) === 'PINNED') return false;
    return computeReachable(this.session.state, unit).has(hexKey(hex));
  }

  /* ---------------------------------------------------------------- */
  /* Commands                                                          */
  /* ---------------------------------------------------------------- */

  private issue(command: Command): void {
    const result = this.session.issue(command);
    if (!result.ok) {
      this.hud.setHint(result.error ?? 'Not possible', true);
      return;
    }
    this.mode = { kind: 'IDLE' };
    this.afterCommand(result.events);
  }

  private issueBarrage(weaponId: string, hex: Hex): void {
    const unit = this.selected();
    if (!unit) return;
    const check = canBarrage(unit, this.weapon(unit, weaponId)!, hex);
    if (!check.ok) {
      this.hud.setHint(check.reason ?? 'Cannot fire there', true);
      return;
    }
    this.issue({ type: 'BARRAGE', unitId: unit.id, weaponId, at: hex });
  }

  private weapon(unit: Unit, weaponId: string) {
    return getUnitDef(unit.defId).weapons.find((w) => w.id === weaponId);
  }

  private afterCommand(events: readonly GameEvent[]): void {
    // Refresh first so the contextual hint is written, then let event
    // reporting overwrite it — a new contact matters more than a reminder of
    // how to move.
    this.refresh();
    this.reportEvents(events);

    if (this.session.isOver) {
      this.callbacks.onResolved();
    }
  }

  private reportEvents(events: readonly GameEvent[]): void {
    const contactsGained = events.filter(
      (e) => e.type === 'CONTACT_GAINED' && e.side === this.session.playerSide,
    ).length;
    const losses = events.filter((e) => e.type === 'DESTROYED').length;

    if (contactsGained > 0) {
      this.hud.setHint(
        contactsGained === 1 ? 'New contact.' : `${contactsGained} new contacts.`,
      );
      // Bring the newest contact into view — a contact the player never saw
      // appear is a contact they will be ambushed by for no good reason.
      const gained = events.find(
        (e) => e.type === 'CONTACT_GAINED' && e.side === this.session.playerSide,
      );
      if (gained && gained.type === 'CONTACT_GAINED') {
        const contact = this.session.state.contacts[this.session.playerSide].get(gained.unitId);
        if (contact) this.centreOn(contact.lastSeen);
      }
    } else if (losses > 0) {
      this.hud.setHint('Unit destroyed.', true);
    }
  }

  private centreOn(hex: Hex): void {
    const screen = this.board.hexToScreen(hex);
    const width = this.app.canvas.clientWidth || 800;
    const height = this.app.canvas.clientHeight || 600;
    this.board.panBy(width / 2 - screen.x, height / 2 - screen.y);
  }

  /* ---------------------------------------------------------------- */
  /* Turn flow                                                         */
  /* ---------------------------------------------------------------- */

  endTurn(): void {
    if (this.busy || !this.session.isPlayerTurn || this.session.isOver) return;

    this.busy = true;
    this.selectedId = null;
    this.mode = { kind: 'IDLE' };
    this.hud.setTurn(
      this.session.turn,
      this.session.state.maxTurns,
      this.session.aiSide,
      false,
    );
    this.hud.setHint('Opposing force acting…');
    this.draw();

    // Yield a frame so the "acting" state is visible before the AI resolves.
    globalThis.setTimeout(() => {
      const events = this.session.endTurn();
      this.busy = false;

      const friendlyLosses = events.filter(
        (e) =>
          e.type === 'DESTROYED' &&
          this.session.state.units.get(e.unitId)?.side === this.session.playerSide,
      );
      if (friendlyLosses.length > 0) {
        const lost = friendlyLosses[0]!;
        if (lost.type === 'DESTROYED') {
          const unit = this.session.state.units.get(lost.unitId);
          if (unit) this.centreOn(unit.pos);
        }
        this.hud.setHint(
          friendlyLosses.length === 1
            ? 'A formation has been lost.'
            : `${friendlyLosses.length} formations lost.`,
          true,
        );
      } else {
        this.hud.setHint('Your turn.');
      }

      this.refresh();
      if (this.session.isOver) this.callbacks.onResolved();
    }, 60);
  }

  setThreatOverlay(on: boolean): void {
    this.showThreat = on;
    this.draw();
  }

  setSensorOverlay(on: boolean): void {
    this.showSensors = on;
    this.draw();
  }

  /* ---------------------------------------------------------------- */
  /* Rendering and panels                                              */
  /* ---------------------------------------------------------------- */

  refresh(): void {
    this.draw();
    this.updatePanels();
  }

  private draw(): void {
    const selected = this.selected();
    const overlays = {
      move:
        selected && !this.busy && this.session.isPlayerTurn && this.mode.kind === 'IDLE'
          ? this.reachableHexes(selected)
          : [],
      threat: this.showThreat,
      sensors: this.showSensors,
      selected: selected ? selected.pos : null,
      hovered: this.hovered,
      path: this.previewPath(selected),
    };

    this.board.draw(this.session.state, this.session.playerSide, overlays);
  }

  private reachableHexes(unit: Unit): Hex[] {
    const out: Hex[] = [];
    for (const node of computeReachable(this.session.state, unit).values()) {
      if (!hexEquals(node.hex, unit.pos)) out.push(node.hex);
    }
    return out;
  }

  private previewPath(unit: Unit | null): Hex[] {
    if (!unit || !this.hovered || this.mode.kind !== 'IDLE') return [];
    if (!this.canMoveTo(unit, this.hovered)) return [];
    return findPath(this.session.state, unit, this.hovered) ?? [];
  }

  private updatePanels(): void {
    const state = this.session.state;

    this.hud.setTurn(
      state.turn,
      state.maxTurns,
      state.activeSide,
      this.session.isPlayerTurn && !this.busy,
    );
    this.hud.setObjectives(state.objectives, this.session.playerSide);
    this.hud.setLog(state.log);

    const selected = this.selected();
    const target =
      this.mode.kind === 'TARGETING' || this.mode.kind === 'CONFIRM_FIRE'
        ? state.units.get(this.mode.targetId) ?? null
        : null;

    // The unit panel shows the target when one is chosen, otherwise the
    // selected friendly formation.
    if (target) {
      const contact = state.contacts[this.session.playerSide].get(target.id);
      const view: UnitView = {
        unit: target,
        def: getUnitDef(target.defId),
        friendly: false,
        detection: contact && !contact.stale ? contact.level : DetectionLevel.CONTACT,
      };
      this.hud.showUnit(view);
    } else if (selected) {
      this.hud.showUnit({
        unit: selected,
        def: getUnitDef(selected.defId),
        friendly: true,
        detection: DetectionLevel.TRACKED,
      });
    } else {
      this.hud.showUnit(null);
    }

    this.hud.setActions(this.buildActions());
    this.updatePreview();
    this.setContextHint();
  }

  /** Say what the current step expects, so the bar is never a dead end. */
  private setContextHint(): void {
    if (this.busy || !this.session.isPlayerTurn) return;

    switch (this.mode.kind) {
      case 'CONFIRM_FIRE':
        this.hud.setHint('Review the shot, then confirm.');
        return;
      case 'TARGETING':
        this.hud.setHint('Choose a weapon, or hand the target to your batteries.');
        return;
      case 'BARRAGE':
        this.hud.setHint('Select a hex to shell — no contact required.');
        return;
      case 'IDLE':
        this.hud.setHint(
          this.selected()
            ? 'Tap a highlighted hex to move, or a contact to engage.'
            : 'Select a formation.',
        );
    }
  }

  private updatePreview(): void {
    if (this.mode.kind !== 'CONFIRM_FIRE') {
      this.hud.showFirePreview(null, '', '');
      return;
    }

    const unit = this.selected();
    const target = this.session.state.units.get(this.mode.targetId);
    if (!unit || !target) return;

    const weapon = this.weapon(unit, this.mode.weaponId);
    if (!weapon) return;

    this.hud.showFirePreview(
      previewFire(this.session.state, unit, weapon, target),
      weapon.name,
      target.callsign,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Action bar                                                        */
  /* ---------------------------------------------------------------- */

  private buildActions(): ActionButton[] {
    const unit = this.selected();
    if (!unit || !this.session.isPlayerTurn || this.busy) return [];

    const def = getUnitDef(unit.defId);
    const state = this.session.state;

    if (this.mode.kind === 'CONFIRM_FIRE') {
      const target = state.units.get(this.mode.targetId);
      const weaponId = this.mode.weaponId;
      return [
        {
          id: 'confirm',
          label: 'Confirm fire',
          enabled: true,
          primary: true,
          onSelect: () =>
            this.issue({ type: 'FIRE', unitId: unit.id, weaponId, targetId: this.modeTargetId() }),
        },
        {
          id: 'cancel',
          label: 'Back',
          enabled: true,
          onSelect: () => {
            this.mode = target
              ? { kind: 'TARGETING', targetId: target.id }
              : { kind: 'IDLE' };
            this.refresh();
          },
        },
      ];
    }

    if (this.mode.kind === 'BARRAGE') {
      return [
        {
          id: 'cancel-barrage',
          label: 'Cancel fire mission',
          enabled: true,
          onSelect: () => {
            this.mode = { kind: 'IDLE' };
            this.refresh();
          },
        },
      ];
    }

    if (this.mode.kind === 'TARGETING') {
      const target = state.units.get(this.mode.targetId);
      if (!target) return [];
      const actions: ActionButton[] = [];

      for (const weapon of def.weapons) {
        const check = canEngage(state, unit, weapon, target);
        actions.push({
          id: `w-${weapon.id}`,
          label: weapon.name,
          enabled: check.ok,
          hostile: true,
          ...(check.reason ? { hint: check.reason } : {}),
          onSelect: () => {
            this.mode = { kind: 'CONFIRM_FIRE', targetId: target.id, weaponId: weapon.id };
            this.refresh();
          },
        });
      }

      if (def.abilities.includes('DESIGNATE')) {
        const seen = detect(state, unit.side, target);
        const enabled = !unit.hasActed && seen.level >= DetectionLevel.IDENTIFIED;
        actions.push({
          id: 'designate',
          label: 'Designate',
          enabled,
          hint: enabled
            ? 'Hand this target to your long-range shooters for the rest of the turn'
            : 'Must personally identify the target',
          onSelect: () =>
            this.issue({ type: 'DESIGNATE', unitId: unit.id, targetId: target.id }),
        });
      }

      actions.push({
        id: 'deselect-target',
        label: 'Back',
        enabled: true,
        onSelect: () => {
          this.mode = { kind: 'IDLE' };
          this.refresh();
        },
      });

      return actions;
    }

    // Idle: postures and abilities.
    const actions: ActionButton[] = [];

    for (const weapon of def.weapons) {
      if (weapon.mode !== 'INDIRECT') continue;
      const check = canBarrage(unit, weapon, unit.pos);
      actions.push({
        id: `barrage-${weapon.id}`,
        label: `${weapon.name}…`,
        enabled: check.ok,
        hostile: true,
        hint: 'Shell a map reference — no contact required',
        onSelect: () => {
          this.mode = { kind: 'BARRAGE', weaponId: weapon.id };
          this.hud.setHint('Select a hex to shell.');
          this.refresh();
        },
      });
    }

    if (def.abilities.includes('OVERWATCH')) {
      actions.push({
        id: 'overwatch',
        label: 'Overwatch',
        enabled: !unit.hasActed && suppressionState(unit) === 'STEADY',
        hint: 'Fire on the first enemy that moves into view',
        onSelect: () => this.issue({ type: 'OVERWATCH', unitId: unit.id }),
      });
    }

    actions.push({
      id: 'hunker',
      label: 'Hunker',
      enabled: !unit.hasActed,
      hint: 'Harder to hit and harder to see, but cannot act',
      onSelect: () => this.issue({ type: 'HUNKER', unitId: unit.id }),
    });

    if (def.abilities.includes('FORTIFY')) {
      actions.push({
        id: 'fortify',
        label: 'Fortify',
        enabled: !unit.hasActed && unit.movementLeft >= def.movement,
        hint: 'Prepare the position — must not have moved',
        onSelect: () => this.issue({ type: 'FORTIFY', unitId: unit.id }),
      });
    }

    if (def.abilities.includes('DECOY')) {
      actions.push({
        id: 'decoy',
        label: 'Deploy decoy',
        enabled: !unit.hasActed,
        hint: 'A false emitter, to spend someone else’s missile',
        onSelect: () => {
          const site = this.decoySite(unit);
          if (!site) {
            this.hud.setHint('No clear ground to deploy a decoy.', true);
            return;
          }
          this.issue({ type: 'DEPLOY_DECOY', unitId: unit.id, at: site });
        },
      });
    }

    const hasActive = def.sensors.some((s) => s.active) || def.abilities.includes('JAM');
    if (hasActive) {
      actions.push({
        id: 'emcon',
        label: unit.emitting ? 'Go silent' : 'Radiate',
        enabled: true,
        hint: unit.emitting
          ? 'Stop transmitting — you will see less and be far harder to find'
          : 'Switch on active sensors — you will see further and be heard further still',
        onSelect: () =>
          this.issue({ type: 'SET_EMISSION', unitId: unit.id, on: !unit.emitting }),
      });
    }

    return actions;
  }

  private modeTargetId(): string {
    return this.mode.kind === 'CONFIRM_FIRE' ? this.mode.targetId : '';
  }

  private decoySite(unit: Unit): Hex | null {
    const state = this.session.state;
    for (const node of computeReachable(state, unit).values()) {
      if (hexEquals(node.hex, unit.pos)) continue;
      if (hexDistance(unit.pos, node.hex) > 2) continue;
      if (!unitAt(state, node.hex)) return node.hex;
    }
    return null;
  }
}
