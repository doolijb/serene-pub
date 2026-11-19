# BRIEF — worker `el-1a-w1` — the four columns, the one migration, the run-lock predicates, the creator column

App repo `/home/jody/github/serene-pub`. SDK repo is read-only. Supervisor: lane `el-1a`. Report: your final message
(under ~500 words) — changed files, the generated migration's file name and full SQL, tests run with results, every
cast-member creation path with what it now writes, Noticed-not-done.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` at all.)

## Rules you work under (quoted from CLAUDE.md and the lane brief)

- The repo is staged by the lead: run **no git command that changes the index or the working tree** (no checkout,
  restore, stash, add, reset). Never run prettier with `--write` and never pipe its output into a file.
- "Migrations are **generated** (`db:generate`). A new migration's index must exceed the highest applied or it is
  *silently skipped*. Never seed a row at a hardcoded id." Run `npm run db:generate` **once**, after the schema edit.
  Highest in `drizzle/meta/_journal.json` now: idx 168 (`0168_sparkling_lethal_legion`), so yours must be `0169_*`.
  Never hand-write or edit the generated SQL or snapshot. No boot pass: existing rows keep the defaults.
- "Inside `db.transaction(async (tx) => …)` use only `tx`."
- Comments state the rule, never history ("was", "now", "used to", dates, lane names are history). Run
  `src/lib/shared/conformance/commentHistory.test.ts` before you finish.
- Tests only as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/el-1a-w1-<n>.log 2>&1"`
  (always at least one path), one run at a time, each preceded by
  `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Never pipe vitest into `head`.
  `NODE_OPTIONS=--max-old-space-size=10240` for `npx tsc --noEmit -p .` (run it once at the end; report only errors in your files).
- `db/schema.ts` is shared with other lanes: re-read the exact lines right before each edit; change only your lines.
- Live lanes, not your files (never edit): `lorebooks/starterKits.ts`, `lorebooks/foldInParent.ts`,
  `sockets/sessions.create.ts`, `sockets/sessions.shared.ts`, `sockets/starterKits.ts`, `plugins/providedBooks.ts`,
  `StartSessionForm.svelte`, `createSession.svelte.ts`, `pipelines/entities/prompts.ts`, `sessions/settingsForm.ts`,
  `pipelines/runtime/host*.ts`. If a creator write belongs in one of these, list it under Noticed and leave it.

## 1. Schema (`src/lib/server/db/schema.ts`) — four columns, nothing else

Names (provisional 🚧, ruled by the supervisor; do not invent others):

| Table (TS const) | TS key | SQL column | Type |
|---|---|---|---|
| `lorebookEntries` (~line 8923) | `entryLock` | `entry_lock` | `boolean().notNull().default(false)` |
| `scenes` (~line 4842) | `sceneLock` | `scene_lock` | `boolean().notNull().default(false)` |
| `lorebookBindings` (~line 1588) | `castMemberLock` | `cast_member_lock` | `boolean().notNull().default(false)` |
| `lorebookBindings` | `createdBy` | `created_by` | `integer().references(() => users.id, { onDelete: "set null" })`, nullable (the existing `created_by` columns at ~8867 / 11232 are the pattern) |

Each gets a short doc comment stating the rule:
- `entryLock` — 🚧 the **entry lock**: a person switched it on; while true no run (a pipeline, a routine, the automatic
  Apply) writes, deletes or archives this row; a person's hand edit, Apply and Take back still do. Not the slot lock
  (`config.lock`, one stat for everyone) and not the setting lock. The one reader is `entryLockedAgainstRuns`
  (`shared/lorebooks/runLocks.ts`).
- `sceneLock` — 🚧 the **scene lock**: the same for a scene row (its summary, notes, name and cast as runs write them);
  reader `sceneLockedAgainstRuns`.
- `castMemberLock` — 🚧 the **cast member lock**: stored here; nothing reads it yet (say only what it is).
- `createdBy` — the person who made this cast member (a guest naming their seat, the owner adding one by hand or for
  someone, a copy's or an import's maker); null when a run or a plugin made it, or for a member stored before the
  column. Not the book's owner.

Then `npm run db:generate` once. Check: the new file is `drizzle/0169_*.sql`, journal idx 169, and the SQL is exactly
three `ADD COLUMN … boolean DEFAULT false NOT NULL`, one `ADD COLUMN "created_by" integer`, and the one foreign key
constraint for it. **If it contains anything else** (another lane's ungenerated schema change), stop, touch nothing
more, and report the full SQL.

Migration test `src/lib/server/db/entryLocks0169.int.test.ts`, modelled on `src/lib/server/db/entryDecay0162.int.test.ts`
(`migrationsFolderThrough("0168_sparkling_lethal_legion")`, then the full folder): rows made at 0168 (an entry, a
scene, a cast member) read `false`/`false`/`false`/`null` after 0169; deleting the user a `created_by` names sets it
null; migrating a second time changes nothing (same rows, same ledger count).

Conformance: run `src/lib/server/db/migrationSet.test.ts` and `src/lib/server/db/migrationJournal.test.ts`.

## 2. The run-lock predicates — `src/lib/shared/lorebooks/runLocks.ts` (new)

Pure, no imports from server code:

```ts
/** 🚧 Whether runs may not write this entry (the entry lock). The one place the rule is read; a wider lock widens here. */
export function entryLockedAgainstRuns(row: { entryLock?: boolean | null }): boolean
/** 🚧 The same for a scene (the scene lock). */
export function sceneLockedAgainstRuns(row: { sceneLock?: boolean | null }): boolean
/** 🚧 Provisional copy: the owner has not seen these sentences. */
export const RUN_LOCK_SENTENCES = Object.freeze({
	/** A run's note when it left a locked entry as it is. */
	entry: (title: string) => `${title} is locked, so this run left it as it is.`,
	/** A run's note when it left a locked scene as it is. */
	scene: (name: string) => `${name} is locked, so this run left it as it is.`,
	/** The Apply review's line on a held change to a locked entry. */
	held: (title: string) => `${title} is locked, so this change waits here until you Apply or Take back.`
})
```

Unit test `src/lib/shared/lorebooks/runLocks.test.ts` (true / false / null / undefined; the sentences).

## 3. The import / export column guard (lane `io-1`)

`src/lib/server/sockets/lorebooks.roundTrip.int.test.ts` classifies every column of every lorebook table
(`COLUMNS`, ~line 95; `REFS` ~558; `NOT_SEEDED` ~2331). Classify the four new columns. Policy (🚧, supervisor's):
the three locks travel with the row like its other settings (export, import, duplicate keep them) — if the existing
classifications already make that true by a generic column copy, just classify; `created_by` is a user id: it is
never exported or compared (classify it like the other user-id columns there, e.g. how `user_id`-style columns are
classified). Find out how export / import / duplicate treat a new column today (read
`plans/REPORT-io-1-2026-11-16.md` and the mappers the test names) and report it; change mapper code **only** if a
lock would otherwise be lost or a `created_by` would leak into an export file — and say exactly what you changed.

## 4. Write `created_by` on every path that creates a cast member where the creating person is known

Every creation goes through `insertCastMember` / `insertCastMemberCopy` (`src/lib/server/characters/versions.ts`
~670–705). Callers (non-test): `sockets/narrativeGraph.merge.ts:1434`, `sockets/narrativeGraph.apply.ts:1053`,
`sockets/lorebooks.ts:1379, 2361, 4025, 4768`, `plugins/providedBooks.ts:1255` (plugin sync: null; not your file),
`utils/characterBindingSync.ts:394` (`resolveOrCreateBinding`-style helper used by many, runs included),
`utils/summarizer/availableSceneCast.ts:651`, `characters/versions.ts:1922`, `lorebooks/starterKits.ts:855` (not your
file: Noticed), `sessions/seats.ts:972` (a card-less seat's member), `lorebooks/tableRegistry.ts:506` (copies:
duplicate / import), `cast/sharedCardCopy.ts:81`.

Rule (owner ruling HM2 needs it: "A seat the guest made is theirs; a cast member they took or were handed stays the
owner's"): `createdBy` = the **person doing the creating**: a guest naming their own seat (`seatNamed`,
`sessions/seatName.ts`) → that guest; the owner adding a member by hand, or a seat for someone → the owner (the
acting socket user); a shared-card copy → the person copying; import and duplicate → the person importing or
duplicating; a person's Apply of a graph build → that person. A run, a pipeline, the summarizer, the boundary
watcher, a plugin sync, a boot pass → `null` (the default: pass nothing). Thread the person as **one optional field**
(e.g. `createdBy?: number | null` on an existing options/input object) only as far as it must go; if a path would need
threading through more than two layers, or through a file listed as not yours, leave it null and list it. Do not
change any other behaviour. Do not build the HM2 rule (nothing reads the column yet).

Tests (new file `src/lib/server/cast/createdBy.int.test.ts`, or beside an existing test of each path if one fits
better): a guest naming their seat → the guest's id; the owner adding a member by hand → the owner; a shared-card copy →
the copier; a run's mint (the helper called without a person) → null. 60 s timeout on any `it` that opens a DB.

## Files owned

`src/lib/server/db/schema.ts` (the four columns only), the generated `drizzle/0169_*.sql` + `drizzle/meta/0169_snapshot.json`
+ `_journal.json` entry (generated, never edited), `src/lib/server/db/entryLocks0169.int.test.ts`,
`src/lib/shared/lorebooks/runLocks.ts` + test, `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts` (the
classification lines; mapper code only per §3), the creator-path call sites listed in §4 except the files marked not
yours, `src/lib/server/cast/createdBy.int.test.ts`.

## Out of scope

Any check of a lock (other workers), sockets, client, docs, NOMENCLATURE, the HM2 rule, a boot pass.

## Stop and ask (in your report, then stop) when

The generated SQL holds anything beyond the four columns and the FK; a creator path can't tell who acts without a
new name, setting or event; a mapper change would alter what an existing export file holds beyond the four columns.

## Done means

Green: `src/lib/server/db/entryLocks0169.int.test.ts`, `src/lib/server/db/migrationSet.test.ts`,
`src/lib/server/db/migrationJournal.test.ts`, `src/lib/shared/lorebooks/runLocks.test.ts`,
`src/lib/server/sockets/lorebooks.roundTrip.int.test.ts`, `src/lib/server/cast/createdBy.int.test.ts`, the existing
test files of every caller you changed (name them), `src/lib/shared/conformance/commentHistory.test.ts`; `tsc` 0 errors
in your files.
