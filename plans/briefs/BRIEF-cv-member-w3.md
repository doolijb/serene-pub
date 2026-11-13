# BRIEF cv-member-w3 — the narrative graph reads and writes cast versions (sockets/narrativeGraph.ts)

Worker (Sonnet) for lane **cv-member**; the supervisor is the cv-member lane-supervisor. App `/home/jody/github/serene-pub`. Report as your final message (no report file), starting `# REPORT cv-member-w3 (2026-11-05)`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

Other agents are editing other files right now (lanes cv-time, cv-writers; another cv-member worker on `sockets/amendments.ts`). Touch nothing outside **Files owned**. If the task needs another file, stop and say so.

## Background (read first)
- `plans/REPORT-cv-core-2026-11-05.md` (short).
- `src/lib/server/characters/versions.ts` — **read only, never edit.** You call `insertCastMember(tx, values, { writtenBy? })` (inserts the member and its **base** version, made from the row's columns by `memberProfileOf`), `writeCastVersion(tx, { member, changes, writtenBy, at })` (author path; read `authorWrite`: it updates in place the version at exactly that key (branch, date, life point) that has no source session and no retire mark, else inserts a copy of the version in force there with the changes), `insertCharacterVersions(tx, rows)` (the table's ONE INSERT; pass `writeOrder` to keep a row's order), type `CastVersionChanges`.
- `src/lib/server/cast/memberAsRead.ts` — `castVersionsInForce(db, memberIds, { reading, appearance })` → `Map<memberId, { version, overlayDepth }>` (read only).
- `src/lib/server/lorebooks/retold.ts` — `memberColumnsOfVersion(version, { carded })` (a version in the member row's legacy column names) (read only).
- `src/lib/server/sockets/lorebooks.ts` — read only; its private `writeMemberEdit` / `withBaseColumns` show the pattern another worker used for the member page.
- Plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §32 §1 (~1144–1170), §8 (~1297–1318), §33 (~1396–1409).

## Files owned (edit only these)
- `src/lib/server/sockets/narrativeGraph.ts`
- Its tests `src/lib/server/sockets/narrativeGraph.*.int.test.ts` (update where they set/assert frozen binding columns or `cast_amendments`), new `src/lib/server/sockets/narrativeGraph.castVersions.int.test.ts`.

Not `versions.ts`, `memberAsRead.ts`, `retold.ts`, `sockets/lorebooks.ts`, `sockets/amendments.ts`, `src/lib/shared/**`, `NOMENCLATURE.md`, any fixture helper outside your files (if `pipelines/testing/fixtures.ts`' `insertNarrativeNodeRow` gets in your way, say so).

## Rules (quoted)
- CLAUDE.md P2: "A module owns its data and every write to it … Two writers of one thing is a bug." `versions.ts`: "Nothing else inserts into or updates the table." → never `insert`/`update`/`delete` `schema.characterVersions` yourself. Selects are fine.
- Plan §32 §8: "`cast_amendments` and the retold columns freeze." → this file never writes `cast_amendments` again, and never writes the **frozen member columns**: retold text, `retold`, `own_name`, `own_nickname`, `face_media_id`, `timbre`, `sprite_set`, `node_state`, `node_visibility`. Their values live on versions. `name`, `aliases`, `summary`, `absorbed_aliases`, `parent_node_id`, `scene_id`, `history_entry_id`, `binding`, `character_id` stay binding columns, written as today.
- ★CV-10 (owner): "graph state and visibility move into cast versions."
- Every `lorebook_bindings` insert goes through `insertCastMember` (plan §32 §8: "They replace every insert site", naming narrativeGraph.ts :2597/:5305).
- Inside `db.transaction(async (tx) => …)` use only `tx`.
- The session always has a lorebook — never write "no book".
- Names: no new exported name, wire field, prop or type. Private helpers are fine.
- Tests: DB-in-`it` needs a 60 s timeout; never pipe vitest into `head`; run only **Done means**; `npx tsc --noEmit -p .` clean for your file (grep for its path); `npx prettier --check` your files (leave untouched-line drift, say so). No `TODO` comments.

## What to build

### 1. Reads of node state and visibility come from versions
One private helper: the version in force for many members at a reading (the build's / list's line at its head, `moment: null`; main head where there is no line) via `castVersionsInForce`, answering `nodeState` (default `"active"`) and `nodeVisibility` (default `"normal"`) per member, and the version itself. Use it everywhere this file reads `lorebookBindings.nodeState` / `.nodeVisibility` (the graph list's alias-children filter and seeds ~1340–1370, the build, `isBlankMember`'s callers ~4296/~5250, any other — grep). A member with no version (shouldn't happen after the boot pass) keeps its stored columns.

### 2. Writes
- **New members** from an applied proposal (~2597) and the undo-merge re-insert (~5305): `insertCastMember(tx, values, { writtenBy })` with the same values (node state in `values` is fine there: the base is made from the row — it is the versions module's insert). `writtenBy`: `user:<id>` of the asker.
- **Node state updates** from an applied proposal (~2633): `writeCastVersion(tx, { member: id, changes: { nodeState }, writtenBy: \`user:${userId}\`, at })` where `at` is the key of the version in force at the build's line head (§1's helper): `{ branchId: v.branchId, date: v.year == null ? null : { year, month, day }, historyEntryId: v.historyEntryId, personalPosition: v.personalPosition }` — so the build's line reads the new state at its head (a base in force → the base is edited; a dated authored one → it is edited; a story-written one → a new authored version at its date). Skip the write when the state is unchanged. Never write the `node_state` column.
- `summary` (fill-blanks-only, ~2650) stays a binding column write as today; also keep the base's `summary` in step: after the column update, when it actually changed the row (check `.returning()`), `writeCastVersion` the base (`at: { branchId: null, date: null, personalPosition: null }`) with `{ summary }`.
- Any other write of a frozen column in this file (grep `.set({` near `lorebookBindings`): route it through `writeCastVersion` the same way, or say why not.

### 3. Merge and undo-merge keep the member's versions
- `snapshotMemberStory` (~4413) also snapshots the absorbed member's **cast versions** (all rows with `cast_member_id` = it), into `MemberStory` as `castVersions` (a private field of the merge log's stored JSON; old logs lack it). `memberIsLinked` (~4332) also counts a non-base version (a dated change) as a link, as `cast_amendments` is today; keep the amendment check too (frozen rows still exist).
- `restoreMemberStory` (~4507) / undo-merge (~5189–5680): the member is re-inserted through `insertCastMember` (that makes a base from the snapshot row's columns, which may be stale). Then, when the log has `castVersions`:
  - the logged **base** (branch null, year null, life point null, source session null, card null): make the new base match it with ONE `writeCastVersion` author write at the base: `changes` = every profile field (`CHARACTER_PROFILE_FIELDS` from `shared/characters/profile.ts`) → `{ follow: true }` when in the logged `follows` (and the new base has a parent), else the logged value; plus `nodeState`/`nodeVisibility`. Skip fields that already equal.
  - every other logged version: `insertCharacterVersions(tx, rows)` in id order with `castMemberId` = the new member id, `writeOrder` kept, `id`/`createdAt`/`updatedAt` dropped, `parentVersionId` kept when that card version still exists (else null and `follows` emptied — but then the followed values are lost; prefer: keep it, the FK is SET NULL on a delete and the row reads empty; say which you did).
  An old log without `castVersions` restores what it holds today (the base from the row's columns).
- The undo's "owned rows" record (~5620, `castAmendment: (await ownedBy(schema.castAmendments))…`): check what it feeds (a log of what the undo restored?) and add nothing new unless a test needs it; say what it is.

### 4. Tests
New `narrativeGraph.castVersions.int.test.ts` (60 s timeouts): an applied proposal's new member has a base (node state from the proposal); an applied state update writes a version and leaves the `node_state` column untouched, and the graph list / the next build read the new state; a member whose state was changed at a dated version reads that state on a build at the line head; merge then undo-merge brings the absorbed member back with its base words (an own description), its dated version (date, life point, write order) and its state; `memberIsLinked` sees a dated version.
Update existing narrativeGraph tests that assert the `node_state` / `node_visibility` columns after a write (assert the version / the read instead), and fixtures in your test files that set frozen columns on a binding and then expect the graph to read them (write the base with `writeCastVersion` instead, or create the member with `insertCastMember` and those values).

## Done means
`npx vitest run --maxWorkers=4 src/lib/server/sockets/narrativeGraph` (all `narrativeGraph.*.int.test.ts`, including your new file) — green, or each red one explained by reading (never stash). List `/tmp/serene-pub-vitest-*` before and after; delete only dirs your runs created, by name.

## Report
Final message: names/signatures; changed files; tests with counts; each existing test changed and why; assumptions; Noticed, not done.
