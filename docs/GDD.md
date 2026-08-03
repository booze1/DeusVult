# DEUS VULT — Game Design Document

*Vertical slice. Living document.*

---

## 1. Statement of intent

**A turn-based tactics game about information, in which finding the enemy is
harder than killing them.**

Every tactics game has fog of war. Almost none make it the *subject*. The
genre's fog is a visibility rule layered onto a combat game; here the combat
system exists to give the information system stakes. The design question this
game answers is: *what does a tactics game look like if the reconnaissance
phase is the game, and the shooting is the consequence?*

### Design pillars

1. **Sensors and shooters are different units.** No unit is good at both
   finding and killing. Every long-range shooter in the roster depends on
   someone else's eyes, and every good sensor is fragile.
2. **Contact has quality, not just presence.** Knowing something is out there
   is nearly useless. Precision fires need a *tracked* contact, which most
   shooters cannot generate for themselves.
3. **Being seen is a choice you keep making.** Moving, firing and radiating all
   raise your signature. Emissions control is a live decision, not a setting.
4. **Losses are permanent and named.** The crew you are risking has a callsign
   and four missions behind it. That is what converts "scouting is correct" into
   "scouting matters".

### What this game is not

- Not a base builder, gacha, or live-ops product. There is no energy, no
  premium currency, and no unit gated behind payment.
- Not a simulation. Every system is abstracted to whatever depth makes the
  *decision* interesting and no further.
- Not a game about real, current wars. See §8.

### Reference points

| Reference | What we take | What we reject |
| --- | --- | --- |
| *Advance Wars* | Counter-scale clarity, readable combined arms, mission pacing | Perfect information; combat as arithmetic |
| *Into the Breach* | Preview honesty; every loss traceable to a decision | Full determinism; puzzle-box scale |
| *XCOM* | Named units, permanent loss, campaign attachment | The missed 95%; save-scumming pressure |
| *Company of Heroes* | Suppression as the primary effect of fire | Real-time execution |
| *Wargame: Red Dragon* | Sensor/shooter split, standoff weapons, EW | Interface density; hostility to newcomers |
| *Panzer Corps* | Core units carried between missions with veterancy | Attrition bookkeeping |

---

## 2. The information system

The signature mechanic. Fully specified in `src/core/sensors.ts`.

### 2.1 Contact tiers

| Tier | Meaning | What it permits |
| --- | --- | --- |
| **Undetected** | Not on your map at all | Nothing |
| **Contact** | Something is there; position known, nature unknown | Area fire only; direct fire at halved accuracy |
| **Identified** | Type known | Direct fire at full effect |
| **Tracked** | Fire-control quality | Missile and precision indirect fire |

The gap between *identified* and *tracked* is the game's central tension. A
unit can usually identify what it can see. It can rarely track it well enough
for someone else's missile.

### 2.2 Modalities

| Sensor | Reads | Line of sight | Active | Ceiling |
| --- | --- | --- | --- | --- |
| Optical | Visual signature | Yes | No | Tracked |
| Thermal | Heat | Yes | No | Tracked |
| Radar | Radar cross-section | Yes | **Yes** | Tracked |
| ELINT | RF emissions | **No** | No | Identified, or **Tracked vs a live emitter** |
| Acoustic | Noise | No | No | Contact |

The ELINT row is the whole design. A passive receiver hears an active radar
from eighteen hexes — further than that radar can see — and against an emitter
it reaches *tracked* quality, which is exactly what a rocket battery needs.
**An enemy's own radar is the thing that kills it.**

### 2.3 Signature

A unit's detectability per spectrum, modified by:

- **Terrain concealment**, weighted per modality. Jungle defeats optical almost
  entirely and thermal heavily (canopy is overhead cover); it does little
  against radar and nothing against a direction finder.
- **Posture** — hunkering cuts signature 45%, fortifying 20%.
- **Recent activity** (`disturbance`) — moving and firing accumulate a
  signature boost that halves each turn. This is what makes *shoot and scoot* a
  behaviour rather than a slogan.
