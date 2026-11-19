# BRIEF — build lane `tm-2` — story time, declared and finished (owner rulings T1, T2, D60; the review findings of `tm-1`)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/REPORT-tm-1-2026-11-16.md` (incl. its "Scope review" notes), `plans/BRIEF-tm-1`'s rules 1–4 and
corrections (`plans/briefs/BRIEF-tm-1.md`), `plans/REPORT-tl-4-2026-11-16.md` (D60 gap; `sessionStart`), rows
D56, D60, D62 in `plans/DISCUSS-LATER.md` (ruled), `plans/INVENTORY-time-in-query-results-2026-11-16.md`,
`docs/lorebook-time.md`, `docs/context-templates.md`, `../serene-pub-sdk/INTEGRATING.md` (story time),
`NOMENCLATURE.md` §1, §24 and rows **timeline**, **timeless null**, **story now**, **presence**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write`. Never commit. Never `npm test` / `npm run build`
at the SDK root; `sdk:build` only from the app root after checking no dev / preview server (`pgrep -af "vite"`;
the Svelte language server's esbuild does not count) and no vitest is up. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tm-2-<n>.log 2>&1"`,
one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. **No migration.** Inside
`db.transaction` only `tx`. No full run, no `npm run build`.

## Owner (2026-11-16)

T1: "No switch: time is always delivered, null when the lorebook keeps no timeline". T2: "While the timeline is
off, dated presences are ignored: everyone listed is present". D60: "While the timeline is off, earlier scenes
also include compiled scenes". D56: "Declare an optional timeline field on the cast query's story time" + "we
can still freely edit our core catelogue … We need the same behavior to match across querying anything that
could carry timelines/time." 2026-11-05: "All sessions have a lorebook … No exceptions so SDK data storage API
is predictable." 2026-11-14: "Messages will just display real time." (an undated session).

## Build

A. **Declare the cast's story time in the SDK** (`sdk/src/participants.ts` ~513–524, `SessionCastV1.storyTime`):
   always an object (drop `?` and `| null`: every session has a lorebook; the no-book branch in
   `host.read.sessionCast.ts` ~589–594 / ~663 is a fault the `ownBookFor` fallback heals: make the read call
   it or throw the existing "no lorebook" fault, never return a missing object), with
   `timeline: boolean` (always present: true when the lorebook keeps a timeline; this replaces the provisional
   app-side `timeline: false`-only key), `now: … | null`, `calendar: … | null`,
   `sessionStart: { year, month, day } | null`. No param on any query (T1). Doc comments state the one rule:
   on a lorebook that keeps no timeline every story-time value a run reads is null. `INTEGRATING.md` gains the
   short section "Story time in what a run reads" (the rule + the table of shapes from `REPORT-tm-1`).
   Update every reader in core (Assemble, the Dungeon Crawler scripts, any template or test fixture) for the
   always-present boolean. `sdk:build`; `npm run sdk:test` capped (four known failures); registry hashes
   re-pinned with "(was …)". NOMENCLATURE: the provisional marks on `storyTime.timeline` / `sessionStart`
   become declared names; §25.
B. **Dated presences are ignored while the timeline is off (T2).** With no moment, `holdsAt(p, null)` keeps
   only presences with no `until`, so a member whose presences all have an end date counts as gone. Build: on a
   reading with `timelineOff`, every listed cast member is present (presence dates are not consulted), in the
   one function that answers presence for a reading (find it; every reader goes through it: the cast read,
   who's-here, seat availability, scene cast); `cast-presences@1` delivers `from` / `until` as null there
   (rule 2). A lorebook that keeps a timeline: unchanged. Tests: a member with only ended presences is present
   with the timeline off and gone with it on at a later moment; both prompt baselines unchanged.
C. **Earlier scenes include compiled scenes while the timeline is off (D60).** `scenes/earlierScenes.ts:59`
   skips a scene whose `historyEntryId` is set, and history entries are left out of prompts with the timeline
   off (`tl-4`), so days compiled before a switch-off leave the prompt. On a reading with `timelineOff`, the
   earlier-scenes read no longer skips compiled scenes (their own summaries, dates null as `tm-1` built); with
   the timeline on, unchanged (compiled days arrive as history). The budget / cap of that read applies as
   today; report whether a long-compiled lorebook then crowds the block and what the existing cap does.
   Tests: switch off after compiling → those scenes' summaries are back in the block; switch on → out again,
   history returns.
D. **A nulled Beginning is never written back.** A task that sends a read row back as a change would write
   `fields.year = null` for a type that takes a Beginning (`utils/lorebookEntries.ts` 762–763); the write path
   drops date parts with the timeline off only for history (`pipelines/runtime/host.ts` 436–443). Extend that
   drop: with the timeline off, an update's date parts (a Beginning's year / month / day) are ignored for
   every type that takes one, so stored dates survive a timeless session untouched. Test with a round trip of
   a read row.
