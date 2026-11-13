# BRIEF — worker `sense-scn-w1` — the SDK half of the scenes routine

Supervisor: lane `sense-scn` (brief `plans/briefs/BRIEF-sense-scn.md`). You type; the supervisor decides. Report back
as your final message (no report file): changed files, tests run with results, every pin/digest that moved
(recorded vs code), anything you could not do, **Noticed, not done**.

## Goal

A genre that wants scenes handled registers a **scenes routine**: code only, no model, run every few rounds. You
build the SDK side: a new cadence, the query's contract, an optional in-port on the existing scene-cue outlet, the
routine's spec, its registration in three core genres, Story Minimal dropping it, three `scenes.mode` declarations,
one stale header comment, and SDK tests. The app side (the host binding that answers the query, the outlet's host
code) is another worker's; you do not touch `/home/jody/github/serene-pub/src`.

## Files owned (edit only these; all under `/home/jody/github/serene-pub-sdk/`)

- `sdk/src/cadences.ts`
- `contracts/src/queries.ts` (the new query), `contracts/src/outlets.ts` (the outlet's new optional in-port)
- NEW `core-catalog/src/shared/sceneBoundaries.ts`
- `core-catalog/src/index.ts` (one `CORE_SPECS` entry, one export line, one import)
- `core-catalog/src/genres/defaults.ts`
- `core-catalog/src/registry/genres.ts` (three `scenes` objects only)
- `core-catalog/src/seed/presets.ts` (Story Minimal's `drop` and its doc comment only)
- `core-catalog/src/genres/dungeon-crawler/summarizeScene.ts` (header comment ~lines 7–10 only)
- SDK tests: `sdk-tests/cadences.test.ts`, `sdk-tests/coreGenreDefaults.test.ts`, and a NEW
  `sdk-tests/coreSceneBoundaries.test.ts`. If an existing SDK test enumerates core cadences or CORE_SPECS by count
  or by list and goes red because of your addition, you may update that list in that test file; name each in your
  report.

## Files readable

Anything. Read first: `core-catalog/src/shared/roundTick.ts` (a code-only spec), `core-catalog/src/genres/story/sweep.ts`
(a routine spec: `C.routine.v1()` inlet, `taxonomy: { role: 'maintenance' }`, `expose`), `core-catalog/src/genres/story/reckon.ts`
~535–552 (how `C.proposeSceneCue.v1` is wired from json parts), `core-catalog/src/genres/dungeon-crawler/secrets.ts`
~135–165 (an `.each(…)` over a json list with `textPart(… $[ITEM] …)`), `core-catalog/src/shared/calls.ts` (`wiring`,
`applyWiring`, `jsonPart`, `textPart`), `sdk/src/builder.ts` ~961–977 (`.each(id, { over, max, mode })`),
`contracts/src/queries.ts` ~1210–1260 (`roundWorth`, a sibling query), `contracts/src/outlets.ts` ~775–842
(`ProposedSceneCue`, `proposeSceneCue`), `sdk/src/cadences.ts` ~590–640, ~768–780, ~937–945, ~1226–1250.

## What to build

### 1. The cadence `core:cadence/every-n-rounds@1` (`sdk/src/cadences.ts`)

Beside `EVERY_N_TURNS` / `AFTER_EACH_ROUND`:

```ts
/** @experimental */
export const EVERY_N_ROUNDS = defineCadence({
	id: 'core:cadence/every-n-rounds@1',
	i18n: {
		name: { en: 'Every few rounds' },
		description: { en: 'Runs after every so many rounds of the session.' },
	},
	options: {
		n: { type: 'integer', min: 1, max: 1000, default: 2, label: { en: 'Every how many rounds' } },
	},
	wakesOn: [ROUND_ENDED_EVENT],
	carries: ['session'],
	evaluate: HOST,
})
```

- `coreCadences.everyNRounds: EVERY_N_ROUNDS` (after `everyNTurns`); the heading comment "Core's ten" becomes eleven.
- Builder beside `everyNTurns`: `export const everyNRounds = (o: { n: number }): CadenceRef => freezeRef(EVERY_N_ROUNDS.id, { n: o.n })` (copy `everyNTurns`'s exact form and doc comment style).
- `cadenceDue`: a case mirroring `EVERY_N_TURNS` on the round-ended event: due when `m.round >= 1 && m.round % n === 0`
  (`n` defaulting to 2 when not a whole number ≥ 1), else `no(state, \`round ${m.round} is not a multiple of ${n}\`)`.
- Grep `sdk/src` for other places that list core cadences by id (e.g. `TURN_OR_ROUND_CADENCES`, `events.ts`,
  `registrations.ts`) and report what you find. Add `every-n-rounds` to such a list only if the list's own rule
  plainly covers it; otherwise report it under Noticed and leave it.

### 2. The query contract `core:query/scene-boundaries@1` (`contracts/src/queries.ts`)

Beside `roundWorth`. Export an interface and the pinned definition (copy `roundWorth`'s shape and doc style; every
name is 🚧 provisional, mark it so in the doc comment):

```ts
/** 🚧 One scene boundary the scenes routine found: the line it begins at, the trigger that fired there, and its words. @experimental */
export interface SceneBoundary {
	/** The message id the new scene begins at. */
	at: number
	/** The boundary trigger that fired there: a core trigger key (`dayCrossed`, `placeChanged`, `timeAction`, `opening`, …) or a genre's declared one. */
	trigger: string
	/** What the trigger says, as the chip and the divider say it ("the day changed"). */
	reason: string
}
```

`export const sceneBoundaries = pin(describeQueryDefinition({ id: 'core:query/scene-boundaries@1', i18n: { name: { en: 'Where scenes begin' } }, timeoutMs: 5000, slots: { params: { kind: 'parameters', facet: 'behavior', schema: { depth: { type: 'integer', default: 2, min: 1, max: 50, label: { en: 'Rounds it waits' }, description: { en: 'Only lines at least this many rounds old are read, so a line that is swiped, retaken or taken back is never read.' } } } } }, ports: { in: { scope: S.sessionScope, routine: S.json }, out: { main: S.json } } }))`

Doc comment must say, in sentences (adapt; keep it accurate):
- It walks the session's `main` channel's standing lines up to the newest line that is at least `depth` rounds old
  (a round as the turn order counts it), evaluates the session's enabled boundary triggers line by line, and returns
  `SceneBoundary[]` in line order. **A query writes nothing.**
- Where the walk starts is derived, never stored: after the latest of the channel's latest scene boundary, its latest
  decided or offered scene cue, and a branch's last copied line. `routine` is the routine inlet's `routine` port (the
  firing); its cadence's `n` bounds how far back a session with none of those looks.
- ⚠ Not the judged scene check (the sweep's model question) and not `propose-scene-cue@1` (which places).

Check how `describeQueryDefinition` takes `slots` (find a query in the same file that declares a `params` slot) and
follow that exactly. If a query may not declare a params slot, stop and report.

### 3. The outlet's optional in-port (`contracts/src/outlets.ts`, `proposeSceneCue`)

Add one in-port to `ports.in`, after `reason`:

```ts
/**
 * 🚧 The boundary trigger the cue is for. Absent or blank: `judged` (the judged scene check's, as before).
 * The scenes routine (`core:spec/scene-boundaries`) passes the trigger that fired at `at`; a cue already at
 * that line for that trigger (a time action's marker) is the one offered or placed.
 */
trigger: S.text,
```

Update the definition's doc comment by one sentence saying the same. **Change nothing else about the outlet**: no
port removed, renamed or made required, no param changed. (An existing node's required inputs must not change: that
is a stop condition.)

### 4. The routine's spec (NEW `core-catalog/src/shared/sceneBoundaries.ts`)

```ts
export const SCENE_BOUNDARIES_SPEC_ID = 'core:spec/scene-boundaries'   // @experimental
export const SCENE_BOUNDARIES_VERSION = '1.0.0'                          // @internal
export const sceneBoundariesSpec = () => compile(...)                    // @experimental
```

Shape, in order:
- `spec(SCENE_BOUNDARIES_SPEC_ID, { version, taxonomy: { role: 'maintenance' } })`
- `.inlet('input', C.routine.v1(), { suits: [coreEvents.roundEnded] })`
- `.query('find', ($) => C.sceneBoundaries.v1({ scope: $.input.sessionScope, routine: $.input.routine, params: slot.params() }), { expose: { label: 'Where scenes begin', status: 'Looking for where scenes begin', purpose: 'Every few rounds, looks a couple of rounds back for where the day or the place changed, or another moment chosen under Scenes, and begins a scene there, or suggests one under Suggested. It asks no model.' } })`
  (Do NOT set `expose.session: true`: `depth` is not a member setting.)
- an `.each('boundary', { over: ($) => $.find.main, max: 20, mode: 'sequential' }, (m) => …)` whose item chain pulls
  `at` (json), `trigger` (text) and `reason` (text) out of `$[ITEM]` with `jsonPart` / `textPart` (the
  `secrets.ts` pattern), then `.outlet('place', ($) => C.proposeSceneCue.v1({ at: …, channel: 'main', reason: …, trigger: …, params: slot.params() }), { expose: { label: 'Mark the new scene' } })`.
  If `channel` cannot take a literal string, pass it the way other specs pass a constant channel and say how.
- `.defaults((p) => applyWiring(p, w))` if the parts need their wiring applied (they do in `secrets.ts`'s spec;
  check how that spec applies `w`).
- `.build()`.

Module doc comment (adapt, keep accurate, mark 🚧): what it is (the scenes routine: code only, no model; runs on a
cadence; core genres every 2 rounds, depth 2); what it owns (finding and placing scene boundaries a couple of rounds
late, through the existing outlet, one at a time in line order); what it does not own (a person's Start scene / End
scene / Mark as scene, which stay immediate; the judged scene check, the sweep's; scene summaries; the open scene's
cast refresh); a genre or preset that does not register it gets no automatic scene boundaries. ⚠ Not the round tick
(an event pipeline, not a routine).

### 5. Catalogue entry (`core-catalog/src/index.ts`)

Import `SCENE_BOUNDARIES_SPEC_ID, sceneBoundariesSpec`, `export * from './shared/sceneBoundaries.js'` beside
`roundTick`'s, and a `CORE_SPECS` entry right after the round tick's:
`/** 🚧 The scenes routine (owner 2026-11-12): Story's, the Lair's and the Dungeon Crawler's, every 2 rounds, no model. */ { slug: SCENE_BOUNDARIES_SPEC_ID, name: 'Find where scenes begin', build: sceneBoundariesSpec },`

### 6. Registrations (`core-catalog/src/genres/defaults.ts`)

- A shared lazy registration like `roundTick` (~line 130):
  `const sceneBoundaries = lazy(() => register(everyNRounds({ n: 2 }), sceneBoundariesSpec()))` with a one-line 🚧
  doc comment (the scenes routine, every 2 rounds; depth is the query's declared default, 2).
- Add it as `scenes: sceneBoundaries(),` to `storyRegistrations`, the Lair's and the Dungeon Crawler's registration
  objects (each with a short doc comment). **Chat and Guide register nothing.**
- Import `everyNRounds` from `@serene-pub/sdk` with the others.

### 7. Story Minimal drops it (`core-catalog/src/seed/presets.ts` ~line 62)

`drop: [r.reckoning, r.sweep, r.illustrate, r.scenes]`. Update Minimal's doc comment ("the three routines dropped"
→ four, naming the scenes routine). Do NOT change Minimal's `description` copy or `callsPerTurn`. No other preset
changes.

### 8. `mode: 'automatic'` in three genres (`core-catalog/src/registry/genres.ts`)

- Story ~604: `scenes: { mode: "automatic", place: { stateKey: "location" }, first: true, castRefresh: true }`
- Lair ~1300: `scenes: { mode: "automatic", place: { stateKey: "location" } }`
- Dungeon Crawler ~1653: `scenes: { mode: "automatic", triggers: { timeAction: false } }`. Its comment block above
  (★D1-1) speaks of "the default Suggested mode": rewrite that comment in one or two sentences so it is true (the
  crawl begins scenes by itself through the scenes routine; time action stays off because each round moves the
  clock; day crossed stays on).
- Add to each a short comment: begins scenes by itself through the scenes routine (owner 2026-11-12); a session's
  own setting still wins. Triggers otherwise unchanged.

### 9. Stale header (`core-catalog/src/genres/dungeon-crawler/summarizeScene.ts` ~7–10)

The "⏳ Not yet registered in the catalogue …" sentence is stale (the genre's defaults register it through
`summaries(dungeonCrawlerSummarizeSceneSpec())` in `defaults.ts`). Verify that in the code, then replace the
sentence with a true one (registered in the Dungeon Crawler's defaults as its summarize-scene). If it is in fact not
registered, change nothing and report it.

### 10. SDK tests

- `sdk-tests/cadences.test.ts`: `everyNRounds({ n: 2 })` through `simulateCadence` over round-ended events for
  rounds 1–6 fires at rounds 2, 4, 6 only (build the events by hand: `{ event: ROUND_ENDED_EVENT, round: r }`); a
  turn-ended event never wakes it; `coreCadences.everyNRounds` exists.
- `sdk-tests/coreGenreDefaults.test.ts` (or the new file, your choice; say which): Story, the Lair and the Dungeon
  Crawler defaults hold a registration of `core:spec/scene-boundaries` on `every-n-rounds` with `n: 2`; Chat and
  Guide hold none; Story Minimal's effective registrations do not include it; Story Living and Rule Based and every
  Lair preset and the Dungeon Crawler's do; the three genres' `shape.scenes.mode` is `'automatic'`; the existing
  `callsPerTurn` assertion still holds (the routine makes no model call).
- NEW `sdk-tests/coreSceneBoundaries.test.ts`: the compiled spec is a `maintenance` routine on the routine inlet;
  its query node is `core:query/scene-boundaries@1` with `depth` defaulting to 2 and reading `scope` and `routine`
  from the inlet; its outlet is `core:outlet/propose-scene-cue@1` inside a **sequential** each clause over the
  query's `main`, with `at`, `reason` and `trigger` wired; the query node exposes a `purpose`; the spec has no
  oracle node. And: the outlet definition's `trigger` in-port exists and nothing about its other ports changed
  (`at`, `channel`, `reason`).

Look at how the existing tests in those files import (they import the **built** packages), and follow them.

## Rules (verbatim; binding)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` anything. It is a **session**, never a *chat*. Every session has a
  lorebook: never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** Line numbers are approximate.
- NOMENCLATURE R3 (qualify, never the bare noun: write "scene cue", "boundary trigger", never bare "cue"/"trigger"
  in prose a reader meets) and R6 (mark every new name 🚧 provisional). Never write "lane" for a message channel in
  anything you add ("lane" survives only where existing code already says it).
- Core runs the SDK executor and never reimplements the scheduler: you only declare; nothing here runs anything.
- Removing or renaming a published SDK name is the owner's call: you add only.

## Build and test (in this order, once)

1. When every edit is done: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p .` is not needed
   separately; instead check `pgrep -af "vite dev"` and `pgrep -af "vitest|tsx --test"`. If either shows a
   serene-pub process, do not build: report "blocked on your dev server" (or "blocked: tests running") with the
   output.
2. Otherwise, from `/home/jody/github/serene-pub`: `npm run sdk:build` (it builds the sibling repo). It must exit 0.
3. Then run only your SDK test files, capped:
   `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test cadences.test.ts coreGenreDefaults.test.ts coreSceneBoundaries.test.ts"`
   plus any SDK test file you changed. Then run `coreCatalog.test.ts` and `presets.test.ts` and `presetsAsChanges.test.ts`
   the same way and report results: pin/digest tests going red because a document moved is **expected**: do not
   re-pin; report each recorded-vs-code pair verbatim. Any other red: fix if it is yours, else report.
4. If you must edit SDK files after the build, rebuild once more (same checks) before re-running tests, and say so.
5. `npx prettier --check <file>` on each file you changed (from the repo the file is in).

## Stop and ask (stop, report the options, do not choose) when

- a required input of an existing node would change, or a published name would be removed or renamed;
- `describeQueryDefinition` cannot take a params slot, or `.each` cannot run sequentially over a query's json list;
- a preset cannot drop the routine the way Minimal drops the sweep;
- you think you need any new name beyond those listed here.

## Done means

All edits above; `npm run sdk:build` exit 0; `cadences.test.ts`, `coreGenreDefaults.test.ts`,
`coreSceneBoundaries.test.ts` green; the other runs reported with every pin pair; prettier clean on changed files.
