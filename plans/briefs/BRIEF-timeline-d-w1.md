# BRIEF — worker `timeline-d-w1` — the timeless copy, server half

Repo `/home/jody/github/serene-pub`. Supervisor: lane `timeline-d` (`plans/briefs/BRIEF-timeline-d.md`). You
cannot spawn agents. Report back in your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

A lorebook's owner who switches its Timeline off is offered **Make a timeless copy**: a NEW lorebook that keeps
each entry and cast member as it reads now on the line being read, undated, with its Timeline off. The source is
never changed. You build the server half: `makeTimelessCopy`, its tests, and an optional param on the existing
`lorebooks:duplicate` socket. **No migration, no SDK change, no new socket event.**

## Owner rulings (quoted)

- 2026-11-13: "Switch off, allow, but prompt the user with a recommendation to clone as a timeless variant
  instead. Do not provide SDK api for this yet."
- 2026-11-13, confirmed "Sounds good": a copy that keeps each entry as it reads now on the line being read,
  without dates, versions or other lines; scenes kept; history entries left out.
- Standing: nothing in the source is deleted or changed; an entry's edit history never travels with a copy.

## What "now" is (lane correction 1 — rules)

"Now" is **the head of the line being read**: `readingOf(tx, sourceId, { branch: branchId })` with **no moment**
(`branch` null → main). Every dated change on the line is applied — what `docs/lorebook-time.md` calls *now* and
exactly what **Switch off here** would make the source read. Do not use `bookPresentOf`, the book's clock or the
line's clock. An **Off for a while** window (two entry amendments setting `enabled`) therefore reads as the later
of its two changes says. The reply carries no "moment used".

## Files owned (edit only these)

- NEW `src/lib/server/lorebooks/timelessCopy.ts`
- NEW tests: `src/lib/server/lorebooks/timelessCopy.int.test.ts`, `src/lib/server/lorebooks/timelessCopy.large.int.test.ts`,
  `src/lib/server/sockets/lorebooks.timelessCopy.int.test.ts`
- `src/lib/server/sockets/lorebooks.ts` — **the duplicate handler only** (`lorebooksDuplicateHandler`, ~5794–5833)
  and the imports it needs
- `src/lib/shared/sockets/types.ts` — `Sockets.Lorebooks.Duplicate` only (~8706–8715). **Another lane
  (`timeline-c`) edits this file right now: re-read the exact lines right before your edit, make one small edit
  with the Edit tool, never reformat, never run prettier on it.**

**Read, never edit:** `lorebooks/tableRegistry.ts`, `utils/lorebookDuplicate.ts`, `state/reading.ts`,
`state/entriesOnReading.ts`, `state/resolve.ts`, `cast/memberAsRead.ts`, `characters/versions.ts`,
`utils/lorebookEntries.ts`, `shared/lorebooks/lineReading.ts`, `shared/lorebooks/amendments.ts`,
`shared/lorebooks/tieVersions.ts`, `sockets/refusable.ts`. If a reader cannot give you what you need without a
change to it, **stop and report**; do not change it.

Stay out of: `sockets/sessions.ts`, `lorebooks/ownBook.ts`, the SDK repo, `NOMENCLATURE.md`, every client file,
every doc.

## The readers you call (verified file:line)

- `readingOf` — `src/lib/server/state/reading.ts:217`. `rowsOnReading(db, rows, reading)` — `reading.ts:599`
  (keeps rows on the line, fork cuts by history-entry date, fills `reading.dates`).
- `entryOnReadingSql(reading)` — `src/lib/server/state/entriesOnReading.ts:69`; `entryOverlaysFor(db, lorebookId,
  reading, ids)` — `:99`; `entryAt(wireRow, overlays, reading)` — `:155`. Amendments overlay the WIRE row.
