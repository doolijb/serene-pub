# BRIEF — build lane `perf-3` — statements per reply, third pass: what the first two passes listed as remaining (programme 0.5)

Repo `/home/jody/github/serene-pub` (app). SDK not touched. Supervisor: read `.claude/guides/multi-agent.md`,
then `plans/REPORT-perf-2-2026-11-17.md` ("What remains"), `plans/REPORT-perf-1-2026-11-17.md` (the two host
memos and their invalidation rules, incl. its fix section: `hostInFlight`, `castWrite`),
`plans/INVENTORY-statements-per-reply-2026-11-17.md`, `plans/briefs/BRIEF-perf-1.md` and `BRIEF-perf-2.md` (the
method and rules: all apply). Re-verify every file:line.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Both repos are staged by the lead: run no git command that changes the index or the working tree.
`npx prettier --check` only, **never `--write`**. No migration. Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/perf-3-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc`. No full run, no `npm run build`. An isolated instance of
the app may be running for a UI walk (a `vite dev` in another data directory): it does not edit code; do not
stop it; **do not run `sdk:build`**.

## Rule

No behaviour change: every prompt fingerprint in both baseline tests stays byte-identical to
`plans/perf-2-shas-final.txt`; what any read returns, the order of writes and what every socket push carries
are unchanged. No caching across runs. One cut at a time, both baselines re-run after each, counts per world
recorded before → after (start: Story second world 1036, the Lair 2500).

## Cuts (each: verify the claim with a quick profile, then cut, then baselines)

1. **The `session-settings` query case** (`pipelines/runtime/host.ts:2280`): it resolves settings on a host of
   its own; pass the run's host (`{ host }`, as lane `perf-2` did for `runTurn.ts`) so it reuses the run's
   narrator-name and cast memos. Saves one narrator build and one cast read in the Lair.
2. **`sessionSpeech.ts:22`** reads settings on its own host after the turn: if a run's host is at hand there,
   pass it; if it runs after the run has ended, leave it and say so.
3. **The rewind check** (`sessions/rewind.ts`): `rewindStateOf` runs `turnUnitOf` twice (~300 statements per
   push): compute once per `rewindStateOf` and share; and in a genre with no fallback envoy each check still
   builds the narrator name (lane `perf-2`'s cut 3 skips it only when a fallback envoy exists): compute the
   naming **once per `rewindStateOf`** (or once per push) rather than per check. Assert the pushed rewind state
   is deep-equal before and after for Story and the Lair, owner and guest.
4. **The actions push** (`sessions/actionsPush.ts`): `listSessionFunctions` ignores `userId`, so it can be read
   once per push rather than once per member; each member's payload stays byte-identical (serialised compare,
   owner and a guest, with this week's guest rules in force).
5. **`turnDeleteRefusedThrough`** and the per-member `reading` reads that `perf-1` rejected: profile again now
   that the big repeats are gone; take them only if a safe, small cut exists (a batched read with identical
   results); otherwise record the count and why not.

For each cut state what could invalidate it and the test that proves a same-run write is still seen. A cut
that cannot be made without changing an output is recorded as rejected with the reason.

## Tests

Both baselines after every cut; the grouped lane run `perf-2` used (its 16 files) green at the end; the new
equality tests. `tsc` 0.

## Files owned

`pipelines/runtime/host.ts` (the `session-settings` case only: lanes `perf-1` and its fix own the memos:
do not change them), `sessions/sessionSpeech.ts`, `sessions/rewind.ts`, `sessions/turnYield.ts` (only if the
naming is hoisted), `sessions/actionsPush.ts`, the per-member reading site if cut 5 is taken, their tests.
Workers one after the other when they share a file; briefs `plans/briefs/BRIEF-perf-3-w<n>.md`.

## Report

Final message = the report (lead saves `plans/REPORT-perf-3-<date>.md`): each cut (what, where, saving, what
invalidates it); counts per world before → after each; cuts rejected and why; what remains; **Noticed, not
done**. Under about 500 words.
