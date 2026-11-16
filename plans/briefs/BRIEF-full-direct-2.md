# BRIEF — build lane `full-direct-2` — the four faults left by `full-direct`

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then
`plans/REPORT-full-direct-2026-11-13.md` in full (the rule as built, Open ★, Noticed), `plans/briefs/
BRIEF-full-direct.md` (Words; Rulings; Corrections), `docs/lorebooks.md` "Bringing a session's changes into the
lorebook" (the history-day paragraph: applying a notes day for a date the lorebook already holds "adds the
paragraph after what the lorebook's day holds and never makes a second entry for one date"), CLAUDE.md Hard
rules and Standing rulings, NOMENCLATURE §1, §24, §25. Line numbers are from 2026-11-13: search by name.

Words as in `BRIEF-full-direct.md`. `host.ts` = `src/lib/server/pipelines/runtime/host.ts`.

## Rulings that bind

- Owner, 2026-11-13, told of the faults below: "And yes, need to fix the issues you just raised."
- `BRIEF-full-direct.md` Build 2: "No write is refused that is held today." A write the notes took before
  `full-direct` is never refused now.
- History holds one entry per date on a line (owner, 2026-11-10).
- A dated session's change to an existing lorebook entry still waits in the notes (correction 1 is held): do
  not touch that.

## Corrections from the cold review (2026-11-13) — these override anything below that disagrees

1. **Build 4 is dropped: nothing is merged on Forward.** The owner already ruled this case (2026-11-10, ★H3
   "Report in Loose ends"; `plans/PLAN-history-one-per-date-2026-11-10.md` ~14, ~69 "Undo and restore are
   exempt", ~207 rejects "an automatic merge … changes people's prose without asking"; `docs/lorebooks.md` ~110
   "Nothing is merged for you"). Forward restores the day unchanged; the book's **Loose ends** lists *Two
   history entries on one date*. Do: one test that after Back, another day written for that date, then Forward,
   both days exist with their text and the Loose ends chore lists the date. `imprints.ts` is **not** owned any
   more; `restoreImprints` is at ~699.
2. **Build 2 is wider than "fork pending".** Before the lane a scenes-end session's history day always went to
   the notes (line `branchId` null, `alsoReads` set: no fork, no refusal). A line forked with no moment has no
   fork date (`lorebooks/sessionLine.ts` ~146–162) and stops being pending at the first direct entry, link or
   automatic Apply; after that `historyDayOwnerRefusal` refuses (~252 dateless fork; ~250 a day on or before the
   fork date). Rule: **for a session whose scenes end by themselves, whenever rule C would refuse the day on the
   line (pending or forked), the day goes to the notes, decided before `forkedLoreLine`** (`host.ts` ~1776;
   called ~11752, ~12332). At scene close it then waits with the rule-C reason (`ownBook.ts` ~2052–2059), as
   before the lane. `scenes/historyEntryOfDate.ts` needs no edit and is **not** owned.
3. **Build 1, how the link reaches the notes.** `link-lore-entries` locks only the lorebook (`host.ts` ~12329)
   and forks its line (~12332) before resolving either end. Get the notes with `ownBookOf`; build the notes line
   explicitly (`historyEntryId` from `ownBookDaysCounted(…).dating`, ~1691; `alsoReads` = the lorebook's
   reading); resolve both ends against it, notes first (~1452); when an end is a notes row, take the notes' lock
   as `create-lore-entry` does (~11744–11754), do **not** fork, and write with `writeLoreLink(tx, notesId, …,
   notesLine)` (~1875). Fork and write to the lorebook only when both ends are lorebook entries. The only notes
   landing on the book route today, `sessionLoreWriteTo(…, {notes:true})`, drops `alsoReads` and the dating
   unless scenes end by themselves (~1687–1690): that is the cause of the missing history-day dating. Say in the
   report that a name found in both books now resolves to the notes row.
4. **Build 3 detail.** Look up the waiting day with `historyEntryOfDate(tx, {lorebookId: notesId, branchId:
   null, date}, {create: false})`; the default date counts the notes' days (`ownBookDaysCounted`, as ~2458).
   Today's fault is paragraphs out of order after the later merge, not two days on one line.
5. **Build 5.** `appliesItself` is `ownBook.ts` ~3046–3070. The new sentence stays 🚧 and is listed as an open ★.

## Build

