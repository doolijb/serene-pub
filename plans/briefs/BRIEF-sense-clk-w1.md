# BRIEF — lane `sense-clk`, worker 1 — the round tick in the SDK catalogue

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

You are a `lane-worker` under the `sense-clk` supervisor. Repo: `/home/jody/github/serene-pub-sdk` (the SDK, sibling of the app
`/home/jody/github/serene-pub`). Use absolute paths in every command.

## Goal

Add one deterministic core pipeline, **`core:spec/round-tick`**, that moves the session's story clock 5 minutes each time a
round ends, and register it in the defaults of **Story** and **the Lair** only. No model call anywhere in it. The owner's ask
(2026-11-11, verbatim): "lets make it so every 'round' moved the clock forward 5 minutes automatically, with a simple setting
in the sessions that opt in to the clock. Simple setting in the session would suffice. Genres like guide that use real time
would be an exception."

## Files owned (edit only these)

1. NEW `core-catalog/src/shared/roundTick.ts`
2. `core-catalog/src/genres/defaults.ts` — Story's and the Lair's registrations only (plus the imports they need).
3. `core-catalog/src/index.ts` — one `CORE_SPECS` row, one import, one `export * from './shared/roundTick.js'` beside
   `export * from './shared/timePasses.js'`.
4. `sdk-tests/coreGenreDefaults.test.ts` — the parity table and one new test (below).
5. `sdk-tests/coreCatalog.test.ts` — only the announcement digest pin (~line 1063), re-pinned with a dated note.
6. Any other `sdk-tests/*.test.ts` that fails ONLY because Story's or the Lair's defaults gained this one registration, or
   CORE_SPECS gained one row: fix the expectation minimally and list each in your report. Anything else failing: report, do
   not fix.

Readable: everything. Model files: `core-catalog/src/genres/story/afterRest.ts` (a no-model clock move behind a junction),
`core-catalog/src/shared/timePasses.ts`, `core-catalog/src/shared/weather.ts` (a shared `core:spec/<what>` spec),
`core-catalog/src/genres/story/respond.ts` ~1447–1478 (the reply tick: `tick` step exposed to the session, `clock` junction),
`core-catalog/src/genres/dungeon-crawler/story.ts` ~1451–1485 (nested junction + `path` predicate), contracts
`contracts/src/tasks.ts` ~4846 (`core:task/clock-step@1`), `contracts/src/outlets.ts` ~1440–1560 (`advance-story-clock@1`),
`contracts/src/queries.ts` ~1165–1215 (`core:query/cast-presences@1`), `contracts/src/inlets.ts` ~445–520
(`core:inlet/session-event@1`).

## The shape (decided by the supervisor; build exactly this)

`roundTick.ts` exports `ROUND_TICK_SPEC_ID = 'core:spec/round-tick'` (`@experimental`), `ROUND_TICK_VERSION = '1.0.0'`
(`@internal`) and `roundTickSpec` (`@experimental`), with a file docblock in the house style (🚧, what it is, why, what it
owns and does not; say it is NOT the reply tick and NOT *Time passes…*; cite "PLAN-sensible-engine §2.11, owner 2026-11-11").

The graph, in order:

- `.inlet('event', C.sessionEvent.v1(), { suits: [coreEvents.roundEnded] })` — an **event** pipeline (not a routine: no
  Off/Review/Full card), `taxonomy: { role: 'maintenance' }`.
- `.task('tick', ($) => C.clockStep.v1({ params: slot.params() }), { expose: { session: true, label: 'Each round advances the clock by' } })`
  — top level, so its settings address is `tick · params · by`.
