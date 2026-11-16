# REPORT perf-P — boot writes batched (★R4-2 as corrected by [C18]) — 2026-11-14

Status: **done**. All targeted tests pass, and tsc reports no errors. Nothing is committed. No ★ is open.
Relayed status question: none received.

## Changed files (all inside the lane's Files owned)

- `src/lib/server/pipelines/boot/registrySync.ts`: `syncDefinitionRegistry`, `archiveDeclaration` and `adoptCurrent`.
  - The sync now runs in one `db.transaction` that uses only `tx`. The wrap's comment says a failing statement still throws to the caller (the `pipelines` task still fails health) and the transaction rolls back.
  - Archive rows and new registry rows wait in two pending lists. Both lists are written as multi-row inserts, 100 rows per statement, after the loop.
  - A duplicate pin that meets a pending row (`PENDING_INSERT` marker) flushes both lists first. Returned registry rows go back into `rowsByPin` by `${definitionId}@${version}`, read from each row, never by position.
  - Pointer-move, heal and reverse-diff updates still run one statement per row, on `tx`.
  - New module-private helpers, none exported: `flushArchive`, `flushRegistry`, `INSERT_CHUNK`, `PENDING_INSERT`.
  - No foreign key links the registry and archive tables. The archive is still flushed first.
- `src/lib/server/pipelines/boot/registrySync.queries.int.test.ts`: the first-run assertion now checks that registry and archive inserts are each at most `ceil(inserted/100)` statements, with a comment giving the reason. The second-run "writes nothing, ≤3 reads" bound is unchanged and holds. Drizzle's logger does not log PGlite's BEGIN/COMMIT. The duplicate-pin test is unchanged and passes.
- `src/lib/server/state/declarations.ts` (`recordLastSeen` only): one multi-row upsert per table, skipped when the list is empty.
  - `set` uses `excluded.origin`, `excluded.props` and `excluded.last_seen_at`, plus `updatedAt: now`, with the same `origin <> 'stored'` `setWhere`.
  - Both lists come from id-keyed registry maps, so no id appears twice in one statement.
- `src/lib/server/state/declarations.int.test.ts`: adds the test "a second last-seen pass adds no rows, and a stored row keeps its props and origin".
- `src/lib/server/pipelines/boot/seedPrompts.ts`: names are computed in memory with the same algorithm in the same order.
  - A planned row is pushed onto `poolNames` under a negative placeholder id, which never equals a real id.
  - All new rows go in after the pool loop, in planned order (chunked at 100), so the sequence-assigned ids keep today's order.
  - There is no `returning`, because nothing reads the new ids. This is my choice; the lane brief said `returning (id, seedKey)`, and ids would be needed only if something read them.
  - The per-prompt `select … where seedKey = ?` (63 reads every boot) is now one `inArray(seedKey, …)` read for the whole pass, mapped by `seedKey`.
- `src/lib/server/pipelines/boot/seedPrompts.int.test.ts`: adds the test "a pool seeded in one statement". It plants a person's row under the first shipped name, then re-seeds. It checks that every row is created in order and that the first takes the "(Built-in)" form.
- `src/lib/server/pipelines/boot/store.ts` (the `pipelinePresets` insert in `saveDocument` only): one insert returning `{ id, slug }`, with ids mapped by slug (`pipeline_presets_version_slug_idx`). The values inserts are unchanged and run in the same preset order.
- `src/lib/server/pipelines/registrations/write.ts` (`replaceRows`): new rows are collected and inserted as one multi-row insert after the loop, in loop order. Updates (which keep `state`), the `gone` delete, `changed` and `invalidateRegistrations()` are as before.
  - `projectRegistrations` is **not** wrapped in a transaction. Each genre and preset there has its own try/catch, and one failed statement would abort a whole Postgres transaction. `project.ts` is unedited.
- `src/lib/server/pipelines/boot/seedScripts.ts`: the loop is wrapped in one `db.transaction` using only `tx`, with the comment the brief asked for. Each script reads its type's name pool again, so rows are not independent and were not batched.

