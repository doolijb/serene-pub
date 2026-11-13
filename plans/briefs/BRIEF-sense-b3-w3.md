# BRIEF — worker `sense-b3-w3` — list, Apply and take back a session's cross-book links and history paragraphs

Supervisor: lane `sense-b3`. Repo: /home/jody/github/serene-pub (SDK at ../serene-pub-sdk — you do not edit it).
Use absolute paths. Your report is your final message to the supervisor (no report file).

## Verbatim rules (binding)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You have no reason to run `sdk:build` at all.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9` anything.
  Inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently) — Apply and
  take-back run in one transaction; every helper you call inside gets `t`/`tx`.
- No migration, no schema change. If you think you need one, stop and report.
- It is a **session**, never a *chat*. Every session has a lorebook: never write "no lorebook".
- No reference to any other project or product in code, comments, tests or docs.
- Tests only in a capped scope, never the whole suite, never piped into `head`:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`
  An int test that opens a DB inside an `it` needs a 60 s timeout. `npx prettier --check <file>` on each file you changed
  (existing files already drift; format only what you add). Typecheck:
  `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (report only errors in your files). No dev server.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.
- Re-read the cited lines before changing anything (line numbers drift).
- Every sentence a person can see that you add is provisional: mark it `// 🚧 Provisional copy` and list it verbatim.
  Every new name (type field, kind value, exported function): list it in your report (distinctive, qualified, grep first).

## Rulings that bind

"A turn owns what it wrote." "Only Apply settles." Apply is a **(b) fold** with a change record (`lore_imprints`,
`origin: 'apply'`, one `batch`, a `cause` naming who and the session — built by lanes b1/b2; copy that shape). A session
never writes another session's rows. Only the attached lorebook's owner applies and takes back. **The route and what the
Full write setting does are not changed**; every existing test must pass unchanged (if one would have to change, stop).

## Background (built by the other workers of this lane — read the code, it is on disk)

On the own-book route (a session that reads an attached lorebook it may not write: Review/Off on your own lorebook, or a
member's session on someone else's), the host now writes into the session's own book (`lorebooks.session_id` = the
session):
- **links whose ends may be the lorebook's** — `narrative_relationships` row, `lorebook_id` = own book, `branch_id` null,
  each end an own-book entry, a lorebook entry, or a member (`from_node_id`/`to_node_id`, a `lorebook_bindings` row of
  either book); made-row imprint (`lore_imprints`, `subject_kind 'relationship'`, `field` null) whose `message_id` is
  the turn that wrote it; dated (`history_entry_id`) by the newest history day of the two books — so a link can be
  dated by an **own-book** day;
- **own-book history days**, one per date in the own book, whether or not the lorebook has that date, never a held
  amendment; dates are the lorebook's calendar's;
- own-book entries filed under a **lorebook** cast member (`lorebook_binding_id` = a binding of the attached lorebook).
- **"Does the lorebook hold this day"** is asked through ONE function: `lorebookDayOfDate(tx, { lorebookId, branchId,
  date })` in `src/lib/server/scenes/historyEntryOfDate.ts` (returns `{ historyEntryId, date } | null`). Call it; never
  re-implement the question (the ruled, unbuilt "coarser covers finer" will change it).
- **Ruleset tie rows are not this lane's links:** an own-book `narrative_relationships` row with
  `rules_run_id IS NOT NULL` is never listed, never applied, never counted here.

## Files owned (edit only these)

- `src/lib/server/lorebooks/ownBook.ts` — `overlayItemsOf`, `applyOverlayItems`, `takeBackApply`, `applyHeldAutomatically`,
  `appliedBatchesOf`, and their types / helpers / sentences (`OverlayItem`, `ApplyOverlayResult`, `TAKE_BACK_REFUSALS`…).
  Not `copyOwnBookToBranch` (done), not the routing functions.
- New test file(s): `src/lib/server/lorebooks/applyOwnBookLinksDays.int.test.ts` (one or two files, your names).