E. **A granted lorebook follows the rule.** `host.helpers.ts` 650–654 passes `timelineOff` only for the
   session's own notes and attached lorebook; for a granted lorebook it is undefined and
   `state/statTrail.ts:289` keeps stored dates. When undefined, ask `timelineOfBook` once (as
   `state/reading.ts:512` does): one statement, on granted reads only. Test.
F. **The guard, strengthened** (`pipelines/runtime/storyTimeRead.guard.test.ts`): per field, not per function
   (a function calling `timelessNull(` once must not clear its other time fields: scan each time-field
   expression, or require an inline marker comment naming the rule on each allowed exception); scan
   `pipelines/runtime/host.ts`, `tools/`, `transcript.ts`; add `forkedAt` with the allow-list reason "the fork
   cut, by design"; `year:` wherever a lore row is shaped; delete the dead `hitsOf`.
G. **The crawl's calendar arithmetic** (SDK `core-catalog/src/genres/dungeon-crawler/storyScripts.ts`): a
   parity test comparing the script's `calendarDay` with the SDK's `storyDayIndex` across 1896–2104 on the real
   calendar (incl. 1900, 2000, 2100), a negative year, and a custom calendar with `skipEvery` / `keepEvery`;
   fix what differs. `addMinutes` (91–100) uses fixed month lengths: make it read month lengths from the
   calendar the same way, so the rest line and the journal's "time" text print the right day across a leap day
   and a custom calendar's months (it writes no date: labels only). Tests.
H. **What a person sees with the timeline off** (the conversation widget; lane `tm-1` reported, did not
   change): lines stamped before a switch-off still show story dates (day marks, the story time beside a name,
   a live scene's opening date: `sceneMarks.ts` ~293 / ~312, `messages/store.ts` stamps,
   `liveSceneProjection.ts`). Owner 2026-11-14: an undated session's "Messages will just display real time."
   Build: with the timeline off the widget's data carries no story stamps (null at the data source, same
   mapper), so messages show real time and no story day marks; stored stamps are untouched and return when the
   timeline is switched on. **Do this item last and re-read first:** lane `gs-2a` is shaping message rows for
   the wire (`sockets/sessions.messages.ts`, `sockets/sessions.ts`) at the same time.
I. Docs: `docs/lorebook-time.md` (presences, earlier scenes, what a person sees, with the timeline off),
   `docs/context-templates.md`, `docs/lorebook-cast.md` (presences), `NOMENCLATURE.md` §25.

## Tests

Per item as above; the three cases (`dated`, `undatable`, `timeless` with stale stored values) for every
changed shape; both prompt baselines (shas unchanged for the shipped worlds; statement counts per world against
`plans/tm-1-shas-final.txt`: report any change and its cause); a first turn per shipped genre; the Dungeon
Crawler's pinned "Day 1, 08:00 → Day 1, 16:00." unchanged. `tsc` 0; `npm run check` 0 errors in lane files.

## Workers (at most 2 at once; sequential on a shared file)

1: A (SDK declaration, readers, INTEGRATING) then G (SDK scripts): one worker owns the SDK and its build.
2: B, C, D, E, F (app reads and the guard), then H last.

## Files owned