- **Emissions** — radiating adds a large RF penalty; running dark cuts residual
  RF to 30% of nominal.

### 2.4 Concealment buys distance, not immunity

A hard floor guarantees identification at one hex and contact at two, with
clear line of sight. Without it, very low-signature units become literally
unengageable at point-blank range, since direct fire requires identification.
A scout should hide from an observer a kilometre away and not from one in the
next field.

### 2.5 Losing contact

Contact is not erased when broken. It degrades to a **stale marker** at the
last observed position and lingers three turns, drawn ghosted, unusable for
precision fires. That ghost is what makes displacement worthwhile: you are not
hiding from the enemy so much as invalidating their picture — and the AI will
shell your last known position, so the ghost is a genuine hazard.

### 2.6 Designation

A scout may spend its action to **designate**: the target counts as tracked for
every shooter on that side, for the rest of the turn. This is the sensor-shooter
handoff made explicit, and the cost is the scout's whole turn. Finding is a job,
not a passive bonus.

---

## 3. Combat

### 3.1 The whiff problem

Percentage-to-hit tactics games have one notorious failure: a single coin flip
decides a turn, and a missed 95% reads as the game cheating.

We keep genuine probability and remove the whiff by **resolving at the correct
scale**. A counter is a platoon. When it attacks it is not taking one shot, it
is putting `volley` rounds of effective fire downrange. Outcomes are therefore
**binomial**, and a binomial with n≈4–10 clusters hard around its mean.

The player is shown a damage *range* — "kills 3.6–7.2 steps" — not a hit
percentage, because that is what they actually need to reason about.

Two properties fall out, both good:

- Damaged units fire **fewer rounds** rather than becoming inaccurate. Truer,
  and much clearer.
- Rounds that fail to kill still **suppress**. There is no wasted attack.

Measured: on a healthy platoon's identified shot in the open, total-miss rate
is under 5%, and suppression is inflicted on 100% of attacks. Both are asserted
in `tests/combat.test.ts`.

### 3.2 Suppression

0–100, decaying at the start of the owner's turn.

| State | Threshold | Effect |
| --- | --- | --- |
| Steady | <40 | — |
| Suppressed | 40–74 | Accuracy ×0.65, movement ×0.5, cannot hold overwatch |
| Pinned | ≥75 | Accuracy ×0.35, cannot move, direct fire only |

Discipline blunts the accuracy loss from being under fire — most of what
separates a veteran formation from a green one — and compounds with campaign
veterancy.

### 3.3 Area fire

Indirect weapons may shell a **map reference** with no contact whatsoever.
Modest damage, heavy suppression, small footprint. This is the answer to "my
artillery has no target", and it lets a commander act on suspicion — shell the
treeline they *think* holds an anti-tank position. That is exactly the decision
the information layer exists to produce.

### 3.4 Reaction fire

Overwatch fires on the first enemy to move within reach and cuts the move
short. Deliberately stricter than a normal engagement: direct fire only, and
the watcher must see the target *itself* rather than relying on a shared track.

---

## 4. Mission and campaign structure

### 4.1 Missions

12–20 minutes, 12–16 turns. One new idea per mission, taught by the interface
rather than by a tutorial box — a disabled fire button that says *"requires a
tracked contact"* teaches the rule better than any pop-up.

| # | Mission | Teaches |
| --- | --- | --- |
| 01 | **First Light** | The sensor-shooter split. A battery that cannot see, a scout that cannot shoot, and a target that dies only when they are connected. |
| 02 | **Silent Watch** | Emissions control. The enemy's air-defence radar is the only way to kill it — and the solution chain is not signposted. |
| 03 | **The Narrows** | Everything at once, roles reversed: now *you* are the one being found. |

### 4.2 The operational layer

Between battles you command a task force, not a shopping list.