Readable: everything. Not `pipelines/runtime/host.ts`, `sockets/sessions.ts`, `shared/sockets/types.ts`,
`SessionViewPanel.svelte` (a later worker wires the payload and the card from your shapes — so make the shapes below
exactly, and report them), `scenes/historyEntryOfDate.ts` (call it, don't edit it).

## Shapes (decided by the supervisor; implement exactly, all additive)

`OverlayItem` gains a third member and one optional field:
```ts
interface OverlayLinkItem {
  kind: "link"
  linkId: number
  /** The entry at the link's `from` end, else its `to` end (a lore link always has an entry end). */
  entryId: number
  typeId: string            // that entry's type
  /** "‹From› ‹wording› ‹To›" — each end named as the session reads it (amended, held included); a member by its shown name. */
  title: string
  /** The made-row imprint's message (the turn that wrote it); null when none. */
  sourceMessageId: number | null
}
// OverlayEntryChangeItem gains:
  /** 🚧 A held history paragraph: the own-book day that carries it (what Apply selects through `entryIds`); `amendmentId` absent. */
  notesEntryId?: number
```
- `amendmentId` on `OverlayEntryChangeItem` becomes optional in the server type only because a paragraph item has none;
  every existing held-change item still carries it.
- `applyOverlayItems` input gains `linkIds?: readonly number[] | null`. Selection: all three absent → everything; any
  given → only those (`entryIds` selects new entries **and** held paragraphs, by the own-book day's id).
- `ApplyOverlayResult` gains `appliedLinks: number[]` (standalone links moved), `mergedDays: number[]` (own-book day ids
  merged), `droppedLinks: number[]` (own-book links the lorebook already said, deleted).

## What to build (item 7)

**List — `overlayItemsOf`.**
1. An own-book history day whose date the lorebook holds **on the session's line** (`lorebookDayOfDate(db, {
   lorebookId: attached, branchId: session reading's branchId, date })`) is listed as **the entry change it is**: kind
   `entry-change`, `entryId` = the lorebook's day, `title` = that day's name as the session reads it, `notesEntryId` =
   the own-book day, `changes: [{ field: "content", label: <the content label as `labelOfKey` gives it>, before: the
   lorebook day's content as the session reads it, after: that content + "\n\n" + the own day's content }]` (the same
   join `fileOntoHistoryDay` uses: blank before → just the paragraph), `conflict` null, `sourceMessageId` = the own
   day's. It is **not** listed as a new entry. An own-book day whose date the lorebook does not hold is listed as today
   (kind `entry`).
2. A **link of the own book whose ends are both outside the own book** — two lorebook entries, or a lorebook entry and a
   member of the **lorebook's** cast — and `rules_run_id IS NULL`, is listed as its own `link` item, oldest first. A
   link with an own-book end is not listed (it travels with its ends, as today). A link with an own-book member end is
   not listed (it stays).

**Apply — `applyOverlayItems`.** Re-check everything inside the transaction (state may have moved since the list).
3. **A merged day.** For a selected own-book day whose date the lorebook holds on the session's line (asked again inside
   the transaction through `lorebookDayOfDate(t, …)`): append its content to the lorebook's day as a paragraph after
   what it holds (the join above; through `writeEntryKeys` so the vector goes stale); **before the own-book day is
   deleted, point every `history_entry_id` that names it at the lorebook's day**, in every table that has the column
   (`db/schema.ts`: `lorebook_bindings`, `scenes`, `narrative_relationships`, `entry_amendments`, `cast_amendments`,
   `character_versions`, `attribute_configs`, `attribute_values`, `state_proposals` — confirm the list by grepping
   `history_entry_id`; scenes cascade on it, and links, amendments and values would lose their dating); collect the ids
   repointed per table. A repoint that would break a unique index (e.g. `narrative_relationships_entry_pair_uq`, which
   includes `history_entry_id`): find such indexes first; if a twin would form, leave that item held and return it in
   `stillHeld`-style form with a 🚧 sentence — report what you chose. File one `origin: 'apply'` record: subject
   `entry`, `subject_id` = the lorebook's day, `field` = its content address (`storedAddressOf`), `before`/`after` the
   content, `message_id` the own day's `source_message_id`, `cause: { ...who, sessionId, messageId, merged: {
   notesEntry: <the own-book day row as it was, plain JSON>, repointed: { <table>: number[] } } }`. Then delete the
   own-book day. Never a second entry for one date.
4. An own-book day whose date the lorebook does **not** hold moves as a new entry, as today.
5. **A standalone link** (listed by 2, selected): moves to the lorebook — `lorebook_id` = the lorebook, `branch_id` = the
   session's line (as moved entries do) — with an `apply` record exactly like the links that ride with entries today
   (`field` null, `cause.moved: { lorebookId: own, branchId, historyEntryId }`, `message_id` = its made imprint's
   message). **Links that ride** (today: entry–entry links with an applied end and no end left in the notes): also move
   when an end is a **member of the lorebook's cast** (today they never move). A tie row never moves.
6. **A moved link's dating:** a link dated by an own-book day that is merged in this Apply is repointed by 3. A link
   that moves while dated by an own-book day that stays in the notes is re-dated to the lorebook's day for that date
   (`lorebookDayOfDate`) or undated when there is none; `cause.moved.historyEntryId` keeps the old value for take-back.
7. **A link the lorebook already says** (the same row would be a twin on the target line —
   `findLinkedThatWay` / the unique index): the own-book copy is deleted instead of moved and returned in
   `droppedLinks`; no record. Say in your report if you think this should rather stay held.
8. An own-book entry moved as a new entry **keeps `anchor_binding_id` when the binding is the lorebook's** (today it is
   always nulled, ~1621 "The notes' cast is not the book's"); an own-book member is still nulled. `cause.moved` already
   keeps the old value.
9. **Settles:** `appliedAnchors` include each moved link's and merged day's anchor; the still-held anchors include each
   standalone link left in the notes (its imprint message) and each own day left. Same rule as today.
10. `applyHeldAutomatically`: what it offers in range now includes the paragraph items (by `notesEntryId` through
    `entryIds`) and the link items (`linkIds`), by the same `within(sourceMessageId)` rule.

**Take back — `takeBackApply`.** All or nothing, checks before writes, as today.
11. A standalone link moved by the batch goes back (`cause.moved`, its dating included). Refuse (🚧) when it is gone:
    `The link ‹title› is no longer in the lorebook, so this can't be taken back.` (title as in 2; your wording may
    differ — report it).
