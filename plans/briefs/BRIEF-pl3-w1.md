# BRIEF pl3-w1 — Clone with changes carries the notes' values into the copy (owner ruling ★pl2-1, 2026-11-05)

Lane **pl3**, worker **w1**. Supervisor: the pl3 lane-supervisor. Work from `/home/jody/github/serene-pub`. Another worker (w2) is editing `src/lib/server/state/write.ts` and `src/lib/server/state/worldScope.int.test.ts` at the same time; Stage S1 of another programme edits `db/schema.ts`, `drizzle/**`, `sessions/seats.ts`, `sessions/seatMembers.ts`, `sockets/sessions.ts`, `sockets/import.ts`, `sessions/branch.ts`, `sessions/envoys.ts`, `sessions/seatBookCast.ts`, `startup/index.ts`. Never touch any of those.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

The owner ruled (★pl2-1, 2026-11-05): *"Clone writes the notes' changes into the copy"* — when a session that kept values in its notes (`keepsValuesInOwnBook`) uses **Clone with changes**, the same transaction writes the notes' values into the copy's own rows, then the notes' copies are cleared, so nothing silently disappears and nothing double-reads.

Where the notes' values live today (m3b-V2 + pl2):
- the world: `attribute_values` rows with `owner_kind='lorebook'`, `owner_id = <own book id>` (book layer: `session_id` NULL; dated by `branch_id`/`history_entry_id` from the session's reading of the **attached** book; `valid_from_message_id` may be set — w2 is making these anchored to the turn);
- a person: `attribute_values` rows with `owner_kind='cast_member'`, `owner_id = <own-book member id>` (a `lorebook_bindings` row of the own book, matched by `character_id`);
- a place of the attached book: the notes' rule-fed overlay `lorebooks.extra_json.ruleFed.placeValues[<book entry id>][<slot id>] = value` (null = cleared → the book's value; reader `placeValuesOf(extraJson)` in `rulesets/ties.ts`). `cloneWithChanges` already rekeys it to the copy's entry ids.
- Reads (resolve.ts `chainFor`/`sessionLinks`): only while `keepsValuesInOwnBook` is true are the notes' `lorebook` row and `placeValues` read, and the own-book member read **before** the attached book's member. After a clone the session owns the copy, so `keepsValuesInOwnBook` turns false: the session then reads `castMemberId ?? ownBookMemberId` (the copy's member when it has one, else the notes' member) and never the notes' `lorebook` row or `placeValues`.

## The change (decided by the supervisor — build exactly this)

In `src/lib/server/lorebooks/ownBook.ts`, function `cloneWithChanges` **only** (~lines 989–1189; the file is dirty at HEAD from other lanes — additive hunks, never reformat, re-read before editing):

