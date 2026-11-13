# REPORT — lane `sense-doc` — 2026-11-11

Written by the lead from the supervisor's final message. Words only: docs, comments, the two ledgers, and the
leftover-pick strings. No behaviour changed.

## Done

1. **The storage page for modders** (`../serene-pub-sdk/guides/storage.md`): one list of three story homes (Messages;
   the annex with `session` and `lorebook` scopes; the lorebook, including stats) and two outside the story (plugin
   files, "for hidden state only"; the user annex). A table "What happens to each home" with the eight rows of plan
   §1.3, **filled with today's behaviour**, a "Where a lorebook write lands" paragraph and five exception bullets.
   Each cell is backed by code (file:line in the supervisor's message; chiefly `sockets/sessions.ts:9326,9962`,
   `sessions/rewind.ts:646`, `pipelines/runtime/host.ts:9842,1964-1983`, `lorebooks/imprints.ts:16-37`,
   `state/write.ts:674-720,807-830`, `lorebooks/ownBook.ts:330-355,457-488`, `scenes/liveScenes.ts:178-184`,
   `sessions/branch.ts:167-175`, `state/reading.ts:583-598`).
2. **Defaults** corrected: lorebook writes default to **Full** (`docs/system-settings.md:66`, `docs/stats-and-states.md:212`).
3. **The contradicting Back sentences** reconciled in `docs/sessions.md`, `docs/lorebooks.md`, `docs/stats-and-states.md`.
4. **Close-out's four triggers** named in `docs/sessions.md`: the menu action, Archive, Catch up, next-chapter creation.
5. **Stale comments** corrected: `db/schema.ts` (the session's line is read now), `sessions/coreAnnex.ts` (six
   pieces; the two logs are edited by Back and Forward), `shared/lorebooks/lineReading.ts`, `state/durable.ts`.
6. A sweep for "a move needs a clock" in the genre docs: nothing to correct.
7. **Ledgers.** NOMENCLATURE §25: four new subsections (variable layouts; model set-up; `storyMoveStartOf`; decision
   lines). §15 rows corrected (variable template's order and reasons; leftover pick → **Remove this pick**).
   STYLE-GUIDE §6.11 (**Where this differs**) and §6.17. The three refusal sentences in
   `pipelines/config/leftoverPicks.ts` (~719, ~756, and a third at ~892 not in the brief) now say **Remove this pick**.
8. `docs/stats-and-states.md:58`: "A session with no lorebook doesn't offer it" replaced by the two real conditions.
10. The reply tick's place corrected in the docs (the Reply card; Story's Reply in Admin, not Chat's). SDK JSDoc
    text in `contracts/src/outlets.ts` and `contracts/src/tasks.ts` (outside every hashed descriptor).
11. Real time: both docs now say no real-time fact reaches a rule yet. A paragraph on a clock with no date.
    NOMENCLATURE §25 records that `countsTime` is inside a function's hash.

## Tests

App, 10 files: 124 passed, 2 failed, neither this lane's (`commentHistory` on the known nine files;
`guideGrounding.int`, which reads compiled docs written before any edit). SDK: 108 of 109 (`vocabulary.test.ts:193`,
known). No `sdk:build`, no re-pin, as instructed.

## Could not fully verify

- Pipeline-driven (automatic) scene closes do not call `recordToTimeline`; only the socket paths do. The guide says
  "when a person captures or ends a scene, or a close-out files its closing scene".
- A swipe takes lorebook-annex writes: inferred, not traced end to end.

## Noticed, not done

- **Next chapter is refused outright** when the old session's close-out returns any refusal but "nothing", including
  "This session's genre doesn't close sessions out." and busy (`sockets/sessions.ts:1532-1534`). Looks unintended.
- **A lorebook-scope annex value in a session's own book is lost on a branch**: `copyOwnBookToBranch`
  (`ownBook.ts:704-721`) does not copy `lorebooks.annex`. Written into the guide as today's behaviour.
- `stepVariableLayouts.dom.test.ts:243` asserts that no "Use the pub's" button exists; passes trivially now.
- Catch up still asks nothing first.
