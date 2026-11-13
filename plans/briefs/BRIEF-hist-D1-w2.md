# BRIEF — hist-D1-w2: Dungeon Crawler scenes on, the create clock, host state, and the conformance law (SDK)

Supervisor: hist-D1. Repo: `/home/jody/github/serene-pub-sdk` (always absolute paths). Plan: `/home/jody/github/serene-pub/plans/PLAN-history-one-per-date-2026-11-10.md` § Build scope items 4 and 6 (everything you need is quoted below).

## Goal

Five small changes, each in its own file set:

1. **Scenes on for the Dungeon Crawler** (registry), with its own `summarizeScene()` spec file written but **not yet registered** (registration sits in files outside this lane; the supervisor queues it).
2. **Create puts the session story clock at 08:00** through `core:outlet/advance-story-clock@1`, instead of writing the crawl's own `crawl-time` slot.
3. **Host state:** the `crawl-time` `time` declaration goes; the slot itself stays registered with a corrected comment.
4. **The shared scene-summary prompt** asks for deaths, departures and arrivals — one phrase.
5. **Conformance law C40:** no pipeline a catalogue ships writes a history entry directly.

## Owner rulings this applies (2026-11-10)

- "Scenes first: DC turns scenes on (`writes.scenes: true` in its registry entry), plus a `summarizeScene()` spec on story channel `main`, the way Lair does (`genres/lair/summarizeScene.ts`; Lair's scene mode, default)."
- The shared scene-summary prompt (`core-catalog/src/seed/prompts.ts` ~350) asks for "deaths, departures and arrivals" among the key beats. **Keep the change to that one phrase**; it applies to every genre's scene summaries.
- Clock (★C1): DC uses the **session story clock** through `advance-story-clock@1`, not its own `crawl-time`. Create → `advance-story-clock@1 { to: { hour: 8, day: 'today' } }`. Remove the host-state `time` declaration for `crawl-time`. **Keep the `crawl-time` slot registered** so old ledger rows still display, and fix its comment: not the story clock; retired from writes 2026-11-10.
- Conformance law (moved here from hist-C): a law over the shipped catalogue saying no shipped pipeline writes history directly — the same predicate as the packager's `W_WRITES_HISTORY`, reusing `declaredNodeParams` from `@serene-pub/sdk` (`sdk/src/document.ts`); `summarize-request` specs exempt. It must pass once the cairn write is gone (another worker, w1, is removing that write in `lore.ts` right now).

## Supervisor decisions you implement (report them as given)

- **★D1-1 (supervisor default, owner to confirm):** DC's story turns will move the clock every round with cause `action`, and a `timeAction` trigger under the default **Suggested** scene mode puts a *New scene?* chip after **every** round. So DC's shape declares `scenes: { triggers: { timeAction: false } }`. Mode stays the default (Suggested); *day crossed* stays on. Comment it in the registry with the reason and "★D1-1, owner to confirm".
- Create's clock outlet: `cause: 'action'`, `onRefusal: 'skip'` (a refused move — e.g. a story already past 08:00 — moves nothing and the create still finishes; every core time step skips).
- The DC summarize-scene spec id: `core:spec/dungeon-crawler-summarize-scene` (pattern NOMENCLATURE §24.7, genre first), constant `DUNGEON_CRAWLER_SUMMARIZE_SCENE_SPEC_ID`, in DC's `names.ts` (the no-import leaf `registry/genres.ts` already imports from). **Do not** add `summarize: { scene }` to the genre, and do not touch `core-catalog/src/index.ts`, `core-catalog/src/genres/defaults.ts`, `core-catalog/src/shared/summarize/*` or any other line of `prompts.ts`: until the spec is registered, DC keeps summarizing with core's `core:spec/summarize-scene` (its defaults already register it).
- Law id **C40**.

## Files owned (edit only these)

- `core-catalog/src/registry/genres.ts` — **the Dungeon Crawler entry only** (`dungeonCrawlerGenre`, ~line 1530+).
- `core-catalog/src/genres/dungeon-crawler/names.ts` — add the spec id constant only.
- `core-catalog/src/genres/dungeon-crawler/summarizeScene.ts` — new.
- `core-catalog/src/genres/dungeon-crawler/index.ts` — add `export * from './summarizeScene.js'` (and nothing else).
- `core-catalog/src/genres/dungeon-crawler/create.ts`
- `core-catalog/src/registry/hostState.ts` — the `crawl-time` `time` decl, its import and the doc lines about it.
- `core-catalog/src/registry/slots.ts` — the `crawlTimeSlot` comment only.
- `core-catalog/src/seed/prompts.ts` — the one phrase only.
- `conformance/src/index.ts` — the new law and its helper.
- `sdk-tests/conformance.test.ts` (C40 tests), `sdk-tests/hostState.test.ts`, `sdk-tests/dungeonCrawler.test.ts` (**only** the create test and the "no lorebook, no lore or scene writes, no scene summary" test). Worker w1 may edit other parts of `dungeonCrawler.test.ts`: re-read the file right before each Edit and never use Write on it.