1. **A link to a row still waiting in the notes is not refused** (★FD-2). On the "book" route,
   `link-lore-entries` resolves both ends in the lorebook only (`host.ts` ~12333–12342,
   `resolveLoreLinkEnd(tx, lorebookId, …, line.alsoReads)`). When an end is a row waiting in the session's notes,
   the link is written into the notes, exactly as the notes route writes a link that joins the two books (it
   then drains with that row at scene close). Both ends in the lorebook: unchanged. The same for the `links` of
   a `create-lore-entry`: a link to or from a notes row lands in the notes with the dating the notes route gives
   it (the report's third Noticed item).
2. **A history day that used to go to the notes is not refused** (★FD-4). A session whose scenes end by
   themselves, with its line fork pending and no fork date, is now refused a history day with the "…with no fork
   date…" sentence (`scenes/historyEntryOfDate.ts` ~252). It gets today's pre-lane behaviour back: the day is
   written to the session's notes. Any other Full session keeps the refusal it already had before the lane.
3. **A day waiting in the notes is found** (report's fourth Noticed item). `fileOntoHistoryDay` on the "book"
   route looks only in the lorebook, so a day still waiting in the notes for that date is missed and a second day
   is made in the lorebook. It looks in the notes first, as the match does: a waiting notes day for the date
   takes the paragraph.
4. **Forward never leaves two days for one date** (★FD-6). When Forward (`restoreImprints`, `imprints.ts` ~631)
   would put back a history day a turn made and the line now holds another day for that date, the restored
   day's text is added to the day that is there as a paragraph, the way Apply merges a notes day
   (`ownBook.ts` ~2110, `writeEntryKeys`; reuse that merge, do not spell a second one), and what the restored
   day's imprints, links and sources named now names the day that stayed. No second entry. If Apply's merge
   cannot be reused from `imprints.ts` without a cycle or a schema change, or `sessions/rewind.ts` must change,
   **stop and report** with what is needed; do not improvise. Back after such a Forward must take the paragraph
   away again (test it), or the stop applies.
5. **The card's sentence** (★FD-3). `SessionViewPanel.svelte` ~647–664, fed by `appliesItself`
   (`ownBook.ts` ~2969–2995): *The lorebook takes this session's changes by itself as each scene closes.*
   becomes 🚧 *The lorebook takes what waits here by itself as each scene closes.* Update its DOM tests and the
   doc sentence that quotes it (`docs/lorebooks.md`).
6. **Tests the scope review found missing:** restore the real writer in `autoApply.int.test.ts`'s `change()`
   helper (a dated session, or a prior hold, still reaches the held path through `update-lore-entry` under Full);
   rename or fix `host.fullDirect.int.test.ts` ~401 so title and assertion agree (a second held row, not a fold);
   confirm an Apply record's automatic cause is still asserted somewhere after `host.scenesEndRoute.int` dropped
   it, and add it if not; add: a match that names `links` on a pending fork; Back on a session's own notes after
   the `holds` widening.
7. **Docs and ledger in the same change:** `docs/lorebooks.md`, `docs/genre-lair.md`, `docs/lorebook-time.md`
   where a sentence now differs; NOMENCLATURE §25 only if a name is added (none expected).

## Files owned

`src/lib/server/pipelines/runtime/host.ts` (the link, history-day and `fileOntoHistoryDay` points only),
`src/lib/server/lorebooks/ownBook.ts` (only to export or reuse the day merge),
`src/lib/client/components/sessionForms/SessionViewPanel.svelte` (the one sentence), their tests and the tests
named in Build 6, the docs above. **Not** `sessions/rewind.ts`, `sessions/settle.ts`, `sockets/sessions.ts`,
`sockets/entries.ts`, `db/schema.ts`, any SDK file.

## Out of scope

The dated change (correction 1); where a Full session with no scenes settles (★FD-1, with the owner); ★FD-5;
the entry switches, edit history and timeline plans; any migration, setting, event or new name.

## Stop and ask when

Build 4's stop; a fix would refuse a write that succeeds today or change Review changes / Off; a file outside
the owned list is needed.

## Done means

New or changed tests prove each of Builds 1–5 through the real outlets and the real Back / Forward, and Build
6's items; the lane's earlier tests still pass: `host.fullDirect.int`, `host.scenesEndRoute.int`,
`host.ownBookFull.int`, `host.historyWrites.int`, `host.forkTiming.int`, `imprints.holds.int`, `imprints.int`,
`autoApply.int`, `autoApply.settle.int`, `loreLinks.int`, `sessions.lairWalk`, `sessions.lairKnock`,
`sessions.lairFileRoom`, `rewind.int`, the `sessionViewPanel.*.dom` tests.
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean; `npm run check`
(`NODE_OPTIONS=--max-old-space-size=12288`) no new errors. Tests only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > log 2>&1"`
from the repo root, one run at a time; another session also runs tests on this checkout: before each run check
`ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` and wait (never `pgrep -f "vitest run"` in a
loop). An int test that opens a DB inside an `it` takes a 60 s timeout. No `npm run sdk:build`; no migration.
Inside a transaction use only `tx`. Comments state the rule, not the story. At most two workers at once.

Verbatim for every worker brief:
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `kill -9`.

## Report

**Return the full report as your final message** (the lead appends it to
`plans/REPORT-full-direct-2026-11-13.md`): what each build does now; what Build 4 reuses and what Back does
after it; tests and results; changed files; open ★; **Noticed, not done**. Say plainly that nothing was looked
at in a running app.
