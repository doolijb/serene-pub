# REPORT — hist-D2: Dungeon Crawler upgrade passes and core tests — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-hist-D2-w{1,2}.md`.

## Changed files
- **New `sessions/dcCairns.ts`** (+ int test, 7 tests): `dcCairns(db)`.
  - Selects history rows in DC own books matching `^Here lies .+, level N, who fell( in .+)?\.$`.
  - Matches the member by the turn's `fate = dead` row (`valid_from_message_id = source_message_id`), else by a unique name among the session's player seats (removed included).
  - Writes a `deceased` cast version (`writtenBy "dc-cairns"`, `ownAnchor`) and a `progress.fallen` item (under `lockSessionAnnex`).
  - Retypes the row in place: character lore anchored to the member (or the own-book overlay), else world lore "Cairn of ‹name›".
  - One transaction per book. Second boot is a no-op.
- **New `sessions/dcCrawlClock.ts`** (+ int test): copies the latest `crawl-time` into a NULL session clock, verbatim. Second boot is a no-op.
- **`startup/index.ts`:** tasks `dc-cairns`, then `dc-crawl-clock`, after `seat-keys` (`failsHealth`, ⏳ until the RC1 squash). Both keep `sessions.updated_at`.
- **`pipelines/boot/specHashes.test.ts`:** re-pinned the DC create/interview/respond/rest/after-rest and the story/guide summarize-scene specs, plus a new pin for `dungeon-crawler-summarize-scene`.
- **DC tests:**
  - `dungeonCrawlerStory.test.ts` (scripts) and `sessions.dungeonCrawler.int` assert the clock;
  - Walk100 uses the clock;
  - W3: no history row, one `deceased`, a `progress.fallen` item, plus new tests (create at 08:00, the rest's clock, swipe/retake a death).

## Lead fixes after the lane (2026-11-10)
- **★D2-0 (blocker):** `runtime/castMember.ts` `writeCastMember` passes `ownAnchor: true` when a run names its own turn message, so the deceased write isn't "sealed" by the turn's own later death's-door line. This is the same rule clock moves use.
- **SDK `core-catalog/src/shared/annexField.ts`:** `progress.fallen[].castMemberId` was declared a string, but death.ts stores a number. Now a number. The SDK was rebuilt.
- **Result:** W3, Walk100, Walk2, `dcCairns` and `specHashes`: 5 files, 49/49 green.

## Tests (lane)
- Passes: 21/21.
- `sessions.dungeonCrawler.int`: 25/25.
- `specHashes`, `registryHashes`, conformance, `pipelineGenre`, `summarizeScenes`, scripts: green.
- `tsc`: 7 errors in another session's files (`typedSocket.ts`, `templateContext.ts`).

## ★ (lead decisions)
- **D2-1** (widen match step 1): no. Name matching covers real data.
- **D2-2** (pass-written `progress.fallen` not tied to a turn): accepted for migrated data.
- **D2-3** (migrated cairns keep old keys): accepted.
- Copy "Cairn of ‹name›" stays provisional 🚧.

## Names for hist-F (already in NOMENCLATURE via hist-F)
`dc-cairns`, `dc-crawl-clock`, `dcCairns`/`DcCairnsReport`, `dcCrawlClock`/`DcCrawlClockReport`, `written_by "dc-cairns"`.

## Noticed, not done
- Match step 1 rarely hits real data, because fate rows are anchored to the owner's reply.
- Cairns in attached books are untouched.
- A retyped row might be pointed at by a `history_entry_id` (unlikely, since cairns were undated).
- `dc-crawl-clock` re-queries clock-less, crawl-time-less sessions every boot.
- "cairn" remains in some test comments.
