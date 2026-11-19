# BRIEF — worker `tm-2-w2` — with the timeline off: presences ignored (B), compiled scenes back in earlier scenes (C), Beginnings never written back (D), a granted lorebook follows the rule (E), the guard strengthened (F)

Repo: app `/home/jody/github/serene-pub` (paths under `src/lib/server/` unless shown). Supervisor: lane `tm-2`. Use absolute
paths. You do not edit the SDK.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You run no `sdk:build`: worker `tm-2-w1` owns it.)

Also: never `git checkout / restore` anything; never `prettier --write`; never `pkill -f` a generic pattern; **no migration**;
no `npm run build`; no full app test run; inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks
PGlite). **Re-read every file right before you edit it**: lane `gs-2a` is live in `sockets/sessions.pipelines.ts`,
`sockets/sessions.messages.ts`, `sockets/sessions.ts`, `sockets/pipelines.ts`, `annexInspect.ts`; lane `gs-3a` in
`sockets/sessions.update.ts`, `sessions/seats.ts`, `EditSessionForm.svelte`; worker `tm-2-w1` in the SDK,
`pipelines/runtime/host.read.sessionCast.ts`, `sessions/settings.ts`, `pipelines/prompt/*.test.ts`, the DC tests. None of
those are yours.

**Tests**, one run at a time, each after **both** waits:
`until ! pgrep -f "^node .*vitest" >/dev/null && [ ! -f /home/jody/github/serene-pub/plans/tm-2-sdkbuild.lock ]; do sleep 5; done`,
only as
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tm-2-w2-<n>.log 2>&1"`.
Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. `tsc`:
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/tm-2-w2-tsc.log 2>&1` (errors in your files: 0; if the
SDK dist is mid-rebuild by w1, wait for the lock and re-run).

## Files you own (edit nothing else)

`state/presencesOnReading.ts`; `sockets/amendments.ts` (`cardMemberAt` only, ~513–620); `sprites/choices.ts` (the
`cardMemberAt` call ~231 only); `pipelines/ranking/eligibility.ts` only if a type needs it; `scenes/earlierScenes.ts`;
`pipelines/runtime/host.ts` (the date-part drop in `changeLoreEntry` ~434–450, plus the receipt line it needs at its callers);
`pipelines/runtime/host.helpers.ts` (`lorebookInScope` ~599–660 only); `state/statTrail.ts` (only if E needs it);
`pipelines/runtime/storyTimeRead.guard.test.ts`; new or existing tests beside these; `docs/lorebook-time.md`,
`docs/lorebook-cast.md`. **Not** `lib/shared/lorebooks/presence.ts` (`holdsAt` stays as it is: the client roster uses it),
not `state/reading.ts`, not `NOMENCLATURE.md` (the supervisor writes it: list every name you add).

## Rules your work depends on (quoted)

- Owner 2026-11-16: T2 "While the timeline is off, dated presences are ignored: everyone listed is present". D60 "While the
  timeline is off, earlier scenes also include compiled scenes". T1 "No switch: time is always delivered, null when the
  lorebook keeps no timeline".
- Lane rule 2: "on a lorebook that keeps **no timeline**, every story-time value a run can read is `null` … whatever is stored.
  On a lorebook that keeps a timeline, values are as today."
- CLAUDE.md P1: "every automatic action shows its cause and how to undo or switch it off." Decisions: a new name, sentence,
  setting or abstraction is ★ (propose, don't decide); implementation inside scope you decide and name in the report.
  Findings outside scope go under **Noticed, not done**, never fixed in passing.
- **B (corrected):** "only two places judge presence on the server. `pipelines/ranking/eligibility.ts:193` (lore gating, through
  `cast-presences@1`) and `cardMemberAt` (`sockets/amendments.ts:560`, called by sprites at `sprites/choices.ts:231`). No cast
  read, who's-here, seat or scene-cast code reads presences. Build: null `from` / `until` in `state/presencesOnReading.ts`
  86–91 from the `timelineOff` the reading already carries (`state/reading.ts` 358–363, no statement; `eligibility.ts:152`
  already treats a row with no `from` as present), and give `cardMemberAt` the same flag. **Leave the shared `holdsAt`
  alone** (the client roster uses it). State the consequence in the docs: with the timeline off, a member whose presence had
  ended has their lore retrieved and their sprite drawn again. Report, do not change: `amendments:place` (`amendments.ts`
  2618–2680) accepts a dated placement on a lorebook with no timeline, which is then ignored."
  Notes: `PresenceRow.from` becomes `StoryDate | null` (the contract's doc already says `from` / `until` "a story date … or
  null"). For `cardMemberAt`, the flag is an optional param the caller passes from the reading it holds
  (`reading.timelineOff`); with it, presences are not consulted (as a member with no presences: one appearance, position
  null). Check every other `cardMemberAt` caller (`state/lineSql.int.test.ts`, …): unchanged when the flag is absent.
- **C (corrected):** "`scenes/earlierScenes.ts:59` skips a scene whose `historyEntryId` is set … On a reading with
  `timelineOff`, the earlier-scenes read no longer skips compiled scenes (their own summaries, dates null as `tm-1` built); with
  the timeline on, unchanged (compiled days arrive as history)." "**C costs no statement:** fold the switch into the first
  select's WHERE (`history_entry_id is null or not <the session's timeline switch>`, `scenes/earlierScenes.ts:59`; the switch
  is read today in the second select, :87). Cap: the newest 200 (:27), then the token budget, newest first." Mind how
  `timelineOf` reads a null switch (use the same coalesce the second select's reader implies). Update the file's header
  comment.
- **D (corrected):** "A task that sends a read row back as a change would write `fields.year = null` for a type that takes a
  Beginning (`utils/lorebookEntries.ts` 762–763); the write path drops date parts with the timeline off only for history
  (`pipelines/runtime/host.ts` 436–443). Extend that drop: with the timeline off, an update's date parts (a Beginning's year /
  month / day) are ignored for every type that takes one, so stored dates survive a timeless session untouched. Test with a
  round trip of a read row." "**D shows its cause.** Ignoring a date part on update with the timeline off adds a receipt line
  when a non-null part differs from what is stored: ★ *date not changed: this lorebook keeps no timeline* (in the manner of
  `tl-4`'s receipt). An update that carries no date part, or the stored value, says nothing." Use `takesBeginning(typeId)` (the
  helper `utils/lorebookEntries.ts` uses) so history and every Beginning type go one way. Find how the sibling refusals /
  drops in `host.ts` put a line on the run's receipt (tl-4's `noteHistoryLeftOut` in `host.read.lorebookEntries.ts`; the
  `set-turn-order` drops "each a receipt note rather than a refusal" ~3992; the clock outlet's `skipped`) and use that
  existing mechanism; no new mechanism. Check the redate guard before `changeLoreEntry` (~7120–7145: `assertDateLands` etc.)
  does not refuse a timeline-off update that carries a date part that will be ignored.
