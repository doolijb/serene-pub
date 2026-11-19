# BRIEF — build lane `fnd-2c` — split `sockets/sessions.ts` by area (programme 0.2, third file)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-file-splits-2026-11-15.md` §3 (the map; **re-derive every line range**: the file has grown to
~12,640 lines since), and `plans/REPORT-fnd-2b-2026-11-16.md` and `plans/REPORT-fnd-2a-2026-11-16.md` (how the
first two splits were done and proven: one move script that refuses to write unless every moved block is
byte-identical and the source changed nowhere else, plus independent proofs against the pre-lane file; copy
that method).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write`. Never commit. Delete
only your own `/tmp/serene-pub-vitest-*` dirs by name. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-2c-<n>.log 2>&1"`,
strictly one run at a time (check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` first; if one is
up, wait for it). Type checks with `NODE_OPTIONS=--max-old-space-size=10240` (`npx tsc --noEmit -p .` is
incremental). The SDK is not touched.

## The rule of this lane

**Mechanical moves only. No behaviour change, no renamed symbol, no edited logic, no reformatting of moved
code.** Every name importable from `sockets/sessions` today stays importable from that path (188 importers;
`ownBooks.fold.int.test.ts` mocks `./sessions` for `pushSessionToParticipants`: the re-export must stay and the
mock must still take effect for the code that calls it; prove it by running that test). `registerSessionHandlers`
stays the one entry point and **registers every event in today's order**. A module-level map, cache or lock
ends up in exactly one module; list each one you find and where it landed. A handler that closes over
`registerSessionHandlers`' locals (`socket`, `io`, the user, …) moves only as a function taking those as an
explicit argument object, with the call line in `sessions.ts` the only new code; if a move needs more than that
to compile, stop that step and report.

## Steps (one at a time, sequential workers; each ends green before the next)

1. `sessions.shared.ts`: helpers, relist, `getSessionFromDB`, broadcast, the binding check.
2. `sessions.messages.ts`: the message handlers.
3. `sessions.pipelines.ts`: functions / pipelines handlers (the busy door and the run-in-progress guards from
   lane ss-7 live here or in shared: keep each guard beside the handler it guards).
4. `sessions.create.ts`.
5. `sessions.update.ts`: update and draft.
6. `sessions.layout.ts`.
7. `sessions.turns.ts`: **`sessions.fireTurnOnly.test.ts` reads this file's text** for
   `event: "sessions:fireTurn"`; point its path at the new file in the same step (the only test edit allowed).
8. Participants and overlay.

Stop after any step if the remaining ones look riskier than the inventory says; a partial split is acceptable
and reported as such.

Per step: no new import cycle (new files import shared helpers from `sessions.shared.ts`, never from
`sessions.ts`; an existing cycle is left and named); `tsc` 0 errors; the export set of `sockets/sessions`
unchanged (TS checker or `Object.keys` probe, deleted afterwards); then tests: every
`src/lib/server/sockets/sessions*.test.ts` / `*.int.test.ts` touching the moved area (all of them after the
last step), `sockets/ownBooks.fold.int.test.ts`, `sockets/sessions.editedLineRerun.int.test.ts`,
`sockets/sessions.retake.int.test.ts`, `pipelines/runtime/allPipelines.int.test.ts`. Failures allowed only if
that file is in the standing list (the failing files of `plans/lead-full11.log`).

## Done means

`sessions.ts` is `registerSessionHandlers` plus what must stay (report the real size, what remains and why);
all checks green after the last step; `NODE_OPTIONS=--max-old-space-size=10240 npm run check` 0 errors; the
comment ratchet (`src/lib/shared/conformance/commentHistory.ratchet.json`) redistributed for moved comments
with the total unchanged; any test or script that names `sockets/sessions.ts` as a path or reads it as text
found (grep) and listed.

## Stop and ask when

A step needs a logic change; a cycle cannot be avoided; the export set differs; registration order would
change; another lane's uncommitted edit sits inside a block you are moving and the move would lose it (verify
with `git diff` before each step).

## Report

Final message = the report (lead saves `plans/REPORT-fnd-2c-<date>.md`): per step, new file, lines, size of
`sessions.ts` after, checks; module-level state and where it lives; what stays and why; **Noticed, not done**.
Under about 600 words.
