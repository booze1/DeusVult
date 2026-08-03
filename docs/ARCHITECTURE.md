# Architecture

## Dependency direction

```
app  →  ui, render  →  content  →  core
```

Strictly one-way. `src/core` imports nothing from `content`, `render`, `ui` or
`app`. Content injects itself into core through a registry
(`src/core/registry.ts`) rather than being imported by it.

This buys three concrete things:

1. The entire simulation runs headless in Node — which is what makes
   `tools/headless.ts` and automated balance sweeps possible.
2. Rules tests never touch a DOM or a renderer, so they are fast (~1.5s for 64
   tests) and cannot break for presentational reasons.
3. The simulation could be lifted onto a server unchanged if asynchronous PvP
   is ever built.

## Determinism

The engine is deterministic by construction, and this is load-bearing rather
than incidental.

- **All randomness flows through `src/core/rng.ts`.** No `Math.random()` under
  `src/core`.
- **sfc32** (128-bit state) rather than mulberry32: a 32-bit state visibly
  correlates across the many short streams forked per battle.
- **Streams are forked by label.** `fork('combat')` and `fork('ai')` are
  independent, so however long the opponent deliberates, the dice for a given
  attack are unchanged. Without this, replays desync the moment AI search depth
  changes.
- **Attack streams are labelled by participants** (`fire:<attacker>:<target>:<weapon>:t<turn>`),
  so a shot's outcome depends only on game state and the shot itself — never on
  how many other actions preceded it.

A replay is therefore `(seed, Command[])`, a few hundred bytes.

## Command sourcing

`src/core/commands.ts` is the **only** mutation path. Every player and AI
decision becomes a `Command`, is validated, then applied. From this one
mechanism: replays, save/load, headless balance runs, and a straightforward
path to server-side validation.

```
Command → validate → apply → updateContacts → diff contacts → evaluate
          objectives → emit GameEvent[]
```

`GameEvent[]` is the presentation channel. The renderer never inspects state
transitions itself; it is told what happened.

## State shape

`GameState` is a plain object graph with `Map`s — structurally clonable, free
of behaviour, and JSON-serialisable once Maps are flattened to entry arrays
(`serializeState`). A round trip is asserted byte-identical in
`tests/integration.test.ts`.

Notable fields:

- `contacts: Record<Side, Map<UnitId, Contact>>` — each side's *belief*, held
  separately from truth. The renderer draws from this, not from unit positions.
- `designations: Record<Side, Map<UnitId, number>>` — target handoffs, keyed to
  the turn they lapse.
- `rngState` — so a save resumes with the identical random stream.

## Hex geometry

Pointy-top, axial storage `(q, r)`, cube arithmetic with implicit `s = -q-r`.
Pointy-top because tactical maps read wider than tall in landscape and it gives
clean east-west movement lanes.

Coordinates pack into integer keys (`(q+512)*1024 + (r+512)`) for `Map` use —
integer keys hash markedly faster than strings, and pathfinding and sensor
sweeps do a great deal of per-tile lookup.

Line drawing uses the standard Red Blob epsilon nudge so that lines running
exactly along a hex edge break ties consistently, which makes line of sight
**symmetric**. Asymmetric LOS produces situations players correctly read as
bugs; symmetry is asserted by test.

## Rendering

**WebGL board (Pixi v8) + HTML interface.** Text in a scene graph is a constant
fight with accessibility, text scaling, selection and IMEs; the browser already
solves all of that. The board is WebGL, the interface is HTML, each does what it
is good at.

All board art is drawn as vectors rather than sprites, so it stays crisp at any
zoom and pixel density — which suits the tactical art direction and removes an
asset pipeline entirely.

**The renderer draws the viewing side's picture, not the truth.** Enemy markers
are placed at their last *observed* position, which for a stale contact is not
where the unit actually is. The true position of an undetected unit never
reaches the renderer's output.

## AI

`src/core/ai/` — utility-scored one-ply search over enumerated actions, with
per-nation doctrine weights as a data table rather than separate code paths.

The invariant enforced by `tests/integration.test.ts`: **the planner's decisions
are identical whether or not undetectable enemies exist.** All enemy knowledge
goes through `visibleEnemies()` and the contacts book.

The planner returns **one command at a time** rather than a whole turn's plan,
so it can react to what its own first move reveals — which matters enormously
in a fog game.

## Testing

64 tests across five files, no DOM required.

| File | Covers |
| --- | --- |
| `hex.test.ts` | Coordinate maths, key round trips, LOS line symmetry, pixel round trips |
| `rng.test.ts` | Reproducibility, stream forking, modulo-bias freedom, binomial properties |
| `sensors.test.ts` | LOS and elevation, concealment per spectrum, the EMCON asymmetry, jamming, stale contacts |
| `combat.test.ts` | Engagement legality, no-whiff guarantee, preview/resolution agreement, lethality matrix, suppression |
| `integration.test.ts` | The sensor-shooter chain end to end, determinism, save round trip, **AI fairness** |

Browser verification is done with Playwright against the dev server; a
`import.meta.env.DEV`-only probe exposes real marker screen positions so UI
tests do not hard-code pixel coordinates that rot when the camera changes.

## Deliberate omissions

- **No ECS.** Unit counts are in the dozens. A `Map<UnitId, Unit>` is faster to
  read and faster to run at this scale.
- **No state-management library.** Command sourcing already gives a single
  mutation path.
- **No sprite atlas / asset pipeline.** Vector rendering removes the need.
- **No server.** The engine is server-ready; nothing requires one yet.