- **E (corrected):** `host.helpers.ts` 650–654 "passes `timelineOff` only for the session's own notes and attached lorebook;
  for a granted lorebook it is undefined and `state/statTrail.ts:289` keeps stored dates. When undefined, ask `timelineOfBook`
  once (as `state/reading.ts:512` does): one statement, on granted reads only." "'granted' is `HostScope.lorebookId`
  (`host.helpers.ts:599`), used by lorebook-scoped runs with no session; fold the switch into `mostRecentBranchOf`'s select if
  that is cheaper than a separate read." (`mostRecentBranchOf` is in `state/reading.ts`, not yours, and is only called for
  `branch: "mostRecent"`: a separate `timelineOfBook` read passed as `timelineEnabled` to `readingOf` is the expected answer;
  `readingOf` then must not ask a second time.) A session-scoped run on its own book: no new statement.
- **F:** "**The guard, strengthened** (`pipelines/runtime/storyTimeRead.guard.test.ts`): per field, not per function (a
  function calling `timelessNull(` once must not clear its other time fields: scan each time-field expression, or require an
  inline marker comment naming the rule on each allowed exception); scan `pipelines/runtime/host.ts`, `tools/`,
  `transcript.ts`; add `forkedAt` with the allow-list reason 'the fork cut, by design'; `year:` wherever a lore row is shaped;
  delete the dead `hitsOf`." Write it so it passes on the tree as it will be after worker w1's cast-read edit (the cast read's
  fields all go through `timelessNull`); for each new hit it finds in `host.ts`, `tools/`, `transcript.ts`, either show it
  already goes through the rule, or allow-list it with a reason — **do not change those reads**; list each allow-listed hit in
  the report (a real leak is a finding, not a fix).

