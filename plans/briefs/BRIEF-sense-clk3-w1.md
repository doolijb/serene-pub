# BRIEF — worker `sense-clk3-w1` — the Lair's Words only gets the round tick, and the tick steps aside for the keeper

You are a `lane-worker` under supervisor `sense-clk3`. Repos: app `/home/jody/github/serene-pub`, SDK
`/home/jody/github/serene-pub-sdk`. Use absolute paths. Another session is editing this repo (visual-novel layout
work: dialogue box, layouts); never touch its files. A read-only agent is diagnosing
`src/lib/server/utils/replyRoad.int.test.ts`: do not edit, run or chase it.

## The owner's ruling (2026-11-11, verbatim)

"Routine; Words only uses the round tick (Recommended)" — described to the owner as: "the routine owns the clock where
it runs. Words only, which has no routine, falls back to the deterministic round tick. If a GM later switches the
routine on in Words only, the routine takes over and the tick steps aside."

## What exists (read these lines first; re-read before changing anything)

- `core-catalog/src/shared/roundTick.ts`: `core:spec/round-tick`, an event pipeline on `round-ended`:
  `worth` (`C.roundWorth.v1`) → `tick` (`C.clockStep.v1`) → junction `clock` (on `$.tick.moves`) → branch `moves` →
  query `present` (`C.castPresences.v1`) → junction `clocked` (on `$.present.at`) → branch `at` → outlet `advance`
  (`C.advanceStoryClock.v1`, `cause: 'tick'`, `onRefusal: 'skip'`). Registered by Story only today
  (`genres/defaults.ts` line ~129, `const roundTick = lazy(() => register(coreEvents.roundEnded, roundTickSpec()))`,
  used at ~251 in `storyRegistrations`).
- `core-catalog/src/genres/lair/keeper.ts` + `shared/reckoning.ts` ~892–915: the keeper (`core:spec/lair-keeper`, a
  routine, mode Review in the Lair's defaults, `genres/defaults.ts` ~327) moves the round worth when it names no move
  (`round` branch) and its named move otherwise. When the routine is Off it does not run at all.
- `core-catalog/src/seed/presets.ts` ~165–185: `lairWordsOnlyPreset` — `change: [{ of: r.keeper, mode: "off" }]`.
  `PresetInput.register` (sdk `announce.ts` ~545) is "Registrations this preset adds to the genre's defaults".
- What the session already publishes about routine modes: `SessionSettingsV1.routineModes` (sdk
  `sessionSettings.ts` ~75–83): "The mode of each routine in force, by the pipeline it runs: `off` · `review` ·
  `full`; a pipeline nothing registers as a routine is absent." Read through the existing query
  `C.sessionSettings.v1({ scope })` (`core:query/session-settings@1`, contracts `queries.ts` ~1962, out `main`). The
  app fills it in `src/lib/server/sessions/settings.ts` ~188–195 (keyed by `r.pipeline`, so the key is
  `core:spec/lair-keeper`).
- Junction predicates (sdk `builder.ts` ~1180–1215, `predicates.ts`): `.when(name, { path, equals | equalsPath |
  truthy }, fn)` and `.otherwise(name, fn)` (fires exactly when no other branch fired). `path` is a dotted path read
  by `readPath` (splits on `.`; `core:spec/lair-keeper` has no dot, so `routineModes.core:spec/lair-keeper` reads the
  key). `truthy: false` holds for nothing. An empty branch `(c) => c` builds (sdk-tests `typedBuilders.assert.ts`).

## Tasks

1. **Words only registers the round tick** — its preset's own registration; Rules and The rules decide do not.
   **Amended by the supervisor after your stop (genres/defaults.ts is re-exported, so no new export there):** in
   `lairWordsOnlyPreset` add `register: [register(coreEvents.roundEnded, roundTickSpec())]`, built locally in
   `seed/presets.ts` (import `register` / `coreEvents` from `@serene-pub/sdk` and `roundTickSpec` from
   `../shared/roundTick.js`; no new top-level export in `presets.ts`, which is re-exported too). Before relying on it,
   confirm a second `register(...)` of the same spec in another genre's preset is accepted (the preset validator,
   `presetChangesOf`, conformance C37) — the SDK test in task 4 will show it. `defaults.ts`: no export; update only
   the `lairRegistrations` docblock and the `roundTick` comment (~126) (one or two lines each). Update the Words only
   docblock in `presets.ts`.