- `.junction('clock', { on: ($) => $.tick.moves }, …)` → branch `moves` (`{ truthy: true }`) holding:
  - a query `present`: `C.castPresences.v1({ scope: $.event.sessionScope })` — the read of where the session's story stands.
    Its `at` port is the story date the session reads at (its own clock, else its line's clock), or null when the story has
    no present. (Optional definition: a failed read is empty, so nothing moves.)
  - a nested junction (name it `clocked`) on the query's `at`, branch `at` with `{ truthy: true }`, holding the outlet
    `advance`: `C.advanceStoryClock.v1({ by: $.tick.by, unit: $.tick.unit, cause: 'tick', onRefusal: 'skip', params: slot.params() })`.
    No `otherwise`/default branch (an empty branch is not stored on publish and drifts the document).
- `.defaults((p) => p.params('tick', { by: 5 }))` — By defaults to **5** (the clock step's own default is 0; Unit's is already
  `minutes`).
- `compile(… .build())`.

So: By 0 → `moves` false → nothing read, nothing written. No present → the outlet never runs → **no clock is started and no
ledger line is written** (the host starts a clock on any move today, so this gate is the whole point). Reference syntax inside
nested branches: follow the DC `story.ts` and Lair `reply.ts` patterns; let `tsc` tell you which `$.…` path the builder types.

In `genres/defaults.ts`: one shared lazy registration, used by both genres:

```ts
/** 🚧 The round tick (PLAN-sensible-engine §2.11): Story's and the Lair's; Unit locked to minutes, so a session sees By alone. */
const roundTick = lazy(() =>
	register(coreEvents.roundEnded, roundTickSpec(), {
		values: { tick: { params: { unit: setting('minutes', { lock: true }) } } },
	}),
)
```

then `roundTick: roundTick(),` in `storyRegistrations` (after `afterRest`) and in `lairRegistrations` (after `keeper`), each
with a one-line 🚧 comment. `setting` comes from `@serene-pub/sdk`. Do **not** register it for Chat, the Guide or the
Dungeon Crawler (the crawl's reply already moves the clock by each round's minutes, `dungeon-crawler/story.ts` ~1466). Do not
touch any preset in `seed/presets.ts`.

`CORE_SPECS` row, placed after the `STORY_ADVANCE_TIME_SPEC_ID` row, with a 🚧 comment:
`{ slug: ROUND_TICK_SPEC_ID, name: 'Each round moves the clock', build: roundTickSpec }`.

## Tests (Done means)

In `sdk-tests/coreGenreDefaults.test.ts`:
- `TODAY['core:genre/story'].events` and `TODAY['core:genre/lair'].events` gain `[ev('round-ended')]: 'core:spec/round-tick'`
  (with a dated 🚧 comment line).
- One new test: Story and the Lair each register `core:spec/round-tick` on `core:event/round-ended@1` (family `event`), its
  values lock `tick.params.unit` to `minutes` (`settingValueOf` reads `lock: true`); Chat, the Guide and the Dungeon Crawler
  register nothing on `round-ended` and nothing naming the spec; under every core preset of Story and the Lair it is in the
  effective set. The built document: no node is an oracle (no model call: no `definitionId` starting `core:oracle/`); the
  `tick` node's expose is `{ session: true, label: 'Each round advances the clock by' }`; the shipped default for `tick.params.by`
  is 5 (find how the built document carries `.defaults()` params — e.g. `doc.defaults` — and assert it); the
  `advance-story-clock` node's config has `cause: 'tick'` and `onRefusal: 'skip'`; the outlet sits inside the junction on the
  presences read's `at`, which sits inside the junction on `tick.moves`.
- Re-pin `coreCatalog.test.ts`'s announcement digest: replace the pin and add a comment line above it in the repo's form,
  `// Moved 2026-11-11 (sense-clk, PLAN-sensible-engine §2.11): core:spec/round-tick joins CORE_SPECS, registered on round-ended in Story's and the Lair's defaults with Unit locked. (was 'cf4c379152e8e47a')`.

**How to run the SDK tests against source** (core-catalog's `main` is its `dist`, and you must NOT build): the supervisor made
`/home/jody/github/serene-pub-sdk/sdk-tests/tsconfig.sense-clk.json`, which maps `@serene-pub/core-catalog` to its `src`. Run,
from `sdk-tests/`:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --tsconfig tsconfig.sense-clk.json --test coreGenreDefaults.test.ts coreCatalog.test.ts lair.test.ts modderPass.test.ts dungeonCrawler.test.ts householdAndRoutines.test.ts catalogueParity.test.ts"
```

Also typecheck your new file with the same mapping (e.g. `npx tsc --noEmit -p tsconfig.sense-clk.json` from `sdk-tests/`;
report pre-existing errors as pre-existing, do not fix them). Then `npx prettier --check <file>` on each file you changed
(report drift you did not cause; do not reformat whole files).

## Out of scope (never build)

Contracts (`contracts/src/*`), the SDK (`sdk/src/*`), the app repo, any preset, any new node type / port / event / cause value,
any copy beyond the strings above, docs, NOMENCLATURE. If the builder refuses the shape above, stop and report what it said.

## Stop and ask (in your report) when

A new name, node type, port, event, setting or migration would be needed; the shape above does not compile or the door
(`registrationFindings`) finds a problem you cannot fix inside the owned files; a test outside the owned list fails for a
reason other than the new registration / CORE_SPECS row.

## Verbatim rules

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — For this worker: **do not run `sdk:build` or any `npm run build` at all**; the supervisor builds once.
- Never `git checkout` / `restore` / `stash` in either repo (most of the SDK repo is uncommitted). Never `prettier --write` on a directory.
- No reference to any other project or product in code, comments or tests.
- It is a **session**, never a *chat*. NOMENCLATURE R3: qualify, never the bare noun (say *story clock*, *clock step*, never bare *clock* in an identifier).
- NOMENCLATURE §24 rule 7: "A new pipeline: its id is genre first (`core:spec/<genre>-<what>`, or `core:spec/<what>` when every genre uses it) and its name says what it does, with no genre in it." (The id and name are given above.)
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.

## Report (your final message)

Changed files; the exact test command(s) and pass/fail counts; the old and new digest; every expectation you changed outside
the two named tests and why; anything you could not do; **Noticed, not done**.
