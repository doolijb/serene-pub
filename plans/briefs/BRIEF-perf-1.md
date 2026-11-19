# BRIEF — build lane `perf-1` — statements per reply: profile one reply, cut repeated reads (programme 0.5)

Repo `/home/jody/github/serene-pub` (app). SDK not expected to change. Supervisor: read
`.claude/guides/multi-agent.md`, then the programme row 0.5 in `plans/PLAN-programme-2026-11-15.md`
("Statements per reply (Story ~2,040, the Lair ~4,580 per run, measured 2026-11-15): profile one reply, cut
repeated reads."), the performance plan notes in `plans/` (grep `PLAN-performance`, `perf-`: rounds 1–5; what
was already memoised per run, e.g. the host's `lorebookReads`), today's baseline numbers
(`plans/wt-1b-fix-shas-sup.txt`: Story baseline 2802 / 2076, Story c / d / e 2784 / 2554 / 2391, Lair baseline
4672 / 4668, Lair c / d / e 4668 / 3806 / 4681) and the two baseline tests that print them
(`pipelines/runtime/unknownEntries.reply.int.test.ts`, `sockets/sessions.lairUnknownEntries.int.test.ts`: find
how they count statements and fingerprint the prompt).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Both repos are staged by the lead: run no git command that changes the index or the working tree.
`npx prettier --check` only, **never `--write`**. No migration. Inside `db.transaction` only `tx` (never the
outer handle: a memo that captures `db` and is then used inside a transaction deadlocks PGlite). Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/perf-1-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc`. No full run, no `npm run build`. A worker task `rt-1` is
editing `routines/evaluate.ts` and three docs sentences: do not touch those.

## Owner

Standing: P1 "Deterministic … Same inputs, same result"; the performance plan's rule: **no behaviour change,
prompts byte-identical**; comprehension and fidelity first. This lane must not change what any read returns.

## Method

1. **Profile first, report the table, then cut.** For one Story reply and one Lair reply (the baseline
   worlds), group the statements by the SQL text's shape and by the function that issued them (a statement
   log with a stack frame, in a scratch test or behind the baselines' existing counter: do not ship a
   profiler): the top repeated shapes, how many times each runs in one reply, and from where. Write
   `plans/INVENTORY-statements-per-reply-2026-11-17.md`: shape → count → caller(s) → why it repeats (per
   step, per row, per speaker, per candidate) → whether a per-run memo, a batched read (`IN (…)`), or a value
   already in hand removes it.
2. **Cut the repeats that are safe**, largest first, each as its own small change with the two baselines
   re-run after it: a read repeated within one run with the same arguments → memoise on the run's host object
   the way the existing per-run memos are (find them: `lorebookReads` and siblings; follow their invalidation:
   a memo must be dropped or bypassed after a **write** in the same run that could change its answer: for each
   memo say what invalidates it and test it); N single-row reads in a loop → one batched read; a value a
   caller already holds → pass it. No caching across runs. No change to query results, ordering or timing of
   writes.
3. **Stop conditions per cut:** a prompt fingerprint moves (revert that cut and record it as "not safe:
   why"); a test fails; a memo would have to live across a write that reads back its own data.
4. **Target:** take what is cheap and provably safe; report the rest with its expected saving. Do not chase a
   number.

## Tests

Both baseline tests after every cut: shas byte-identical to `plans/wt-1b-fix-shas-sup.txt`; statement counts
recorded per world (before → after per cut). For each memo: a test that a write in the same run is seen by the
next read. First turns of the shipped genres (find the grouped lane run earlier lanes used: `genreParity`,
`lairWalk`, `dungeonCrawler`, `envoyRoad`) green at the end. `tsc` 0.

## Files owned

`src/lib/server/pipelines/runtime/host*.ts` and `bindings*.ts` read paths, `state/` reads, the per-run memo
object, the inventory file, the tests. Not: routines, sockets, the SDK, any write path's behaviour.

## Stop and ask when

CLAUDE.md §Decisions applies; a cut needs a schema index (propose it with the measured gain: no migration
here); a repeated read turns out to be needed for correctness after an intervening write.

## Report

Final message = the report (lead saves `plans/REPORT-perf-1-<date>.md`): the profile table (top shapes); each
cut (what, where, saving, what invalidates the memo); counts per world before → after; cuts rejected and why;
what remains with expected savings; **Noticed, not done**. Under about 600 words.
