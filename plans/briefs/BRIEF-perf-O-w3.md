# BRIEF perf-O-w3 — the boot query-count test and the [C16] order test

Supervisor: lane perf-O (boot reads once). You are a `lane-worker`. The source changes are already in (w1, w2):
the `pipelines` boot task now reads the registry index once per loop and threads documents and variable-layout
offers through optional parameters. Your job is the test that pins it.

## Goal
Rewrite `/home/jody/github/serene-pub/src/lib/server/pipelines/boot/bootstrap.queries.int.test.ts` (the supervisor
left a throwaway baseline version there — replace it entirely; keep its handle trick) into the lane's real test.

## What the test does
Shape to copy: `src/lib/server/pipelines/boot/registrySync.queries.int.test.ts` — a second drizzle handle over the
same PGlite client with a `logger` that records every statement:
```ts
counted = drizzle((db as any).$client, { schema, logger: { logQuery: (q: string) => void queries.push(q) } })
```
`beforeAll`: `db = await createTestDb()` then a first `await bootstrapPipelines(db)` (timeout 120_000).

1. **Count test** — `queries = []`, `await bootstrapPipelines(counted)`, then assert on the recorded SQL:
   - full-registry selects: statements matching `/from "pipeline_definition_registry"/` with no ` where ` →
     measured **4** after the change (240 before). Pin `toBeLessThanOrEqual(6)`.
   - per-version node selects: `/from "pipeline_nodes" where .*"spec_version_id"/` → measured **573** for 79
     published specs (695 before). Pin `toBeLessThanOrEqual(600)`; also compute the number of published specs from
     `pipeline_specs` (`activeVersionId` not null) and assert the count is ≤ 8 × that, with a comment that the
     remaining reads are `loadDocument` (6–7 statements per call), `chainNodesFor`, the pass-1 heal and
     `reconcilePlacedNodes`, outside this pass.
   - layout offers [C19]: selects matching `/from "pipeline_variable_templates" where .*"variable_id" = \$\d+ and .*"reference" = /`
     (the per-row `layoutByReference` shape) → **0** during the scan (557 before); and selects matching
     `/from "pipeline_variable_templates" where "pipeline_variable_templates"."variable_id" = \$\d+ order by/`
     → measured **19**: pin `toBeLessThanOrEqual(25)`. Check these regexes against real statements (drizzle writes
     `where ("t"."a" = $1 and "t"."b" = $2)`), adjust them so they match, and say what you matched.
   - a total upper bound is NOT pinned (another lane changes the write paths at the same time); record the total in
     your report only.
   If your measured numbers differ from the supervisor's, report both and pin yours with a similar small margin.
2. **[C16] order test** (its own `it`, after the count test). The rule, verbatim for a comment in the test:
   "pass 1 of `seedCoreSpecs` heals present versions in place (`seed.ts` `healNodeExpose` writes
   `pipeline_nodes.expose`; `healClauseChains` writes `pipeline_clauses.parent_clause_chain`). A document map may
   only be created after pass 1 (`reconcilePublishedConfigs`, the refit, the preset reconcile and the scan all are).
   Never hand one map across those steps from the top of `bootstrapPipelines`; one map per step is the shape."
   Test: pick a `pipeline_nodes` row with a non-null `expose` whose version is the active version of a spec AND is
   loaded during boot (prefer one with context-template slots or one the refit/preset reconcile loads; verify by the
   recording below). Remember its `expose`, set it to `null` in the db (damage it as a pre-0155 version would be),
   then run `bootstrapPipelines(db)` while recording every `loadDocument` result. Record with
   `vi.mock("$lib/server/pipelines/boot/store", async (importOriginal) => { const m = await importOriginal<…>(); return { ...m, loadDocument: vi.fn(async (...a) => { const doc = await m.loadDocument(...a); loaded.push({ versionId: a[1], doc }); return doc }) } })`
   (the boot readers import `loadDocument` dynamically from that module, so the mock sees them; calls inside
   `store.ts` itself are not seen, which is fine). Assert: at least one load of the damaged version happened, and
   every recorded document of that version carries the original `expose` on that node (deep-equal) — i.e. no
   document was read before the heal and reused after it. Also assert the row is healed in the db afterwards.
   Use a `vi.hoisted` array for `loaded` if the mock factory needs it. If the mock breaks the count test (it should
   not: it passes through), say so and move the order test to the bottom of the same file in its own `describe`.
   File header doc comment: one or two sentences on what the file pins ("fewer times, not less work").

## Files owned (edit nothing else)
`src/lib/server/pipelines/boot/bootstrap.queries.int.test.ts`.

## Files readable
Anything under `src/lib/server/pipelines/`, `src/lib/server/db/schema.ts`, `src/lib/server/utils/testDb.ts`.

## Out of scope — written down, never built
Every source file. If a test reveals a source bug, stop and report it; do not fix it. No new helpers outside the file.

## Rules (quoted by the supervisor)
- Comment ratchet (`conformance/commentHistory`): comments say what the code does now; avoid "no longer",
  "used to", "previously", "deliberately not". (Stating the measured "before" numbers as numbers in a comment is
  fine: "557 before this pass" — prefer putting before/after in the report rather than the file.)
- Formatting: tabs, no semicolons, double quotes. `npx prettier --check <file>` only.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (This task needs no sdk:build.)
- Never pipe vitest into `head`: redirect to a log file, then grep it. A test's `console.log` is swallowed by the
  setup; to see numbers while developing, write them to a file under the scratchpad
  `/tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/` (prefix
  `perf-O-w3-`) behind an env var, and remove that from the final file.
- Run inside `systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run <file> > <log> 2>&1`. Each `it`
  that boots needs a 120_000 timeout.

## Done means
- The file passes twice in a row (two separate runs), and `npx tsc --noEmit -p . 2>&1 | grep bootstrap.queries`
  prints nothing, and `npx prettier --check` passes on it.
- A quick sanity check that the order test can fail: describe in the report (do not leave it in) what you changed
  temporarily inside the TEST to see it fail (e.g. assert against `null` instead), never by editing source.

## Report
Return as your final message: what each assertion matches, measured numbers, the pins, run results, any ★, and
**Noticed, not done**.