1. **Before** the transaction: `const keeps = await keepsValuesInOwnBook(db, sessionId)` (same file). The carry runs only when `keeps` is true. (An owner's own-book session keeps nothing in the notes that its copy would read.)
2. **Inside** the existing `db.transaction`, inside the existing `if (own) { … }` block, after `maps` exist and the session row has been moved onto the copy. **Use only `tx`/`t` inside the transaction — the outer `db` deadlocks PGlite silently.** Helpers may be dynamically imported (`await import(...)`) the way this file already does; never add a static import of `$lib/server/db`.
   - **World:** every `attribute_values` row (and every `attribute_configs` row — see 5) with `owner_kind='lorebook'`, `owner_id = own.id` → a **new** row on `{ owner_kind: 'lorebook', owner_id: copy.id }`.
   - **People:** own-book members → the copy's member for the same character. Use `castMemberCards` (`$lib/server/utils/castMemberCards`, dynamic import; it never imports `$lib/server/db`) on `own.id` and on `copy.id`: for each `characterId → ownMemberId` in the own book's `memberOf`, the target is the copy's `memberOf.get(characterId)`. When the copy holds no member for that character, carry **nothing** for it and leave its rows in the notes (they stay read as the fallback). Each own member is carried at most once.
   - **Copied rows** (world and people): insert in the order `valid_from_message_id ASC NULLS FIRST, id ASC` (so the row in force stays in force once anchors are gone — a later insert wins a tie); each new row keeps `slot_id`, `value`/`config`, `updated_by`, `note`, `state_version`, `scene_id`, `created_at` may default; sets `session_id: null`, **`valid_from_message_id: null`** (the copy is a real book — "author layers are never anchored" stands for every real book); `branch_id` → `maps.branches.get(id) ?? id`; `history_entry_id` → `maps.entries.get(id) ?? id` (dated values stay dated, on the copy's line); `source_session_id: row.sourceSessionId ?? sessionId`, `source_message_id: row.sourceMessageId ?? row.validFromMessageId`. Then **delete** the carried notes rows (by id).
   - **Places:** from the (already rekeyed) `placeValues`, every `[entryId][slotId] = value` whose `entryId` is one of the copy's entries (a value of `maps.entries`) and whose `value !== null` → a new `attribute_values` row `{ owner_kind: 'location', owner_id: entryId, slot_id, value: { v: value }, session_id: null, valid_from_message_id: null, updated_by: 'user', source_session_id: sessionId }`, **dated at the session's reading on the copy**: `const reading = await sessionReadingOf(t, sessionId)` (from `$lib/server/state/reading`, after the session row is updated), `branch_id: reading?.branchId ?? null`, `history_entry_id: reading ? (await writeDatingAt(t, reading))?.historyEntryId ?? null : null` — exactly what `bookWritePlace` in `state/write.ts` gives a session's write to the book (an undated row would lose to any dated row of the book). Then drop each carried entry id from `placeValues` in the `extraJson` the block already writes (keep keys that weren't carried, and null-only entries may go too — say which you did).
3. Nothing else in `cloneWithChanges` changes. Do not touch `applyOverlayItems`, `shareAsLorebook`, `copyOwnBookToBranch` or anything else in the file.
4. Update `cloneWithChanges`'s doc comment with one dated sentence: `🚧 (★pl2-1, owner 2026-11-05) …` naming what is carried and that the notes' copies are deleted.
5. **Configs:** carry `attribute_configs` rows of the same owners the same way (they have the same anchor/dating columns; check `schema.attributeConfigs`) — a config left on an unread notes row would silently disappear.

## Tests — `src/lib/server/lorebooks/cloneWithChanges.int.test.ts` (yours)

Follow the file's existing fixtures (`world()` makes a book of one user's and a session of another's reading it — that session can't write its book, so `keepsValuesInOwnBook` is true). Timeouts are 60 s (already set). Add:
1. *A member's session with notes values (the world, a person, a place) → Clone with changes → the copy reads the same values and the notes no longer hold them.* Write the values through the real path (`setValue`/`applyChange` from `$lib/server/state/write` with a world-scope slot, as `src/lib/server/state/worldScope.int.test.ts` does — read its fixtures for the world-scope slots it registers, e.g. `test:slot/lamps@1`, and how it writes a `session`, a `session_cast` and a `session_location` value; pass the writer id). Seat a character the book holds (so the copy has a member for it). Before the clone: `valueOf` reads the notes' values. After: `valueOf` (from `$lib/server/state/resolve`) reads the same values for the world, the person and the place; the notes' `lorebook` row and the carried member have no `attribute_values` rows; `placeValuesOf(own.extraJson)` holds no carried key; the copy's new rows have `valid_from_message_id` null; the original book gained no row.
2. *A person the copy doesn't hold stays in the notes and still reads.*
3. *A dated notes value lands dated on the copy's line* (the fixture already makes a history entry; check `history_entry_id` maps to the copy's entry).
4. *An owner's own-book session's clone carries nothing* — only if cheap with the existing fixtures; otherwise skip and say so.

Run only: `npx vitest run src/lib/server/lorebooks/cloneWithChanges.int.test.ts` (then also `src/lib/server/lorebooks/ownBook.int.test.ts`). **Never pipe vitest into `head`** (the SIGPIPE leaks PGlite temp dirs). w2 edits `write.ts` concurrently: if a failure points into `write.ts`, re-run once at the end before reporting it. Then `npx tsc --noEmit -p . 2>&1 | grep -E "lorebooks/ownBook|cloneWithChanges"` must print nothing.

## Rules you work under (quoted from CLAUDE.md / NOMENCLATURE)

- *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."*
- *"Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."*
- *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for."*
- *"Propose and wait — one recommendation and its trade-off, marked ★ — on anything a user sees or that outlives the change: … a new name / setting / flag / abstraction / event / table / migration."* No new exported name; a private helper inside `ownBook.ts` is fine. No migration, no schema edit, no SDK edit.
- NOMENCLATURE R1 one word, one meaning · R3 qualify, never the bare noun · R6 mark 🚧 provisional vocabulary. It is a **session**, never a *chat*.
- *"A change to stored data or ids ships with a forward migration or boot pass"* — this changes no stored shape; it only writes rows at the clone.

## Stop and ask (in your report, don't decide) when
An ★ is unruled, a name is new and exported, a migration seems needed, or the change needs a file outside: `src/lib/server/lorebooks/ownBook.ts` (`cloneWithChanges` only) and `src/lib/server/lorebooks/cloneWithChanges.int.test.ts`.

## Files readable
Anything. Especially `state/write.ts` (`setValue`, `bookWritePlace`, `setOverlaidPlaceValue`), `state/resolve.ts` (`sessionLinks`, `chainFor`, `inForce`, `valueOf`), `state/reading.ts`, `rulesets/ties.ts` (`placeValuesOf`, `layPlaceValue`), `utils/lorebookDuplicate.ts` (`maps`), `utils/castMemberCards.ts`, `state/worldScope.int.test.ts`.

## Done means
The new tests and the existing ones in `cloneWithChanges.int.test.ts` and `ownBook.int.test.ts` pass; tsc clean on the two files.

## Report
Write `plans/briefs/REPORT-pl3-w1.md`: changed files with line ranges, tests run with pass counts, decisions you made (name each), anything you couldn't do, Noticed-not-done.
