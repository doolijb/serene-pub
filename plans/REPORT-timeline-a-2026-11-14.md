# REPORT — build lane `timeline-a` — a lorebook's Timeline switch, server half, slices 1 and 2 (2026-11-14)

Brief: `plans/briefs/BRIEF-timeline-a.md` (its Corrections rule). Worker briefs `BRIEF-timeline-a-w1.md`, `-w2.md`;
logs `plans/timeline-a-*.log`. **Nothing was looked at in a running app.** One process slip: one of the
supervisor's runs started while lane `edit-history-a` had a vitest run going.

## Migration

`drizzle/0160_sharp_dormammu.sql` (generated; highest applied was 0159): only
`ALTER TABLE "lorebooks" ADD COLUMN "timeline_enabled" boolean DEFAULT true NOT NULL;`. Not regenerated.

## The rule as built

Flag 🚧 **Timeline**, `lorebooks.timeline_enabled`, default **on** (every creation path as today). Read only
through `src/lib/server/lorebooks/timeline.ts`: `timelineOf(row)`, `timelineOfBook(db, id)`,
`sessionTimelineOf(db, sessionId)`, `sessionTimelineSql()`. A session follows its attached lorebook's switch,
else its notes'.

With the switch off: `readingOf` drops a passed moment (reading marked `timelineOff`); `sessionReadingOf` has no
moment, with the session's, lorebook's and branch's clocks ignored, not cleared (fork and session cuts stay; the
flag rides the existing query); `writeDatingAt` returns null; `storyNowOf` / `sessionStoryNowOf` return null
(so no prompt date, message stamp, dated scene name or age); `moveSessionStoryClock` is refused in its
transaction; `stepBackSessionStoryClock` unchanged. `sockets/storyClock.ts` refuses follow, set and step. The
clock outlet returns `skipped` with the sentence, writes no ledger row, emits nothing. `create-lore-entry`'s
history day writes nothing and notes the sentence; the run goes on. `ownBookDaysCounted` returns no dating.
`sockets/scenes.ts` refuses a compile (by date or entry) and a scene saved with a `historyEntryId`; a
compile-review save files nothing, silently (no reply channel there).

Copy 🚧 (`TIMELINE_OFF_SENTENCES`): *This lorebook has no timeline, so no history is kept.* · *This lorebook has
no timeline, so its story time doesn't move.* · *The timeline is on or off.*

The setter rides `lorebooks:update` (`timelineEnabled`): owner only; notes over a lorebook refuse it and follow
their lorebook in the same transaction; notes that are a session's whole world may be switched.
`insertOwnBook` and `copyOwnBookToBranch` copy the overlaid book's switch.

## The one-time pass

`settleTimelineSwitches` (`lorebooks/timelinePass.ts`), one transaction: a book with no `overlay_of` is on when
it holds a clock, any branch, a session with a clock reading it, a history entry with a numeric year, a dated
`entry_amendments` row, any `cast_amendments` row, a dated `character_versions` row, a tie or stat dated by one
of its history entries, or a non-default calendar; else off; notes over a lorebook copy it. Built with a
`doneMarker` so it never re-decides.

## Read sites still reading at a moment (not covered)

`sockets/amendments.ts` ~526, ~1303; `lorebooks/ownBook.ts` ~1473 (Apply's verdict at a held change's date);
`characters/versionsLift.ts` ~667.

## Tests (supervisor)

8 new files, 25 tests pass (`timelinePass.int`, `ownBook.timeline.int`, `sockets/lorebooks.timeline.int`,
`timelineCopies.int`, `state/timelineOff.int`, `sockets/storyClock.timeline.int`, `runtime/host.timelineOff.int`
with the byte-identical snapshot, `sockets/scenes.timelineOff.int`). 11 existing suites: 137 of 138; the one
failure (`lorebooks.duplicate.int`, table `lore_redlines` not copied) is lane `edit-history-a`'s table mid-build.
`tsc` 0 errors. Not run: `npm run check`, session-create and Lair socket tests.

