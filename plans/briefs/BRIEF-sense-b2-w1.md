# BRIEF — lane `sense-b2`, worker w1 — Apply records every item, take-back refuses in a sentence, agreed changes are done, Apply settles, Apply happens by itself

You are a `lane-worker` under the `sense-b2` supervisor, in `/home/jody/github/serene-pub` (SDK sibling at
`../serene-pub-sdk`, read-only for you). This is the server domain half of Stage B "Apply in full". Another worker
builds the client card at the same time (different files); a later worker wires sockets and the scene triggers to the
functions you build here. Build exactly the signatures below: the next worker codes against them.

## Verbatim rules (bind you word for word)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`: no SDK code changes.)
- Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9` anything. Never `prettier --write` a directory. No migration, no schema change (stop and report if you think you need one). Inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently). It is a **session**, never a *chat*. Every session has a lorebook (its own book, or an overlay): never write "no lorebook". No reference to any other project or product in code, comments, tests or docs.
- Run tests only like this, never the whole suite, never piped into `head`:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Typecheck: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (report only errors in your files; other sessions are editing the repo). `npx prettier --check <file>` on each file you changed.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Re-read the cited lines before changing anything.

## Files owned (the only files you may edit)

- `src/lib/server/lorebooks/ownBook.ts`
- `src/lib/server/lorebooks/imprints.ts` — only if item A needs it; **the retraction rule (`retractionAct`, `retractImprints`) must not change**.
- `src/lib/server/sessions/settle.ts` — only its header doc comment, to say an Apply moves the line too.
- Tests: `src/lib/server/lorebooks/heldApply.int.test.ts` (update), `src/lib/server/lorebooks/ownBook.int.test.ts` and `src/lib/server/sessions/branch.heldAmendments.int.test.ts` (only where an expectation of Apply's return shape or `batch` moved), and two new files: `src/lib/server/lorebooks/applyTakeBack.int.test.ts`, `src/lib/server/lorebooks/autoApply.int.test.ts`.

## Files readable

Everything. Start with: `src/lib/server/lorebooks/ownBook.ts` 1126–1748 (the overlay list, `heldChangeConflict`, `applyOverlayItems`, `takeBackApply`, `dropTurnTiesOfPlaces`); `src/lib/server/lorebooks/imprints.ts` (`imprintField`, `imprintMade`, the `SUBJECTS.entry.holds` check ~217, `markImprintsKept`, `keptImprintsByEntry`, `retractImprints` — which skips `origin: 'apply'`); `src/lib/server/sessions/settle.ts` (`settleThrough`, `compactThrough`, which never compacts `origin: 'apply'` records); `src/lib/server/state/loreWriteMode.ts` (`bookLoreWriteMode`); `src/lib/server/db/schema.ts` (`loreImprints` ~10809, `lorebookEntries` ~8808, `entryAnnotations` / `messageAnnotations` ~10010–10130, `scenes` ~4840, `sessions.branchOfSessionId` ~2871, `attributeValues` / `attributeConfigs`); `src/lib/server/lorebooks/heldApply.int.test.ts` (fixtures: real held changes through the `update-lore-entry` outlet); `src/lib/server/lorebooks/ownBook.int.test.ts` (own-book entries); `plans/REPORT-sense-b1-2026-11-11.md` (what the slice built).

## Before you write code

List, in your report, every caller of `applyOverlayItems`, `overlayItemsOf`, `settleThrough`, `takeBackApply`
(grep `src`, tests included), and every reader of `lore_imprints` (`schema.loreImprints`) that could select a record
with `origin = 'apply'` and `field IS NULL` (the new entry and link records below): say for each why it is safe, or
stop and report if one is not (for example a reader that offers Revert on a made row, or a count of "made" rows).

## Rules that bind (owner, quoted by the supervisor)

- "Only Apply settles." "A turn owns what it wrote."
- When held changes apply by themselves (owner, 2026-11-12): "At scene close, unless a summary waits" — "Changes apply when a scene closes. If that scene's summary is being written or is waiting for your review, they apply when you save it instead. Default play stays seamless; a reviewed summary still gates its scene."
- P1: every automatic action shows its cause and how to undo it or switch it off (the cause is stored on the records below; the next workers show it).
- No new setting, column, migration, seed or toggle. Automatic Apply runs only when `bookLoreWriteMode(db, lorebookId) === 'full'` (the stricter of the owner's setting and the lorebook's own).
- Take-back restores the lorebook and the held rows and **leaves the settle line where it is** (compaction is one-way). No other settle trigger is touched.

## Build — in this order

### A. Every applied item is recorded (item 1)

In `applyOverlayItems`' transaction, for each **new entry** it moves into the lorebook: read its prior `lorebookId`,
`branchId`, `position`, `anchorBindingId`, `anchorEntryId` before the update (extend the existing select), and after
the move insert one `lore_imprints` row: `sessionId`, `messageId: item.sourceMessageId`, `runId: null`,
`lorebookId: <the lorebook>`, `subjectKind: 'entry'`, `subjectId: <entry id>`, `field: null`, `before: null`,
`after: null`, `origin: 'apply'`, `batch`, `cause: { …who, sessionId, messageId, moved: { lorebookId, branchId,
position, anchorBindingId, anchorEntryId } }` (the prior values). For each **link** that moves with it
(`moving`), one row: `subjectKind: 'relationship'`, `subjectId: <link id>`, `field: null`, `cause: { …who,
sessionId, moved: { lorebookId, branchId } }` (its prior values; extend the links select with `branchId`).
`…who` is `by: { userId }` for a press, and `automatic: <cause>, sceneId?` for an automatic Apply (item E); the
existing held-change records take the same `…who` in place of their `by` when automatic. `batch` in the return is
non-null whenever anything at all was applied (entries or changes). Apply's move must not set `updatedAt` (it does
not today; keep it so — item B relies on it).

### B. Take-back of a whole batch, all or nothing, refusing in a sentence (item 1)

Rewrite `takeBackApply(db, { batch, userId, sessionId? })`: when `sessionId` is given and the batch's records are not
that session's, refuse with `nothing`. Group the batch's records into entry moves (`subjectKind 'entry'`, `field
null`), link moves (`'relationship'`, `field null`) and held changes (as today, by `cause.amendmentId`). **Check
everything first, write nothing until every check passed** (one transaction, the two advisory locks as today). For
each moved entry, refuse when (each with its own sentence, 🚧 provisional, add them to `TAKE_BACK_REFUSALS`):

| Standing case | How to detect | 🚧 Sentence |
|---|---|---|
| the entry is gone from the lorebook | as today (`entryGone`) | existing |
| it is a **place** (`typeId === LOCATION_TYPE_ID`, `$lib/shared/entries/types`) — `dropTurnTiesOfPlaces` re-filed its stat rows untied, so it is never taken back in this lane | type check | `‹Entry› is a place, and a place applied to the lorebook can't be taken back yet.` |
| another link to it | a `narrative_relationships` row with `fromEntryId` or `toEntryId` = the entry, whose `lorebookId` is not the session's own book, and that is not one of this batch's link records | `Something else in the lorebook now links to ‹Entry›, so this can't be taken back.` |
| an amendment on it | an `entry_amendments` row on the entry whose `lorebookId` is not the own book, or whose `base IS NOT NULL` (any session's held change) | `‹Entry› has a change of its own in the lorebook now, so this can't be taken back.` |
| a history day naming it | an `entry_annotations` row with `refEntryId` = the entry whose annotated entry is a history entry (`HISTORY_TYPE_ID`), or a history entry of the lorebook created or updated after the batch's record was filed whose `content` contains the entry's title as a whole word, case-insensitive | `A history day now names ‹Entry›, so this can't be taken back.` |
| the lorebook owner's edit since the Apply | `entry.updatedAt` later than the record's `createdAt` — first confirm (grep every `update(…lorebookEntries…)` / `schema.lorebookEntries` write) that no derived writer (indexing hashes, vectors, annotations) sets `updatedAt`; if one does, store the entry's `updatedAt` after the move in `cause.moved` instead and compare to that, and say so | `‹Entry› was edited in the lorebook since it was applied, so this can't be taken back.` |
| another session's name annotation resolving to it | a `message_annotations` row with `refEntryId` = the entry on a message of another session, or an `entry_annotations` row with `refEntryId` = the entry whose annotated entry lies in another session's own book | `Another session's story names ‹Entry›, so this can't be taken back.` |
| another session's stat rows on it | an `attribute_values` or `attribute_configs` row whose owner is this entry (find which `ownerKind` values address a lorebook entry id) and that is not this session's (`sessionId` set and different, or a book row whose `sourceSessionId` is not this session) | `Another session keeps values on ‹Entry›, so this can't be taken back.` |
| a child entry anchored to it | a `lorebook_entries` row with `anchorEntryId` = the entry, outside the own book, not moved by this batch | `An entry in the lorebook is filed under ‹Entry› now, so this can't be taken back.` |
| its turn is gone | the existing `turnGone` check, for the entry's `messageId` too | existing |

`‹Entry›` is the entry's title (fallback `Entry <id>` as today). Then write: each entry back to `cause.moved`'s
`lorebookId`, `branchId`, `position`, `anchorBindingId`, `anchorEntryId`, with `extraJson.appliedFrom` removed (and
nothing else of `extraJson` touched); each link back to its `cause.moved`; held changes as today; delete the batch's
records. A batch that holds a place refuses whole, writing nothing.

### C. A held change the lorebook already agrees with is done (item 2)

Change the conflict check into a verdict per key: a key **agrees** when the lorebook's resolved value (the `read` the
check already computes) is `sameValue` to the held change's `after` (`fields[key]`); it **conflicts** when it is
neither `base` nor `after`. A held row whose every key agrees is **done**: `overlayItemsOf` does not list it (a list
read writes nothing), and every `applyOverlayItems` call — pressed or automatic, whatever was selected — deletes
every done held row of the session inside its transaction and returns their ids as `dropped`. A partly agreeing row
lists and applies only its other keys: an agreeing key is neither written nor recorded. **The earlier-change case:**
when a key conflicts and an earlier held row of the same session on the same entry (anchor order, `byAnchor`) has
`fields[key]` equal to this row's `base[key]`, the conflict says what is true — 🚧 `An earlier change from this
session to ‹label› is still waiting; apply it first.` (`lowerFirst(label)`). Apply all still folds both, in order.
Branch case to test: a branch's held copy of a change its original then applied is dropped, not a conflict.

### D. Apply settles (item 3)

Inside `applyOverlayItems`' transaction, after the moves and folds: `newest` = the greatest non-null anchor among the
items applied (new entries' `sourceMessageId`, held changes' `sourceMessageId`); `oldestHeld` = the least non-null
anchor among the items still held once this Apply is done (own-book entries still listed, held rows still present —
read inside the transaction; done rows dropped are not held). `through = oldestHeld == null ? newest : min(newest,
oldestHeld - 1)`. When `through` is not null: `settled = await settleThrough(t, sessionId, through, { userId })`.
Return `settled` (null when nothing moved or nothing applied). Remove the "Apply does not move the settle line"
comment. **Never emit inside the transaction**: the caller announces (`announceHistorySettled`) after commit — not
you. `takeBackApply` never touches the line. Update `settle.ts`'s header doc comment (one clause: an Apply moves it,
never past the message before the oldest item still held). Rewrite heldApply's "Back of the anchor's message after an
Apply leaves the lorebook as applied" test: Back now refuses with the existing settled sentence
(`SETTLED_SENTENCE`), and the lorebook still reads the applied value.

### E. Automatic Apply — the domain function (item 5)

```ts
export type AutomaticApplyCause = "scene-close" | "scene-summary" | "close-out"
export async function applyHeldAutomatically(
	db: Db,
	input: { sessionId: number; automatic: AutomaticApplyCause; sceneId?: number }
): Promise<(ApplyOverlayResult & { userId: number }) | null>
```
`ApplyOverlayResult` is `applyOverlayItems`' return type (export it): `{ lorebookId, applied, appliedChanges,
stillHeld, batch, dropped, settled }`. `applyOverlayItems` gains an optional `automatic?: { automatic:
AutomaticApplyCause; sceneId?: number }` input that only changes the records' `…who`.

**Never throws** (catch, `console.warn("[apply] …")`, return null) and opens its own transaction only through
`applyOverlayItems`; it must never be called with a transaction handle (say so in its doc comment). Returns null and
writes nothing unless **all** hold: the session exists, reads a lorebook, and its own book overlays it; the session
is not a branch (`branchOfSessionId` null); the session's owner is the lorebook's owner;
`bookLoreWriteMode(db, lorebookId) === 'full'`.

- **through:** for `scene-close` and `scene-summary`, the scene (`sceneId`, must be this session's) must be closed —
  `closedAtMessageId`, or for a scene captured by selection the greatest of `selectedMessageIds`; otherwise null.
  For `close-out`, no bound.
- **the scene's own wait:** for `scene-close`, when that scene's `summaryStatus` is `running` or `review`, return
  null (its summary's save applies it later).
- **a waiting summary gates its scene:** `waitingStart` = the least start (`openedAtMessageId`, else the least of
  `selectedMessageIds`) among this session's scenes whose `summaryStatus` is `running` or `review`, any channel.
- **eligible items** (from `overlayItemsOf`): anchor null, or anchor ≤ through (when bounded) and < `waitingStart`
  (when set); and the item is a new entry (additive) or a held change whose `conflict` is null (clean). None
  eligible → null.
- Then `applyOverlayItems(db, { sessionId, userId: <session owner>, entryIds, amendmentIds, automatic })` — always
  pass both lists (empty arrays when none), so it never means "everything" — and return its result with `userId`.

### F. The two list reads (item 6's data)

```ts
export async function appliedBatchesOf(db: Db, sessionId: number): Promise<Sockets.Sessions.AppliedBatches.Batch[]>
export async function overlayAccessOf(db: Db, sessionId: number, userId: number): Promise<{ mayApply: boolean; appliesItself: boolean }>
```
The wire types are already in `src/lib/shared/sockets/types.ts` (`Sockets.Sessions.AppliedBatches`, read them;
the global `Sockets` namespace is ambient). `appliedBatchesOf`: this session's `origin = 'apply'` records grouped by
`batch`, newest first (by the batch's greatest record id); `at` the batch's earliest `createdAt` as ISO; `by` from
`cause.by.userId` with the person's shown name (find the users table's display name, falling back to the username),
null when automatic; `automatic` and `sceneId` from the cause, null when absent; `items`: one per moved entry
(`kind: 'entry'`, the entry's current title, `""` when none) and one per held change (`kind: 'entry-change'`, the
entry's title, `changes` with `labelOfKey` labels and `unwrap`ped `before`/`after`); links are not items; `count =
items.length`. `overlayAccessOf`: `mayApply` — `userId` owns the session's lorebook; `appliesItself` — the session's
owner owns it, the session is not a branch, and `bookLoreWriteMode` is `'full'`. Both false when the session reads no
lorebook.

## Done means — tests that fail before and pass after

New `applyTakeBack.int.test.ts`: an applied new entry files a record (batch non-null with entries only); taking it
back moves it and its links back with their prior position, `anchorBindingId`, `anchorEntryId`, `branchId`, and
`extraJson.appliedFrom` gone, and it is listed again; take-back refuses, **writing nothing** (assert the entry,
links and records unchanged), for each standing case in the table (one `it` each) and for a batch holding a place;
a done held row is not listed and Apply drops it; a branch's held copy of a change its original applied is dropped,
not a conflict; the earlier-change sentence, and Apply all folding both in order; Apply settles through the newest
applied anchor and not past the message before the oldest still-held item; Back below the line then refuses with
`SETTLED_SENTENCE`; take-back leaves `sessions.settled_message_id` where it was.

New `autoApply.int.test.ts`: applies (Full, owner, not a branch) the items through a closed scene's close and leaves
later ones held; records carry `cause.automatic` and `sceneId`, never `by`; `scene-close` returns null while that
scene's summary is `running`, and while `review`; `scene-summary` applies once it is `done`; a scene still `running`
elsewhere gates items from its start; `close-out` applies everything eligible; returns null and writes nothing for a
member's session (session owner ≠ lorebook owner), a branch, a lorebook whose mode in force is Review or Off — once
set at the owner's level (`user_settings.lore_write_mode`) and once at the lorebook's (`lorebooks.lore_write_mode`) —
and leaves a conflicted item held; a thrown error inside returns null (stub one read to throw).

Run, capped: your two new files, `heldApply.int.test.ts`, `ownBook.int.test.ts`, `ownBook.test.ts`,
`imprints.int.test.ts`, `imprints.rule.test.ts`, `src/lib/server/sessions/settle.int.test.ts`,
`src/lib/server/sessions/branch.heldAmendments.int.test.ts`, `src/lib/server/state/heldAmendments.undo.int.test.ts`,
`src/lib/server/state/heldAmendments.readers.int.test.ts`, `src/lib/server/state/heldAmendments.exclusions.int.test.ts`,
`src/lib/server/sessions/rewind.int.test.ts`. `tsc` clean in your files. Prettier check each changed file.

## Stop and ask (in your report) when

Anything needs a migration or schema change; take-back of an entry cannot be made all-or-nothing from what `cause`
stores; a reader of `lore_imprints` would mistake the new records; you would need to edit a file not listed above
(including `pipelines/runtime/host.ts`, `state/write.ts`, `sockets/*`). Do not decide those: report the options.

## Report

Your final message: changed files; the caller and reader inventory; each decision you made inside scope; every
🚧 string verbatim; tests run with pass/fail counts; **Noticed, not done**.
