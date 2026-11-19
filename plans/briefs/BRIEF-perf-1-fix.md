# BRIEF — worker task `perf-1-fix` — the cast memo can never serve a read that a write has overtaken

Repo `/home/jody/github/serene-pub`. Read first: `plans/REPORT-perf-1-2026-11-17.md`,
`plans/briefs/BRIEF-perf-1.md` (the rule: no behaviour change; a memo is invalidated by any same-run write that
could change its answer). Re-verify every file:line.

Rules: both repos are staged by the lead: run no git command that changes the index or the working tree;
`npx prettier --check` only, **never `--write`**; no migration. Inside `db.transaction` only `tx`. Comments
state the rule, not the story. Lane `perf-2` is editing `pipelines/config/world.ts`, `sessions/settings.ts`,
`pipelines/runtime/runTurn.ts`, `turnYield.ts`, `sessions/sessionActions.ts`, `sockets/sessions.pipelines.ts`
and reads the host's memos through their accessors: do not touch its files, and **do not rename or change the
signature of `narratorNameOf` or the cast memo's accessor**. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/perf-1-fix-<n>.log 2>&1"`
(always at least one path), after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `npx tsc --noEmit -p .`.

## The problem

Lane `perf-1` memoises the `session_cast` read per host (`sessionCastReads`,
`src/lib/server/pipelines/runtime/host.ts`), cleared when any `host.call` or `host.commit` starts and ends
(wrappers ~7611–7632). Two holes:
- **Writes that bypass both wrappers:** `pipelines/runtime/bindings.state.ts:1103` (`applyAutomatic(db, …)`) and
  `:1111` (`proposeChange`) on the outer `db`; and, **inside** a call, the tool `propose` door
  (`host.call.ts:713`) and `toolDoors`, which sit between the call's two clears. The cast returns fields such
  writes could move: `storyTime.now` (`host.read.sessionCast.ts` 570–573), seat cards (`cardsNow`, ~171),
  `replyCount` (~633).
- **Parallel reads during a call:** the SDK runs parallel clauses (reads are not gated); a cast read that
  starts after a call's opening clear is memoised, and sibling reads then get that copy after a write the call
  makes mid-flight, where before the memo they would have read the database fresh.

## Fix

1. **Bypass while anything is in flight.** Count `host.call`s and `host.commit`s in flight in the wrappers;
   while the count is above 0 the cast memo is neither read nor written (every read goes to the database, as
   before the memo). Clear the memo when the count rises from 0 and when it returns to 0.
2. **Every writer clears it.** Find every write a binding, tool door or script port can make during a run that
   does not go through `host.call` / `host.commit` (start from the two sites above; grep the bindings and
   `host.call.ts` for writes on `db` / state writes / proposals) and make each clear the memo before and after
   (one small exported `forgetSessionCast()`-style function on the host, name by the file's conventions; or
   route those writers through a wrapper that does). List each site in your report.
3. **Narrow the comment** at `host.ts` ~830–843 to exactly what now holds.
4. **Tests** (`host.sessionCastMemo.int.test.ts`, `host.narratorNameMemo.int.test.ts`): for the cast: an
   `advance-story-clock` commit, a `host.call` case that changes `replyCount`, an apply-state-changes write
   through `bindings.state.ts`, and the tool `propose` door: each followed by a read that must equal a fresh
   host's read; a read started while a call is in flight is not memoised (assert the database is asked); a
   one-line comment that cast results must stay `structuredClone`-able. For the narrator name: one same-run
   write test (any outlet) showing the name is unchanged and equal to a fresh host's.
5. **Baselines:** both prompt-baseline tests (`pipelines/runtime/unknownEntries.reply.int.test.ts`,
   `sockets/sessions.lairUnknownEntries.int.test.ts`): fingerprints byte-identical to
   `plans/perf-1-shas-*.txt` (after cut 2); report the statement counts per world (the bypass may give some of
   the saving back: say how much; correctness first).

Append a "Scope review and fix task" section to `plans/REPORT-perf-1-2026-11-17.md` (also: worker 2's report
file `plans/REPORT-perf-1-w2.md` was never written; its log is `plans/perf-1-w2-1.log`).

## Report (under 250 words)

The writers found and how each clears the memo; the in-flight rule; statement counts per world before → after
this fix; tests and counts with log names; `tsc`; anything not done.
