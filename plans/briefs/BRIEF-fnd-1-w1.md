# BRIEF — lane `fnd-1`, worker w1 — no second database in `importOriginal` mocks

Repo `/home/jody/github/serene-pub`. Supervisor: lane `fnd-1` (brief `plans/briefs/BRIEF-fnd-1.md`).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You have no reason to run `sdk:build` in this task: don't.)

## Goal

135 integration test files mock the database module like this:

```ts
vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})
```

`importOriginal` evaluates the real `src/lib/server/db/index.ts`, which opens a second, on-disk PGlite in the
run's data directory, migrates it, syncs defaults and widget settings and awaits all of it at import time, only for
the test to replace `db` with its own in-memory database. That second database costs ~10 s per file. Replace it
with a helper that returns the module's surface without loading the real module.

## What to build

1. In `src/lib/server/utils/testDb.ts`, add (name fixed by the supervisor, provisional):

   ```ts
   /**
    * 🚧 The `$lib/server/db` module surface around a test's own database, for
    * `vi.mock("$lib/server/db", …)`. Never loads the real module: importing it
    * opens, migrates and seeds a second database on disk.
    */
   export function testDbModule(db?: TestDb) { … }
   ```

   It returns exactly: `db`, `schema` (the `$lib/server/db/schema` namespace testDb.ts already imports),
   `dbReady: Promise.resolve()`, `closeDatabase: async () => {}` (the test's database is in memory; nothing to
   close), `getCryptoSecretKey: () => "test-crypto-secret-key"` (the constant many existing mocks already use)
   and `compareVersions` (re-exported from `$lib/shared/utils/releaseChannel`, as the real module does). Do NOT
   add `reopenDatabase`: a test that reaches it must fail loudly and keep the real module. `db` is optional only
   for the getter shape below. Also correct the stale sentence in `releaseDataDir`'s doc comment ("every caller
   mocks it with `importOriginal`") so it stays true; keep the rule it states.

2. A codemod script in the scratch area (NOT in the repo):
   `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/fnd1-w1-codemod.mjs`.
   Input list: `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/fnd1-io-files.txt`
   (137 files; the supervisor's scan of each mock's text is `…/scratchpad/fnd1-mocks.json`, and
   `…/scratchpad/fnd1-scan.mjs` shows how it found them). It matches each `vi.mock("$lib/server/db", …)` call by
   whitespace-normalised text against these shapes only, rewrites them, and prints every file it did not match:

   - **A** (117 files): `{ ...actual, db }` or `{ ...actual, db: await createTestDb() }`, with or without
     options passed to `createTestDb(…)` → keep the options verbatim:
     ```ts
     vi.mock("$lib/server/db", async () => {
     	const { createTestDb, testDbModule } = await import("$lib/server/utils/testDb")
     	return testDbModule(await createTestDb())
     })
     ```
   - **B** (16 files): A plus `getCryptoSecretKey: () => "<literal>"` → keep the file's own key:
     `return { ...testDbModule(await createTestDb()), getCryptoSecretKey: () => "<literal>" }`
   - **C** (2 files: `adminLogbook/logbook.int.test.ts`, `sockets/systemSettings.accountsEnabledTransition.int.test.ts`):
     `{ ...actual, get db() { return getDb() } }` →
     `const { testDbModule } = await import("$lib/server/utils/testDb")` then
     `return { ...testDbModule(), get db() { return getDb() } }`
   - **D** (2 files: `sessions/fireTurn.int.test.ts`, `sessions/sessions.turnOrder.int.test.ts`): their mock
     never calls `importOriginal` (unused parameter). Leave them untouched; list them as "already no real module".

   Match the indentation (tabs) and style of the surrounding file. Run it, then `git diff --stat` over the list.

3. Comments in the converted files that state the real module's side effects as a reason (about 3 files:
   `grep -n -iE "importOriginal|side effect" <file>` excluding the mock line itself) — rewrite them to what is
   now true, or delete the sentence if nothing it says is true any more. Comments state the rule, not the story.
   Don't touch any other line of any test.

