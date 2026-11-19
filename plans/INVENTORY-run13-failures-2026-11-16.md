# INVENTORY — full run 13's failures, triaged (lane `fnd-4`, 2026-11-16)

Kinds: **a** a test that pinned behaviour a lane changed on purpose (re-pinned) · **b** real defect · **c** flake.
Paths under `src/lib/server/`. Grouped rerun `plans/fnd-4-3.log`: 13 files, 145/146 (the one is row DC below).
`tsc` 0 (`plans/fnd-4-tsc.log`). Not touched on purpose: `paramsSlotWiring` (D19), `panel/groups` (D20),
`guideGrounding` (D22), `creationModes` "a following session is followed by a following one" (D52(b)).

| File | Test | Cause (lane, file:line) | Kind | Done |
|---|---|---|---|---|
| entries/declarations.test.ts | carries each field's declared default | tl-2d removed history `year` default (SDK) | a | `fieldDefault(history, "year")` `toBe(1)` → `toBeNull()` |
| pipelines/boot/contentAddressing.int.test.ts | 4 tests | ss-2a `config/panel/write.ts:40` static import of `sessions/settingsForm` → `sessionAccess` → `db/index`; `followPresetOnMove` imports `config/named` inside the publish transaction, which started default-db init there | b | import moved to a dynamic `await import` before the transaction in `writeSessionValue`; `config/named` has no static path to `db/index`; test unchanged |
| pipelines/boot/lorebookTriggerControls.int.test.ts | declares none of the four controls nothing read | kn-2a `knownToSpeaker` on every read (read at `bindings.retrieval.ts` 407…1996) | a | `knownToSpeaker` added to the expected set |
| pipelines/boot/retrievalModeCull.int.test.ts | keeps exactly the controls that are read | same | a | `LANE_OWN_PARAMS` and `VECTOR_PARAMS` gain `knownToSpeaker` |
| pipelines/boot/specSlugRename.int.test.ts | an install an earlier build left boots onto the new ids | ss-2a boot pass `boot/sessionOverrideFold.ts` (moved: 1) | a | old override row `[[3,'contextBudget',8.05]]` → none; the value 8.05 asserted in the session's registration values |
| pipelines/runtime/armsSpeaker.int.test.ts | entity-link unwired ×2 | kn-2a: entity-link reads as the scope's speaker when unwired (`bindings.retrieval.ts` ~1985–2000) | a | old list kept under `knownToSpeaker: false`; default with a scope speaker → `[verity, world]` |
| pipelines/runtime/bindings.firsthand.int.test.ts | history-entries ×4 | kn-2a receipt note (`readsAllReceipt`, `firsthandFilter.ts:330`) | a | exact call lists gain the note first; one title "no receipt line" → "no firsthand receipt line" |
| pipelines/runtime/lorebookListing.int.test.ts | 4 tests | fake ctx had no `log` (required: SDK `executor.ts:288`); kn-2a now logs | a | `log: () => {}` on the fake ctx |
| pipelines/runtime/structuralCompat.test.ts | requiresOf one contract | kn-2a `knownToSpeaker` on vector-search params | a | key added |
| pipelines/runtime/host.notesMeet.int.test.ts | with no year … the write files onto it | tl-2d (year now required) × `host.loreWrites.ts` `typedFieldsOf`: a whole-entry check refused `fields: {}` before `historyDateOf` could use the story's day | b | `typedFieldsOf` drops only the `year` finding for a new history entry whose year is unset; test unchanged |
| sockets/lorebooks.entryEdges.int.test.ts | a book holding a dated and an undated version … | tl-2d: fixture `chapter()` wrote yearless history; import skips those, links come back undated and collapse | a (fixture) | `entry()`/`chapter()` take an optional year; test uses `chapter(1)`, `chapter(2)` |
| sockets/sessions.dungeonCrawlerRounds.int.test.ts (DC) | Rest (round 2) one line on the journal folio | tl-2d new sessions start today; SDK `core-catalog/src/genres/dungeon-crawler/storyScripts.ts:115–121` `clockLabel` prints the absolute day since Year 1 (`Day 739445`) | b ★ | left failing: two readings (days since the crawl began / the story date) → owner |
| pipelines/runtime/scoreLedAllocation.int.test.ts | file level (runs 12, 13) | tl-2d: seeded history row has no year; check `entry_fields__core_entry_history__v1` refuses at `:142` (3 solo runs, all failed) | a (fixture), not c | seed gains `year: 1`; 5/5 |
