# BRIEF — build lane `fnd-1` — a faster verification loop (programme 0.1)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-verification-cost-2026-11-15.md` (the evidence; re-verify what you rely on),
`vitest.config.ts`, `vitest.setup.ts`, `src/lib/server/utils/testDb.ts`, `src/lib/server/db/index.ts`
(read-only: **never add a top-level `await` there**), and CLAUDE.md's Hard rules.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write`. Never commit. Never `kill -9`. Delete only your
own `/tmp/serene-pub-vitest-*` dirs by name. Tests run only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-1-<n>.log 2>&1"`,
strictly one run at a time; a peer session shares the checkout (check `ps -eo pid,args | grep -E "node.*vitest" |
grep -v grep` first). No product code changes behaviour in this lane: only test infrastructure, test files'
database set-up, and tool configuration.

## Owner (2026-11-15)

"perhaps you should first prioritize optimizing those files and the verification suite." A full run is ~78–85
minutes; this lane's target is set by measurement, and every step reports before / after numbers.

## Steps, in this order; each is measured before the next starts

1. **Evidence on.** Add the json reporter alongside the default (an output file under `plans/` or a temp dir,
   chosen by an env var so a normal `npm test` is unchanged) and `experimental.importDurations` if the installed
   Vitest has it. Record the baseline per-file numbers for the files each later step touches.
2. **No second database in `importOriginal` mocks** (~153 files, e.g.
   `src/lib/server/characters/cardFromMember.int.test.ts` ~29–34). A helper in `testDb.ts` (🚧 `testDbModule()`)
   returns what those mocks need (`db`, `schema`, `dbReady`, a no-op `closeDatabase`, and whichever other exports
   the inventory shows are read) without loading the real module. Convert the files mechanically (a codemod
   script kept in the scratch area, not the repo). A file that genuinely needs the real module's behaviour keeps
   it and is listed in the report with the reason. Verify: the converted files pass; no `serene-pub.db` appears
   under their `/tmp/serene-pub-vitest-*` dirs; before / after seconds.
3. **A template database for `createTestDb`.** Build once per run in global set-up (migrate, resync sequences,
   seed, sync the registry), dump it (`dumpDataDir`), and have `createTestDb` load the dump
   (`loadDataDir`); key the dump on a hash of `drizzle/meta/_journal.json`, every migration file's content and
   the SDK packages' built versions, so a stale dump is impossible; options that change the seed
   (`skipEntryTypes` and any other the inventory finds) bypass or key the template. The migration-order and
   upgrade tests that must replay migrations themselves are untouched. Verify with the migration tests, the
   `db/*.int.test.ts` files and a 60-file sample; before / after seconds; **a test that the template equals a
   freshly migrated database** (table list, row counts, sequences).
4. **A bootstrapped template** for files that call `bootstrapPipelines`, only if step 3's numbers show it is
   worth it and the in-process part of bootstrap can still run cheaply; otherwise report why not.
5. **SDK dist outside Vitest's transform** (`test.server.deps.external` for the linked packages' `dist`, or the
   equivalent), only if step 1's import numbers show a gain; check the files that `vi.mock("@serene-pub/sdk")`
   and that registry singletons stay shared.
6. **Type checks.** Measure `npx tsc --noEmit -p . --extendedDiagnostics` (10 GB heap) once. Then: `incremental`
   + `tsBuildInfoFile` (ignored by git) for the tsc pass; `svelte-check --incremental` if the installed version
   supports it; and a `tsconfig` split so `npm run check` does not type-check `**/*.test.ts` while a separate
   tsc pass still does (no file may fall out of both passes: prove it with a file-count check). Report memory
   and time before / after.
7. **Workers.** With the per-worker memory measured (`--logHeapUsage` on a sample), say whether 4 workers fit
   under 10 GB; do not change the lead's command, only report.

Not in this lane: moving heavy suites to an opt-in project (a policy choice, with the owner), `isolate: false`,
changing any test's assertions, deleting tests, the standing failures (lane 0.3).

## Stop and ask when

A converted file fails for a reason that is not the set-up; the template database differs from a migrated one;
a step would change what a product module does; the same standing failures list changes (compare with
`plans/lead-full8.log`: 21 files).

## Done means

Every step's before / after table; the sample runs green except standing failures; `npx tsc --noEmit -p .` 0
errors and `npm run check` 0 errors under the new configuration; docs for contributors (`CONTRIBUTING.md` test
section, CLAUDE.md is the lead's) updated where a command changes.

## Report

Final message = the report (lead saves `plans/REPORT-fnd-1-<date>.md`): numbers per step, files converted and
files left with reasons, new helper names, the projected full-run time, what the lead should change in the
grouped verification command, **Noticed, not done**. Under about 800 words.
