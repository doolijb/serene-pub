# BRIEF cv-member-w2 — book-side readers of cast versions: registry, history keeping, calendar rows, entity names, seat payloads

Worker (Sonnet) for lane **cv-member**; the supervisor is the cv-member lane-supervisor. App `/home/jody/github/serene-pub`. Report as your final message (no report file), starting `# REPORT cv-member-w2 (2026-11-05)`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

Other agents are editing other files in this repo right now (lanes cv-time and cv-writers, and another cv-member worker on `sockets/lorebooks.ts`, `lorebooks/retold.ts`, `castOwnNames.ts`, `characterBindingSync.ts`). Touch nothing outside **Files owned**. If the task needs another file, stop and say so in your report.

## Background (read these first)
- `plans/REPORT-cv-core-2026-11-05.md` (short) — the one writer of `character_versions` and the reader.
- `src/lib/server/characters/versions.ts` — **read only; never edit it.** You call `insertCharacterVersions(tx, rows)` (the table's ONE INSERT; it draws ids and sets `write_order` from the id unless you pass `writeOrder`).
- `src/lib/server/db/schema.ts` ~9356–9510 (`characterVersions`: `cast_member_id` and `lorebook_id` CASCADE, `branch_id` CASCADE, `history_entry_id` SET NULL, `parent_version_id` SET NULL, `valid_from_message_id` SET NULL; the base unique index `character_versions_base_idx`).
- Plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §32 §1 (~1144–1170), §8 (~1297–1318), §33 (~1396–1409).

## Files owned (edit only these)
- `src/lib/server/lorebooks/tableRegistry.ts`, `src/lib/server/lorebooks/tableRegistry.test.ts`
- `src/lib/server/sockets/lorebooks.duplicate.int.test.ts` (only to add version assertions)
- `src/lib/server/utils/forkHistory.ts`
- `src/lib/server/state/storyTime.ts` (only `datedRowsOf`)
- `src/lib/server/annotations/**` (`index.ts`, `queue.ts`, their tests; a new `src/lib/server/annotations/versionNames.int.test.ts`)
- `src/lib/server/sessions/rowProjection.ts` (only `sessionsWithMemberWords`), its tests `src/lib/server/sessions/rowProjection.*.int.test.ts`
- New tests: `src/lib/server/lorebooks/tableRegistry.versions.int.test.ts`, `src/lib/server/state/datedRows.versions.int.test.ts`

Not `versions.ts`, not `memberAsRead.ts`, not `src/lib/shared/**`, not `NOMENCLATURE.md`, not `utils/lorebookDuplicate.ts`, not `sockets/amendments.ts`, not `sockets/narrativeGraph.ts`.

## Rules you work under (quoted)
- CLAUDE.md P2: "A module owns its data and every write to it … Two writers of one thing is a bug." `versions.ts`: "`insertCharacterVersions(tx, rows)` is the table's only INSERT … Nothing else inserts into or updates the table." → you **never** `insert`/`update` `schema.characterVersions` yourself. Inserts go through `insertCharacterVersions`. The one DELETE you may write is the registry's book-scoped `purge` (the lead's brief: "register `character_versions` (copy with the book, remapping ids and parents; purge with it)").
- `tableRegistry.ts` header: "⚠ Every statement runs on the `tx` handed in. The outer `db` inside a transaction deadlocks PGlite silently."
- **Frozen**: `cast_amendments` is no longer written (plan §32 §8: "`cast_amendments` and the retold columns freeze"); the boot pass lifted every amendment into versions. The member's frozen `lorebook_bindings` columns: retold text, `retold`, `own_name`, `own_nickname`, `face_media_id`, `timbre`, `sprite_set`, `node_state`, `node_visibility` — read them from versions, not the binding, in code you change. `name`, `aliases`, `summary` stay binding columns (also kept on versions).
- A **cast version**: `character_versions` row with `cast_member_id` set; the member's **base** = `card_id` null, `branch_id` null, `year` null, `personal_position` null, `source_session_id` null. A cast version holds a complete character profile; `follows` names the fields it reads from its parent card version (`parent_version_id`). Card versions (`card_id` set) are not the book's.
- The session always has a lorebook — never write "no book" / "no lorebook".
- Names: no new **exported** name, prop, wire field, type, entity-ref kind or key prefix beyond this brief. Private helpers are fine. If you need one, stop and say so.
- Tests: an int test that opens a DB inside an `it` needs a **60 s timeout**. Never pipe vitest into `head`. Run only the files under **Done means**. `npx tsc --noEmit -p .` must show no errors in your files (grep its output for your paths). `npx prettier --check` your files; leave pre-existing format drift on lines you didn't touch and say so.
- Don't add `TODO` comments or "for later" hooks.

## What to build

