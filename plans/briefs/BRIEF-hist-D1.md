# BRIEF — hist-D1: Dungeon Crawler stops writing history (SDK core-catalog half)

Plan: `plans/PLAN-history-one-per-date-2026-11-10.md`. Read all rulings sections, **§ Build scope item 6**, and the research sections **"★H4 design"** and **"Clocks"**. Read the reports `plans/REPORT-hist-B2-2026-11-10.md` (`update-cast-member@1` now accepts `nodeState`/`nodeVisibility`; `note-scene@1` exists) and `plans/REPORT-hist-C-2026-11-10.md` (`declaredNodeParams`, `W_WRITES_HISTORY`). GO 2026-11-10. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need.

**Two-step lane.** D1 (this brief) edits the SDK **source** only. The lead then runs `npm run sdk:build`; lane supervisors' builds are refused by the permission check. A following lane, D2, does the core data passes and core tests. **Never run `npm run sdk:build`.** Run SDK tests from source: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test <file>`, in the capped scope.

## Rulings this lane applies (owner, 2026-11-10)

- **Dungeon Crawler must stop writing history.** It is the only genre abusing it: an undated cairn per death, plus reading every history entry back as "the fallen".
- **The fallen's record is the cast state** ("There should already be a status we can add to the cast directly"). A death places `update-cast-member@1` with `{ nodeState: "deceased" }` for the fallen seat's cast member, with cause `action` (so a swipe takes it back) and visibility left `normal` (default).
- **"The fallen" for the Planner** comes from a lasting `progress.fallen [{ name, where, seat, castMemberId }]` in the Crawler's progress annex. It is appended in `death.ts` beside `arrivals` and never spent.
- **Scenes first:** DC turns scenes on (`writes.scenes: true` in its registry entry, `core-catalog/src/registry/genres.ts:~1621`), plus a `summarizeScene()` spec on story channel `main`, the way Lair does (`genres/lair/summarizeScene.ts:43`; Lair's scene mode, default).
  - The Narrator must **name a death in its own sentence** (`death.ts:~151`, the `told` instruction).
  - The shared scene-summary prompt (`core-catalog/src/seed/prompts.ts:~350`) asks for "deaths, departures and arrivals" among the key beats. Keep the change to that one phrase; it applies to every genre's scene summaries.
  - A death may also be noted with `note-scene@1` where a scene is open. Use it only if it fits cleanly; otherwise the Narrator's line is the record.
- **Clock (★C1):** DC uses the **session story clock** through `advance-story-clock@1`, not its own `crawl-time`:
  - create (`create.ts:~45,233`) → `advance-story-clock@1 { to: { hour: 8, day: 'today' } }`;
  - story turns (`story.ts:~746-750`) and rests (`rest.ts:~119-121`) → `advance-story-clock@1 { by, unit: 'minutes', cause: 'action' }`;
  - the Planner brief's `clockBase` (`story.ts:~163,217,277`) and the journal line (`journal.ts:~144`) read the session's story now. Find what DC's story graph can reach (the cast source's `storyTime.now`, or `current-date@1`). If neither is reachable, **stop and report**;
  - remove the host-state `time` declaration for `crawl-time` (`hostState.ts:~61`), and have the prompt use `current-date@1`;
  - **keep the `crawl-time` slot registered** so old ledger rows still display, and fix its comment (`slots.ts:~553-558`): not the story clock; retired from writes 2026-11-10.
- **The people listing** (`respond.ts:~84`, "people the party may meet") leaves out anchored character-lore rows that are cairns (the D2 pass turns old cairns into anchored character lore). Simplest: leave out character lore anchored to a fallen or deceased member, or filter by whatever marker D2 will stamp. Coordinate by stating your filter in the report.
- **Remove:** the `loreFallen` junction (`lore.ts:~335-347`), `DUNGEON_CRAWLER_ENTRY_TYPES.fallen` (`lore.ts:~41`), the history `fallen` query (`story.ts:~985-989,1005`), and `fallenOf` reading history (`preamble.ts:~516-575` now reads `progress.fallen`).
- **The conformance law** (moved here from hist-C, challenge 5): a law over the shipped catalogue saying no shipped pipeline writes history directly (the same predicate as `W_WRITES_HISTORY`, reusing `declaredNodeParams` from `sdk/src/document.ts`; `summarize-request` specs exempt). It must pass once the cairn write is gone.
- **Out of this lane: seat benching.** The hero's retire stays as it is; benched seats are a separate plan that comes later. Companion death is also in that later plan.

## Files owned (SDK repo)

- `core-catalog/src/genres/dungeon-crawler/**` (lore, death, story, preamble, respond, create, rest, journal, storyScripts, any new `summarizeScene.ts`)
- `core-catalog/src/registry/genres.ts` (the DC entry only), `core-catalog/src/registry/slots.ts` (the `crawl-time` comment only), `core-catalog/src/registry/hostState.ts` (the `time` decl only)
- `core-catalog/src/seed/prompts.ts` (the one phrase)
- `conformance/src/index.ts` (the new law) and its test
- `sdk-tests/dungeonCrawler*.test.ts`, `sdk-tests/hostState.test.ts`, and any other sdk-test pinning the removed pieces (update only)

## Out of scope (write down, never build)

- Core data passes (`dc-cairns`, `dc-crawl-clock`) and core DC int tests: lane D2, after the build.
- Seat benching, companion death, hero-retire changes (the benched-seats plan).
- `core-catalog/src/shared/summarize/summarizeScene.ts`'s `DEFAULT_TRANSCRIPT_TEMPLATE` (lane hist-B3 is editing it): use the `summarizeScene()` builder, don't edit the template.
- Docs and NOMENCLATURE (hist-F): queue names.

## Stop and ask when

CLAUDE.md §Decisions applies; DC's graph can't reach the story clock; turning scenes on changes behaviour beyond capture and summary (for example automatic scene starts the owner hasn't seen); a name beyond those above is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo; most of the SDK is uncommitted. **Never run `prettier --write` on a file.**
- Never commit. Never `npm test` or `npm run build` at the SDK root. **Never `npm run sdk:build`** (the lead builds).
- Never hand a DOM node to an assertion. SDK tests in a capped scope: `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 <cmd>; echo test-exit=$?'`.
- Scratch files start with `hist-D1-`.

## Done means

- `npx tsc --noEmit -p sdk-tests` exits 0.
- From source, these pass:
  - DC sdk-tests: a Fair death emits the deceased cast change and no history write; `progress.fallen` survives the arrival being spent; a swipe or redo writes nothing twice; the crib reads `progress.fallen`; the clock goes through `advance-story-clock@1`;
  - `hostState.test.ts`;
  - the new conformance law;
  - `coreCatalog`, `conformance` and `registry` tests.
- **No build, no full suite.**

## Report

`plans/REPORT-hist-D1-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include changed files, test results, the exact people-listing filter, the marker D2 should stamp on retyped cairns, names for lane F, open ★, **Noticed, not done**.
