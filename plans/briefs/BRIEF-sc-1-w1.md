# BRIEF — worker `sc-1-w1`: a scene becomes the fourth subject of Edit history (schema, migration, record)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `sc-1`. Owner ruling SC1 (2026-11-17): "Go: add a
scene as a subject of change history, and a cause for the compiler's writes" (every change to a scene's cast is
kept; one migration; no existing rows change). B2: "hand edits aren't treated differently. Just keep a change
history so a user can overwrite."

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build at all in this task.)

The repo is staged by the lead: run **no git command that changes the index or the working tree** (no checkout,
restore, add, reset). Never run prettier with `--write` or pipe its output into a file.

## Goal

1. **Schema** (`src/lib/server/db/schema.ts`, table `loreRedlines`, ~11034–11117; a shared file: re-read it right
   before you edit; touch only this table):
   - add `sceneId: integer("scene_id").references(() => scenes.id, { onDelete: "cascade" })` (nullable; doc comment
     "The scene whose cast was edited; NULL when the subject is not a scene.");
   - add `index("lore_redlines_scene_idx").on(t.sceneId, t.id).where(sql\`${t.sceneId} IS NOT NULL\`)` (same shape
     as `lore_redlines_character_version_idx`);
   - widen `lore_redlines_subject_check` to **exactly one of the three keys** (`entry_id`, `character_version_id`,
     `scene_id`), keeping the amendment clause: `num_nonnulls(${t.entryId}, ${t.characterVersionId}, ${t.sceneId}) = 1
     AND (${t.amendmentId} IS NULL OR ${t.entryId} IS NOT NULL)`;
   - widen `lore_redlines_cause_check` with one new cause **`scene-compiler`** (🚧, the scene compiler's own writes
     of a scene's cast): `IN ('save', 'routine', 'apply', 'revert', 'take-back', 'restore', 'scene-compiler')`;
   - update the table's doc comment: **four** subjects (add "a **scene** (`scene_id`, cascade): its cast — the
     participant and mentioned lists, by member id. The lorebook's; its owner clears it.") and the `cause` column's
     comment.
2. **Generate the migration once**: first confirm `drizzle/meta/_journal.json`'s last entry is idx 169
   (`0169_normal_gauntlet`) and no `drizzle/0170*` exists; then
   `cd /home/jody/github/serene-pub && npm run db:generate -- --name scene_redlines`. **Run it exactly once. Never
   hand-write or edit the generated SQL, snapshot or journal.** Expect: `ADD COLUMN "scene_id"`, the FK, the index,
   a DROP + ADD of both CHECK constraints. If drizzle-kit prompts, refuses (data dir lock), or emits anything for
   another table, **stop and report** without retrying. No boot pass.
3. **Record** (`src/lib/server/lorebooks/redlines.ts`):
   - `REDLINE_CAUSES` gains `"scene-compiler"`; the header comment says four subjects;
   - `recordRedline`'s subject union gains `{ sceneId: number; entryId?: never; amendmentId?: never;
     characterVersionId?: never }` (and the other two members gain `sceneId?: never`); the insert writes
     `sceneId: input.sceneId ?? null`; `keepNewest` takes `{ sceneId }` too (`eq(T.sceneId, …)`). No second writer.
   - Keep everything else unchanged.
4. **The cause elsewhere** (each a typed list that must stay in step):
   - `src/lib/shared/sockets/types.ts:59` (`RedlineView.cause` union) gains `"scene-compiler"` (shared file: re-read
     before editing; touch only that line and the `RedlineView` comment if it lists subjects);
   - `src/lib/client/lorebooks/editHistory/editHistoryCopy.ts` `REDLINE_CAUSE_LABELS` gains
     `"scene-compiler": "Listed who spoke"` (🚧 copy).
5. **`writeSceneCast` records** (`src/lib/server/utils/sceneCast.ts:153`): add an optional 4th argument
   `redline?: SceneCastRedline` where
   `export type SceneCastRedline = { by: RedlineAuthor; cause: RedlineCause; before?: Partial<SceneCast> }`
   (import the types from `$lib/server/lorebooks/redlines` as `import type`, so no runtime edge is added). Rule:
   - With no `redline`, behaviour is exactly as today (no extra statement).
   - With `redline`: the cast before is `redline.before[role]` for each written role the caller supplied, else read
     **once** on the same handle (`readSceneCast(sceneId, database)`) before the delete. The participants and
     mentioned lists are two keys of `changes`: `participantCharacters` and `mentionedCharacters` (the scene
     payload's own wire keys). A role counts only when it is **written** (present in `cast`) **and its sorted id set
     changed** (deduped, sorted numerically, compared; the same members in another order is no change). Call
     `recordRedline(database, { sceneId, before, after, keys: <changed roles>, cause, by })` with `before` / `after`
     holding each changed role's list **in stored order** (before: as read/supplied; after: the deduped list written).
     When no role changed, record nothing (do not call `recordRedline`). Recording happens after the insert, on the
     same handle.
   - Update the function's doc comment with the rule (one paragraph).
   - Do **not** change `repointSceneCast`, `readSceneCast(s)` or any caller. (Callers are the next worker's.)

## Files owned

`src/lib/server/db/schema.ts` (the `loreRedlines` table only), the generated `drizzle/0170_scene_redlines.sql`,
`drizzle/meta/0170_snapshot.json`, `drizzle/meta/_journal.json` (generated only), `src/lib/server/lorebooks/redlines.ts`,
`src/lib/server/utils/sceneCast.ts`, `src/lib/shared/sockets/types.ts` (the one union), 
`src/lib/client/lorebooks/editHistory/editHistoryCopy.ts` (the one label), and new tests:
`src/lib/server/db/sceneRedlines0170.int.test.ts`, `src/lib/server/utils/sceneCast.redlines.int.test.ts`.

## Files readable

`src/lib/server/db/redlineVersions0163.int.test.ts` (the model for the migration test: `migrationsFolderThrough`,
`rawRows`), `src/lib/server/db/entryLocks0169.int.test.ts`, `src/lib/server/utils/sceneCast.int.test.ts` (how tests
build a book, members and scenes), `src/lib/server/lorebooks/redlines.callSites.int.test.ts`,
`src/lib/server/characters/versions.ts:540–600` (the optional-`redline` pattern you copy).

## Out of scope (do not build)

Any caller of `writeSceneCast`; the compiler; sockets; the reader; `scopeWhere`; `tableRegistry.ts`; client
components; docs; NOMENCLATURE. Live lane `gs-3a3b-2` owns `sessions/seats.ts`, `sessions/seatKeys.ts`,
`sessions/guestSeats.ts`, `sockets/sessions.update.ts`, `state/write.ts`, `lorebooks/entryKnowledge.ts`,
`pipelines/runtime/bindings.outlets.ts`: never touch them.

## Rules you work under (quoted)

- CLAUDE.md Hard rules: "Migrations are **generated** (`db:generate`). A new migration's index must exceed the highest
  applied or it is *silently skipped*. Never seed a row at a hardcoded id." · "Inside `db.transaction(async (tx) => …)`
  use only `tx` — the outer `db` deadlocks PGlite silently." · "Never add a top-level `await` to
  `src/lib/server/db/index.ts`."
- CLAUDE.md: "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a
  test that a second boot changes nothing."
- `utils/sceneCast.ts` reaches the shared `db` only through its lazy `defaultDb()`; never add a static import of
  `$lib/server/db` there (its header explains why). `lorebooks/redlines.ts`: "Every function takes its handle; never
  statically imports `$lib/server/db`."
- Comments state the rule, never history (no "was", "used to", "now", "previously", dates, lane names, "added").
  `src/lib/shared/conformance/commentHistory.test.ts` enforces it.
- NOMENCLATURE R1/R3: `scene-compiler` is qualified on purpose (bare `compile` is Compile to Entry, `scenes:compile`).

## Tests (Done means)

- `src/lib/server/db/sceneRedlines0170.int.test.ts`: migrate through `0169_normal_gauntlet`, insert an entry row and a
  cast-version row (as 0163's test does), migrate the rest: both rows read unchanged (`scene_id` NULL); a scene row
  with cause `scene-compiler` inserts; the CHECK refuses two keys, none, and an amendment on a scene row; an unknown
  cause is refused; a second `migrate` changes nothing (row count and the constraint definitions identical).
- `src/lib/server/utils/sceneCast.redlines.int.test.ts`: with `redline`, a changed participant set records one row
  (`scene_id`, cause, `changes.participantCharacters.before/after` in stored order, `user_id` from `{ userId }`); the
  same members reordered records nothing; mentioned only changed → only that key; a role not written is never a key;
  `before` supplied → no read (count statements at the client, the pattern in
  `scenes/liveScenes.castRule.int.test.ts:294`: supplied before = delete + insert + recordRedline's insert + select);
  no `redline` → no row and the same statement count as today; 51 changes keep 50 rows.
- Also run `src/lib/server/db/redlineVersions0163.int.test.ts`, `src/lib/server/utils/sceneCast.int.test.ts`,
  `src/lib/server/lorebooks/redlines.callSites.int.test.ts`, `src/lib/server/db/migrationJournal.test.ts`,
  `src/lib/server/db/migrationSet.test.ts`, `src/lib/shared/conformance/commentHistory.test.ts`.

How to run tests: first `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, then exactly
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/sc-1-w1-<n>.log 2>&1"`
(always at least one path; one run at a time; never pipe vitest into `head`). Read the log with `grep`/`tail`.
Type check your files: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "redlines|sceneCast|schema.ts|types.ts|editHistoryCopy"`.

## Stop and ask when

drizzle-kit wants anything beyond this table, prompts, or refuses; a name beyond `scene_id`,
`lore_redlines_scene_idx`, `scene-compiler`, `SceneCastRedline` seems needed; a test outside your files fails
because of your change.

## Report

Your final message: changed files; the migration file name and its SQL verbatim; the statement counts you measured
(no redline / redline with before / redline without before); tests run with pass/fail counts; anything Noticed, not
done.