### 1. `lorebooks/tableRegistry.ts` — register `character_versions`
A `bookScoped(schema.characterVersions, { lineScoped: true, countAs: …, copy })` spec, placed after cast members, lines and entries (it points at all three) — read `LOREBOOK_TABLES`' order rule. The default `bookScoped` purge (delete by `lorebook_id`) stays.
- `copy`: the source book's cast versions (`lorebook_id = from`, `cast_member_id` not null), in id order, inserted with ONE `insertCharacterVersions(tx, rows)` call: `castMemberId` via `maps.bindings` (a row whose member did not copy is left out), `lorebookId: to`, `branchId` via `maps.branches`, `historyEntryId` via `maps.historyEntries`, `parentVersionId` **kept** (card versions are the cards', shared like the member's card link), `writeOrder` **kept** (pass the source's, so the copy reads in the same order), `validFromMessageId: null` (a copy is a real book; it is not tied to the source's turns — check how entries/values copies treat their session ties and match that), `retiredOrder` kept, everything else copied as is. Drop `id`, `createdAt`, `updatedAt`.
- ⚠ The member copy (~line 355) still inserts `lorebook_bindings` rows directly. Do not route it through `insertCastMember` (that would write a second base beside the copied one). Leave it, and say so in the report (the guards lane needs an exception or a writer helper for it).
- `countAs`: check what `count`/`countAs` keys the duplicate test compares (`lorebooks.duplicate.int.test.ts`) and add `castVersions` there; keep `castAmendments` (frozen rows still copy).
- `tableRegistry.test.ts` must be green (cv-core: "Still red, and not mine: `tableRegistry.test.ts`, waiting on V-member registering `character_versions`").
- New `tableRegistry.versions.int.test.ts`: a book with a carded member and a card-less member, a dated version on a line with a history entry, a story-written version (source session set) → duplicate → the copy's versions name the copy's members, line and history entry, keep parent and write order, `validFromMessageId` null; `membersAsRead` on the copy reads what the source reads; purge (book delete and the overwrite purge) leaves none of the copy's versions; the source is untouched.

### 2. `utils/forkHistory.ts`
Every place that looks at `cast_amendments` for a history entry (`found`, `lines`, the re-point at ~460) must also look at cast versions (`character_versions` with `cast_member_id` not null, their `branch_id` and `history_entry_id`) — reads only. The re-point (`UPDATE … SET history_entry_id = to`) of cast versions is a write the versions module has no function for: **do not write it.** Keep the `cast_amendments` re-point as is (harmless; frozen). In the report, say exactly which case loses the link (a cast version on a second fork, dated by a copied history entry) — the supervisor is asking for that writer. Test it: `src/lib/server/sockets/amendments.deleteBranch.int.test.ts` is NOT yours — instead add the version cases to a new `src/lib/server/utils/forkHistory.versions.int.test.ts` (add it to your owned files): a version on a fork dated by a history entry of the deleted line keeps the entry (the first fork gets it moved).

### 3. `state/storyTime.ts` — `datedRowsOf`
Dated cast versions are dated rows the calendar must land (today the cast amendments are): list every cast version of the book's members with a `year` (any line), label exactly as today's cast-amendment rows (`Amendment to <member name>` — the Changes list keeps its words, ★CV-20). Key: check every consumer of `DatedRow.key` (grep); if nothing parses the `castAmendment:` prefix, use `castVersion:<id>` and say so; if something does, stop and report. Stop listing `cast_amendments` (they are lifted; listing both would show each change twice). Test in `datedRows.versions.int.test.ts`; run `src/lib/server/sockets/calendarInvariants.int.test.ts` too.

### 4. `annotations/index.ts` — the vocabulary reads versions
- `amendedNamesOf(db, lorebookId)`'s cast half: every name and alias the book's **cast versions** give their members — own values only (a field in `follows` is the card's, already in the vocabulary through the card's member), on any line, at any date, trimmed, empty dropped, ordered by version `write_order` then id. Stop reading `cast_amendments`. Keep the function name and return shape; update its doc ("the book's cast versions" for "the book's amendments" in the cast half).
- The stored-name half (`bindingNames(binding)`) stays on the binding's `name`/`aliases`/`absorbedAliases` (not frozen).
- **Card-less members stay out** (an `EntityRef` names a card or an entry; a member kind would be a new name — the supervisor is asking the owner). Keep the doc paragraph that says why.
- `amendedNames.int.test.ts` and `castTagAnnotations.int.test.ts` insert `cast_amendments` rows / update binding columns: change them to write versions (through `writeCastVersion(tx, { member, changes: { name, aliases }, writtenBy: "user:<id>", at: { branchId, date, personalPosition: null } })` inside `db.transaction`) and assert the same outcomes. New `versionNames.int.test.ts` if a case needs its own file (a renamed member on a line answers to both names; a followed name adds nothing).

### 5. `sessions/rowProjection.ts` — `sessionsWithMemberWords`
The superset test reads frozen columns and `cast_amendments`. Replace both `or(...)` conditions' member tests with one EXISTS over the member's cast versions: a version where `name`, `nickname` or `faceMediaId` is own (not in `follows`), or any version that is not the base (`year`, `branch_id`, `personal_position` or `source_session_id` not null — a dated card or words may be the active one). Keep the function's shape and doc (update the doc's column list). Run `rowProjection.*.int.test.ts`; fix fixtures that set `own_name`/`face_media_id` on the binding to write the base version instead (`writeCastVersion` author at the base: `at: { branchId: null, date: null, personalPosition: null }`).

## Done means
`npx vitest run --maxWorkers=4` on: `src/lib/server/lorebooks/tableRegistry.test.ts src/lib/server/lorebooks/tableRegistry.versions.int.test.ts src/lib/server/sockets/lorebooks.duplicate.int.test.ts src/lib/server/utils/forkHistory.versions.int.test.ts src/lib/server/sockets/amendments.deleteBranch.int.test.ts src/lib/server/state/datedRows.versions.int.test.ts src/lib/server/sockets/calendarInvariants.int.test.ts src/lib/server/annotations src/lib/server/sessions/rowProjection.batch.int.test.ts src/lib/server/sessions/rowProjection.castNames.int.test.ts src/lib/server/sessions/rowProjection.playerSeats.int.test.ts src/lib/server/sessions/rowProjection.seatCast.int.test.ts` — all green, or each red one explained (pre-existing: show by reading, never by stashing). `amendments.deleteBranch.int.test.ts` is read-only for you: if it goes red because of your change, report it, don't edit it.
Before and after your runs, list `/tmp/serene-pub-vitest-*`; delete only dirs your runs created, by name.

## Report
Final message: what you added (names, signatures); changed files; tests with counts; assumptions; the history-entry re-point gap; the member-copy insert note; Noticed, not done.
