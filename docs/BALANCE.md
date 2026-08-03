# Balance

Tuning constants, the reasoning behind them, and the current honest state of
mission balance.

## Global dials

| Constant | Value | Location | Effect |
| --- | --- | --- | --- |
| `SIGNATURE_REFERENCE` | 24 | `sensors.ts` | **The single global dial for how thick the fog is.** Signature a sensor's `power` is calibrated against. Lowering it makes every sensor more capable. |
| `DETECTION_THRESHOLDS` | 25 / 55 / 85 | `sensors.ts` | Score needed for contact / identified / tracked |
| `EMISSION_RF_PENALTY` | 65 | `sensors.ts` | Added to RF signature while radiating |
| Dark RF multiplier | ×0.3 | `sensors.ts` | Residual RF under emissions control |
| `MOVE_DISTURBANCE` | 14 | `sensors.ts` | Signature boost from moving |
| `DISTURBANCE_DECAY` | 0.5 | `sensors.ts` | Per-turn halving of recent-activity signature |
| `STALE_MEMORY_TURNS` | 3 | `sensors.ts` | How long a lost contact is remembered |
| `SUPPRESSION_SUPPRESSED` / `_PINNED` | 40 / 75 | `combat.ts` | Suppression state thresholds |
| `ZOC_COST` | 2 | `pathfind.ts` | Extra movement to enter a known enemy's zone of control |

### Detection score

```
score = power × rangeFactor × crewFactor × (signature / SIGNATURE_REFERENCE)
        − obstruction − jamming

rangeFactor = 1 − 0.55 × (distance / sensorRange)
crewFactor  = 0.6 + 0.4 × (strength / maxStrength)
```

Plus a proximity floor: identified at 1 hex, contact at 2, with clear line of
sight. Concealment buys distance, not immunity — without this floor,
low-signature units are unengageable at point-blank range, since direct fire
requires identification.

### Concealment weighting per modality

| Modality | Weight | Reasoning |
| --- | --- | --- |
| Optical | 1.00 | Foliage defeats the eye completely |
| Thermal | 0.80 | Canopy is overhead cover; it defeats thermal nearly as well |
| Radar | 0.30 | Clutter helps somewhat |
| Acoustic | 0.25 | Sound carries |
| ELINT | 0.00 | Terrain does nothing against a direction finder |

## Target behaviours

These are the outcomes the calibration is chosen to produce. If a change breaks
one of these, the change is wrong.

| Situation | Intended result |
| --- | --- |
| Infantry in the open, 3 hexes, good optics | Identified |
| Infantry in forest, 3 hexes | Contact |
| Infantry in jungle, 5 hexes | **Undetected** |
| Vehicle in the open, 4–6 hexes | Identified |
| Scout at 4 hexes on a vehicle | Identified — can designate |
| Radiating air-defence vehicle vs ELINT at 10–18 hexes | **Tracked** |
| Same vehicle dark, vs ELINT at 12 hexes | **Undetected** |
| Anything with clear LOS at 1 hex | Identified |

The last two rows are the emissions-control bargain and are the most important
pair in the table. If a tuning change collapses the gap between them, the
mechanic is gone.

## Combat

```
p    = accuracy × rangeFalloff × suppressionEffect × veterancy
       × (1 − cover) × posture × contactQuality
hits = Binomial(volume, p)
volume = round(weapon.volley × attackerStrength / maxStrength)
damage = hits × weapon.damage × lethality[targetArmor]
```

Contact quality multipliers: **contact ×0.5** (area fire against a position),
**identified ×1.0** (the baseline — you are shooting at something you can see),
**tracked ×1.1** (a handoff is slightly better than your own eyes).

`p` is clamped to [0.02, 0.95]. There is no auto-hit and no auto-miss.

### Lethality matrix

Coarse on purpose — five armour classes produce a counter matrix a player can
hold in their head, which is the entire point of combined arms.

| Weapon | Soft | Light | Heavy | Air | Naval |
| --- | --- | --- | --- | --- | --- |
| Small arms | 0.9 | 0.15 | 0.02 | 0.08 | 0 |
| Autocannon 25–30mm | 1.0 | 0.85–0.95 | 0.15–0.2 | 0.25–0.3 | 0.1 |
| Tank gun 105mm | 0.9–0.95 | 1.25–1.3 | 1.0–1.05 | 0 | 0.25 |
| ATGM | 0.4–0.5 | 1.15–1.35 | 1.35–1.55 | 0 | 0.2–0.35 |
| Guided rockets | 1.15–1.2 | 0.95–1.0 | 0.6–0.65 | 0 | 0.35–0.4 |
| Anti-ship missile | 0.8 | 1.25–1.3 | 1.6–1.7 | 0 | 2.1–2.2 |
| Surface-to-air | 0 | 0 | 0 | 1.6–1.7 | 0 |

Small arms against heavy armour is 0.02 — effectively nothing. Infantry kill
tanks with their ATGM or not at all, which is the intended lesson.

## Scarcity

Long-range precision is deliberately, painfully scarce.

| System | Rounds |
| --- | --- |
| NMESIS / Type 12 anti-ship missile | 2 |
| HIMARS GMLRS precision | 3 |
| HIMARS area mission | 3 |
| PHL-11 precision / area | 3 / 4 |
| Javelin, LMAT, HJ-12 | 2–3 |
| SAM | 6 |

Two missiles against three armoured vehicles is not an oversight. It is the
mission.

## Current mission balance — honest state

Measured by `npm run sim`, which plays with the **AI driving both sides**.

| Mission | Blue win rate | Avg turns (par) | Avg friendly losses | Avg intel |
| --- | --- | --- | --- | --- |
| 01 First Light | **75%** | 13.0 (8) | 1.0 | 85% |
| 02 Silent Watch | **10%** | 13.7 (10) | 4.0 | 62% |
| 03 The Narrows | **0%** | 17.0 (12) | 6.8 | 23% |

**Mission 1 is in an acceptable place** for a teaching mission — a human should
comfortably beat 75%.

**Missions 2 and 3 are not balanced yet, and self-play is a poor proxy for
them.** Both are built around a specific insight the player is meant to have:

- *Silent Watch* requires noticing that the enemy's own radar provides the
  tracked contact needed to kill it. The AI has no representation of "solve the
  puzzle"; it evaluates positions.
- *The Narrows* requires holding missile fire until the crossing commits, and
  hunting reconnaissance rather than trading with armour. The planner has no
  concept of patience.

The AI-vs-AI number is therefore a **floor, not an estimate**, and both missions
need human playtesting before any further tuning. Resisting the temptation to
tune them against the self-play number is deliberate: doing so would balance
them for an opponent nobody plays against.

### Fixed during the slice

- **Zone of control from undetected enemies** — removed. Being halted by a unit
  you cannot see reads as an invisible wall.
- **`DENY` objectives failed instantly** when an enemy touched the hex, making
  counterattack pointless. Now resolved at the deadline: what matters is who
  holds the ground when the clock stops.
- **The AI marched missile batteries onto objectives.** Long-range platforms now
  use a standoff posture, holding roughly two-thirds of their reach from known
  enemies. A battery that advances has thrown away its only advantage.
- **Identification was a penalty** rather than the baseline for direct fire.
- **Thermal saw through jungle canopy.**

## Retuning procedure

1. Change one constant.
2. `npm test` — the target behaviours in this document are asserted there.
3. `npm run sim -- <mission> 200` for each mission.
4. Update the table above with real numbers. Do not update it from intuition.
