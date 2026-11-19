# BRIEF — worker `tl-2c-w3` — docs for "play's writes carry the story's date on a lorebook that keeps a timeline"

Supervisor: lane `tl-2c`. Repos: app `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk`
(only `INTEGRATING.md` there). Docs only: **no code, no tests**. Other lanes' uncommitted edits are in every one of
these files: **re-read each section right before editing it; small targeted edits; never a whole-file rewrite.**
A code worker (w1) is building the behaviour at the same time; describe the behaviour below, not what you read in
the code today.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

You run no `sdk:build` and no tests. Never `git checkout / restore / stash` in either repo; never `prettier --write`.

## The behaviour to document (lane tl-2c, 2026-11-16)

Owner 2026-11-16: "Genres must respect timelines if they are writing to the lore book. Refuse the … write if dated
entries don't get a date". "1. Go with the safest option for existing lorebooks".

- One server function, 🚧 `loreWriteDateOf` (`state/storyTime.ts`; names ★ awaiting the owner), answers what date a
  write of play carries, as one of three kinds (`LoreWriteDate`):
  - `dated`: the session's lorebook keeps a timeline and the story has a date. The date is the **story's now** as a
    day (the session's story clock, else its line's clock, else the line's newest dated history entry). It also
    carries `hangsOn`: the history entry the write hangs on (`writeDatingAt`), which may be none (before the line's
    first dated history entry), and that is allowed.
  - `timeless`: the lorebook keeps no timeline. Writes carry no date (unchanged).
  - `undatable`: a timeline and no date at all: only an older lorebook that was never dated (a new lorebook that
    keeps a timeline always starts with a date). Every write behaves exactly as before: a pipeline's history entry
    is refused as today; everything else is undated.
- What changes for play (pipelines and the Dungeon Crawler's cairns), only on `dated`, and only for writes made from
  now on (rows already written never change):
  - a new entry whose Beginning defaults to *began* (an Item, for instance) begins at the story's day even when the
    lorebook has dated history and no story clock (before: stored Perpetual). An entry whose type or step says
    Perpetual (World lore, Place, Character lore) stays Perpetual.
  - a change to an entry of the attached lorebook (under Full on the owner's own lorebook) is written as a dated
    version at the story's day whenever the story has a date (before: only with a story clock; with dated history
    and no clock it was written over the entry in place). A change that waits in the session's notes waits with
    that date. Changes to the session's own notes' entries are written in place, as before.
  - a cast member's change is dated at the story's day (before: on the notes' main only by the session's clock).
  - links, who-knows notes, stats, settle, messages and scene stamps: unchanged (they already hang on the right
    history entry, or stamp the story's now).
- **The backstop refusal.** If one of those writes reaches the store without a date while the story has one (a bug,
  a plugin, a future caller), it is refused and nothing is written. The run's step fails with ★
  *‹step›: This lorebook keeps a timeline, so this write needs the story's date, and it arrived without one.
  Nothing was written.* (For a cast member's change the sentence stands alone.) The sentence is ★ (provisional
  copy); mark it 🚧 in docs as the file does for other provisional copy. In ordinary play it never shows.
- Older lorebook with dated history and no clock (`dated`, on purpose): from now on its new Items begin at the
  newest history day and the Lair's entry updates are dated versions at that day (D52(c)).
- Not in this lane: the prompt's date with the timeline off (lane tl-2e) — do not write about it.

## Edits

1. `docs/lorebook-time.md`: rework the last sentence of the paragraph "A session follows the timeline of the
   lorebook it reads…" (~line 25, "an older session can still have none: until its story clock is set or a history
   entry is dated, the entries and changes it writes are undated…") and add a short subsection or paragraph (your
   call where; probably under "A lorebook's timeline") **"What a session's pipelines date"**: what play dates, what
   is refused and why, what an older lorebook with no date at all does. Check "Beginning and decay" (~78) and
   "Versions of an entry" (~116) for sentences that say a session's change/entry is dated only with a story clock,
   and fix only those. Keep the file's voice: short sentences, *italics* for shown copy, bold for UI names.
2. `docs/pipelines.md`: one paragraph near the lore writes list (~83–101, "Summaries and the lorebook"): on a
   lorebook that keeps a timeline a pipeline's lore writes carry the story's date; an older never-dated lorebook
   writes undated; the backstop sentence. Don't touch the history-write bullet's existing sentences.
3. `../serene-pub-sdk/INTEGRATING.md`: in the `SessionSettingsV1.timeline` bullet (~1641–1653) the words "`true`
   promises no date: … a write that may carry a date is stored undated" become: with a date the host dates the
   write with the story's now; with no date at all (an older, never-dated lorebook) it is stored undated as before;
   and one sentence on the backstop refusal. Check the `create-lore-entry@1` / `update-lore-entry@1` /
   entry-defaults bullets (~1347–1349, ~1659–1666) for a "dated only with a clock" claim and fix only that.
4. `NOMENCLATURE.md` (re-read first; lane tl-3a edited it today): (a) a new row in §8 right after the
   **story calendar · story clock** row (~396), in the table's format, for 🚧 **lore write date**
   (`loreWriteDateOf` · `LoreWriteDate` `dated` · `timeless` · `undatable` · `undatedLoreWriteRefusal` ·
   `UNDATED_LORE_WRITE_SENTENCE`), built 2026-11-16, lane tl-2c, no migration, with its charter (P6): **Purpose**
   (one answer to what date a write of play carries; callers switch on the kind), **Owns** (the answer and the
   backstop refusal for rows that store a date: a Beginning resolved to began, a dated or held entry change's year,
   a cast version's year; a history day's own refusal stays `fileOntoHistoryDay`'s), **Does not own** (the history
   entry a row hangs on: `writeDatingAt` (links, knowledge ties, stats, settle keep it); a person's writes; message
   and scene stamps (`withStoryClockStamp`, `sessionClock`); the prompt's date; the story's now itself
   (`storyNowOf`)), and ⚠ not `storyStartOf` (where a new session starts) nor *dating*. (b) In the **Timeline** row,
   the tl-2a sentence "`true` promises no date (…)" gains: "on a date, play's writes carry it (`loreWriteDateOf`)".
   Keep that edit to one clause. (c) §25 Change ledger: a new dated entry at the end in the style of the
   2026-11-16 tl-2b / tl-2d entries: *new internal names (app)* the five names above (🚧, not ruled); *changed*:
   the three write kinds above (before → after); UI copy (🚧) the sentence; docs touched.

## Report (final message, under 300 words)

Files and sections changed; every new sentence a person reads (verbatim, ★); `npx prettier --check` on the four
files (pre-existing drift is fine, say so); Noticed, not done.