2. **Exactly one move per round in every state**, with no new published name and no second writer: inside the
   round tick, after `present`'s `at` branch and before `advance`, add a `C.sessionSettings.v1({ scope:
   $.event.sessionScope })` query and a junction on its `main` with two **empty** branches —
   `{ path: 'routineModes.core:spec/lair-keeper', equals: 'review' }` and the same with `equals: 'full'` — and an
   `.otherwise(...)` branch holding the existing `advance` outlet unchanged. So: keeper Off or absent (Story, Words
   only as shipped) → the tick moves the round worth; keeper at Review or Full → the tick moves nothing and the
   keeper's move is the only one. Choose short node/branch keys (the settings query, the junction, the three
   branches) and list them in your report; they are spec-internal keys, not published names. Do **not** import
   from `genres/` into `shared/roundTick.ts` (cycle risk): write the id as a string literal with a comment naming
   `LAIR_KEEPER_SPEC_ID`, and pin their equality in the SDK test (task 4). Update the docblock at the top of
   `roundTick.ts` (why the third gate exists, in two or three sentences). If the validator refuses empty branches or
   the path, **stop and report** with the exact refusal; do not invent a new predicate, port or parameter.
3. Grep the app and SDK for node keys `clock.moves.clocked.at.advance` / `at.advance` / `advance` of the round tick
   in tests or code (the outlet's qualified key moves under the new junction) and report every hit; update only
   hits inside your owned files.
4. **SDK test** `sdk-tests/coreClockOwners.test.ts`: Words only → `['core:spec/round-tick']` (replace the ★ comment
   and its `[]` assertion); add a test that the round tick holds a `core:query/session-settings` node and that the
   literal key it reads equals `LAIR_KEEPER_SPEC_ID` (export it if it is not reachable from `@serene-pub/core-catalog`
   — check first; it is likely already exported via `export *`). Keep the existing Story / Rules / DC cases green.
5. **App int test** `src/lib/server/pipelines/routines/clockOwners.int.test.ts`: add a `wordsOnly` table
   (`table("core-lair-words-only", { primaryRuleset: "core:ruleset/vis-itineris@1" })` — check the seed key in
   `seed/presets.ts` `seedOf(stored("lair-words-only"), "core-lair-words-only")`) and two cases:
   (a) Words only, keeper Off: one round → exactly one clock row, `by: 5`, `cause: "tick"`, applied, clock 09:05; no
   keeper run; a `core:spec/round-tick` run happened. Wait for the round tick's run to end (the `playRound` helper
   takes the routine slug; pass `ROUND_TICK`).
   (b) Words only with the keeper switched on (the same `upsertRow(rowOfChange({ key, mode: "review" }, …))` pattern
   as the last existing case): one round → exactly one clock row (the keeper's round-worth move, `by: 5`,
   `cause: "tick"`), clock 09:05, not 09:10. Wait for both the keeper's and the round tick's runs to end before
   asserting. Update the file's header comment. Use 180 s timeouts as the file does.
6. **Docs, one sentence each** (replace the sentence that says nothing moves the clock under Words only):
   - `docs/genre-lair.md` line 160's last sentence ("With **Keep the books** Off, as it is under **Words only**,
     nothing moves the clock by itself.") → under Words only, with the routine Off, the pipeline **Each round moves
     the clock** moves it by the same setting; switch the routine on and it takes over.
   - `docs/lorebook-time.md` line 110 ("If **Keep the books** is Off, nothing moves the clock by itself.") → the same
     fact in one sentence.
   - `/home/jody/github/serene-pub-sdk/guides/time.md` ~207–211 ("Core has two readers…"): one sentence that Words
     only registers the round tick, and the tick steps aside while `routineModes['core:spec/lair-keeper']` is
     `review` or `full`.
   Plain, short sentences; the UI names in bold as the docs do. Mark nothing as built that is not.
7. **Build once, then pins.** After all SDK source edits: run `pgrep -af "vite dev"`; if a serene-pub dev server is
   up, do not build — report "blocked on your dev server". Otherwise `cd /home/jody/github/serene-pub && npm run
   sdk:build` once. Then run (from `/home/jody/github/serene-pub-sdk/sdk-tests`, `npx tsx --test <file>`):
   `coreClockOwners.test.ts`, `coreCatalog.test.ts`, `coreGenreDefaults.test.ts`, `guides.test.ts` and
   `guideSnippets.test.ts` if they exist. Then the app tests (capped, below): `clockOwners.int.test.ts`,
   `roundTick.int.test.ts`, `roundWorth.genres.int.test.ts`, `src/lib/server/pipelines/boot/specHashes.test.ts`,
   `registryHashes.test.ts`. Re-pin a moved hash/digest only with a dated note naming lane `sense-clk3`
   (`2026-11-11, sense-clk3: Words only registers the round tick; the tick steps aside while the Lair keeper runs`),
   as the files already do. **If a pin moves for a spec this lane did not touch** (the other session edits the SDK),
   do not re-pin it: report it. If a fix needs another SDK source edit after the build, make it, rebuild once more,
   and say so.
8. `npx prettier --check <file>` on each file you changed (report results; do not reformat whole files that were
   already unformatted — compare with how they stood).

## Files owned (edit only these)

- SDK: `core-catalog/src/seed/presets.ts` (the Words only preset only), `core-catalog/src/shared/roundTick.ts`,
  `core-catalog/src/genres/defaults.ts` (the export and the two docblocks), `sdk-tests/coreClockOwners.test.ts`,
  `sdk-tests/coreCatalog.test.ts` (pins only), `guides/time.md` (one sentence).
- App: `src/lib/server/pipelines/routines/clockOwners.int.test.ts`, `src/lib/server/pipelines/boot/specHashes.test.ts`
  and `registryHashes.test.ts` (pins only), `docs/genre-lair.md`, `docs/lorebook-time.md` (one sentence each).

## Files readable

Anything. Not editable: everything else, including `NOMENCLATURE.md` (the supervisor writes it), `keeper.ts`,
`reckoning.ts`, `registry/genres.ts`, `host.ts`, `sockets/sessions.ts`, `db/schema.ts`.

## Out of scope

The keeper's own behaviour; Story's reckoning (★CLK2-3); the Dungeon Crawler; any new contract, port, query, event,
setting, migration; UI; `replyRoad.int.test.ts`.

## Stop and ask (in your report) when

A new published name, port, predicate kind, parameter or setting would be needed; the validator refuses the junction;
a pin moves for something you did not touch; anything outside the owned files must change.

## Done means

Tasks 1–6 built; the SDK tests and app tests in task 7 pass (report counts); `tsc` for the app
(`cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`)
is clean or its errors are shown to be another lane's.

## Report (your final message)

Changed files per repo; the node/branch keys chosen; the grep hits of task 3; every pin moved (old → new) and any you
refused to move; tests run with counts; prettier results; anything that surprised you; Noticed, not done.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  It is a **session**, never a *chat*. Every session has a lorebook (its own book, or an overlay): never write "no
  lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
  `npx prettier --check <file>` on each file you changed. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** A review row marked "? inferred" is yours to confirm first;
  if it turns out false, report that and do not "fix" it.
