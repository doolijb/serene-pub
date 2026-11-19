# BRIEF — build lane `tl-2c` — on a lorebook that keeps a timeline, play's writes carry the story's date; a write that must be dated and is not is refused (programme 1.7)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then the programme's
"Latest rulings" dated 2026-11-16 (`plans/PLAN-programme-2026-11-15.md` ~30–65), D46–D52 in
`plans/DISCUSS-LATER.md`, `plans/INVENTORY-undated-lore-writes-2026-11-16.md` (the map of this lane:
**re-verify every file:line**, lanes `tl-2b` and `tl-2d` have moved code), `plans/REPORT-tl-2a-…`, `-tl-2b-…`,
`-tl-2d-2026-11-16.md`, `docs/lorebook-time.md`, `NOMENCLATURE.md` §1, §24 and rows **timeline**, **story now**,
**Perpetual**, **Beginning**; `../serene-pub-sdk/INTEGRATING.md` where lore write outlets and `current-date` are
described.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write` (nor a scratch-copy equivalent). Never commit.
Never `npm test` / `npm run build` at the SDK root. `sdk:build` only from the app root after checking no dev /
preview server (`pgrep -af "vite"`) and no vitest is up
(`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`). Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-2c-<n>.log 2>&1"`,
one run at a time. `NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. **No migration.**
Inside `db.transaction` only `tx`. No full run, no `npm run build`. Workers sequential when they share a file.

## Owner (2026-11-16)

"I think we should enforce true type safety for dates." "Genres must respect timelines if they are writing to
the lore book. Refuse the fucking write if dated entries don't get a date". "This is what we are enforcing type
safety on timelines lorebooks". "There shouldn't be a scenario where it defaults to 1-1-1." "1. Go with the
safest option for existing lorebooks". Lead's recorded reading (programme): a lorebook that keeps a timeline and
was made from now on always has a date (`tl-2d`), so play's writes are always dated and the refusal is a
backstop; **existing** sessions and lorebooks with no date at all are left exactly as they are.

## Terms used here

*Story now* = `storyNowOf` (`state/storyTime.ts`): the session's clock, else the line's clock, else the line's
newest dated history entry; null only when the lorebook has no date at all. *The reading's moment* = clock only
(`state/reading.ts`). *Dating* = `writeDatingAt`: the history entry a write hangs on.

## Build

1. **One answer to "what date does this write of play carry".** One server function (in `state/`, next to
   `storyNowOf` / `writeDatingAt`; name by §24, ★ in the report) that every pipeline lore write asks, returning
   one of three typed results: `{ kind: 'dated', … }` (the lorebook keeps a timeline and has a story now),
   `{ kind: 'timeless' }` (the lorebook keeps no timeline), `{ kind: 'undatable' }` (a timeline, and no date at
   all: only an existing, never-dated lorebook). Callers switch on the kind; no caller reads a nullable date
   and decides for itself. This is the "type safety": after the lane, a `dated` result's date is non-null in the
   type, and the helpers that store a dated row take that type.
2. **Close each gap in the inventory's §2 table** so that with `dated` the write carries the date, every
   outlet, every genre including Story: Minimal on an attached timeline lorebook:
   - `create-lore-entry@1`, non-history: the Beginning comes from story now, not only the clock (today: no
     clock but dated history → stored Perpetual silently). An entry the step itself declares Perpetual stays
     Perpetual: find how a step says so (`lorebooks/entryDefaults.ts`); if it cannot, report, add nothing.
   - Links (both outlets), `note-entry-knowledge@1`: dated on the own-book route with no attached lorebook too
     (today always null there) when that own book keeps a timeline.
   - `update-lore-entry@1`: a dated version whenever the result is `dated` (today only with a clock); a held
     change is held with its date.
   - `update-cast-member@1`; scene open / close stamps; message stamps; stats; settle: each follows the one
     function. Where a row already gets the right date, change nothing and list it as verified.
3. **The backstop refusal.** With `dated` expected and a store helper reached without a date (a bug, a plugin's
   own binding, a future caller): the write is refused with one sentence modelled on the existing history
   refusal (`host.ts` ~639), reaching the receipt the way that one does (`written: false` + `notes`, or the
   node fails where history does today): never stored undated, never Year 1. One sentence per row kind only if
   the existing wording cannot cover it; sentences are ★.
4. **`undatable` (existing lorebooks with no date at all): unchanged.** History refused as today; every other
   write behaves exactly as before the lane. Tests pin this. Do not add a nag, a boot pass or a migration.
5. **`timeless`:** writes carry no date, as today, and **no prompt part prints a date**: `current-date` (and
   any sibling that prints story time; lane `tl-2a` found `current-date` can appear with the timeline off) is
   absent, in words where a layout expects it. Find every reader; fix at the one read, not per genre.
6. **A person's writes are out of scope** except where they share a helper whose type changes: then keep their
   behaviour identical and say so.
7. **SDK:** only if a contract's doc comment must say the rule (an outlet's description: "on a lorebook that
   keeps a timeline the write is dated with the story's now"). No new in-port, no `@2`, no `validate()` law
   unless it needs no new name; if only comments change, do not rebuild the SDK.
8. **Docs:** `docs/lorebook-time.md` (what play dates, what is refused and why, what an undated older lorebook
   does), `docs/pipelines.md` (one paragraph), `INTEGRATING.md`, `NOMENCLATURE.md` (the function's row with its
   charter; §25).

## Tests

- The inventory's §6 list: each test that pins an undated write **on a timeline lorebook that has a date** changes
  on purpose (list old → new); each that pins one on a lorebook with **no date at all** stays and is renamed to
  say so if its title is ambiguous. Never weaken an assertion.
- Per outlet: `dated` (clock set; no clock but dated history), `timeless`, `undatable`.
- The backstop: a store helper called without a date on a dated lorebook is refused; nothing is written.
- A guard test in the manner of `state/noYearOneFallback.guard.test.ts`: no pipeline lore write site reads a
  date except through the one function (an allow-list with reasons).
- A first turn of each shipped genre / Story preset (the lists in `REPORT-tl-2d`), and both prompt baselines:
  a baseline may change only where a date is now absent with the timeline off; report the diff and its cause.
- Back / a swipe still removes each dated write with its reply.

## Files owned

`state/storyTime.ts`, `state/reading.ts` (only the dating helpers), `pipelines/runtime/host.ts` (only the
commit cases named), `host.loreWrites.ts`, `characters/versions.ts` (only the pipeline's `when`),
`scenes/liveScenes.ts`, `messages/store.ts`, `state/write.ts`, `sessions/settle.ts`, `lorebooks/ownBook.ts`
(only dating of play's writes), the `current-date` read, the tests above, the docs. Lane `tl-3` (may run at the
same time) owns `lorebooks/timeline.ts`, the start form and which lorebooks keep a timeline: do not touch
those; re-read any shared test before editing.

## Stop and ask when

CLAUDE.md §Decisions applies; a shipped pipeline would be refused in ordinary play on a dated lorebook; closing
a gap changes what an **existing** session shows or stores for rows already written; the backstop needs a
migration or a NOT NULL constraint (propose it, do not build it); more than about 30 tests change; a prompt
baseline changes for another reason.

## Done means

`tsc` 0; `npm run check` 0 errors in lane files; the lane's tests and the two baselines green; SDK untouched or
`sdk:build` + `npm run sdk:test` with only the four known failures.

## Report

Final message = the report (lead saves `plans/REPORT-tl-2c-<date>.md`): the function and its three results;
the table of write kinds (before → after, or verified unchanged); the refusal and where it shows; what stays
for undated older lorebooks; tests changed (old → new, counts); every sentence and name (★); **Noticed, not
done**. Under about 700 words.

## Cold review corrections (2026-11-16) — these rule over the text above

**Item 5 (`timeless`: no date in a prompt; `currentDateOf` in `assemble.ts` ~343 / ~801; the prompt baselines'
diff) is cut out into lane `tl-2e`: do not build it, do not touch `assemble.ts`.** This lane is items 1–4, 6–8.
Workers run one after the other on `host.ts`. Line drift: `host.ts` 642 (history refusal), 477 (dated-version
branch), 297 (held change), 6452 (the Beginning's date); `host.loreWrites.ts` 274 / 372 / 461 / 792 / 1090;
`versions.ts:1954`; `storyTime.ts:267`; `reading.ts:511`.

1. **A date is not the history entry a write hangs on.** The result is
   `{ kind: 'dated', date: <non-null story date>, hangsOn: number | null }`. `hangsOn` (`writeDatingAt`) is
   null before the line's first dated history entry and that stays **legal** (ruled, plan A22 2026-09-30; doc
   at `reading.ts` 491–495): a new dated session has a clock and no history entry, Dungeon Crawler writes no
   history (ruling 2026-11-10), and both Dungeon Crawler and the Lair write links from turn 1. So:
   - links, knowledge ties, stats and every other row that stores only `history_entry_id` keep today's value;
     "links dated" in item 2 means *verified: they hang on the right entry when one exists*;
   - **the backstop covers only rows that store a date**: a history entry's year, `entry_amendments.year`,
     `character_versions.year`, a Beginning resolved to *began*, clock stamps on lore rows. Never
     `history_entry_id`;
   - play never creates a history day to hang a write on (scenes first, 2026-11-10); `placeStats` keeps its
     exact-moment rule (`reading.ts` 505–509).
2. **Perpetual comes from the entry type as well as the step** (owner 2026-11-14, ★4,
   `PLAN-entry-time-and-lines-2026-11-14.md:240`: "World lore, Place, Character lore = perpetual fact; Item =
   began, fact"; `newEntryTime`, `entryDefaults.ts` 107–125: step, then type, then perpetual). Leave
   `newEntryTime` alone. The only change for non-history creates is the `date:` input at `host.ts` ~6452: story
   now instead of the reading's moment. Test: dated history and no clock → World lore stays Perpetual, an Item
   begins at the newest history date.
3. **Messages and scene stamps are outside the backstop** and already use story now
   (`messages/store.ts` 90–93 "A failure to read the clock never fails the write"; `withStoryClockStamp`;
   `liveScenes.ts` 145–147): list them as verified unchanged; `session_messages` is excluded by name.
4. **A lorebook with dated history and no clock is `dated`, on purpose** (not `undatable`, not a stop): there
   new writes change (an Item begins at the newest history day instead of Perpetual; `update-lore-entry` writes
   a dated version at that day instead of in place), as D52(c) already records for the Lair. Rows already
   written do not change. A test and a row in the report's table; ★ in the report so the owner sees it.
5. **From the scope review of `tl-2d`:** `sockets/sessions.lairWalk.int.test.ts` 637–641 clears the session's
   clock so its in-place assertion holds; a freshly created Lair session now starts dated and `update-lore-entry`
   writes a dated version, with no assertion. Add the walk case that asserts the dated version for a new Lair
   session (keep the cleared-clock case: it stands for an existing undated session).
