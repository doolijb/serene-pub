# BRIEF playtest4-C4-w1 — the connection fold drops colliding rows by unique key

Lane `playtest4-C4`, worker w1. Supervisor: the playtest4-C4 lane-supervisor. Report: your final message (the supervisor reads it); no report file.

## Goal
`src/lib/server/connections/connectionFold.ts` (`foldConnectionInto(tx, source, target)`) repoints every FK into `connections.id` / `connection_models.id` with a blind UPDATE. Only `connection_scripts` gets a duplicate-pair pre-delete (lines ~91–106). A table whose unique key includes the repointed column (today: `logit_bias_tokens_lookup` on (connection_id, model, tokenizer_fingerprint, tokenized_text), and `connection_scripts_pair_idx` on (connection_id, script_id)) collides when source and target both hold the pair, and the fold transaction rolls back.

Build the general rule, replacing the `connection_scripts` special case (which becomes one instance of it):

**Before each repoint UPDATE of `column` from `from` to `to` in `table`, for every unique key of `table` that includes `column`, delete the rows with `column = from` whose other key columns equal those of a row with `column = to`. The target's row wins (no merging of values).** This applies in both loops: the `connections.id` loop (from = source.id, to = target.id) and the `connection_models.id` loop (each `[from, to]` of `duplicates`).

### Design (decided by the supervisor — follow it)
1. A helper, exported (for its test), placed above `foldConnectionInto`, with a one-line doc comment:
   ```ts
   /** The other columns of each unique key on `table` that includes `column` (exported for its test). */
   export function uniqueKeysWith(table: PgTable, column: PgColumn): { others: PgColumn[]; nullsNotDistinct: boolean }[]
   ```
   Read `getTableConfig(table)` (drizzle-orm 0.45.3, `drizzle-orm/pg-core`). Unique keys come from:
   - `indexes` where `index.config.unique` is true. `index.config.columns` items are either an `IndexedColumn` (has `.name`, the SQL column name) or an `SQL` (`is(c, SQL)`). `index.config.where` is an optional SQL.
     - If any column is an `SQL` expression → do NOT guess: skip the index and, when `dev` (`import { dev } from "$app/environment"`, the way `src/lib/server/db/index.ts:9` does), `console.warn` one sentence naming the table and index, e.g. `` `[connections] Fold: unique index ${name} on ${tableName} uses an expression; not checked for collisions.` ``.
     - If it has a `where` and its named columns include `column` → skip with the same kind of dev warning (`...is partial; not checked for collisions.`). A partial index whose columns don't include `column` cannot collide on the repoint: skip silently.
     - Otherwise, if its column names include `column.name`, it is a key; `nullsNotDistinct: false`.
   - `uniqueConstraints` (`.columns` are `PgColumn`s, `.nullsNotDistinct` boolean) whose columns include `column.name`.
   - `primaryKeys` (`.columns` are `PgColumn`s) whose columns include `column.name` (a composite PK is a unique key too; `nullsNotDistinct: false`).
   - Column-level: `column.isUnique` or `column.primary` on the repointed column itself → a key with `others: []` (`nullsNotDistinct: column.uniqueType === "not distinct"`).
   Resolve every "other" column to the table's own `PgColumn` by SQL name via `getTableColumns(table)` (same matching `referencesTo` does at lines 41–49). Compare by `.name`, never by object identity (index columns are clones).
2. A private helper `dropCollisions(tx, table, column, from, to)` that, for each key from `uniqueKeysWith`, runs ONE delete using a self-join on an alias of the table:
   ```ts
   const kept = alias(table, "fold_kept")        // alias from "drizzle-orm/pg-core"
   await tx.delete(table).where(and(
     eq(column, from),
     exists(tx.select({ one: sql`1` }).from(kept).where(and(
       eq(keptCol(column), to),
       ...others.map((c) => nullsNotDistinct ? sql`${keptCol(c)} is not distinct from ${c}` : eq(keptCol(c), c))
     )))
   ))
   ```
   where `keptCol(c)` is the alias's column with the same JS key as `c` in `getTableColumns(table)`. Check the generated SQL qualifies outer columns with the table name and inner ones with `"fold_kept"` (e.g. `.toSQL()` in a scratch test or by reading the error if it fails) — the test proves it.
3. In `foldConnectionInto`: delete the `connection_scripts` block (lines ~91–106, and the now-unused `inArray` import if nothing else uses it); call `dropCollisions` immediately before each UPDATE in both FK loops. Amend the step-2 doc comment at the top of the file (lines 10–13) with one sentence: a row that would break a unique key the target already holds is dropped first, the target's row wins. Keep the edit small; don't restructure anything else.

## Files owned (re-read each immediately before editing; Edit, never Write, on existing files)
- `src/lib/server/connections/connectionFold.ts`
- `src/lib/server/connections/connectionFold.int.test.ts` (NEW — Write is fine for this one)

