/**
 * Movement and pathfinding.
 *
 * Costs vary per tile and per mobility type, so this is Dijkstra over
 * movement points rather than uniform-cost BFS. Maps are small (a few hundred
 * tiles) and this runs on every unit selection, so it is written for
 * allocation restraint rather than elegance.
 *
 * One rule deserves calling out: zone of control is exerted only by enemies
 * the moving side has actually detected. Being halted by a unit you cannot
 * see reads as an invisible wall and is the single most common way a fog-of-
 * war game loses a player's trust.
 */

import { hexEquals, hexKey, hexNeighbors, type Hex, type HexKey } from './hex';
import { inBounds, terrainAt } from './gamemap';
import { getUnitDef } from './registry';
import { isPassable, movementCost } from './terrain';
import { suppressionMovementFactor } from './combat';
import { visibleEnemies } from './sensors';
import type { GameState, Unit } from './types';

/** Extra movement points charged for entering a hex adjacent to a known enemy. */
export const ZOC_COST = 2;

export interface ReachableNode {
  readonly hex: Hex;
  readonly cost: number;
  /** Previous hex on the cheapest path, or null for the origin. */
  readonly from: Hex | null;
}

/* ------------------------------------------------------------------ */
/* Minimal binary heap                                                 */
/* ------------------------------------------------------------------ */

class MinHeap<T> {
  private readonly items: Array<{ value: T; priority: number }> = [];

  get size(): number {
    return this.items.length;
  }

  push(value: T, priority: number): void {
    this.items.push({ value, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent]!.priority <= this.items[i]!.priority) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0]!.value;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.items[left]!.priority < this.items[smallest]!.priority) {
          smallest = left;
        }
        if (
          right < this.items.length &&
          this.items[right]!.priority < this.items[smallest]!.priority
        ) {
          smallest = right;
        }
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = tmp;
  }
}

/* ------------------------------------------------------------------ */
/* Occupancy and zone of control                                       */
/* ------------------------------------------------------------------ */

function buildOccupancy(state: GameState): Map<HexKey, Unit> {
  const occupancy = new Map<HexKey, Unit>();
  for (const unit of state.units.values()) {
    if (unit.destroyed) continue;
    occupancy.set(hexKey(unit.pos), unit);
  }
  return occupancy;
}

/** Hexes adjacent to enemies the given side has live contact on. */
export function zoneOfControl(state: GameState, side: Unit['side']): Set<HexKey> {
  const zoc = new Set<HexKey>();
  for (const enemy of visibleEnemies(state, side)) {
    const enemyDef = getUnitDef(enemy.defId);
    // Aircraft and drones do not exert ground ZOC.
    if (enemyDef.domain !== 'LAND') continue;
    for (const neighbor of hexNeighbors(enemy.pos)) {
      zoc.add(hexKey(neighbor));
    }
  }
  return zoc;
}

/* ------------------------------------------------------------------ */
/* Reachability                                                        */
/* ------------------------------------------------------------------ */

/**
 * Every hex the unit can reach this turn, with the cost and predecessor for
 * each. This single call drives the movement overlay, the path preview and
 * the AI's candidate destination list.
 */
export function computeReachable(state: GameState, unit: Unit): Map<HexKey, ReachableNode> {
  const def = getUnitDef(unit.defId);
  const budget = unit.movementLeft * suppressionMovementFactor(unit);

  const results = new Map<HexKey, ReachableNode>();
  if (unit.destroyed) return results;

  const originKey = hexKey(unit.pos);
  results.set(originKey, { hex: unit.pos, cost: 0, from: null });
  if (budget <= 0) return results;

  const occupancy = buildOccupancy(state);
  const zoc = zoneOfControl(state, unit.side);

  const frontier = new MinHeap<Hex>();
  frontier.push(unit.pos, 0);

  while (frontier.size > 0) {
    const current = frontier.pop()!;
    const currentNode = results.get(hexKey(current))!;

    for (const next of hexNeighbors(current)) {
      if (!inBounds(state.map, next)) continue;

      const terrain = terrainAt(state.map, next);
      if (!isPassable(terrain, def.mobility)) continue;

      const occupant = occupancy.get(hexKey(next));
      // Enemies block outright; friendlies may be transited but not occupied.
      if (occupant && occupant.side !== unit.side) continue;

      let stepCost = movementCost(terrain, def.mobility);
      if (zoc.has(hexKey(next))) stepCost += ZOC_COST;

      const total = currentNode.cost + stepCost;
      if (total > budget) continue;

      const nextKey = hexKey(next);
      const existing = results.get(nextKey);
      if (existing && existing.cost <= total) continue;

      results.set(nextKey, { hex: next, cost: total, from: current });
      frontier.push(next, total);
    }
  }

  // A unit may not finish its move stacked on a friendly.
  for (const [key, node] of [...results]) {
    if (key === originKey) continue;
    const occupant = occupancy.get(key);
    if (occupant && occupant.id !== unit.id) results.delete(key);
    else void node;
  }

  return results;
}

/** Cheapest path from the unit to `target`, inclusive of both ends. */
export function findPath(state: GameState, unit: Unit, target: Hex): Hex[] | null {
  const reachable = computeReachable(state, unit);
  const targetNode = reachable.get(hexKey(target));
  if (!targetNode) return null;

  const path: Hex[] = [];
  let cursor: Hex | null = target;
  while (cursor) {
    path.push(cursor);
    const node: ReachableNode | undefined = reachable.get(hexKey(cursor));
    cursor = node?.from ?? null;
    if (cursor && hexEquals(cursor, unit.pos)) {
      path.push(cursor);
      break;
    }
  }
  return path.reverse();
}

export function movementCostTo(state: GameState, unit: Unit, target: Hex): number | null {
  const reachable = computeReachable(state, unit);
  return reachable.get(hexKey(target))?.cost ?? null;
}

export function canReach(state: GameState, unit: Unit, target: Hex): boolean {
  return computeReachable(state, unit).has(hexKey(target));
}