## Open ★

- ★T-A1 The "switch on when dated" call for arriving lorebooks (attic; `importLorebookDocument` in
  `sockets/lorebooks.ts`, not `import.ts` ~888) is not added: with the default on it would do nothing until slice
  3 changes the default.
- ★T-A2 The sentences above.
- ★T-A3 Notes over a lorebook refuse the setter; whole-world notes may be switched by their owner.
- ★T-A4 The pass as ruled switches **off** existing sessions whose notes are their whole world and hold nothing
  dated and no clock, Living, the Lair and Dungeon Crawler included: they would then never start a clock.

## Queued, outside the owned files

`sockets/entries.ts` session history write (Summarize to lorebook's **New**; `messages/writes.ts` ~334 still falls
back to Year 1 with the switch off); the lorebook's own clock and calendar handlers in `sockets/lorebooks.ts`;
`state/clockMoves.ts` `clockMoveProblem`; Apply still drains dated held changes and notes' history days into a
switched-off lorebook; `ownBookFor` re-pointing `overlay_of` does not copy the switch; `changeLoreEntry` can
re-date a history entry; export does not carry the flag; no event tells open sessions the switch flipped.

## Lead follow-up (2026-11-14)

**The one-time pass is unregistered** (`startup/index.ts`): the function and its tests stay, nothing calls it at
boot. Reason: ★T-A4, and there is no screen yet to switch a lorebook back on, so the pass would have changed how
existing stories keep time with no visible cause and no way back (P1). Lane `timeline-b` registers it together
with the Book settings card, with the rule corrected for session notes (on when the session's genre keeps story
time). Until then the flag changes nothing unless set through the socket.

## Scope review and follow-up (2026-11-14)

Scope review: in scope; the migration is clean; names recorded; the setter owner-only and on `tx`; nothing else
switches a lorebook off by itself. Five findings, all fixed by worker w3 (`plans/briefs/BRIEF-timeline-a-w3.md`):
1. **Extra queries with the switch on.** `readingOf` takes the flag from a caller that has it and records it on
   the reading (`LineReading.timelineOff` is `true` / `false`; absent = not asked); `writeDatingAt` trusts the
   reading; the switch is selected with the lorebook row in `storyNowOf`; the clock outlet's pre-check is gone
   (the in-transaction `TimelineOffRefusal` becomes the `skipped` receipt). Measured after: `sessionReadingOf` 1
   query, `sessionStoryNowOf` 4, `writeDatingAt` 1, `timelineOfBook` called 0 times
   (`state/timelineQueries.int.test.ts`; the "before" counts of 2 / 6 / 2 were read from code, not run).
2. **Docs and comments said the pass ran.** `docs/lorebook-time.md`, NOMENCLATURE ~393 and §25, the comments in
   `db/schema.ts` and `timelinePass.ts` now say every lorebook keeps a timeline for now, the switch is 🚧 not
   reachable from a screen, and the pass is built and not registered.
3. **`sockets/storyClock.ts`.** The refusal runs after validation (a malformed step keeps its own sentence),
   only for setting and stepping; `follow` is allowed; the clock read returns no present with the timeline off.
4. **Notes agree with their lorebook.** `ownBookFor` copies the switch when it re-points `overlay_of`;
   `timelineOfBook` answers notes over a lorebook with that lorebook's switch (`bookTimelineSql()`).
5. **Tests added:** a malformed step on a switched-off lorebook still halts in the outlet; a message gets no
   story stamp with the timeline off and its stamp with it on.

Worker run: 12 files, 41 tests pass (`plans/timeline-a-w3.log`); `tsc` 0 errors. Left: `host.ts` ~11769 still
pre-checks with `sessionTimelineOf` for a history-day write (history writes only). The lead's wide run waits for
lane `edit-history-a` to stop editing the shared files.
