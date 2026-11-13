# REPORT — hist-D1: Dungeon Crawler stops writing history (SDK half) — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-hist-D1-w{1,2,3}.md`. **No sdk:build was run.**

## Changed (SDK, `core-catalog/src/genres/dungeon-crawler/` unless noted)
- **`death.ts`:**
  - a death pushes `deceased: {member: "seated-member:<castMemberId>"|seat ref, changes: {nodeState:"deceased"}}`;
  - it appends `progress.fallen {name, where, seat, castMemberId}` (never spent);
  - the Narrator names the death in a sentence of its own;
  - the lane line has no cairn.
- **`lore.ts`:** removed `loreFallen` (story and genesis), `ENTRY_TYPES.fallen`, `MOST.fallen` and `WorldWrites.fallen`. **`scripts.ts`:** no `fallen: null`.
- **`preamble.ts`:** `fallenOf` reads `progress.fallen`; `peopleOf(listing, fallen)` is the people filter; the fallen are listed only in the story turn's crib (AUDIT C7).
- **`story.ts`:**
  - the books script reads `peopleOf` and `cast`;
  - the ledger returns `deceased` and `clock` (re-filed once on a redo) and writes no `crawl-time`;
  - the history `fallen` query is gone;
  - new nodes `channel.story.deaths.deceased.*` (`update-cast-member@1`) and `channel.story.time.clock.*` (`advance-story-clock@1`).
- **Clock:**
  - `storyScripts.ts`: `storyNowClock(now)`, and `addMinutes`/`clockLabel` accept `\d+` digits;
  - `rest.ts`: reads the story now, `rested.clock.*`, and the label "Heal the party";
  - `create.ts`: the `clock` outlet (`to: {hour: 8, day: 'today'}`, cause `action`, `onRefusal: 'skip'`). Every clock move skips on refusal.
- **Scenes:**
  - `names.ts`: `DUNGEON_CRAWLER_SUMMARIZE_SCENE_SPEC_ID`;
  - new `summarizeScene.ts` (`dungeonCrawlerSummarizeSceneSpec`, not yet registered);
  - `registry/genres.ts` DC: `writes: {lore: true, scenes: true}`, `scenes: {triggers: {timeAction: false}}` (★D1-1).
- **Registry and prompt:**
  - `registry/hostState.ts`: the `crawl-time` `time` decl is removed;
  - `registry/slots.ts`: the `crawlTimeSlot` comment says it is retired from writes;
  - `seed/prompts.ts`: "deaths, departures and arrivals among them".
- **`conformance/src/index.ts`:** law **C40** (`historyWriteFindings`, reusing `declaredNodeParams`).
- **Tests:** `dungeonCrawler{Story,,Walk100,Walk3}.test.ts`, `hostState.test.ts`, `conformance.test.ts`.

## Tests (from source)
- `tsc -p sdk-tests`: 0.
- DC, host-state and registry: 128/128.
- Wider run: 231/235.
  - Expected to pass after the build: C40 core and #95 (they read dist).
  - Count pins, handled by the lead's worker: two in `deriveDontSpell`.

## People filter / what D2 stamps
- `peopleOf` drops a character-lore row whose `lorebookBindingId` equals a `progress.fallen` `castMemberId`.
- `dc-cairns` binds each retyped epitaph to the matched member and adds the matching `progress.fallen` item. No extra marker is needed.

## Decisions made inside scope
- `note-scene@1` isn't used: it halts with no open scene, so the Narrator's sentence is the record.
- No story now falls back to the epoch.
- No DC prompt edit for `current-date@1`: no DC prompt read the host-state time line.

## Open ★
- **D1-1:** `timeAction: false`, so a story turn's clock move doesn't put a "New scene?" chip after every round. A chip still appears on a day crossed. This is new-behaviour avoidance (P1).
- Provisional copy: the lane line, the Narrator line, node labels and the crib line (see the hand-back).

## Queued (outside the lane), taken by the lead's worker hist-D1b
1. `deriveDontSpell.test.ts`: data path 169→174, `rest.ts` `($: any)` 19→21.
2. Register the DC summarize-scene spec: `index.ts` `CORE_SPECS`, `defaults.ts` `summaries`, `registry/genres.ts` `summarize.scene`, `seed/prompts.ts` `defaultForSpecs` (×3), and the tests that move.
3. `shared/annexField.ts`: declare `progress.fallen` and fix its description.

After the build:
- re-run conformance;
- re-pin the `coreCatalog` golden;
- core `registryHashes` pins (DC specs, host state);
- core law counts (40).

For D2: `dc-crawl-clock` is required, since an old session's clock otherwise never starts.

## Names for hist-F
- **New:** `progress.fallen`, the ledger/rest `deceased`/`clock`, C40, `core:spec/dungeon-crawler-summarize-scene` and its constant and function, `storyNowClock`, node keys.
- **Retired:** `ENTRY_TYPES.fallen`, `loreFallen`, the `channel.story.fallen` query, the `crawl-time` time decl.
- **Docs:** `genre-dungeon-crawler.md` cairns → the deceased state, scene and compile; `summarization.md` prompt phrase.

## Noticed, not done
- Leftover references to the slot name (`SLOT_IDS.clock`, `SL.clock`, `NOT_FOR_DELTAS`).
- Fixtures still set `crawl-time`.
- `clockLabel` uses Gregorian month lengths.
- `DUNGEON_CRAWLER_LAYOUT` has no scenes panel (where does a DC session review and compile its scenes?).
