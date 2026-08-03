# DEUS VULT

**Modern combined-arms hex tactics on the First Island Chain.**

A turn-based tactics game in which your weapons reach much further than your
eyes do, and the whole of your job is closing that gap before the other side
closes theirs.

> This repository is a **vertical slice**: a complete, tested rules engine, a
> fog-respecting AI opponent, a playable WebGL client, three authored missions,
> and a persistent campaign layer. It is not a finished game — see
> [Status](#status).

---

## The idea in one paragraph

In modern combat, finding a target is harder than killing it. Once something is
located precisely enough, a weapon is almost always available to service it.
So this game separates the two: **sensors and shooters are different units.** A
reconnaissance team sees seven hexes and cannot hurt anybody. A missile battery
reaches sixteen hexes and sees three. Neither can do the other's job, and the
game is the act of connecting them — while the opponent tries to do the same,
and to break your connections first.

The second rule follows from the first: **active sensing is a trade.** Switching
on a radar buys long-range detection and simultaneously broadcasts your position
to every passive receiver in the theatre, usually further than the radar itself
reaches. Emissions control is a decision you re-make every turn.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Typecheck and produce a production bundle |
| `npm run build:single` | One self-contained `dist-single/index.html`, no external requests |
| `npm test` | Full test suite (64 tests) |
| `npm run typecheck` | Types only |
| `npm run sim` | Headless mission runner / balance sweep |
| `npm run smoke` | Browser smoke test — drives the full designate-then-strike loop |
| `npm run smoke:mobile` | Same, under iPhone emulation in both orientations |

## Playing on a phone

The client is built mobile-first and is verified under iPhone emulation in
portrait and landscape on every change (`npm run smoke:mobile`). **Landscape is
the better orientation** — the board gets roughly 70% of the screen against 55%
in portrait.

Three ways to get it onto a device:

1. **Over your local network** — best for iterating, since hot reload works:
   ```bash
   npm run dev -- --host       # prints a Network: http://192.168.x.x:5173 URL
   ```
   Open that URL on a phone on the same Wi-Fi.

2. **A single file** — `npm run build:single` produces one ~610 kB
   `dist-single/index.html` with all JavaScript, CSS and the icon inlined and
   **zero network requests**. Host it anywhere static, or open it directly.

3. **As a hosted page** — `node tools/make-artifact.mjs` converts that build
   into a content-only fragment for hosts that supply their own document
   skeleton.

Touch handling covers tap, drag-to-pan and pinch-to-zoom. Renderer resolution
is capped at 2× regardless of device pixel ratio: a 3× display triples fragment
cost for a difference nobody can see on vector art, and drains the battery
doing it. The WebGL backend is pinned explicitly rather than left to
auto-detection, because WebGPU availability on iOS Safari is still version- and
flag-dependent.

### Playtest builds

Production bundles ship no debug surface. Append `?probe=1` to expose a
read-only hook (`window.__deusvult`) that reports unit positions and game
state — which is how the automated UI tests avoid hard-coding pixel
coordinates that rot whenever the camera changes.

The headless runner plays complete missions with no renderer, which is what
makes automated balance work possible:

```bash
npm run sim                          # one run of every mission
npm run sim -- m01_first_light 200   # 200 runs of one mission
```

## What is implemented

- **Deterministic rules engine** — seeded PRNG, command-sourced mutation, full
  save/load round trip. A replay is a seed plus a command list.
- **Sensor model** — five modalities (optical, thermal, radar, ELINT, acoustic),
  four contact tiers, line of sight with elevation, terrain concealment per
  spectrum, jamming, decoys, and emissions control.
- **Combat model** — binomial volume-of-fire resolution with suppression,
  a lethality matrix across five armour classes, reaction fire, and area fire
  that requires no contact at all.
- **AI opponent** — utility-scored planning over enumerated actions, driven by
  per-nation doctrine profiles, operating **strictly on its own contact
  picture**. A test asserts its decisions are unchanged by the existence of
  enemies it cannot detect.
- **Campaign layer** — a persistent task force tracked by callsign, veterancy
  that accumulates, permanent losses, and reconstitution that costs requisition
  and returns a green crew.
- **Client** — WebGL board (Pixi), HTML interface, touch and mouse input with
  pan/pinch/zoom, threat and sensor-coverage overlays, and a fire preview that
  shows the damage *distribution* before you commit.

## Repository layout

```
src/core/        Pure simulation. No DOM, no rendering, no content imports.
  hex.ts           Hex mathematics (pointy-top, axial, cube arithmetic)
  rng.ts           Deterministic PRNG (sfc32) and binomial helpers
  sensors.ts       Detection, line of sight, EW — the signature system
  combat.ts        Binomial fire resolution and suppression
  commands.ts      The only mutation path; command + event types
  pathfind.ts      Dijkstra over movement points, fog-aware zone of control
  ai/              Opposing commander and doctrine tables
  campaign.ts      Operational layer, veterancy, requisition
src/content/     Data: nations, unit roster, missions
src/render/      Pixi board renderer, palette, symbology
src/ui/          DOM heads-up display
src/app/         Screen flow and input
tests/           Vitest suite
tools/headless.ts  Balance runner
docs/            Design, architecture and balance documentation
```

The dependency direction is strictly one-way: `app → ui/render → content →
core`. `src/core` imports nothing from the other directories, which is what
lets the entire simulation run headless in Node and would let it run on a
server unchanged.

## Fiction

Real forces and real equipment in a **fictional flashpoint** — the standard
used by *Wargame*, *Broken Arrow* and *Command: Modern Operations*. Nations are
characterised by doctrine, meaning the way a force fights, and by nothing else.
Combatants are professional militaries only. There are no civilian targets and
no ethnic or religious framing of any opponent. Both rosters are competent;
neither is written as a villain.

## Status

Three missions of a campaign designed for twenty. Known gaps, honestly stated:

- **Missions 2 and 3 are not yet balanced.** Under AI-vs-AI self-play mission 1
  wins ~75% of the time, but missions 2 and 3 lose. They are tuned against a
  human solving a specific puzzle, and self-play is a poor proxy for that; both
  need real playtesting. See `docs/BALANCE.md`.
- **No audio.** No sound design or music of any kind.
- **No animation between turns.** The opposing turn resolves instantly and is
  reported through the log rather than played back.
- **Capacitor packaging is specified but not wired up.** The client is a
  responsive web build; the native iOS/Android shell is not yet in the repo.
- **Reinforcements** are implemented in the session layer, but only mission 3
  uses them.

## Licence

Unlicensed / all rights reserved, pending a decision by the project owner.
