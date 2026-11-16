# BRIEF — build lane `time-t8` — lines and lists: move an entry down the tree, *could exist here*, bulk edit

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §1 (the Lines and Lists rulings), §2, §5 (rules 8 and 9) and §8
(★9, ★10, ★11), `plans/NOTES-entry-time-and-lines-2026-11-13.md` parts E, F, G (~186–204),
`plans/REPORT-time-t2-2026-11-14.md`, `plans/REPORT-time-t4a-2026-11-14.md`, `NOMENCLATURE.md` §1, §24, §23 and
the rows for *line* / *branch*, **Beginning**, **Decay**, *entry version*, `STYLE-GUIDE.md` (lists, dialogs,
copy, a11y, container queries), `docs/lorebook-time.md` (Branches), `docs/lorebooks.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

Three things in a lorebook's workspace, all the lorebook owner's alone:

1. **Move down the tree.** An entry that lives on a line can be moved, permanently, to a line that line was
   forked from ("down" = toward main), as far as its Beginning allows.
2. ***Could exist here*.** A toggle in the entries list that also shows, muted, entries the line and date being
   read do not read but could: each with the control that would bring it here.
3. **Bulk edit.** A toggle that shows checkboxes in the entries list; select several; act once.

No SDK change. No migration expected (an entry's line is `branch_id`; say so in the inventory, or stop).

## Owner rulings this lane builds (quote them in worker briefs)

- 2026-11-13: "perpetual entries always sit on the earliest point on their branch … a dropdown and button to
  permanently move the entry down the tree. The dropdown shows the current and parents in descending order";
  an entry dated before the split "could theoritically be pulled down as well"; "When moving a child before the
  parent, prompt an approval to move the parent, don't allow children to be moved down without the parent."
- 2026-11-13: "a toggle in the entries list to show entries that could theoritically exist in the current branch
  or time. Show the cards muted and full opacity on hover with a control to move them"; "a toggle to show
  checkboxes, toggle multiple entries and perform bulk edits".
- 2026-11-14, "Lets go with all your recommendations": the chosen screens — **move down as a confirming
  dialog**; ***could exist here* as a group at the end of the list, with the bulk action bar at the bottom**;
  bulk actions (★11): **Beginning, Decay, move down, Pinned / Off / Archive, Delete** (marking *not common
  knowledge* belongs to lane T6 and is not built here); plan §5.8 "Lorebook-wide and permanent actions … are the
  lorebook owner's alone"; §5.9 "A bulk move asks once, naming the count, the parents taken along and the lines
  that will start reading them."
- 2026-11-14, "Go with your safe suggestions" (the lead's stated reading, not contradicted): ★9 **no way back**
  from a move down (the dialog says it is permanent); ★10 *could exist here* lists entries of lines forked from
  this one and entries that begin later, **not** sibling lines' entries.
- 2026-11-14: "hide all the extra time management noise … when timelines aren't enabled": with the Timeline off,
  Beginning is not among the bulk actions and "begins later" is not a reason an entry *could exist here*; lines
  are not part of the timeline, so move down and the line half of *could exist here* stay.
- Standing: "Nothing ever merges between lines, by design" (`docs/lorebook-time.md`) is softened by move down
  only: no merge, no copy to a sibling line, no move up. A move is a person's action, never automatic (P1).

## Build

### A. Inventory first (supervisor, read-only, before any worker) — report with file:line

1. What an entry's line is in storage (`lorebook_entries.branch_id`) and what else is keyed to the same line and
   must be decided on a move: the entry's dated changes (`entry_amendments.branch_id`), links
   (`narrative_relationships`), stats, scenes filed under it, children (`anchor_entry_id`), character lore's
   member binding, the edit history, embeddings, held changes of sessions on that line, session notes that
   overlay the lorebook. The ruled rule: **the entry itself moves; its line-written dated changes and links stay
   on the line they were written on.** Say for each table whether "stays" is already what the reader does when
   the entry row's `branch_id` changes (`rowReadsOnLine`, `amendmentsOnLine`,
   `src/lib/shared/lorebooks/lineReading.ts`), or what would break.
2. The fork date of each line (`lorebook_branches.fork_year` …) and how "as far as its Beginning allows" is
   computed along the chain: a perpetual entry may move to any ancestor; an entry with a Beginning may move to
   an ancestor only while its Beginning is on or before the fork date at every fork on the way.
3. Name clashes: is an entry's name unique per lorebook, per line, or not at all today? The move refuses on a
   clash only where a rule exists today; do not add a uniqueness rule.
4. The existing line actions and their sockets (`amendments:fork`, `renameBranch`, `deleteBranch`, `place`,
   `unplace` in `src/lib/server/sockets/amendments.ts`): is there already a server action that changes a row's
   line (`place` / `unplace`)? Reuse it if it is the same job; if a new event is needed, name it by NOMENCLATURE
   §24 and the sockets ruling and report it.
5. The entries list: where rows are resolved for a line and moment (`LorebooksWorkspace.svelte` `resolveRows`),
   what the list already receives about rows it does not read (the *not yet* count), and what the server would
   have to send for *could exist here* (rows of descendant lines; rows that begin after the moment).
6. Existing bulk or multi-select code anywhere in the lorebook lists (none expected); the per-row actions that
   bulk edit must call (pin, off, archive, delete, the Beginning and Decay saves) and their refusals (a starter
   kit's rows, an earmarked entry, a library piece, a shared reader).

### B. Move down the tree

- Server: one action that moves one or more entries to a named ancestor line, in one transaction under the
  book's lock, only `tx`. It refuses, with a sentence each: a target that is not an ancestor of the entry's
  line; a Beginning the target's fork does not reach (name both dates and the line); a child whose parent is
  not on or below the target unless the parent is in the same request; a name clash where a rule exists;
  a session's notes, a starter kit's row the person may not edit, a non-owner. It records the move in the
  entry's edit history only if the existing record can carry it without a new cause; otherwise report.
- Client: on the entry's own row (the "entry" area the versions lane built), the line is shown (*On ‹line›*);
  beside it, for an entry not on main, **Move down…** opens a dialog: a list of the current line and each
  parent down to main, in that order; a parent the Beginning does not reach is disabled with the reason
  (*Began in Year 5; ‹line› left ‹parent› at Year 3*); the confirmation names the lines that will start reading
  the entry, says its dated changes and links written on ‹line› stay there, and says **it cannot be moved
  back**. When the entry has a parent entry above the target, the dialog asks to move the parent with it (one
  approval, naming it); declining cancels.
- After a move the workspace re-reads; the form stays on the entry.

### C. *Could exist here*

- A toggle in the entries list (off by default, remembered per browser in `localStorage` with try/catch). On, a
  group **Could exist here** at the end of the list shows, muted (full opacity on hover and on keyboard focus),
  the entries the reading does not read but could: entries on lines forked from the line being read (each with
  **Move down…** to this line, enabled only where B allows it, else the reason), and, with the Timeline on,
  entries that begin after the moment being read (each with the date it begins and a control that moves the
  moment bar to that date). Never sibling lines' entries.
- Each row says why it is not read here in a few words (*on ‹line›*, *begins in ‹date›*): plan §5.6, a filter
  shows its cause.
- A muted row opens read-only when selected; nothing about it is editable from this line.
- Counts: the group's rows are not counted in the scope counts, the loose ends or the Everything total.

### D. Bulk edit

- A toggle in the entries list shows a checkbox on each row (not on muted *could exist here* rows, except for
  **Move down…**, where rows of one descendant line may be selected together), a select-all for what is listed,
  and an action bar **at the bottom** of the list with the count: **Beginning…**, **Decay…**, **Move down…**,
  **Pin / Unpin**, **Switch off / on**, **Archive / Unarchive**, **Delete…**.
- Each action is the existing per-entry action applied to each selected entry by one server request per action
  where the server has one, else a short sequence the client reports on honestly: how many changed, and for each
  one refused, its name and the server's sentence. No action is applied to an entry it does not fit (History
  entries take no Beginning; a library piece is skipped with the reason).
- **Delete…** and **Move down…** confirm once, naming the count; a bulk move also names the parents taken along
  and the lines that will start reading the entries (§5.9). **Delete…** says the entries' edit history goes too.
- Owner only; hidden for a shared reader and where the list is read-only. With the Timeline off, no
  **Beginning…**.
- Keyboard and a11y: checkboxes are real checkboxes with the entry's name in their label; the action bar is a
  toolbar with a live count; focus returns to the list after an action.

### E. Docs and names

`docs/lorebook-time.md` (Branches: move down, what stays, that it is permanent; "Nothing ever merges between
lines" amended to say what move down is and is not), `docs/lorebooks.md` (the list's two toggles). `NOMENCLATURE.md`:
rows for **move down** (charter: it owns changing an entry's line toward main; it does not merge, copy or move
up) and ***could exist here***, a §25 line per new name; no retired word. `STYLE-GUIDE.md` if a list rule moves.
No other product's name in any file.

## Two parts

Part 1: the inventory, B (server and dialog) with its tests. Part 2: C and D, only after part 1's tests pass.

## Files owned

- `src/lib/server/sockets/amendments.ts` or a new `src/lib/server/lorebooks/moveDown.ts` with a socket handler
  beside the line actions (decide in the inventory), `src/lib/shared/sockets/types.ts`, and the shared-socket
  registries a new event needs (`shared/sockets/interest.ts`, `client/sockets/typedSocket.ts`, their tests),
  additive lines only
- `src/lib/server/sockets/entries.ts` only for a bulk request the inventory shows is needed
- `src/lib/client/lorebooks/LorebooksWorkspace.svelte`, `EntryPool.svelte`, `EntryWorkspace.svelte` (the entry
  area's **Move down…** only), `time/BeginningDecayRow.svelte`, new components and pure helpers under
  `src/lib/client/lorebooks/` (a move dialog, the bulk bar, the *could exist here* group)
- `src/lib/client/components/Layout.svelte` only to add a new `:error` event to its handled list — another
  session edits that file: add your one line by Edit and tell the lead in the report
- tests beside each; the docs above; `NOMENCLATURE.md`; `STYLE-GUIDE.md`

## Out of scope (write down, never build)

Merging lines; copying an entry to a sibling line; moving up; moving cast members, scenes or history entries
between lines (say in the report what would be needed); marking *not common knowledge* (T6); what sessions write
(T5); the cast list; any SDK or `src/lib/server/pipelines/**` file; `src/lib/server/characters/versions.ts`.

## Stop and ask when

CLAUDE.md §Decisions applies; a migration or a change to how the readers decide what a line reads seems needed;
"its dated changes and links stay" cannot hold for some table without losing or orphaning rows; a move would
change what a running session reads in a way the dialog does not say; a new setting or flag seems needed.

## Done means

- Tests (targeted files only, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t8-<name>.log 2>&1"`
  from the repo root, one at a time; check for a running vitest first; never pipe vitest into `head`; 60 s for
  an int test that opens a DB inside an `it`): the move (perpetual to any ancestor; a Beginning that reaches and
  one that does not, across two forks; child without parent refused, with parent moved; what stays on the old
  line still reads there and does not read on the target; a second boot changes nothing; non-owner, notes,
  starter refused; the source line and sibling lines read as before except for the moved entry); the dialog;
  *could exist here* (what is listed, what is not, counts unchanged, Timeline off); bulk edit (each action, a
  partial refusal reported, the confirmations, owner only).
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors. Do not run the full suite or a build.
- Comments state the rule, not the story. Never `prettier --write` beyond the lines changed.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t8-<date>.md`): the inventory with
file:line; changed files; tests with results; every name, event, sentence and label added; open ★; **Noticed,
not done**. Under about 1,000 words.

## Corrections after the cold review (2026-11-14) — these rule over the text above

1. **Two lanes, not two parts.** `time-t8a` = the inventory and **B** (the move: server action, dialog, tests,
   its docs and names). `time-t8b` = **C** and **D** (the list's two toggles), a separate lane with its own
   supervisor after `time-t8a` is reviewed. This brief serves both; each supervisor is told which.
2. **The label is Move down the tree…** (the owner's phrase). "Move down" / "Move up" already mean reordering a
   list (`EditSessionForm.svelte` ~2398, `PipelineConfigOptions.svelte` ~1904): NOMENCLATURE R1. The row is
   **move down the tree** and records the collision.
3. **What a move touches: only `lorebook_entries.branch_id`** (`schema.ts` ~9150). Verified by the review:
   the old line and lines forked from it read exactly as before (the target is in their chain and the date rule
   keeps the Beginning inside each cut; the old line's dated changes stay and still apply, `amendmentsOnLine`
   ~456–487); the target reads the base row without those changes; lines forked from the target, and their
   descendants, **start** reading it where their cut reaches its Beginning (a perpetual entry: everywhere,
   `lineSql.ts` ~85–90); nothing orphans or doubles; deleting the old line no longer takes the entry
   (`schema.ts` ~9139–9152). Held changes, embeddings and stats need no change. `amendments:place` / `unplace`
   are cast presences, not this job; the one existing move of an entry between lines is `keepHistoryForForks`
   (`utils/forkHistory.ts` ~131–175): use its `pointedAt` list as the inventory's checklist, and name it in the
   charter as the line delete's own writer of `branch_id` (P2).
4. **"The lines that will start reading it" is computed on the client**: it holds every line's rows
   (`listEntryRows`, `sockets/entries.ts` ~254–262) and the line list; run `rowReadsOnLine` per line before and
   after. No server change for that, nor for *could exist here* (`resolveRows`, `LorebooksWorkspace.svelte`
   ~559–578).
5. **Tell the sessions.** After the commit, send `state:changed` to the sessions on every line that starts
   reading the entry and re-send the entry lists to the lorebook's readers, as the line delete does
   (`announceReadingMoved`, `sockets/amendments.ts` ~2502–2522; `relistEntries`, `sockets/entries.ts` ~681–695).
   Scoped events carry their scope key.
6. **History entries are refused by the server**, with a sentence, and are not selectable for a bulk move: a
   history entry moved to a line that already holds one for that day would break one-entry-per-day. Test it.
7. **The per-turn record.** A session-made entry whose per-turn record still stands compares `branchId` among
   its fields (`lorebooks/imprints.ts` ~233, ~683–688); after a move, taking that turn back would keep the entry
   and its **Revert** would delete it from every line now reading it (`imprints.ts` ~882). **Lead's decision
   (★T8-1): the move is refused while the entry has a standing per-turn record of being made or changed by a
   session's turn**, with a sentence saying a turn can still take it back and that it can move once the scene
   settles or the change is kept. Add `lore_imprints` to inventory item 1 and report what "standing" is in code.
8. **Parents.** "The parent must be on the target line or an ancestor of it, at a date the target reads"; the
   rule applies to grandparents in turn. `lorebook_bindings` has no line: character lore's member puts no limit
   on a move.
9. **The edit history cannot record a move** (`redlineKeysOf` has no line key, `redlines.ts` ~223–241): do not
   add one; report it. The move is permanent and unrecorded by ruling (★9).
10. ***Could exist here*, "begins later":** only a row on the reading's chain, after the moment, and **on or
    before its step's fork cut** (`amendmentsAheadOnLine`, `lineReading.ts` ~486–491: a row past the cut is
    "not at all", never "not yet").
11. Bulk **Delete…** also says a shared entry goes from every line that reads it, as the per-entry delete does
    (`docs/lorebook-time.md` ~237). With the Timeline off a stored Beginning still applies a fork cut (★T2-1):
    the move dialog words that refusal without a date (*‹line› left ‹parent› before this entry began*).
12. ★9 and ★10 are ruled (owner 2026-11-13 "permanently move the entry down the tree"; "with a control to move
    them"; 2026-11-14 "Go with your safe suggestions"); recorded in the plan's §8.