NOT yours, never edit: `koboldCppManagedFold.ts`, `localOnnxConnections.ts`, `src/lib/server/db/schema.ts`, `NOMENCLATURE.md`, any test file other than the new one, anything in `../serene-pub-sdk`. Other lanes and another programme (M2e) are editing this repo right now; touch only the two files above.

## Files readable
Everything. Useful: `src/lib/server/connections/koboldCppManagedFold.int.test.ts` and `localOnnxConnections.int.test.ts` (fixture patterns: `createTestDb` from `$lib/server/utils/testDb`, `connection()` / `model()` inserts), `logitBiasTokens.int.test.ts` (how a `logit_bias_tokens` row is inserted), `src/lib/server/db/schema.ts:910-930` (logit_bias_tokens) and `:1221-1241` (connection_scripts).

## Tests — `connectionFold.int.test.ts`
`createTestDb()` in `beforeEach` with a 60 s timeout; any `it` that touches the DB gets `60_000` as its timeout. Call the fold as `db.transaction(async (tx) => foldConnectionInto(tx as any, source, target))`. Cases:
1. **logit_bias_tokens collision:** source and target each hold a row on the same (model, tokenizer_fingerprint, tokenized_text) with different `token_ids`, plus the source holds one non-colliding row. The fold resolves without error; the target holds exactly one row for the colliding key and it is the TARGET's (its `token_ids`); the non-colliding row now belongs to the target; the source connection is gone.
2. **connection_scripts pair:** both hold the same script (and the source one other script). Fold succeeds; the target has one row per script. (Needs a `pipeline_scripts` row — read the schema for its required columns.)
3. **No unique key folds as before:** a table whose FK has no unique key (e.g. a loadout via `defaultLoadoutRow` from `$lib/server/loadouts/testing`, or a `connection_defaults` row) naming the source is repointed to the target.
4. **`uniqueKeysWith` on the real schema:** for `schema.logitBiasTokens` / `.connectionId` the others are `model`, `tokenizer_fingerprint`, `tokenized_text` (compare by `.name`); for `schema.connectionScripts` / `.connectionId` the others are `[script_id]`; for `schema.loadouts` (or whichever table case 3 used) it is `[]`.
5. **Warning path on a fake table:** define test-local `pgTable`s (not in the schema) with an `integer("connection_id")` column and (a) `uniqueIndex("fake_expr").on(sql\`lower(${t.label})\`, t.connectionId)`, (b) `uniqueIndex("fake_partial").on(t.connectionId, t.label).where(sql\`${t.label} is not null\`)`. With `vi.spyOn(console, "warn")`, `uniqueKeysWith` returns `[]` for each and warns once with a message containing the table's name. (`dev` from `$app/environment` is true under vitest — if it isn't, report that instead of working around it.) No DB needed for 4–5.
6. Leave `koboldCppManagedFold.int.test.ts` and `localOnnxConnections.int.test.ts` unchanged; you will RUN them.

Run, from the app root, exactly (one run, all three files):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 src/lib/server/connections/connectionFold.int.test.ts src/lib/server/connections/koboldCppManagedFold.int.test.ts src/lib/server/connections/localOnnxConnections.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest4-C4-w1-<n>.log 2>&1; echo exit=$?'
```
then read the log (`tail -60`, `grep -n "FAIL\|✓\|×"`). Before the first run, `ls -d /tmp/serene-pub-vitest-* 2>/dev/null` and note it; after, delete only new dirs your runs made, by name. Also `npx prettier --check src/lib/server/connections/connectionFold.ts src/lib/server/connections/connectionFold.int.test.ts` (fix with `npx prettier --write` on those two files only). No `tsc` or `npm run check` runs of any kind (the lead runs them); keep types careful.

## Rules (quoted from the project)
- CLAUDE.md Hard rule: *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."* `dropCollisions` uses only the `tx` it is given.
- CLAUDE.md: *"Never seed a row at a hardcoded id."* Tests insert without `id` and use `.returning()`.
- Lane brief, out of scope — never built: *"Merging the colliding rows' values (the target's wins); a setting; schema changes."*
- Names: the only new identifiers are `uniqueKeysWith`, `dropCollisions`, the alias name `fold_kept`, and the warning sentences above. Add no other exported name, option, flag or hook.
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout.

## Stop and ask when
Drizzle's `getTableConfig` does not expose the unique index for `logit_bias_tokens` or `connection_scripts` (report what it returns; do not fall back to a static list yourself); the self-join delete can't be expressed in drizzle (report the error and generated SQL; don't switch to raw SQL strings on your own); any edit outside the two owned files would be needed.

## Done means
The three test files above green; prettier clean on the two files. Report: diff summary of `connectionFold.ts`, the test names, the exact command and pass/fail counts, the generated SQL of one `dropCollisions` delete, anything noticed but not done.

## Verbatim lines
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (This lane needs no `sdk:build`.)
- Also never `git checkout`, `git restore` or `git clean` in either repo.