SDK: `sdk/src/participants.ts`, doc comments on time fields, `INTEGRATING.md`,
`core-catalog/src/genres/dungeon-crawler/*.ts`, their SDK tests. App: `pipelines/runtime/host.read.sessionCast.ts`,
`pipelines/prompt/assemble.ts` (the boolean), the presence function and its readers, `scenes/earlierScenes.ts`,
`pipelines/runtime/host.ts` (the date-part drop at ~436–443 only), `host.helpers.ts` (650–654),
`state/statTrail.ts`, the guard test, the widget's stamp sources (`messages/store.ts` stamps as sent,
`liveSceneProjection.ts`, `sceneMarks.ts`), their tests, the docs.

## Stop and ask when

CLAUDE.md §Decisions applies; making `storyTime` non-null breaks a session that truly has no lorebook (report
how many paths can produce one); ignoring presences changes who speaks in a shipped world's baseline; the
earlier-scenes change moves a prompt baseline for a world that plays with a timeline; the widget needs a story
stamp to order or group lines (then keep ordering, null only what is shown).

## Report

Final message = the report (lead saves `plans/REPORT-tm-2-<date>.md`): per item what changed; the declared
shape; the presence function; the earlier-scenes behaviour and its cap; the guard's coverage; statement counts;
names and sentences (★); **Noticed, not done**. Under about 700 words.

## Cold review corrections (2026-11-16) — these rule over the text above

1. **Item H is out of this lane** (it goes to the owner as a question: the 2026-11-14 quote was about new
   undated sessions, not a lorebook switched off after its lines were stamped). Do not touch the widget, its
   stamp sources or `sceneMarks.ts`. Worker 2 carries B, C, D, E, F only.
2. **B, corrected: only two places judge presence on the server.** `pipelines/ranking/eligibility.ts:193` (lore
   gating, through `cast-presences@1`) and `cardMemberAt` (`sockets/amendments.ts:560`, called by sprites at
   `sprites/choices.ts:231`). No cast read, who's-here, seat or scene-cast code reads presences. Build: null
   `from` / `until` in `state/presencesOnReading.ts` 86–91 from the `timelineOff` the reading already carries
   (`state/reading.ts` 358–363, no statement; `eligibility.ts:152` already treats a row with no `from` as
   present), and give `cardMemberAt` the same flag. **Leave the shared `holdsAt` alone** (the client roster
   uses it). State the consequence in the docs: with the timeline off, a member whose presence had ended has
   their lore retrieved and their sprite drawn again. Report, do not change: `amendments:place`
   (`amendments.ts` 2618–2680) accepts a dated placement on a lorebook with no timeline, which is then ignored.
3. **C costs no statement:** fold the switch into the first select's WHERE
   (`history_entry_id is null or not <the session's timeline switch>`, `scenes/earlierScenes.ts:59`; the switch
   is read today in the second select, :87). Cap: the newest 200 (:27), then the token budget, newest first:
   say so in the report.
4. **D shows its cause.** Ignoring a date part on update with the timeline off adds a receipt line when a
   non-null part differs from what is stored: *date not changed: this lorebook keeps no timeline* (★; in the
   manner of `tl-4`'s receipt). An update that carries no date part, or the stored value, says nothing.
5. **A, corrected:** the cast read already falls back to the own book (`attachedOrOwnBookOf`,
   `host.read.sessionCast.ts:565`; null only when the session row is gone, `ownBook.ts` 285–294): no path
   reaches a no-book state, so that Stop-and-ask is dropped; the object is simply always present. Derive
   `timeline` from `timelineOf(storyBookRow)`, not from `!timelineOff`. Readers to update that the brief did
   not name: `sessions/settings.ts` 319–328 (a `raw ?? {}` cast to `SessionCastV1` that would hide a missing
   `storyTime`), `sdk-tests/turnOrder.test.ts:371` (a typed fixture with no `storyTime`),
   `pipelines/runtime/host.sessionCast.storyTime.int.test.ts` 97 / 107 (pins that `timeline` is absent: re-pin,
   old → new). Assemble no longer reads `timeline`.
6. **E:** "granted" is `HostScope.lorebookId` (`host.helpers.ts:599`), used by lorebook-scoped runs with no
   session; fold the switch into `mostRecentBranchOf`'s select if that is cheaper than a separate read.