**Supervisor corrections.** Both workers ran `prettier --write`, which reformatted code outside their owned regions. That included other sessions' uncommitted hunks in `registrySync.ts` (the plugin preset/template sync, from ~`:773` on) and unrelated functions in `declarations.ts`. In `declarations.ts` it also moved a comment. I spliced the owned regions back onto pre-lane copies, so each file's diff now holds only this lane's hunks:
- `registrySync.ts`: the sync function and its helpers.
- `declarations.ts`: `recordLastSeen`.
- The two test files: only the added cases.
- `seedPrompts.ts`: one reformatted line in `defaultPromptFor`.

I also moved the prompts insert from one per pool to one per pass.

## Tests run

All runs were `systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run …` after the splices:
- `registrySync.int.test.ts`, `registrySync.queries.int.test.ts`, `seedPrompts.int.test.ts`, `seedScripts.int.test.ts`, `store.int.test.ts`, `bootstrap.int.test.ts`, `registrations/` (all 6 files), `state/declarations.int.test.ts`: **13 files, 139 tests, all passed.** This includes `bootstrap.int.test.ts` "changes nothing on the next boot".
- `npx tsc --noEmit -p .`: exit 0, with no errors anywhere.
- `prettier --check`: `registrySync.ts`, `store.ts`, `seedScripts.ts`, `write.ts`, `declarations.ts` and some of the test files fail. They were already unformatted before this lane, and the hunks this lane added follow the file's style. I did not reformat them.

## Measurements: first `bootstrapPipelines(db)`, then a second, on a fresh test db

I used the same drizzle-logger trick as `registrySync.queries.int.test.ts`, plus a counter on `client.transaction`, both on an in-memory `createTestDb()` and on a file-backed PGlite. The scratch harness is at `/tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/perfP/perfP-measure.int.test.ts`. It is run with `perfP.vitest.config.mts` from that folder; the raw output is in `before.txt` and `after.txt` there.

| | before | after |
|---|---|---|
| first boot, writes | **1,848** | **1,196** (−652) |
| first boot, all statements | 9,140 | 6,350 |
| first boot, transactions | 81 | 83 (+ registry sync, + scripts) |
| first boot, wall (in-memory / file-backed) | 17.1 s / 14.3 s | 14.8 s / 8.9 s |
| second boot, writes | **197** | **125** (−72: `recordLastSeen` 73 → 1 upsert statement) |
| second boot, all statements | 6,050 | 3,840 |
| second boot, wall (in-memory / file-backed) | 4.6 s / 6.5 s | 2.4 s / 3.3 s |

The **write counts are this lane's work**. These first-boot statements went to one or a few each:
- `pipeline_definition_registry` 192 → 2
- `pipeline_definition_declarations` 192 → 2
- `registrations` 145 → about one per scope
- `attribute_declarations` 73 → 1
- `pipeline_prompts` 63 → 1

Presets went from one statement per preset to one per spec. Scripts stay at 44 statements but now in one commit.

The **read counts and wall times are confounded** by lane perf-O, whose read-path changes had landed by the "after" run (reads 7,292 → 5,154 first boot, 5,853 → 3,715 second boot). The "after" run also overlapped perf-O's own test run, so its wall times were measured under contention. The second-boot wall-time drop is mostly perf-O's. Only about 72 single-row commits there are this lane's.

## Open ★

None.

## Noticed, not done

- **A second boot still writes 125 statements.** They are:
  - `update pipeline_specs` ×79 (one per spec, every boot)
  - `insert session_preset_notices` ×26 and `delete session_preset_notices` ×10
  - one delete each in `pipeline_specs` (×2), `session_presets`, `session_layout_presets`, `session_genre_settings`, `pipeline_node_overrides`, `pipeline_config_values` and `pipeline_prompts`, plus `update pipeline_prompts` ×1
  
  The 79 updates and the notices churn break "an unchanged boot writes nothing", and they are outside this lane. The deletes on a second boot of the same build look like a cull or cleanup pass worth a look.
- On the first boot, `update pipeline_specs` and `update pipeline_spec_versions` run 158 times each (two per published spec). That is the largest write stream left, in `saveDocument`/`publishVersion`, outside this lane.
- `seedCoreScripts` could batch the way prompts now do (in-memory pools, one insert). It was left as one transaction, as the brief asked.
- The new seedPrompts test cannot cover two *new* rows colliding on a name in one pool, because no two catalog prompts in a pool share a name. Covering it needs a mocked catalog.
- Several owned files fail `prettier --check` independently of this lane (listed above).
