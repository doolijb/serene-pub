# BRIEF — worker task `rt-1` — a routine's `when` is applied; the docs say what a routine can wake

Repo `/home/jody/github/serene-pub` (app); SDK `/home/jody/github/serene-pub-sdk` (docs / guide sentences only;
no build). Read first: `plans/INVENTORY-routine-groups-2026-11-17.md` §2 (the ⚠ about `when`), §5 and
"Noticed", `docs/pipelines.md` ~60–75 (routines), `NOMENCLATURE.md` ~185, `../serene-pub-sdk/INTEGRATING.md`
~1325. Re-verify every file:line.

Rules: both repos are staged by the lead: run no git command that changes the index or the working tree;
`npx prettier --check` only, **never `--write`**; no migration. Inside `db.transaction` only `tx`. Comments
state the rule, not the story. A lane `perf-1` is profiling and editing read paths under
`src/lib/server/pipelines/runtime/` and `state/`: do not touch those. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/rt-1-<n>.log 2>&1"`
(always at least one path), after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `npx tsc --noEmit -p .`.

## Fix 1 — a routine's `when` is stored, validated and shown, but never applied

`whenHolds` runs only on the event path (`src/lib/server/pipelines/registrations/resolve.ts:495`); the routine
path (`src/lib/server/routines/evaluate.ts` and what it calls) never asks it, so a routine registered with a
`when` condition fires regardless. No shipped routine sets `when`, so shipped behaviour does not change; a
user's or plugin's routine that sets one starts obeying it. Apply the same `whenHolds` (same inputs, same
semantics as on the event path: find exactly what it reads and at which moment) at the point a routine is
found due: a routine whose `when` does not hold **does not fire and does not consume its cadence** (decide by
what the event path does for a registration whose `when` fails; if a cadence counter exists per routine, say
whether a skipped firing resets it, and follow what a due-but-off routine does today), and the skip shows the
way a routine's other skips show (find the existing skip reasons in `evaluate.ts`: one sentence in the same
style, ★). Tests: `when` true fires; false does not fire, with the reason; shipped routines unchanged (the
existing routine tests stay green).

## Fix 2 — the docs on a routine waking another

`docs/pipelines.md:70`, `NOMENCLATURE.md` ~185 and `INTEGRATING.md` ~1325 say a routine never wakes another;
the code lets a routine's writes wake other routines **once** (one level; `routines/evaluate.ts` 209, 333;
pinned by `evaluate.test.ts:129`). The pinned behaviour is the rule: correct the three sentences to say one
level, no further, and why (to keep a chain from running away): one sentence each. Do not change code.

## Report (under 200 words)

What changed (file:line); what a skipped routine does to its cadence; the skip sentence (★); tests and counts
with log names; `tsc`; anything not done.
