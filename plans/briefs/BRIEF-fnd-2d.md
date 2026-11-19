# BRIEF — build lane `fnd-2d` — split `sockets/narrativeGraph.ts` by area (programme 0.2, fourth file)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-file-splits-2026-11-15.md` §4 (the map; **re-derive every line range**), and
`plans/REPORT-fnd-2c-2026-11-16.md` (how the previous split was done and proven: the move tool that refuses to
write unless every moved block is byte-identical and the source changed nowhere else, plus independent proofs
against the pre-lane file; the tool is in the scratchpad as `fnd-2c-move.cjs`, described in that report and in
`REPORT-fnd-2b-2026-11-16.md`: retarget it, or rebuild it the same way if it is gone).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write`. Never commit. Delete
only your own `/tmp/serene-pub-vitest-*` dirs by name. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-2d-<n>.log 2>&1"`,
one run at a time; other lanes run tests: wait with `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`
(a pattern without the `^node` anchor matches its own shell and never ends). Type checks with
`NODE_OPTIONS=--max-old-space-size=10240`. The SDK is not touched. No full run, no `npm run build`.

## The rule of this lane

**Mechanical moves only. No behaviour change, no renamed symbol, no edited logic, no reformatting of moved
code.** Every name importable from `sockets/narrativeGraph` today stays importable from that path; the
registration function stays there and registers every event in today's order. **Module-level state ends up in
exactly one module, with the code that uses it**: `buildResumeStates` / `buildResumeScopes` (build only),
`buildsBeingApplied` (apply only); if any other module reads one of them, stop that step and report. A handler
that closes over registration locals moves only as a function taking them as an explicit argument object; if a
move needs more than that to compile, stop that step and report.

## Steps (one at a time, sequential workers; each ends green before the next)

1. `narrativeGraph.shared.ts`: shared helpers.
2. `narrativeGraph.apply.ts`: apply, with `buildsBeingApplied`.
3. `narrativeGraph.merge.ts`: merge.
4. `narrativeGraph.build.ts`: build, with its two maps. **`activity.connectionLeak.test.ts` (~322–343) lists
   this file and requires a `status: "error",` write there**: update its file list in the same step (the only
   test edit allowed besides a path string a test reads as text).
5. `narrativeGraph.relationships.ts`: relationships. Note: lane `time-t6c2` added knowledge-tie refusals to the
   update / delete handlers; they move with their handlers, unchanged.

A partial split is acceptable and reported as such.

Per step: no new import cycle (new files import from `narrativeGraph.shared.ts`, never from
`narrativeGraph.ts`); `tsc` 0 errors; export set unchanged (TS checker); tests: every
`src/lib/server/sockets/narrativeGraph*.test.ts` / `*.int.test.ts`, `knowledgeTiesHidden.int.test.ts`,
`activity.connectionLeak.test.ts`, any test that mocks or reads `sockets/narrativeGraph` (grep; list them).
Failures allowed only if the file also fails in `plans/lead-full12.log`.

## Done means

`narrativeGraph.ts` is the registration plus what must stay (report size, what remains and why); all checks
green after the last step; `npm run check` 0 errors in this lane's files; the comment ratchet
(`src/lib/shared/conformance/commentHistory.ratchet.json`) redistributed for moved comments with the total
unchanged; `characters/frozenColumns.guard.test.ts` and any other guard that lists socket files by path checked
(report whether the new files are covered).

## Stop and ask when

A step needs a logic change; a cycle cannot be avoided; the export set differs; registration order would
change; another lane's uncommitted edit sits inside a block you are moving and the move would lose it (verify
with `git diff` before each step: lane `io-1` is working on lorebook export / import and may touch this file).

## Report

Final message = the report (lead saves `plans/REPORT-fnd-2d-<date>.md`): per step, new file, lines, size after,
checks; module-level state and where it lives; what stays and why; **Noticed, not done**. Under about 500 words.
