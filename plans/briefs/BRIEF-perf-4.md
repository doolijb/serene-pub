# BRIEF — build lane `perf-4` — statements per reply, fourth pass: what `perf-3` listed as remaining (programme 0.5)

Repo `/home/jody/github/serene-pub` (app). SDK not touched. Supervisor: read `.claude/guides/multi-agent.md`,
then `plans/REPORT-perf-3-2026-11-17.md` ("Not taken", "What remains", "Scope review"),
`plans/REPORT-perf-2-2026-11-17.md` and `plans/REPORT-perf-1-2026-11-17.md` (the host memos and their
invalidation rules), `plans/briefs/BRIEF-perf-3.md` (the method and every rule in it apply here; log names
`plans/perf-4-<n>.log`). Re-verify every file:line.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Both repos are staged by the lead: run no git command that changes the index or the working tree. Never
`prettier --write`. No migration, no SDK build, no full run, no `npm run build`. Comments state the rule, never
the history.

## Rule

No behaviour change: every prompt fingerprint in both baseline tests stays byte-identical to
`plans/perf-3-shas-final.txt`; what any read returns, the order of writes and what every socket push carries
to each member are unchanged. No caching across runs or across pushes. One cut at a time, both baselines
re-run after each, counts per world recorded before → after (start after lane `cpl-A`: Story 1478 / 1036,
the Lair 2283 / about 2279; re-measure first and use what you measure).

## Cuts (each: verify the claim with a quick profile, then cut, then baselines)

1. **A fields-only settings read.** `sessionKeepsEveryTurn` (`sessions/settings.ts:362`) and
   `sessionSpeechSettings` (`pipelines/speech/sessionSpeech.ts`; callers `speech/onMessageSettled.ts:196`,
   `speech/resolveVoice.ts:202`) build the whole settings document through `resolveSessionSettings` and then
   read only `fields`. Find what in `resolveSessionSettings` the `fields` value depends on (genre declaration,
   preset, session overrides: verify) and what it does not (cast, narrator name, participants…). Add one
   function in `settings.ts` that returns exactly the `fields` the full document would carry, built from the
   same code path as the full document (the full resolver calls it; never a second copy of the cascade), and
   point the two readers at it. Test: for Story, the Lair, Dungeon Crawler, Guide and Chat sessions, with and
   without overrides, the function's result deep-equals `resolveSessionSettings(...).fields`; the two readers
   return what they returned before. If `fields` cannot be separated without duplicating the cascade, stop
   and report what it depends on.
2. **The actions push reads the offer once per push** (`sessions/actionsPush.ts` `pushNow`;
   `buildSessionActions` in `sockets/sessions.pipelines.ts`): today each member's build reads the genre row
   and `listSessionFunctions` again. Read what does not depend on the member once per push and pass it in
   (smallest shape: an optional argument the per-member build filters); what depends on the member (owner vs
   guest, admin, seats) stays per member. Lane `gs-1`/`gs-2a` made several of these per-member on purpose
   (`pipelineReaderOf`, `visibleTo`, `withoutDebugMeta`): list each per-member rule you find and show it is
   still applied per member. Test: a push to an owner and a guest (real guest flags) in one session carries
   to each exactly what it carried before (frozen literals captured from the code before your change, in the
   manner of `perf-3-fix`: `git show :<path>` into a scratch copy, capture, delete the scratch files); the
   statement count for a two-member push drops.
3. **The rewind state once per push.** `rewindStateOf(db, sessionId)` takes no user (`sessions/rewind.ts:140`):
   where a push computes it once per member, compute it once and hand the same value to each member's
   payload. Verify nothing mutates the value per member. Same two-member test.
4. **Profile only, cut if it is one line:** the in-run cast reads at `pipelines/runtime/bindings.ts:786` and
   `bindings.retrieval.ts:518` miss the run's cast memo. If passing the run's host is the whole change and
   the memo's invalidation rules cover the call site (state why), cut; otherwise report the cost and stop.

## Files owned