- `toEntryRow(storedRow)` — `src/lib/server/utils/lorebookEntries.ts:269`; `splitUpdate(typeId, data)` — `:673`
  (wire → `{ columns, fields }`; `name` → `title` column, `lorebookBindingId` → `anchorBindingId` when the type
  has those roles; never emits `position`).
- `castVersionsInForce(db, memberIds, { reading })` — `src/lib/server/cast/memberAsRead.ts:726` (the one version
  in force per member; a member with none is absent).
- `inForce(rows, dates)` — `src/lib/server/state/resolve.ts:543` (per owner and slot; latest anchor, then later
  story date, undated earliest, then later id). `configFor` (`resolve.ts:1148`) applies it per owner layer and
  slot: one row per (ownerKind, ownerId, slotId) is in force.
- `nearestTieVersions(rows, line)` — `src/lib/shared/lorebooks/tieVersions.ts:61` (a cast tie at one date: the
  nearest line's version).
- `duplicateLorebookRows(tx, sourceId, userId, name)` — `src/lib/server/utils/lorebookDuplicate.ts:71`; already
  returns `{ id, maps: { branches, bindings, entries, scenes } }`. Do not change it.
- `insertCharacterVersions(tx, rows)` — `src/lib/server/characters/versions.ts:383` (the table's one INSERT; omit
  `writeOrder` so it draws one). `isBaseVersion` — `versions.ts:2029`.
- `deleteOwnedRows(tx, kinds, ids)` — `src/lib/server/lorebooks/tableRegistry.ts:1186`; `bookStatOwners` — `:253`;
  `via(map, id)` — `:155`. Registry tables and their line flags: `LOREBOOK_TABLES` `:416–1121`.
- Schema constraints that decide the order: `character_versions_base_idx` (one undated main version per member,
  `db/schema.ts` ~9774) and `character_versions_undated_base_check` (~9833); `narrative_relationships_entry_pair_uq`
  (`schema.ts:5361`: book, from entry, to entry, lower(type), lower(title), coalesce(branch,0),
  coalesce(history,0)); `lorebook_entries.anchor_entry_id` **cascades** (`schema.ts` ~9126);
  `lorebook_entries.branch_id`, `scenes.branch_id`, `narrative_relationships.branch_id`, `character_versions.branch_id`,
  `attribute_*.branch_id` **cascade** on a line's delete; `scenes.history_entry_id` **cascades** (`schema.ts` ~4847);
  `narrative_relationships.history_entry_id`, `attribute_*.history_entry_id`, `character_versions.history_entry_id`
  set null; `lorebook_entries.anchor_binding_id` sets null.

## Build A — `src/lib/server/lorebooks/timelessCopy.ts`

```ts
export async function makeTimelessCopy(
	tx: Db,
	opts: { sourceId: number; branchId: number | null; userId: number; name: string }
): Promise<DuplicatedLorebook> // { id, maps } from lorebookDuplicate.ts, for the handler and the tests
```

A header comment states the rule (what the copy keeps, what it drops, the source is never written). Comments state
the rule, not the story (a ratchet test counts phrases such as "no longer").

**Refuse first:** a source that is a session's notes (`lorebooks.session_id` set) is refused with
`throw new Error("Session notes can't be made into a timeless copy.")` 🚧 (copying notes collides on
`lorebooks_session_id_idx`). Report the sentence.

**Step 0 — read the SOURCE first** (from the existing readers, before anything is copied). `R = readingOf(tx,
sourceId, { branch: branchId })`.
- Entries: stored rows `where lorebook_id = source and entryOnReadingSql(R)`; `overlays = entryOverlaysFor(tx,
  sourceId, R, ids)`; each one's folded wire row `entryAt(toEntryRow(row), overlays, R)`. These are the entries
  that read; every other entry of the copy goes.
- Cast: `castVersionsInForce(tx, allSourceMemberIds, { reading: R })`.
- Links: all the source's `narrative_relationships`; `nearestTieVersions(await rowsOnReading(tx, rows, R), R.line)`;
  then **one row in force per tie**: tie key = for a cast↔cast row `(fromNodeId, toNodeId, relationshipType)` as
  `tieVersions.ts` keys it (case kept); for any row with an entry end `(fromNodeId|fromEntryId, toNodeId|toEntryId,
  lower(relationshipType), lower(title))` — the entry-pair index's identity. Among one tie's rows the latest story
  date wins (date = `R.dates.get(historyEntryId)`, undated earliest, compare with `compareDates` from
  `$lib/shared/lorebooks/storyDate`), then the nearer line (index in `R.line.steps`), then the higher id. Keep
  every `status` (no writer sets "ended"; a resolved or broken tie is the tie as it stands).
- Stats: `attribute_values` and `attribute_configs` rows with `session_id IS NULL` whose owner is the source book
  (`lorebook`), one of its members (`cast_member`) or one of its place entries (`location`) — not
  `session_location`; `rowsOnReading(tx, rows, R)`; group by (ownerKind, ownerId, slotId); `inForce(group,
  R.dates)` per group.
- Scenes: the source's scenes `{ id, branchId, historyEntryId }` through `rowsOnReading(tx, rows, R)`.

**Step 1** — `const dup = await duplicateLorebookRows(tx, sourceId, userId, name)`; keep `dup.maps`.

**Then flatten the COPY only, in this order (lane correction 3 — rules; it survives the `set null` on a deleted
history entry meeting the link index):**

1. **Replace versions, links and stats** (lane correction 2 — rules: the copy's rows of these kinds cannot be
   matched to the source's in-force rows, so delete all of the copy's rows, then insert the source's in-force rows
   again, remapped through the four maps):
   - `character_versions where lorebook_id = copy`: delete all; insert each member's version in force through
     `insertCharacterVersions` as the base version: `castMemberId` mapped, `lorebookId` = copy, main, undated
     (`year`/`month`/`day` null), `historyEntryId`, `atHour`, `atMinute`, `personalPosition`, `sourceSessionId`,
     `sourceMessageId`, `validFromMessageId`, `retiredOrder`, `liftedFromAmendmentId` null; `parentVersionId` and
     `follows` kept; no `id`, `createdAt`, `updatedAt`, `writeOrder`.
   - `narrative_relationships where lorebook_id = copy`: delete all; insert each link in force undated, on main:
     endpoints through `maps.bindings` / `maps.entries` (skip a row whose endpoint does not map), `historyEntryId`
     null, `branchId` null, `sceneId` through `maps.scenes` (null if unmapped). Ended and superseded rows are
     simply not inserted.
   - `attribute_values`, `attribute_configs` owned by the copy's owners: delete all; insert one row per owner and
     slot, undated, on main: owner id mapped (`lorebook` → copy id, `cast_member` → `maps.bindings`, `location` →
     `maps.entries`), `branchId`, `historyEntryId`, `validFromMessageId` null, `sceneId` through `maps.scenes`,
     and on values the session clock stamp columns `story_clock_year … story_clock_minute` (`schema.ts`
     ~10620–10630) null. `sourceSessionId` / `sourceMessageId` stay as provenance (as the duplicate keeps them).
   - Delete the copy's `cast_presences`, `entry_amendments` and `cast_amendments`.
2. **Fold the entries**: for each entry that read, write its folded wire row into the copy row's stored columns
   (`splitUpdate(typeId, folded)`; a folded `anchorEntryId` through `maps.entries`, a folded `anchorBindingId`
   through `maps.bindings`; the `fields` half merged over the copy row's stored `fields`), `branch_id = NULL`. Never
   fold `position` (story amendments do not move rows; `lorebook_entries_position_uq` is per book and type).
3. **Unfile scenes** (`scenes.history_entry_id = NULL` on every copy scene) and **un-anchor** every kept non-history
   entry whose `anchor_entry_id` is a history entry or an entry about to be deleted (it is kept at the top level;
   the FK would cascade it away otherwise).
4. For each **place entry** (`LOCATION_TYPE_ID`) and each **cast member** about to go, call `deleteOwnedRows(tx,
   ["location"], placeIds)` / `deleteOwnedRows(tx, ["cast_member"], memberIds)` so no stat, config or owner-sheet
   row is left unreachable (owner ids carry no FK). Then delete the copy's history entries and every entry that
   did not read, the members that go, and the scenes that did not read. Then clear references the deleted entries
   leave with **no FK** in the copy's registry tables (check the schema; at least
   `binding_suggestions.example_source_id` when `example_source_kind = 'entry'`, and `entry_annotations` keys
   `entry:<id>` / `ref_entry_id` if they carry no FK) — list each one handled in your report.
   - **A member with no version in force** is left out with its binding when nothing kept refers to it (a kept
     entry's `anchor_binding_id`, a link in force, a kept scene's cast, a kept member's `parent_node_id`).
     Otherwise keep it with its source **base** version (`isBaseVersion`) inserted as in 1; if it holds none, leave
     it out anyway and count it. Report how often each case happens in the fixture.
5. **Clear the remaining dates**: `lorebook_bindings.history_entry_id = NULL`; kept scenes `branch_id = NULL` and
   the `opened_story_clock_*` / `closed_story_clock_*` columns NULL; the copy's `lorebooks.story_clock_*` and
   `story_calendar` NULL.
6. **Delete the copy's `lorebook_branches`**, then set the copy's `timeline_enabled = false`.

`state_proposals` is not a lorebook table and is not copied (lane correction 4): never read or write it beyond what
`deleteOwnedRows` already does, and never read or write the source's sessions.

Every statement runs on `tx` (CLAUDE.md Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the
outer `db` deadlocks PGlite silently"). Never seed a row at a fixed id. If any table's rule is not obvious once you
are in the code, stop and report rather than decide.

## Build B — the socket (`sockets/lorebooks.ts`, the duplicate handler only)

- `Sockets.Lorebooks.Duplicate.Params` gains `timeless?: { branchId: number | null }` and `requestId?: string`;
  `Response` gains `requestId?: string` (lane correction 5). One JSDoc line each.
- With `timeless`, the handler calls `makeTimelessCopy` in place of `duplicateLorebookRows`, default name
  `` `${source.name} (timeless)` `` 🚧 when `params.name` is blank; a malformed `timeless` (not an object, or a
  `branchId` that is neither null nor an integer) is refused with a sentence 🚧. Permission
  (`assertReadableBook`, `isAdmin: false` — a shared reader may make one, the copy is theirs), cover handling,
  `fetchCompletedLorebook`, relist and the emitted event are the same.
- The reply and the refusal echo the asker's `requestId`: spread `...askerOf(params)` (`sockets/refusable.ts:78`)
  into the response, and pass `askerOf` as `refusable`'s fifth argument `echo` (fourth `translate` stays
  `undefined`). Do not edit `refusable.ts`. Plain Duplicate sends no `requestId`, so its reply and refusal are
  unchanged.
- After the transaction commits, queue the copy's entries for embedding: `autoEnqueueLorebook(id,
  completedBook.name, "").catch(console.error)` (`embedding/vectorizationQueue.ts:2220`, the guarded form the other
  handlers call after content saves; it respects the vectorization switch). Only for the timeless path. Entries
  carry `embed_text_hash`, so a folded entry's copied vector is seen as stale.
- Without `timeless` the handler behaves exactly as today.

## Tests — write the fixture and the two invariant tests FIRST, then the flatten

Pattern: `src/lib/server/sockets/lorebooks.duplicate.int.test.ts` (its `vi.mock("$lib/server/db")` +
`createTestDb`, `createTestUser`, `seedBook`, `historyValues` / `worldLoreValues` fixtures). An int test that opens
a DB inside an `it` takes a 60 s timeout.

`timelessCopy.int.test.ts` — one fixture lorebook holding: a second line forked mid-story (dated fork) and a
sibling line; a clock on the book; entries with dated changes (`entry_amendments`) before and after the clock's
date, on main and on the line; an **Off for a while** window (an `enabled: false` amendment and a later
`enabled: true` one) open at the head and one closed; an entry that exists only on the sibling; history entries
with scenes filed under them and a non-history entry anchored under one; cast members with several dated versions
and presences; links that changed over time (a cast tie in two dated versions, a place link); stats dated by
history entries. Then:
- **the copy reads as the source read**: for every entry, member, link and stat that read on the source's reading,
  the copy's stored rows read at the head (`readingOf(tx, copyId)`, no moment) give the same values (entries: the
  wire rows through the same readers, ids compared through `maps`; members: `castVersionsInForce` profile columns;
  links: the in-force rule above; stats: the row in force per owner and slot), and nothing else reads. Assert the
  key cases by hand-written values too (the after-the-clock change IS applied; the open window reads off; the
  closed window reads on; the sibling-only entry is absent), not only by recomputing with the same code;
- the copy holds no dated change, no history entry, no second line, no presence, no clock, no calendar, and its
  switch is off; its scenes are kept, unfiled;
- **the source is unchanged**: every registered table's rows for the source (walk `LOREBOOK_TABLES`' scopes, plus
  the `lorebooks` row) compare deep-equal before and after;
- from main and from the line give the two different expected copies;
- `holdsSomethingDated(tx, copyId)` (`lorebooks/timeline.ts:144`) is false.
- A small seeded property test (a fixed-seed PRNG, a handful of seeds): random entries on main / line / sibling,
  random dated amendments to `content` / `enabled` / `name` on main and the line, a dated fork; for each, the
  copy's stored rows read as the source's folded rows at the head.

`timelessCopy.large.int.test.ts` — a lorebook with about 3,000 entries, a few hundred amendments, ~50 members with
several versions, a few hundred links and stats, one line; time `makeTimelessCopy` in one transaction and print
the milliseconds (`console.log("timeless copy:", ms, "ms")`); a 180 s timeout. Report the number.

`sockets/lorebooks.timelessCopy.int.test.ts` — the param makes a timeless copy; without it Duplicate is unchanged
(a dated amendment still copies); a shared reader may make one (the copy is theirs); the reply and the refusal
echo `requestId`; a session's notes are refused with the sentence; the source's switch is untouched.

## How to run tests (rules)

- Only your files and the suites you touch, from the repo root, inside
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full paths> > plans/timeline-d-w1-<n>.log 2>&1"`
  one run at a time; before each run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and wait if
  one is up, checking each minute (another lane and another session run tests too; never `pgrep -f "vitest run"`
  in a loop). Never pipe vitest into `head`. Also run
  `src/lib/server/sockets/lorebooks.duplicate.int.test.ts` once at the end (it may already fail on
  `lore_redlines` from another lane; say so if it does).
- Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/timeline-d-w1-tsc.log 2>&1` and
  report errors in your files only. Not `npm run check` or `npm test`.
- If app tests fail on a missing SDK `dist` file, another lane is running `sdk:build`: wait a few minutes and rerun.
  You need no `sdk:build`.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Never `prettier --write` a directory or glob; never `git checkout`, `restore` or `stash`; never `kill -9`.
- It is a session, never a chat. No other product's name in any file.

## Stop and report (do not decide) when

A migration seems needed; a table's flatten rule is not obvious; a reader cannot give a folded row without a change
to it; the copy cannot be made in one transaction for the large lorebook; a new name beyond the ones marked 🚧
here seems needed; anything outside the files owned would have to change.

## Report (your final message)

Changed files; tests run with results (log paths); the flatten rule used for each table, and each no-FK reference
handled; the member cases counted; the time for the large lorebook; every sentence, label or name added (🚧);
anything you could not do; **Noticed, not done**.
