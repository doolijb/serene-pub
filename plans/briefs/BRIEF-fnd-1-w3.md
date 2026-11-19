# BRIEF — lane `fnd-1`, worker w3 — a template database for `createTestDb`

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-1` (brief `plans/briefs/BRIEF-fnd-1.md`).
Scratchpad: `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad` (below: `<S>`).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You have no reason to run `sdk:build`: don't.)

## Goal

`createTestDb()` (`src/lib/server/utils/testDb.ts` ~24–109) runs ~1,080 times per full run. Each call starts PGlite,
replays all 170 migrations (346 KB SQL), resyncs identity sequences, seeds the completion templates and syncs the
definition registry. Measured by the supervisor in plain Node: PGlite start 0.66 s + migrate 1.25 s, against
`dumpDataDir("none")` 0.09 s (44.5 MB) and `new PGlite({ loadDataDir })` 0.39 s (`<S>/fnd1-pgbench.mjs`). Build
the database once per run and load copies of it.

The owner (2026-11-15): "Maybe run only a handful of full migrations? Anything that isn't testing migration data
integridy can likely just use a full schema dump done by a test at the start." The template must be **built by
running the real migrations** (never from the Drizzle schema definition), so a schema change without a generated
migration still fails tests.

## Design (decided by the supervisor; build it this way)

1. Move today's body of `createTestDb` unchanged into a new exported 🚧 `migratedTestDb(opts?)` in `testDb.ts`
   ("a test database built by replaying every migration, never from the template"). Same options, same steps,
   same order, same `guardTransactions(client, "throw")`.
2. **Per-run template directory.** A new global setup module 🚧 `scripts/testDbTemplate.ts`, added to
   `vitest.config.ts` `test.globalSetup` after `./scripts/testTempDirs.ts` (that line is the only edit you make
   in `vitest.config.ts`). Its `setup(project)` makes one directory with `fs.mkdtempSync(path.join(os.tmpdir(),
   "serene-pub-vitest-template-"))` (the existing stale sweep already knows the `serene-pub-vitest-` prefix),
   hands it to workers with `project.provide("testDbTemplateDir", dir)` (declare the key on vitest's
   `ProvidedContext` in a `declare module "vitest"` block), and its teardown removes that one directory. It builds
   nothing itself, so a unit-only or single-file run pays nothing. Verify how Vitest 4.1.11 runs a root
   `globalSetup` with `projects` + `extends: true` (once, or once per project) and that `inject` returns the dir
   inside an int test; adapt so every project's workers receive a directory.
3. **`createTestDb(opts)`**:
   - `opts?.skipEntryTypes` → `return migratedTestDb(opts)` (the template holds the entry types; those 5 call
     sites are about the registry sync itself).
   - No provided dir (`inject("testDbTemplateDir")` undefined, e.g. `vitest.budgets.config.ts` or a script) →
     `migratedTestDb(opts)`.
   - Template file present → read it, `new PGlite({ loadDataDir: <Blob> })`, `await client.waitReady`,
     `guardTransactions(client, "throw")`, `drizzle(client, { schema })`. Then perform the **module imports** the
     build path performs, without their database work: `$lib/server/db/seedCompletionTemplates`,
     `$lib/server/pipelines/boot/registrySync`, `@serene-pub/sdk` and `@serene-pub/core-catalog` — importing the
     catalog registers definitions in the SDK registry, and a test may rely on `createTestDb` having done it.
   - Template file absent → `const db = await migratedTestDb(opts)`, then dump it
     (`db.$client.dumpDataDir("none")`; measure `"gzip"` too and keep the faster overall), write it to
     `<file>.<process.pid>.tmp` and `rename` onto `<file>` (atomic: a reader never sees a partial file; several
     workers racing write identical content), return `db`.
   - The file name inside the dir is a key: sha256 of `drizzle/meta/_journal.json`, every `drizzle/*.sql` file's
     content, and the `version` of each `@serene-pub/{sdk,contracts,core-catalog}` package.json. (The per-run
     directory is what makes a stale template impossible; the key is the second guard. Compute it once per module
     instance.)
   - Read and write the template through `process.getBuiltinModule("fs")` (Node ≥ 22.3), not an `import`, so a
     test file that mocks `fs` / `fs/promises` cannot break database set-up.
4. **The proof test**, new `src/lib/server/utils/testDbTemplate.int.test.ts`: build `migratedTestDb()` and
   `createTestDb()` (call `createTestDb()` once first so the second call certainly loads the file; assert the file
   exists in the injected dir), then assert equal: the list of tables in schemas `public` and `drizzle` (name +
   columns with types from `information_schema.columns`), the row count of every table, every sequence's
   `last_value` / `is_called` (`pg_sequences` or per-sequence `SELECT`), and the `drizzle.__drizzle_migrations`
   rows (hash, created_at). Comments state the rule, not the story.
5. Update the file header of `testDb.ts` and `createTestDb`'s doc comment so they state what is now true (the
   template, `migratedTestDb` for a test that must not use it). Keep `createTestDb`'s signature.

## Rules (quoted from the lane brief and CLAUDE.md)

- "No product code changes behaviour in this lane: only test infrastructure, test files' database set-up, and tool configuration."
- "options that change the seed (`skipEntryTypes` …) bypass or key the template. The migration-order and upgrade tests that must replay migrations themselves are untouched."
- "Not in this lane: … `isolate: false`, changing any test's assertions, deleting tests, the standing failures."
- CLAUDE.md: "Never add a top-level `await` to `src/lib/server/db/index.ts`" — you don't edit that file.
  "Inside `db.transaction(async (tx) => …)` use only `tx`." "Never `kill -9`."
- Never `prettier --write`. Comments state the rule, not the story. No other product's name in any file.

## Files owned

`src/lib/server/utils/testDb.ts` (createTestDb, the new migratedTestDb, the template helpers, header/doc
comments), new `scripts/testDbTemplate.ts`, the `globalSetup` line of `vitest.config.ts`, new
`src/lib/server/utils/testDbTemplate.int.test.ts`, scratch files `<S>/fnd1-w3-*`, logs `plans/fnd-1-w3-*.log`.
Nothing else. Do not touch any other test file.

## Tests — one run at a time, capped

A peer session shares this machine. Before every run check `ps -eo pid,args | grep -E "node.*[v]itest"`; if
anything is listed, wait for it to finish (poll the log or the ps line; note `pgrep -f "node.*vitest"` matches
its own shell and never exits — use `[v]itest`). Never start a second run. The only allowed form, from the repo root:

```
SERENE_PUB_TEST_REPORT=<S>/fnd1-w3-run<n>.json systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-1-w3-<n>.log 2>&1"
```

Never pipe vitest into `head`. Paths can be passed with `$(tr '\n' ' ' < <list file>)`.

1. The proof test alone first.
2. **The step-3 set** `<S>/fnd1-step3set.txt` (112 files: every `src/lib/server/db/*.int.test.ts`, every test that
   replays migrations itself, and a 60-file sample of `createTestDb` users, standing failures removed) plus your
   proof test. The supervisor's "before" run of exactly that set is `plans/fnd-1-3.log` / `<S>/fnd1-run3.json`.
   Report from both: the `Duration` line (wall, import, tests, setup) and pass/fail counts. Every file that passed
   before must pass. **If a file fails for a reason that is not database set-up, or the proof test finds any
   difference, stop and report** — don't change the test or paper over the difference.
3. Count how often the template was built vs loaded in that run (a temporary `console.log`/counter is fine while
   measuring; remove it before you finish), and confirm the per-run dir is gone after the run.
4. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` once at the end: 0 errors (it is incremental
   now, warm runs take ~8 s). `npx prettier --check` your files.

## Stop and ask when

The template differs from a migrated database; a file fails for a non-set-up reason; the design above cannot work
as written (say why and what you'd do instead); anything would change a product module or a test's assertions.

## Done means

Proof test green; step-3 set green except files that failed before; per-run dir removed; tsc 0 errors;
prettier clean on your files.

## Report

Final message: files changed, before/after numbers (wall, import, tests, setup), builds vs loads, the globalSetup
behaviour you found with projects, dump compression chosen and why, anything restored or left, noticed-not-done.
Under 500 words.