12. A **merged day**: refuses (🚧) `Something was written after this session's paragraph on ‹Day›, so this can't be taken
    back.` unless the lorebook's day content still **ends with** the appended paragraph (the exact `after` suffix); then:
    the day's content becomes what it is now minus that suffix; the own-book day is re-inserted from `cause.merged.
    notesEntry` with its **original id**; each repointed id that still names the lorebook's day is pointed back at it;
    the record is deleted. A day that is gone: the existing `entryGone` sentence.
13. `appliedBatchesOf`: a merged day reads as an `entry-change` item (`title` the lorebook day's, `changes` its content
    before → after); a standalone link as a new item kind `link` with `title` as in 2; `count` counts standalone links
    and merged days (links that ride with entries still do not count). Report the item shape for the payload worker.

## Tests (new file; both situations: own lorebook under Review — `userSettings.loreWriteMode: "review"` — and a member's
session on someone else's lorebook, where only the lorebook's owner may apply; see `lorebooks/heldApply.int.test.ts`,
`applyTakeBack.int.test.ts`, `autoApply.int.test.ts` for setup; insert own-book rows directly or drive the real outlets)

- List: a lorebook–lorebook own-book link and a lorebook-entry–lorebook-member link are `link` items; a tie row is not
  listed; an own-book day for a date the lorebook holds is an `entry-change` with `notesEntryId`; one for a date it does
  not hold is an `entry` item.
- Apply merges a day: the lorebook day gets the paragraph; no second entry for the date; a link, an amendment, a stat
  value and a scene dated by the own day now name the lorebook's day; the record's `cause.merged` lists them.
- Apply moves a standalone link (lorebook line, record filed); a riding link with a lorebook-member end moves with its
  entry; a link the lorebook already says is dropped; an entry filed under a lorebook member keeps its binding.
- Selection by `linkIds` / `entryIds` alone; everything with none; automatic Apply includes both kinds in range.
- Take back: a moved link returns (dating too); a merged day returns (own day re-inserted with its id, repoints undone,
  paragraph removed) while the paragraph is last; refuses with the sentence once something was appended after it.
- Settle line: a still-held link stops the settle before its anchor.

**Regression set — must pass unchanged** (capped scope, batches ≤ 8): `lorebooks/heldApply.int.test.ts`,
`lorebooks/applyTakeBack.int.test.ts`, `lorebooks/applyTakeBack.otherSessionLink.int.test.ts`,
`lorebooks/autoApply.int.test.ts`, `lorebooks/ownBook.int.test.ts`, `lorebooks/ownBook.branchNotes.int.test.ts`,
`sockets/sessions.applyLists.int.test.ts`, `scenes/liveScenes.autoApply.int.test.ts`,
`sockets/sessions.closeOut.int.test.ts`, `sessions/branch.heldAmendments.int.test.ts`,
`sessions/branch.ownBookLinks.int.test.ts`, `sockets/ownBooks.fold.int.test.ts` (all under `src/lib/server/`). A failure
that is not yours (another session's file): report it with file and line, do not fix it.

## Stop and report (do not decide) when

A migration or schema change seems needed; an existing test would have to change; a file outside the list is needed;
a merged day's take-back cannot restore the own-book day with its id; a repoint table you find is not in the list above
and cannot be handled the same way.

## Report (your final message)

Changed files; the final TypeScript shapes of `OverlayItem`, the Apply input and result, and the applied-batch item
(verbatim, for the payload worker); each numbered point built or not and how; every 🚧 sentence verbatim; the unique
index choice (3) and the twin-link choice (7); tests with pass/fail counts; `tsc` for your files; Noticed, not done.