## Rules you work under (quoted from the lane brief and CLAUDE.md)

- "No product code changes behaviour in this lane: only test infrastructure, test files' database set-up, and tool configuration."
- "Not in this lane: … changing any test's assertions, deleting tests, the standing failures."
- "A file that genuinely needs the real module's behaviour keeps it and is listed in the report with the reason."
- CLAUDE.md: "Never add a top-level `await` to `src/lib/server/db/index.ts`" — you don't edit that file at all.
- CLAUDE.md: "Never `kill -9` the dev server: PGlite's WAL corrupts." Never kill any process you didn't start.
- Never `prettier --write`. No other product's name in any file.

## Files owned

- `src/lib/server/utils/testDb.ts` (the helper and the doc-comment fix only)
- the 135 converted test files' `vi.mock("$lib/server/db", …)` call, plus the ~3 stale comments named in step 3
- your scratch files under the scratchpad dir above, prefixed `fnd1-w1-`

Readable: anything. Not owned: everything else, in particular `src/lib/server/db/index.ts`, `vitest.config.ts`,
`vitest.setup.ts`, `scripts/testTempDirs.ts`.

## Tests — one run at a time, capped

A peer session and the supervisor share this machine. Before every run check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if anything is listed, wait for it to finish (a
background loop such as `while pgrep -f "node.*vitest" >/dev/null; do sleep 20; done`), never start a second run.
The only allowed form (run from the repo root):

```
SERENE_PUB_TEST_REPORT=<scratchpad>/fnd1-w1-run<n>.json systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-1-w1-<n>.log 2>&1"
```

Never pipe vitest into `head`. `SERENE_PUB_TEST_REPORT` makes the run also write a json report (per-file
`startTime`/`endTime`, per-test durations) and print the slowest imports.

1. **Converted set**: run all 135 converted files in one run (the file list minus the two D files). Baseline to
   compare against: `plans/fnd-1-1.log` and `<scratchpad>/fnd1-run1.json` (the same 137 files before the change,
   run by the supervisor). Report wall seconds (the `Duration` line) and the summed per-file seconds from both
   json reports (`endTime - startTime` per `testResults[]` entry), plus the `import` and `tests` totals from both
   `Duration` lines.
2. Every converted file must pass if it passed in the baseline. A file that fails: if the cause is that it needs
   the real module (it reaches `reopenDatabase`, real `closeDatabase`, the real `meta.json`, defaults the real
   module seeded into a shared place, …), put that one file's mock back exactly as it was and list it with the
   reason. **If a converted file fails for any other reason, stop and report it** instead of changing the test.
3. **Probe for the second database**: create `/tmp/serene-pub-vitest-fnd1w1-probe` yourself, then run 20 of
   the converted files (pick ones that statically import product code reaching `$lib/server/db`) with
   `SERENE_PUB_DATA_DIR=/tmp/serene-pub-vitest-fnd1w1-probe` prefixed to the capped command (the setup file
   leaves an inherited directory alone). Afterwards `find /tmp/serene-pub-vitest-fnd1w1-probe -name "serene-pub.db*"`
   must list nothing. Then delete that one directory by name.
4. `npx tsc --noEmit -p . 2>&1 | grep -E "utils/testDb|<converted file paths>"` — no new errors in the files you touched
   (run tsc with `NODE_OPTIONS=--max-old-space-size=10240`; a full tsc takes minutes — run it once at the end).
   `npx prettier --check` on testDb.ts and a sample of 10 converted files.

## Stop and ask when

A converted file fails for a reason that is not its set-up; a shape not listed above; anything would change a
product module or a test's assertions.

## Done means

All converted files pass (or are restored and listed with a reason); the probe finds no `serene-pub.db`; tsc
shows no errors in touched files; prettier clean.

## Report

Your final message: changed files (count + the non-mechanical ones), files restored with reasons, the D files,
before/after numbers from step 1 (wall, summed per-file, import, tests), probe result, tsc/prettier results,
anything noticed but not done. Under 500 words.