- Formations are tracked by **callsign** and carry veterancy forward.
- Destroyed formations are **gone**. They do not appear in the next mission.
- **Reconstitution** costs requisition and returns a green crew — the experience
  died with the old one.
- Requisition rewards intelligence, not only kills: the after-action rating
  includes an **intel score**, the fraction of the surviving enemy force you
  still hold at identified quality or better.

### 4.3 Scoring

0–3 stars: victory, plus one for finishing inside par turns, plus one for zero
losses (or all optional objectives).

---

## 5. Factions

Real militaries, characterised by doctrine.

| Force | Doctrine |
| --- | --- |
| **USMC** | Disperse, sense, strike from beyond reach. Small teams hold ground nobody wants in order to range weapons on water nobody can cross. |
| **JGSDF** | Prepared defence of known terrain. Fortified positions and coastal batteries sited years in advance. |
| **Australian Army** | Armoured cavalry reconnaissance. Fights *for* information rather than waiting for it. |
| **PLA** | Reconnaissance-strike. Cheap sensors find, massed precision rockets service the grid reference, layered air defence blinds anything that flies. |

These are reflected mechanically in the AI's doctrine weights
(`src/core/ai/doctrine.ts`), not just in flavour text.

---

## 6. Interface

Mobile-first. The board owns the screen; panels are collapsible overlays; every
target is ≥44px.

- **Nothing irreversible on a single tap.** Choosing a weapon shows the shot; a
  second explicit press fires it. On a phone a misfired missile can lose a
  mission.
- **Disabled actions state their reason.** "Requires a tracked contact —
  designate the target with a scout or drone" is the tutorial.
- **The fire preview shows a distribution**, not a percentage.
- **Colour is never the only channel.** Blue/orange rather than blue/red, since
  red/green and red/blue both fail for roughly one man in twelve. Friendly
  markers are rounded, hostile markers angular — side is readable from shape
  alone, and from luminance in greyscale.
- **Overlays on demand** — threat envelopes and your own sensor coverage, so a
  player can see the shape of their coverage and, more importantly, its gaps.

---

## 7. The opposing commander

Utility-scored, one-ply. Depth is the wrong investment: in a game whose dominant
question is *what do I know*, a shallow planner with a correct model of its own
ignorance plays far more convincingly than a deep one that cheats.

**The AI reads only its own contact picture.** It never iterates the true board
to find the player. This is enforced by test: adding an undetectable enemy must
not change its decisions. A fog game whose AI peeks is not a fog game, and
players detect it within one mission — they notice artillery landing on units
that were never observed.

Difficulty scales evaluation quality (search breadth, score noise, lapse rate),
never information. Lower difficulties make genuine misjudgements rather than
being handicapped mechanically.

---

## 8. Editorial standard for the fiction

Real forces and real equipment in a **fictional flashpoint**, which is the
standard used by every shipped title in this space.

- Combatants are **professional militaries only**.
- Forces are characterised by **doctrine** — how they fight — and by nothing
  else. No ethnic, religious or cultural framing of any opponent.
- No civilian targets, no civilian casualties as a mechanic, no atrocity
  content.
- The scenario is invented and set forward in time. It is **not** a restaging
  of any live conflict, and content should not be written such that it reads as
  commentary on one.
- Both rosters are competent and internally coherent. Neither is a punching bag
  and neither is a villain.

---

## 9. Roadmap beyond the slice

**Near term** — playtest and balance missions 2–3; audio; turn playback
animation; Capacitor packaging for iOS/Android.

**Campaign** — twenty missions across three acts; a theatre map with branching
front lines; research unlocking capabilities rather than stat upgrades.

**Systems** — transport and embarkation; naval surface units (the roster
already carries a `SHIP` class and naval lethality); weather and night, which
the sensor model is built to express; multi-turn resupply.

**Post-launch** — asynchronous PvP, for which the deterministic command-sourced
engine is already the correct foundation: a match is a seed plus a command
list, and the simulation runs unmodified on a server.
