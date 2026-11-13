# REPORT playtest4-C4 — the connection fold never collides on a unique key

(Saved by the lead from the supervisor's hand-back; the harness refused the lane's own write.)

**BUILT.** The fold no longer rolls back when the source and target both hold a row on the same unique key; the target's row is kept. One worker (w1, `plans/briefs/BRIEF-playtest4-C4-w1.md`). 3 targeted test files: 16 tests, all passed. No migration, no schema change, no SDK change.

## Changed files (app repo only)

**`src/lib/server/connections/connectionFold.ts`** (untracked file from lane playtest2-C, edited)
- New `export function uniqueKeysWith(table, column)` — lists every unique key on `table` that includes `column`, reading Drizzle's `getTableConfig`; returns `{ others: PgColumn[]; nullsNotDistinct: boolean }` per key. Four sources count: unique `indexes`; `uniqueConstraints` (with their own `nullsNotDistinct`); composite `primaryKeys`; column-level `isUnique`/`primary` on the repointed column.
- Not guessed at: a unique index using a SQL expression → skipped with a dev-only `console.warn` naming index and table; a partial index (`where`) whose columns include the repointed column → skipped with the same kind of warning; a partial index not naming the column → skipped silently (cannot collide).
- New private `dropCollisions(tx, table, column, from, to)` — one self-joined delete per key (`alias(table, "fold_kept")`): removes rows with `column = from` whose other key columns equal those of a row with `column = to`; `is not distinct from` only when the key is nulls-not-distinct; uses only the given `tx`.
- In `foldConnectionInto`: the `connection_scripts` special case is deleted (one instance of the rule now); `dropCollisions` runs just before each repoint UPDATE in both the `connections.id` loop and the `connection_models.id` duplicates loop; header step 2 gains a sentence; unused `inArray` import dropped.
- Generated SQL for `logit_bias_tokens`:
  ```
  delete from "logit_bias_tokens" where ("logit_bias_tokens"."connection_id" = $1 and exists (select 1 from "logit_bias_tokens" "fold_kept" where ("fold_kept"."connection_id" = $2 and "fold_kept"."model" = "logit_bias_tokens"."model" and "fold_kept"."tokenizer_fingerprint" = "logit_bias_tokens"."tokenizer_fingerprint" and "fold_kept"."tokenized_text" = "logit_bias_tokens"."tokenized_text")))
  ```

**`src/lib/server/connections/connectionFold.int.test.ts`** (new, five tests): `logit_bias_tokens` collision (target keeps its `token_ids`; the non-colliding source row moves; source gone; SQL shape checked); `connection_scripts` (one row per script); a table with no unique key (loadout repointed as before); `uniqueKeysWith` on the real schema (`logitBiasTokens`, `connectionScripts`, `loadouts`); the warning path (two fake tables, expression + partial index, each `[]` and one warning).

## Tests run
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 … npx vitest run --maxWorkers=2 connectionFold.int koboldCppManagedFold.int localOnnxConnections.int` → exit 0; 3 files, 16 tests passed. Prettier clean on both files. No vitest temp dirs left behind.

## Decisions (supervisor, within scope)
- More key types than the brief named (composite PKs, column-level unique/primary) — PostgreSQL enforces them the same way; none includes a connection/model id today.
- NULLs follow PostgreSQL: `=` never matches NULL, so rows holding NULLs don't collide; `is not distinct from` only for nulls-not-distinct keys.
- The warning is dev-only (`dev` from `$app/environment`, as `db/index.ts:9`); true under vitest.
- `uniqueKeysWith` exported only for its test. No other export, option or hook.

## Stopped, needs owner — none. No open ★.

## Canon rows needed (lead)
Internal identifiers `uniqueKeysWith`, `dropCollisions`, alias `fold_kept`; two dev-only log sentences (`[connections] Fold: unique index <name> on <table> uses an expression; not checked for collisions.` / `… is partial; not checked for collisions.`); §10 fold row: "before each repoint, a row that would break a unique key including the repointed id is dropped; the target's row wins".

## Noticed, not done
- The expression-index warning fires for any unique expression index on a referencing table, even one not involving the repointed column; dev-only, may repeat per fold call. None exists today.
- Test 1's SQL check wraps `tx.delete` to capture `toSQL()` — Drizzle-internal; if an upgrade breaks it, delete the SQL check (the other checks prove the delete).
- `koboldCppManagedFold.ts` shows modified in `git status` from lane playtest2-C (mtime 13:18); untouched here.
