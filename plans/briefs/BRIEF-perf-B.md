# BRIEF — build lane `perf-B` — plugin sandbox: a pool, cheaper marshalling, one storage walk, the dead path removed

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then: `plans/PLAN-performance-2026-11-13.md`
Part 1 and W3; `plans/REVIEW-performance-2026-11-13.md` rows A1–A10 and its measured baselines; the file headers of
`src/lib/server/plugins/QuickJsSandbox.ts`, `SandboxManager.ts` (the `HOOK_DEADLINE_SLACK_MS` comment),
`pipelines/scripts/host.ts` (the `PendingJob` comment on the 2026-10-19 queued-kill bug), `plugins/storageHost.ts`
~90–130 and ~240–320; `docs/plugins.md` §"What a plugin can't do" and §"The data folder and storage"; CLAUDE.md
Principles and Hard rules. Line numbers are from 2026-11-13; re-read before editing.

## Rulings that bind

- Owner 2026-11-13: improvements **without sacrificing security**. The guest-to-host wall, plugin-to-plugin
  isolation, the interrupt and kill path, the memory cap, the grants and the storage transaction semantics stay
  exactly as they are. A fresh runtime + context per call stays (★P3 warm context is unruled: do not build it).
- ★P4 (fetch body cap), ★P5 (invocation retention), ★P3 are unruled: not in this lane.
- Security posture statements in file headers are canon; update them where your change makes them stale, in the
  same edit.

## Build

1. **Worker pool with per-plugin affinity, and a `started` ack** (A2). `QuickJsSandbox` runs N workers (default 2,
   at most 4; pick from `os.availableParallelism()` and say the rule in the report), each holding the WASM module and
   every loaded bundle (re-hydrated on spawn as today). A plugin's calls go to one worker (hash of plugin id, or
   least-loaded with sticky assignment; choose and justify). The evaluator posts `{id, started: true}` when a job
   actually begins, and the host arms the wall-clock backstop only then — port the pattern from
   `pipelines/scripts/host.ts` (`arm`, `post`, `breakWorker` with a culprit so queued jobs are re-posted, not failed).
   `breakWorker` kills only the culprit's worker. `kill`/`abort` keep working per job across workers. The inline
   debug path is unchanged. Update the header's "one pooled worker" sentences.
2. **Input through a guest global** (A3). In `QuickJsSandbox`'s evaluator and in `pipelines/scripts/host.ts`
   `buildProgram`, hand `inputJson` / `vars` / `extras` / the annex JSON to the guest as a string set on the global
   (`context.newString` + `setProp`) and `JSON.parse` it once inside the program, instead of embedding the JSON as a
   string literal. Byte-for-byte identical behaviour for the hook; the SES worker's program may keep its literal if
   changing it would make the two backends differ in any observable way — say which you chose.
3. **Storage walk once per transaction** (A5). In `storageHost.ts`, measure the on-disk size once when the
   transaction opens (lazily, on first write or `usage()`), then keep the projected size as a running number updated
   by `bufferWrite` / `bufferRemove`. `usage()`, `receipt()` and the quota check read the number. Semantics
   (quota refusal point, receipt values, `files.list` output) are unchanged; `storageHost.test.ts` is the contract.
4. **Re-point the budgets and abuse tests at the production host** (A4). `scripts/scripts.budgets.test.ts` and
   `scripts/abuse.test.ts` currently exercise `runScript` (`scripts/run.ts`), which nothing in production calls.
   Re-point both at `runScriptSource` (`pipelines/scripts/host.ts`): keep every corpus case, the regex-interrupt
   case must still pass on the worker path, thresholds stay §9's (the first budget measured a cold in-process
   context; on the worker path a round trip is included — if §9's 5 ms does not hold, report the number, do not
   loosen the threshold). **Do not delete** `scripts/run.ts`, `scripts/engine.ts` or `plugins/RuntimeManager.ts`:
   that is ★P11 and waits for the owner. Leave `pluginBindings.ts` alone.
5. **Drive loop without the 1 ms timer** (A7), only if step 1 leaves the loop in place: wait on whichever settles
   first of the open fetches, a flag change, or the deadline, instead of `setTimeout(r, 1)`. If that complicates the
   kill/abort guarantees, skip it and say so.

## Files owned

`src/lib/server/plugins/QuickJsSandbox.ts` · `SandboxManager.ts` · `storageHost.ts` · their tests ·
`src/lib/server/pipelines/scripts/host.ts` and `host.test.ts` · `src/lib/server/scripts/*.test.ts` (tests only) ·
`vitest.budgets.config.ts` · `docs/plugins.md` (only if a sentence becomes false).

## Files readable

Everything, including `../serene-pub-sdk/sdk/src/pluginHarness.ts` and `conformance/`.

## Out of scope

Warm context (★P3, deferred: it breaks P1 determinism). Fetch cap (★P4). Invocation retention/index (★P5). File
deletions (★P11). SES worker beyond keeping parity. Any new
setting or environment variable beyond reusing `SP_PLUGINS_INLINE`. Rules sandbox (`rulesets/sandbox.ts`).

## Stop and ask when

A security statement in a header would have to change in meaning; a test asserting isolation or kill semantics has
to change to pass; a new user-facing name; anything that would make the two backends observably differ.

## Done means

`npx vitest run src/lib/server/plugins/QuickJsSandbox.test.ts src/lib/server/plugins/SandboxManager.test.ts
src/lib/server/plugins/storageHost.test.ts src/lib/server/plugins/sandboxAuthoring.contract.test.ts
src/lib/server/plugins/engineHost.int.test.ts src/lib/server/pipelines/scripts/host.test.ts
src/lib/server/scripts/abuse.test.ts` green, and
`npm run test:budgets` green on the production host. Two new tests: (a) a hook spinning on one plugin does not delay
a 100 ms-budget call on another plugin past ~50 ms (the review measured ~1,000 ms today); (b) a job queued behind a
blocked worker is not killed by the backstop before it starts. Re-run the per-call cost at 8/64/256 KB bundles and
report before/after (the review's baseline: 1.9 / 7.2 / 22 ms).

## Report path

`plans/REPORT-perf-B-2026-11-13.md`: changed files, tests with results, the measurements, open ★, **Noticed, not done**.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
- At most 2 workers at once. Workers get these rules inline.