## Work, in order

1. B; tests: a member whose presences all have an `until` before the present, on a lorebook with the timeline off, gets their
   lore retrieved (eligibility via `cast-presences@1`, e.g. extend `pipelines/runtime/eligibilityGates.int.test.ts`) and
   `cardMemberAt(..., timelineOff)` answers one appearance; with the timeline on at a later moment, the member is gone (both
   paths). `cast-presences@1` with the timeline off delivers `from` / `until` null; with it on, stored dates. Also run
   `state/presencesAtHour.int.test.ts`, `state/lineSql.int.test.ts`, `pipelines/ranking/eligibility.test.ts`.
2. C; tests (extend `scenes/earlierScenes.int.test.ts` or `pipelines/runtime/earlierScenesQuery.int.test.ts`): compile a
   scene into a history day, switch the timeline off → its summary is in the read (`openedStoryClock` null); switch on → out
   again, and the history entry returns (history read). Report: does a long-compiled lorebook crowd the block, and what the cap
   (newest 200, then the fit's token budget, `transcriptFit.earlierScenesShown`) does.
3. D; test: read a Beginning-taking non-history row with the timeline off (its year / month / day come back null), send it
   back as an update through the host's write path → stored date unchanged, the rest of the change written, no receipt line
   (the parts were null); an update with a non-null different year → stored unchanged + the receipt line; history unchanged in
   behaviour plus the receipt rule. Timeline on: dates written as today.
4. E; test (extend `pipelines/runtime/timelineOff.hostReads.int.test.ts` or `state/lorebookStats.int.test.ts`): a
   lorebook-scoped run (no session, `scope.lorebookId`) reading `stat-trail@1` on a book with the timeline off gets
   `anchor.date` null; on, stored dates; and the statement count of a session-scoped read is unchanged.
5. F; run the guard.
6. Docs: `docs/lorebook-time.md` (with the timeline off: presences ignored, everyone listed present, a member whose presence
   ended has lore retrieved and sprite drawn again; earlier scenes include compiled scenes; an update never changes a stored
   date, with the receipt line), `docs/lorebook-cast.md` (presences: the same, one or two sentences). Read each file's
   relevant section first; keep the docs' existing voice; short.
7. Final run of every test file you touched or extended, as one run; `tsc`.

## Done means

All runs green, `tsc` 0 errors in your files, `npx prettier --check` on every file you touched (report pre-existing
differences, never `--write`).

## Report (your final message, under 600 words)

Per item: what changed (file:line), the tests (old → new where re-pinned), logs and pass counts. B: the flag's name and how
`cardMemberAt` uses it. C: the WHERE clause verbatim; the crowding answer. D: the receipt mechanism used, the sentence as
written. E: where the statement is spent. F: the guard's coverage, each allow-listed hit with its reason, any real leak found.
Names and sentences added (★). **Noticed, not done** (include the `amendments:place` finding).
