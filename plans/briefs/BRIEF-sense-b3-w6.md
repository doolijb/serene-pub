# BRIEF — worker `sense-b3-w6` — docs, SDK JSDoc and NOMENCLATURE for the own-book route (item 8)

Supervisor: lane `sense-b3`. Repos: /home/jody/github/serene-pub and /home/jody/github/serene-pub-sdk. Use absolute
paths. Your report is your final message to the supervisor (no report file).

## Verbatim rules (binding)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — **Do not run `sdk:build` at all**; the supervisor decides.
- Never `git checkout` / `restore` / `stash` in either repo (most of the SDK repo is uncommitted). Never run npm at the
  SDK root. Never `prettier --write` on a directory.
- It is a **session**, never a *chat* (except chat-completions wire vocabulary). Every session has a lorebook (its own
  notes, or one it reads): never write "no lorebook". No reference to any other project or product, in either repo.
- In user docs the own book is called the session's **notes** / **Session notes** (see `docs/lorebooks.md` "Your
  session's own notes"); in the SDK guide and NOMENCLATURE it is the **own book**. Do not merge the two vocabularies
  (NOMENCLATURE R5).
- NOMENCLATURE: **R1** one word, one meaning · **R2** distinctive words for new concepts · **R3** qualify, never the bare
  noun · **R6** mark 🚧 provisional vocabulary. "When you add or rename a term, record it in **§25 Change ledger** in
  the same change." Read §1, §24 and the §25 entries for `sense-b1` and `sense-b2` (grep `sense-b1`, `sense-b2`,
  `held amendment`, `own book`) and follow their form exactly. §23 retired words: never reintroduce one.
- JSDoc only in the SDK: **no code change** in `../serene-pub-sdk/contracts/src/outlets.ts` (a comment edit only; no
  published name, port or shape changes).
- Write only what is true of the code on disk. Read the code first (below); when the code and this brief differ, say so
  in your report and write what the code does.
- Every sentence you add to user docs is provisional copy 🚧: list each new or changed paragraph's first words in your report.

## What was built (lane `sense-b3`; read the code to confirm)

On the **own-book route** — a session that reads an attached lorebook it may not write (**Review changes** or **Off** on
your own lorebook, or your session on a lorebook someone else owns) — the session's writes land in its own book, and:
1. **Match over what the session reads, own book first** (`create-lore-entry`'s `match`, `pipelines/runtime/loreMatch.ts`
   `findLoreMatch`): the own book first; only with no hit there, the lorebook's entries as the session reads them, where a
   hit is a held change (not a duplicate). Two hits refuse within one book, never across. `bind` accepts a member of the
   lorebook's cast as well as the own book's. A new place's Exits line links over both books, own book first.
2. **A link may join the two books** (`host.ts` `resolveLoreLinkEnd`, `writeLoreLink`, `link-lore-entries`): the row is
   stored in the own book; its ends may be own-book entries, the lorebook's entries, or members. A link the lorebook (or
   the own book) already holds is not written again (`written: false`). Ruleset tie copies (`rules_run_id` set) never
   count. "Both ends of a link live in one book" is no longer said on this route; an id in neither book is refused with
   `entry ‹id› is not in this session's lorebook or its notes, so there is nothing here to link it to.` Under Full and
   for a session whose lorebook is its own notes alone, unchanged. A session's private link does not act on anyone else
   (undo, fork history, take-back — `‹Entry› is linked from another session's notes, so this can't be taken back.`).
3. **History days are always the own book's** on this route: one per date in the own book, dates checked against the
   lorebook's calendar, never a held change to the lorebook's day. "Does the lorebook hold this day" is one function
   (`scenes/historyEntryOfDate.ts` `lorebookDayOfDate`).
4. **The session reads its own book where it reads the lorebook:** the names vocabulary includes the own book's entries
   (own book first; under Full too); the graph's links keep an own-book link with a lorebook end and name its ends as the
   session reads them; the prompt's current date and the dating of this route's writes count the own book's history
   days (`writeDatingAt` / `sessionStoryNowOf` unchanged: stats, timeline, cast versions date by the lorebook alone).
5. **A turn owns them:** swipe, regenerate, Back and delete take the turn's own-book entries, history days, paragraphs
   and links (cross-book included); Forward and a failed re-tell restore them. A press-started run (no turn message):
   entries and new days anchor to the newest message; links now do too; a paragraph onto an existing day is not
   anchored (Back of the newest message can revert it with the turn's own paragraph — a known gap, not documented as a
   feature).
6. **A branch** copies the own book's links for a session that reads an attached lorebook too, cut at the fork message
   (by each link's made-record message); an entry filed under a lorebook cast member keeps that member. Tie rows are not
   copied.
7. **Listed and applied** (`lorebooks/ownBook.ts`): the "This session only" card lists a link whose ends are both the
   lorebook's (two entries, or an entry and a lorebook cast member) as its own item, and an own-book history day whose
   date the lorebook holds as a change to the lorebook's day (a paragraph). **Apply**: such a link moves to the
   lorebook on the session's line; a day is **merged onto the lorebook's day** (a paragraph after what it holds), never a
   second entry for one date, and everything dated by the session's day is re-dated to the lorebook's; a link with a
   lorebook-member end moves with its entry; a link the lorebook already says is dropped. **Take back** returns a link,
   and a merged day while its paragraph is still the day's last; otherwise `Something was written after this session's
   paragraph on ‹Day›, so this can't be taken back.` (Read `TAKE_BACK_REFUSALS` and `MERGE_HELD_REASONS` in
   `ownBook.ts` for every sentence.)
**Not changed:** the route; what **Full** does (writes to the lorebook as before); `loreWriteRoute` and its rule.

## Files owned (edit only these)

- `docs/lorebooks.md` — "Your session's own notes" (~222) and "Bringing a session's changes into the lorebook" (~232),
  and any sentence in "What a session may write" / "Changes from a replaced reply" that is now false (say which).
- `docs/session-actions.md` — "What a branch copies" (~129–140): the own-book row now true for a session that reads a
  lorebook too.
- `../serene-pub-sdk/guides/storage.md` (~45–70 and wherever it states the one-book rule or the branch copy).
- `../serene-pub-sdk/contracts/src/outlets.ts` — JSDoc only, at: `update-lore-entry@1` "How the change lands" (~1840),
  `link-lore-entries@1` "One lorebook, both ends" (~1905), `LoreMatch` (~2031): make each true of the own-book route
  (and still true of Full).
- `NOMENCLATURE.md` — the rows for **own book** (what it now holds and owns: cross-book links, its history days) and any
  row this changes (find them); new 🚧 names in §25, one entry dated 2026-11-12 for `sense-b3`, in the existing form:
  the overlay item kind `link`, `notesEntryId`, Apply's `linkIds` / `appliedLinks` / `mergedDays` / `droppedLinks` /
  `heldDays`, `lorebookDayOfDate`, `LoreWriteLine.alsoReads`, `ownBookDaysCounted` (internal), the `cause.merged` /
  `cause.standalone` keys of an Apply record. Grep each in both repos first and note any collision.

Readable: everything. Do not edit code.

## Done means

Each file above true of the code; `npx prettier --check` on each Markdown/TS file you changed reports no new problem in
your lines (the SDK `outlets.ts` may have prior drift; leave it); no "chat", no "no lorebook", no other project named.

## Report (your final message)

Changed files in each repo; per file, which sections changed; every new or changed user-facing paragraph's first words
(🚧); the NOMENCLATURE rows and §25 entry added; any place the code differed from this brief; Noticed, not done.