`src/lib/server/sessions/settings.ts` (the new function and the two-line change in `sessionKeepsEveryTurn`),
`pipelines/speech/sessionSpeech.ts`, `sessions/actionsPush.ts`, `sockets/sessions.pipelines.ts` (only
`buildSessionActions` and what it calls; lane `cpl-A` edited lines 69–77 of this file and has landed: re-read
first), the two `bindings` call sites for cut 4, their tests. Not `rewind.ts`, `turnYield.ts`, `host.ts`.

## Stop and ask when

CLAUDE.md §Decisions applies; a cut would change what a member receives; `fields` depends on something read
per member; a cut needs a cache that outlives one push or one run.

## Report

Final message = the report (lead saves `plans/REPORT-perf-4-<date>.md`), under about 500 words: per cut the
change, what could invalidate it, the test; the count table per world before → after each cut plus the
two-member push count; fingerprints; what remains; **Noticed, not done**. NOMENCLATURE §25: one "Also this
change, no new words: …" line naming any new internal names.

## Cold review corrections (2026-11-17) — these rule over the text above

1. **Cut 1 adds no function.** The fields-only read exists: `genreFieldsFor`
   (`pipelines/entities/sessionGenres.ts:430-453`; the full resolver and it both go through
   `cascadeSessionFields`, `:557`, `settings.ts:236`). Point `sessionKeepsEveryTurn` and
   `sessionSpeechSettings` at it. `fields` depends only on the session row's `genreId` / `presetId` /
   `genreFields`, the genre declaration and the preset row. Error path: `sessionKeepsEveryTurn`'s callers
   already turn a throw into `null` (`messages/verbs.ts` 724–731, 767–779): no change.
   `sessionSpeechSettings` today falls back to the raw `genre_fields` when the full document fails
   (`sessionSpeech.ts` 25–35), and `genreFieldsFor` swallows errors and returns `{}`: **keep today's
   fallback** (if `genreFieldsFor` cannot tell failure from empty, compose the same reads in
   `sessionSpeech.ts` without the catch, through `cascadeSessionFields`; say which you did). Nothing new in
   `settings.ts` beyond the reader's own lines.
2. **Cut 1's test uses frozen literals**, not "deep-equals the full document" (both sides run the same
   cascade): capture the two readers' outputs from the pre-change code (`git show :<path>` into scratch
   copies, capture, delete the scratch files) for the five genres with and without overrides, assert against
   those.
3. **Cut 4 is profile-only.** A query node's `ctx.read` already is `host.read` on the run's host
   (`../serene-pub-sdk/sdk/src/executor.ts` 2018–2022); the memo is skipped while `hostInFlight > 0` or a
   cast write is in flight and cleared on a `castWrite` epoch change (`host.ts:2574-2575`). Find which of
   those makes these two sites miss and report it with the cost. Change nothing (`host.ts` is not owned).
4. **The per-member rules on the actions path** are these, not the ones named above: portrayals from
   `resolveAudiences` with the viewer as `runOwnerUserId` (`entities/sessionActions.ts:235`, `:343`);
   `seenSetFor` (the "new" mark, `:349`); `audienceHolds` for see and act (`:406`, `:431`, `:447`, `:465`,
   `:521`); `turnDeleteRefusedThrough`'s owner / player split (`sessions.pipelines.ts:1359`,
   `verbs.ts:705+`); `emitRedacted`'s admin-only strip (`sockets/utils/broadcastHelpers.ts` 94–140). Each
   stays per member. The two-member test pins what differs between owner and guest: `canAct`, which actions
   are visible, `isNew`, `deleteRefusedThrough`.
5. **Files owned for cuts 2–3: `buildSessionActions` (`sessions.pipelines.ts` 1283–1362; two optional values:
   the offer and the rewind state) and `pushNow` (`actionsPush.ts`) only.** `listSessionActions` and
   `formCollectsOf` already accept `offered` (`sessionActions.ts:289`, `:498`); `listSessionFunctions`
   ignores its user (`sessionGenres.ts:1357`). `sessionActions.ts`, `sessionGenres.ts`, `verbs.ts` are **not
   owned**. A socket that wants nothing costs no query (`actionsPush.ts` 17–22): read the shared values
   **lazily, on the first member who passes `hasInterest`** (`:105`); test that a push with no interested
   member still issues no statement.
6. A fix task is renaming `registrations/summarizer.ts` and its importers right now: re-read any file before
   editing it.
