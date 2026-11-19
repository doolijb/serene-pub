# BRIEF — build lane `fnd-3` — the standing test failures (programme 0.3)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-standing-failures-2026-11-16.md` (the triage: one row per failing test, with cause and fix;
**re-verify every file:line and every cause before editing**: a row may be wrong).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash` / `checkout` / `restore`; `npx prettier --check` only, never `--write`. Never commit. Delete
only your own `/tmp/serene-pub-vitest-*` dirs by name. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/fnd-3-<n>.log 2>&1"`,
strictly one run at a time: another lane (`fnd-2c`) runs tests too, so check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` before every run and wait if one is up. Type checks
with `NODE_OPTIONS=--max-old-space-size=10240`. **The SDK is not touched and `sdk:build` is not run.**

## Owner (2026-11-15)

Programme 0.3: "Each is fixed, or deleted with the reason written down; the suite ends green so a run reads
clean at a glance."

## Build

Every row of the inventory **except** the two marked ★ (D19 `paramsSlotWiring`, D20 `panel/groups`): those
wait for the owner; leave their tests failing and untouched.

- Class **A** rows: update the test's expectation to what the code does today, only after confirming the code's
  present behaviour is intended (find the change that moved it; if it looks like an accident, stop on that row
  and report it as a possible defect instead of pinning it). Excuse lists (`UNCONSUMED_OUT_SHAPES`,
  `UNFILLED_IN_PORTS`, `CONSUMERS`, `dispatchable`) get one reason per entry, stated as a rule.
- `importBoundary` "nothing under shared/…": fix the test's path resolution; product imports stay as they are.
- Class **C** rows: the temp dir fix as given.
- `commentHistory`: rewrite each flagged comment as a present-tense rule (comments state the rule, not the
  story; never delete a comment that carries a rule), then `npm run comments:ratchet`. **Skip any flagged file
  under `src/lib/server/sockets/sessions*.ts`: lane `fnd-2c` is moving that file now**; list what you skipped.
- `guideGrounding`: find out why (print the scores in a throwaway copy of the test, not committed to the file).
  If the guide is just below the cut because the docs corpus grew, make the assertion stable without weakening
  what it guards (say how); if retrieval lost it, change nothing and report.
- `scoreLedAllocation`: the inventory notes the entries still disagree after the budget change; make the test
  meaningful again or report why it cannot be.

No product behaviour changes in this lane. A row whose honest fix is a product change: stop on that row, report.

## Files owned

The test files named in the inventory, the comment lines the ratchet flags (except as above),
`src/lib/shared/conformance/commentHistory.ratchet.json`. Do not edit `src/lib/server/sockets/sessions.ts` or
any `sessions.*.ts` beside it (tests of it are fine).

## Done means

Each fixed file passes alone and all of them pass together in one capped run; `tsc` 0 errors;
`NODE_OPTIONS=--max-old-space-size=10240 npm run check` 0 errors.

## Report

Final message = the report (lead saves `plans/REPORT-fnd-3-<date>.md`): per row, what was changed and the
evidence the present behaviour is intended; rows stopped and why; the ratchet numbers; **Noticed, not done**.
Under about 600 words.
