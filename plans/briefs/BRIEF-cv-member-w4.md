# BRIEF cv-member-w4 — dated changes become cast versions (sockets/amendments.ts)

Worker (Sonnet) for lane **cv-member**; the supervisor is the cv-member lane-supervisor. App `/home/jody/github/serene-pub`. Report as your final message (no report file), starting `# REPORT cv-member-w4 (2026-11-05)`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

Other agents are editing other files right now (lanes cv-time, cv-writers; another cv-member worker on `sockets/narrativeGraph.ts`). Touch nothing outside **Files owned**. If the task needs another file, stop and say so.

## Background (read first)
- `plans/REPORT-cv-core-2026-11-05.md` (short).
- `src/lib/server/characters/versions.ts` — **read only, never edit.** You call `writeCastVersion(tx, { member, changes, writtenBy, at })` (author path: `at: { branchId, date, historyEntryId?, personalPosition }` — read `authorWrite`: it updates in place the version at exactly that key with no source session and no retire mark, else inserts a copy of the version in force there with the changes), `retireOrTakeVersions(tx, rows)` (deletes a story-written row, or retires it when a branch still reads it; **skips rows with no `sourceSessionId`**), type `CastVersionChanges`.
- `src/lib/server/lorebooks/retold.ts` — read only. The one mapping between the legacy member columns and versions: `memberColumnsOfVersion(version, { carded })` → `MemberColumnsOfVersion` (a version in the member row's column names), `castChangesOfMemberEdit(before, after, card)` → `CastVersionChanges | null` (only touched fields; runs `memberProfileOf`). See how `sockets/lorebooks.ts` uses them in `writeMemberEdit` (read only) — follow the same pattern.
- `src/lib/server/cast/memberAsRead.ts` — `castVersionsInForce(db, memberIds, { reading, appearance })`, `membersAsRead`, `memberAsRead` (read only). `src/lib/shared/lorebooks/lineReading.ts` — `versionInForce(rows, line, moment, appearance)`, `rowReadsOnLine`. `src/lib/server/state/reading.ts` — `lineOfBook(db, lorebookId, branchId)`.
- Plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §32 §3 (~1214–1225), §9 (~1319–1331), §33 (~1396–1409).

## Files owned (edit only these)
- `src/lib/server/sockets/amendments.ts`
- Tests: `src/lib/server/sockets/amendments.int.test.ts`, `amendments.anchor.int.test.ts`, `amendments.deleteBranch.int.test.ts` (only where they insert/assert cast amendments), new `src/lib/server/sockets/amendments.castVersions.int.test.ts`.

Not `versions.ts`, `retold.ts`, `sockets/lorebooks.ts`, `memberAsRead.ts`, `src/lib/shared/**` (incl. `shared/sockets/types.ts`), `NOMENCLATURE.md`, `sprites/choices.ts`, `state/lineSql.int.test.ts`.

## Rules (quoted)
- CLAUDE.md P2: "A module owns its data and every write to it … Two writers of one thing is a bug." `versions.ts`: "Nothing else inserts into or updates the table." → never `insert`/`update`/`delete` `schema.characterVersions` yourself. Read-only selects are fine.
- Plan §32 §8: "`cast_amendments` and the retold columns freeze." → **`cast_amendments` is never written again** by this file (no insert, update or delete of cast rows). Entry amendments (`entry_amendments`) are unchanged — leave every entry path exactly as it is.
- Frozen member columns (read their values from versions, never write them): retold text, `retold`, `own_name`, `own_nickname`, `face_media_id`, `timbre`, `sprite_set`, `node_state`, `node_visibility`.
- ★CV-20 (lead-recommended, built unless the owner says otherwise): "the member page keeps its **Changes** list and words (each row a version, showing what changed from the one before)."
- ★CV-13 (owner): editing an older version → "_2 later versions keep their own words_ + **Change later versions too**, which writes the same edited fields onto those later versions on the shown line".
- ★CV-15: a version carries its life point (`personal_position`).
- Inside `db.transaction(async (tx) => …)` use only `tx`. Keep `lockBookCalendar(tx, lorebookId)` + `assertDateLands` on every dated write, as today.
- The session always has a lorebook — never write "no book".
- Names: no new exported name, wire field, prop or type beyond this brief. Private helpers are fine.
- Tests: DB-in-`it` needs a 60 s timeout; never pipe vitest into `head`; run only **Done means**; `npx tsc --noEmit -p .` clean for your files (grep for your paths); `npx prettier --check` your files (leave untouched-line drift, say so). No `TODO` comments.

## What to build

### 1. `buildAmendmentsList` — the cast half lists versions (★CV-20)
Keep the wire shape (`cast: { id, castId, lorebookId, branchId, year, month, day, fields, historyEntryId, personalPosition, createdAt, updatedAt }[]`). Each row is now a **cast version** of a member of this book (`character_versions.lorebook_id` = the book, `cast_member_id` not null) that is **not the base** (base = `branch_id` null, `year` null, `personal_position` null, `source_session_id` null) and **not retired** (`retired_order` null — the book's own screens don't read retired rows). `id` = the version id; `castId` = its member.
`fields` = what changed **from the one before**, in the legacy member column names (the client still reads them): `memberColumnsOfVersion(prev)` vs `memberColumnsOfVersion(this)` (`carded` = the row has a parent), keeping only keys whose values differ (deep-equal), plus `characterId` = this version's parent card id when it differs from `prev`'s (null when this one is card-less and prev wasn't). `prev` = `versionInForce` over the same member's other rows that are earlier than this one (earlier date, or the same date and lower `write_order`), on this row's line (`lineOfBook(db, book, row.branchId)`), at this row's date, `appearance` = this row's `personal_position`. A row with no `prev` (shouldn't happen: the base precedes every dated row) diffs against an empty projection. Read the parent card versions in one query (their `card_id`). Do it in a bounded number of queries for the whole book (one for versions, one for parents, one for lines), not per row.
Stop reading `cast_amendments`.

### 2. `amendments:create` with a `castId` → a cast version
Keep: book ownership, the primer check, `assertDate`, `assertBranch`, `assertHistoryEvent`, the member-in-book check, `assertPersonalPosition`, `cleanFields` → `cleanCastFields` (its validation and refusal words stay; its provided-book face check reads the stored face from the member's **base version projection** (`memberColumnsOfVersion`), and for an update, the edited version's projection, instead of the frozen columns and `cast_amendments.fields`).
Then in `writeDated`'s transaction (after `lockBookCalendar` + `assertDateLands`):
- `inForce` = the version in force at (`branchId`, date, `personalPosition`) — `castVersionsInForce(tx, [member], { reading: { branchId, moment: date, forkedAt: null, line: await lineOfBook(tx, book, branchId) }, appearance: personalPosition })` (that is what `authorWrite` copies; read it to match).
- `before` = `memberColumnsOfVersion(inForce, …)` + `characterId` (its parent's card); `after` = `before` ⊕ `fields` (`retold` overlaid whole, as the old amendment did); `card` = the parent card version's profile. `changes = castChangesOfMemberEdit(before, after, card)`.
- **A card in `fields`** (`characterId` that differs from `inForce`'s parent card, or null on a carded one): the versions module has no writer that re-parents a version yet. Refuse, before writing anything, with exactly: `"Changing the card a cast member is drawn with at a date isn't available yet."` (🚧 provisional words; the supervisor asks the owner.) Keep `assertCardFree`'s check for the case where it applies.
- `changes` null → refuse with the existing sentence for a change that sets nothing.
- Else `writeCastVersion(tx, { member, changes, writtenBy: \`user:${userId}\`, at: { branchId, date: {year, month, day}, historyEntryId, personalPosition } })`.
- ★CV-13 option: `changeLaterVersions?: boolean` (typed locally: `Sockets.Amendments.Create.Params & { changeLaterVersions?: boolean }`). **Later versions** = the member's versions on the same `branchId` that are later than the written one (later date, or same date and higher `write_order`), not retired, not the base. When true, apply the same `changes` to each later one that has no `source_session_id` with `writeCastVersion` `at` its own key (branch, date, historyEntryId, personalPosition) — it updates in place. A later version with a source session, and (when `changes` carries a follow) one with no parent, keeps its words. The response gains, typed locally, `laterVersions: { changed: number; kept: number }` (kept = all of them when the option is off). `sockets/lorebooks.ts`' `updateBinding` does the same for the base — read it and share nothing but the pattern (it's another file).

### 3. `amendments:update` with `subject: "cast"`
`params.id` is a version id now. Look it up scoped by `lorebook_id` (refuse with the existing "That amendment is not in this lorebook." when missing, the base, or retired).
- **A re-date** (any of `year`/`month`/`day` given and different from the stored date) — no writer moves a version yet: refuse with exactly `"Moving a cast member's change to another date isn't available yet."` (🚧 provisional).
- **A story-written version** (`source_session_id` not null) — the author path can't edit it in place yet: refuse with exactly `"Changes a session wrote can't be edited here yet."` (🚧 provisional).
- Otherwise `fields` replaces the change's whole field set, as an amendment's update did: `prev` as in item 1; `before` = `memberColumnsOfVersion(this)` (+ `characterId`); `after` = `memberColumnsOfVersion(prev)` ⊕ `fields`; a card change refuses as in item 2; `changes = castChangesOfMemberEdit(before, after, card)`; null → nothing to change (the existing "Nothing to change." refusal); else `writeCastVersion` `at` this version's own key (updates it in place). The ★CV-13 option and `laterVersions` as in item 2.

### 4. `amendments:delete` with `subject: "cast"`
`params.id` = a version id, scoped by book; the base or a retired row → "That amendment is not in this lorebook.". A story-written version → `retireOrTakeVersions(tx, [row])` in a transaction. An authored one (no source session) — no writer deletes it yet: refuse with exactly `"Removing a cast member's change isn't available yet."` (🚧 provisional).

### 5. `cardMemberAt` — reads versions
Keep its signature and return shape (`{ member, appearances: [{ personalPosition, member }] } | null`; `sprites/choices.ts` and `state/lineSql.int.test.ts` call it — read what fields of `member` they use). `member` = the member row with its frozen columns projected from the version in force at `at` (null appearance) via `memberColumnsOfVersion`, and `characterId` = that version's parent card id (the active card; "Everything in session is cast -> active card"); each appearance's `member` the same at its `personalPosition` (`castVersionsInForce` with `appearance`). Presences unchanged. Update the docstring (the "one resolver" paragraph now names `versionInForce` / `castVersionsInForce`).

### 6. Nothing else in the file writes `cast_amendments`
grep `castAmendments` in the file when done; only reads that are explicitly kept may remain (say which). Branch fork/rename/delete handlers: a deleted line's versions go by cascade (`branch_id` CASCADE); check `amendmentsDeleteBranchHandler`'s cast-amendment handling and make it not write `cast_amendments` (leave entry amendments alone).

### 7. Tests
New `amendments.castVersions.int.test.ts` (60 s timeouts): **dated change round trip** — create a cast change at Y10 (`description` retold) → a version at Y10 exists, `memberAsRead` at Y12 reads it and at Y5 reads the base, the list shows one cast row whose `fields` are `{ description, retold }` diffs and nothing else; update its fields → same version id, new words; a second change at Y20 lists only what differs from Y10; life point: a change at personal position 40 lists `personalPosition: 40` and `memberAsRead` with `appearance: 30` doesn't read it; `changeLaterVersions` on/off counts; the four refusals (card change, re-date, story-written edit, authored delete) each with its exact words and nothing written; a story-written version (make one with `writeCastVersion` `session`, or insert via `insertCharacterVersions` with `sourceSessionId`) is deleted by `amendments:delete`; no `cast_amendments` row is written by any of it; `cardMemberAt` reads the version (and an appearance at a life point).
Update the existing amendments tests that create/assert cast amendments to the new behaviour (or, where they test entry amendments only, leave them).

## Done means
`npx vitest run --maxWorkers=4 src/lib/server/sockets/amendments.castVersions.int.test.ts src/lib/server/sockets/amendments.int.test.ts src/lib/server/sockets/amendments.anchor.int.test.ts src/lib/server/sockets/amendments.deleteBranch.int.test.ts src/lib/server/state/lineSql.int.test.ts src/lib/server/sprites` — green, or each red one explained (by reading; never stash). `lineSql.int.test.ts` and `src/lib/server/sprites` are read-only for you: if they go red because of you, fix your code, not them, or report.
List `/tmp/serene-pub-vitest-*` before and after; delete only dirs your runs created, by name.

## Report
Final message: names/signatures; changed files; tests with counts; each existing test changed and why; the remaining `castAmendments` reads; assumptions; Noticed, not done.
