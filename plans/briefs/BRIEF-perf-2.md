# BRIEF — build lane `perf-2` — statements per reply, second pass: the repeats outside the host (programme 0.5)

Repo `/home/jody/github/serene-pub` (app). SDK not touched. Supervisor: read `.claude/guides/multi-agent.md`,
then `plans/REPORT-perf-1-2026-11-17.md` ("What remains"), `plans/INVENTORY-statements-per-reply-2026-11-17.md`,
`plans/briefs/BRIEF-perf-1.md` (the method and rules: they all apply here). Re-verify every file:line.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Both repos are staged by the lead: run no git command that changes the index or the working tree.
`npx prettier --check` only, **never `--write`**. No migration. Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/perf-2-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc`. No full run, no `npm run build`. A read-only review of
lane `perf-1` is running; no other lane is editing code.

## Rule

No behaviour change: every prompt fingerprint in both baseline tests stays byte-identical to
`plans/perf-1-shas-*.txt` (after cut 2); what any read returns, the order of writes and what every socket push
carries are unchanged. No caching across runs. One cut at a time, both baselines re-run after each, counts per
world recorded before → after.

## Cuts, largest first (each: verify the profile's claim, then cut, then baselines)

1. **`buildWorld`'s variable templates** (`src/lib/server/pipelines/config/world.ts` 1276–1407): it reads
   `pipeline_variable_templates` four times per variable on every build (548 statements in a Story reply, 1152
   in the Lair). One batched read (`IN (…)`) per build, results distributed in memory; same rows, same
   precedence, same order. Expected ~290 (Story) / ~700 (Lair). Test: a build's output is deep-equal before
   and after for every shipped genre and for a session with a preset-level and a pub-wide layout for the same
   variable (the precedence case).
2. **Settings read builds its own host.** `resolveSessionSettings` (`sessions/settings.ts:306`) creates a host
   of its own, so each run pays a second cast read and narrator build; `pipelines/runtime/runTurn.ts:1064`
   reads settings before the run's host exists (:1137). Let the run create its host first and hand it (or the
   two values it needs) to the settings read, so one host serves both; callers of `resolveSessionSettings`
   outside a run keep today's path. Expected ~330 / ~500. Mind lane `perf-1`'s memo rules: the cast memo is
   cleared around every `host.call` / `host.commit`.
3. **`turnYield.ts:243`** builds the narrator name on each rewind check (~560 in the Lair): take it from the
   run's host memo (`narratorNameOf`) where a run exists, else compute once per check batch.
4. **`runTurn.ts:996`**: two `buildWorld` calls per run (~160 / ~200): build once and pass it, if both calls
   have the same inputs (prove it; if a write between them can change the answer, leave it and say so).
5. **The actions push after a turn** (`sessions/sessionActions.ts` 311 / 325 / 506 / 902, via
   `sockets/sessions.pipelines.ts`; ~740 in the Lair): find what repeats (a `buildWorld` per action? per
   recipient?) and compute once per push; the payload each recipient gets is byte-identical (assert on the
   serialised push for the owner and a guest).

For each cut state in the report what could invalidate it and the test that proves a same-run write is still
seen. If a cut cannot be made without changing an output, record it as rejected with the reason.

## Tests

Both baselines after every cut; the grouped lane run `perf-1` used (genreParity, lairWalk, dungeonCrawler,
envoyRoad, both baselines, the memo tests, the guard tests) green at the end; the new equality tests. `tsc` 0.

## Files owned

`pipelines/config/world.ts` (the variable-template reads), `sessions/settings.ts` (`resolveSessionSettings`'s
host), `pipelines/runtime/runTurn.ts` (the two sites), `pipelines/runtime/turnYield.ts`,
`sessions/sessionActions.ts` and the push site in `sockets/sessions.pipelines.ts`, their tests. Workers one
after the other when they share a file; briefs `plans/briefs/BRIEF-perf-2-w<n>.md`.

## Report

Final message = the report (lead saves `plans/REPORT-perf-2-<date>.md`): each cut (what, where, saving, what
invalidates it); counts per world before → after each; cuts rejected and why; what remains; **Noticed, not
done**. Under about 550 words.