Never touch `story.ts`, `death.ts`, `lore.ts`, `preamble.ts`, `rest.ts`, `storyScripts.ts`, `journal.ts`, `respond.ts`, `dungeonCrawlerStory.test.ts` (other workers).

## What to build

### 1. registry/genres.ts (DC entry)
- `writes: { lore: true, scenes: true }`. Rewrite the comment above it: `lore: true` (the world in the session's own book) and `scenes: true` (owner ruling 2026-11-10, scenes first: a day's scenes compile into its one history entry; the crawl writes no history itself). The older comment block above says "**No `lorebook`** … No scenes." and "The world is generated and kept in the annex (★A)": correct only the "No scenes." sentence; leave the rest.
- Add `scenes: { triggers: { timeAction: false } }` to the DC `shape` with the ★D1-1 comment. Check it is valid at the genre layer: `sceneSettingsFindings` in `sdk/src/sceneSettings.ts` (keys `mode`, `triggers`, `summary`, `place`, `first`, `castRefresh`; core trigger keys are allowed in a genre's `triggers`).
- Do not add `summarize`.

### 2. names.ts + summarizeScene.ts + DC index.ts
- `names.ts`: `export const DUNGEON_CRAWLER_SUMMARIZE_SCENE_SPEC_ID = 'core:spec/dungeon-crawler-summarize-scene'` with an `@experimental` doc saying it names the crawl's summarize-scene (live scenes §13) and is kept here so the genre can name it without importing the spec.
- `summarizeScene.ts`: modelled on `core-catalog/src/genres/lair/summarizeScene.ts`, but **no transcript template of its own** (the builder's default is used; never edit `shared/summarize/summarizeScene.ts`, lane hist-B3 is editing it), story channel `main`, no asides:
  `summarizeScene(DUNGEON_CRAWLER_SUMMARIZE_SCENE_SPEC_ID, { version: GENRE_SUMMARIZE_SCENE_VERSION, genre: dungeonCrawlerGenre, channels: { story: 'main' } })`, exported as `dungeonCrawlerSummarizeSceneSpec`. Header doc: scenes first (2026-11-10); a death reaches the scene through the Narrator's own sentence; ⏳ not yet registered in the catalogue (`CORE_SPECS`, the genre's defaults, `summarize.scene`, the prompt rows) — until then core's `core:spec/summarize-scene` summarizes the crawl.
- Confirm the build doesn't throw: `summarizeScene` checks the channels against the genre's declared channels.

### 3. create.ts
- Remove `{ owner: 'world', slot: crawlTimeSlot.id, value: DUNGEON_CRAWLER_EPOCH }` from the `rules` changes and the now-unused `crawlTimeSlot` import. **Keep `DUNGEON_CRAWLER_EPOCH` exported** (other files read it as a fallback).
- Add an outlet (after `apply`, before `blank`, or wherever it reads naturally in the chain): `C.advanceStoryClock.v1({ to: { hour: 8, day: 'today' }, cause: 'action', onRefusal: 'skip', params: slot.params() })` — look at `core-catalog/src/shared/timePasses.ts` for the literal-port pattern. `expose: { label: 'Start the story clock at 08:00' }` (report the label as provisional copy).
- Doc: the create header's bullet "and the crawl's clock at its epoch" becomes: the session's story clock set to 08:00 on its first day through `advance-story-clock@1` (a story with no clock yet starts at Year 1, day 1). Fix `DUNGEON_CRAWLER_EPOCH`'s own doc: no longer written; the fallback a turn reads when the session has no story now.

### 4. hostState.ts / slots.ts
- Remove `Object.freeze({ slot: crawlTimeSlot.id, role: "time", genres: [dungeonCrawlerGenre] })` and the `crawlTimeSlot` import; the doc's "its time (`crawl-time`, the crawl's own clock: no lorebook calendar)" goes (the crawl's time is the session story clock since 2026-11-10).
- `slots.ts` `crawlTimeSlot` comment: "⏳ Retired from writes (2026-11-10): the crawl's time was its own clock on the world; it is now the session's story clock (`advance-story-clock@1`). Not the story clock. Still registered so the rows older sessions wrote display." (wording in the file's voice; keep the slot definition itself unchanged).

### 5. prompts.ts
- In the `core:oracle/summarize-batch` row seeded `pipeline-prompt:core:oracle/summarize-batch:prompts:summarize-scene-default` (~line 343-350), change "captures the key beats, actions, and emotional turning points" to "captures the key beats — deaths, departures and arrivals among them — actions, and emotional turning points" (or as close as reads cleanly; one phrase only). Nothing else in the file.

### 6. conformance/src/index.ts — C40
- After C39 (same shape: `id`, `law`, `title`, `consequence`, `async check(host, fx, report)`, skip with a sentence when the host declares no catalogue or the catalogue ships no pipelines — copy C39's two skips).
- `law: 'scenes first (owner ruling 2026-11-10)'`; title e.g. "no pipeline a catalogue ships writes a history entry directly — history is compiled from scenes"; consequence e.g. "A pipeline that files history itself goes around scenes and Compile: its entries land beside the day's one entry, and a person never reviews them as a scene."
- Helper `historyWriteFindings(d: SpecDocument): string[]`: skip a document with any node `definitionId === 'core:inlet/summarize-request'`; else for each node `definitionId === 'core:outlet/create-lore-entry'`, `const t = declaredNodeParams(d, n.key).entryType` and flag when `typeof t === 'string' && t.replace(/@\d+$/, '') === 'core:entry/history'` — the exact predicate of `W_WRITES_HISTORY` in `cli/src/compiler.ts` (~line 1644-1661; read it). Finding text: `${d.id} ${n.key}: writes a history entry directly — put the event in a scene (note-scene@1 or a story line); Compile files it under the day's entry.`
- Doc comment above the helper, as C39's has.

## Tests

- `sdk-tests/conformance.test.ts` (beside the C39 tests, reuse their `node`/`doc` helpers by copying the pattern):
  - `C40 · core’s catalogue` passes, not skipped. **This passes only once w1 has removed the cairn write.** If w1 isn't done when you run it, say so and re-run at the end.
  - `C40 · a pipeline that files a history entry fails naming it; a summarize-request one is exempt; no pipelines skips` — a doc with a create-lore-entry whose default-preset params say `entryType: 'core:entry/history@1'` fails with its id and node key; the same doc plus a `core:inlet/summarize-request` node passes; `entryType: 'core:entry/world-lore'` passes; `shipped()` without pipelines skips.
- `sdk-tests/hostState.test.ts`: the crawl has no `time` role any more (`!crawl.some((d) => d.role === 'time')`), and the crawl-time slot is still registered (find how slots are looked up in that file or `registry.test.ts`, e.g. `getAttributeSlot('core:slot/crawl-time@1')` or the catalogue's slot list).
- `sdk-tests/dungeonCrawler.test.ts`:
  - create test: `rules` no longer carries `core:slot/crawl-time@1` nor the epoch; a node with `definitionId === 'core:outlet/advance-story-clock'` whose config/params carry `to: { hour: 8, day: 'today' }`, `cause: 'action'`, `onRefusal: 'skip'` (look at how other tests read a literal port off a node: `node.config` or `doc.edges`).
  - "no lorebook, no lore or scene writes, no scene summary": now lore and scenes are written (`writes` is `{ lore: true, scenes: true }`), `scenes.triggers.timeAction === false`, and no `summarize` yet. Rename the test to say so.
- Run also `registry.test.ts`, `coreCatalog.test.ts`, `sceneSettings.test.ts`, `summarizeScene.test.ts`, `writes.test.ts`, `coreGenreDefaults.test.ts`. The golden test "core's announcement (golden) — the canonical document is unchanged" in `coreCatalog.test.ts` will move: **don't update its pin** (the supervisor does it once at the end, since other workers move it too); just report the new value it prints.

## Run (capped scope, from source; never pipe into `head`)

```
cd /home/jody/github/serene-pub-sdk/sdk-tests && systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx tsx --test conformance.test.ts hostState.test.ts dungeonCrawler.test.ts registry.test.ts coreCatalog.test.ts sceneSettings.test.ts summarizeScene.test.ts writes.test.ts coreGenreDefaults.test.ts; echo test-exit=$?'
cd /home/jody/github/serene-pub-sdk && npx tsc --noEmit -p sdk-tests
```
All of these passed before you started (supervisor's baseline, 2026-11-10).

## Code style

- Tabs. `registry/*.ts` use double quotes; `genres/*` and `conformance` single quotes — follow each file. `npx prettier --check <file>` to look, never `--write`; don't reformat lines you didn't change.
- Doc comments in the files' own voice (🚧 / ⏳ marks, "owner ruling 2026-11-10").

## Rules (CLAUDE.md, NOMENCLATURE)

- It is a **session**, never a *chat*. No new names beyond: `DUNGEON_CRAWLER_SUMMARIZE_SCENE_SPEC_ID` / `core:spec/dungeon-crawler-summarize-scene`, `dungeonCrawlerSummarizeSceneSpec`, `C40`, `historyWriteFindings`. Any other new name → stop and report. Never reintroduce a retired word.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.
- Never edit outside the files owned; if you need a change elsewhere, stop and report it.

## Stop and ask when

CLAUDE.md §Decisions applies, a ★ is unruled, a name is new, or a migration is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- **Never run `npm run sdk:build`** in this lane at all (the lead builds). Never `git checkout`, `restore` or `clean` in either repo; most of the SDK is uncommitted. **Never run `prettier --write` on a file.**
- Never hand a DOM node to an assertion.
- Scratch files start with `hist-D1-`.

## Done means

`npx tsc --noEmit -p sdk-tests` exits 0, and the test run above passes except the golden pin (report its new value) and `C40 · core's catalogue` if w1 has not finished (say so).

## Report

Your final message is your report: changed files, the exact copy you wrote (labels, the prompt phrase, the law's title and consequence), tests run with results, the golden test's printed value, open ★, **Noticed, not done**.
