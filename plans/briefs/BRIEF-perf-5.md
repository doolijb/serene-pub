# BRIEF — build lane `perf-5` — statements per reply, fifth pass: the run's cast memo survives host calls and commits that cannot change the cast (programme 0.5)

Repo `/home/jody/github/serene-pub` (app). SDK not touched. Supervisor: read `.claude/guides/multi-agent.md`,
then `plans/REPORT-perf-4-2026-11-17.md` (**Cut 4: profiled only**), `plans/REPORT-perf-1-2026-11-17.md` and
its fix section (the two host memos, `hostInFlight`, `castWrite`, why the memo is cleared around every
`host.call` and `host.commit`), `plans/REPORT-perf-2-2026-11-17.md`, `plans/briefs/BRIEF-perf-3.md` (method
and rules: all apply; log names `plans/perf-5-<n>.log`).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

The repo is staged by the lead: run no git command that changes the index or the working tree. Never run
prettier with `--write` or pipe its output into a file. No migration, no SDK build, no full run, no
`npm run build` (an isolated instance of the built app may be running for a UI walk: do not stop it, do not
rebuild). Comments state the rule, never the history.

## Rule

No behaviour change: every prompt fingerprint in both baseline tests stays byte-identical to
`plans/perf-3-shas-final.txt`; what any read returns, the order of writes and what every socket push carries
are unchanged. No caching across runs. Statement counts start: Story 1358 / 806, the Lair 1932 / 1928
(re-measure first).

## The cut

The run's cast memo (`sessionCastReads`, `narratorNameOf`) is cleared at the start and end of **every**
`host.call` and `host.commit` (`pipelines/runtime/host.ts` ~851–856, ~2574–2578). `perf-4` measured the
misses that follow: in the Lair `bindings.ts:786` re-reads the cast after the two embed calls
(`semantic.arm.embed`, `names.arm.embed`) and `bindings.retrieval.ts:518` after the `placeholder` commit; in
Story `:518` after `placeholder`. About 51 statements per miss: ~53 per Story reply, ~102 per Lair reply.

Narrow the clear to what can change the cast, by **what the call or commit is, never by its name**:

1. Write down, from the code, everything a `host.call` or `host.commit` can do that changes what
   `sessionCast` returns (seat writes, bench, seat names, cast members and their cards, sheets and attribute
   values the cast read includes, story time, the narrator's name, presence facts, scene state the cast read
   reads): the list is the report's first section, with file:line for each writer.
2. A **call** that only talks to a model or an embedding service and writes nothing through the host (an
   oracle call with no outlet; embed) cannot change the cast: the memo survives it **if** nothing else can
   write during it. `perf-1`'s fix added `hostInFlight` and the `castWrite` epoch precisely because other
   requests write while a call is awaited: keep that protection exactly (a cast write by anyone bumps the
   epoch and the memo is dropped). So the change is only: do not clear on entry / exit of a call whose kind
   cannot write the cast, and rely on the epoch for outside writes. State why the epoch covers every outside
   writer you listed in step 1 (if a writer does not go through `castWrite`, either route it or keep the
   clear for it: say which).
3. A **commit** clears the memo when its effects include a cast-changing write (decide from the commit's
   declared effects / the tables it writes, as the code already knows them), and not otherwise: the
   `placeholder` commit writes a message row; check whether a message row changes anything `sessionCast`
   returns (e.g. "last spoke", turn state inside the cast read). If it does, the miss after `placeholder` is
   legitimate and stays; report it and stop on that half.
4. If "what kind of call / commit is this" cannot be known at the clear site without a list of node keys or
   slugs, stop and report what would be needed.

## Tests

For each kind kept: a run where a cast write lands **during** an awaited model call (another request benches
a seat) → the next cast read in the run sees it (the `perf-1` fix's test stays green untouched; add the same
for an embed call). A commit that changes the cast → the next read sees it. A commit that does not → the
memo is reused (statement count assertion). Both baselines: fingerprints identical; counts per world before
→ after. `tsc` 0.

## Files owned

`src/lib/server/pipelines/runtime/host.ts` (the clear sites and the memo only), the cast-write registry file
(`sessions/sessionCastWrites.ts`) if a writer must be routed, their tests. Nothing else.

## Stop and ask when

CLAUDE.md §Decisions applies; a fingerprint moves; a writer of the cast cannot be made to bump the epoch; the
kind of a call or commit is not knowable structurally.

## Report

Final message = the report (lead saves `plans/REPORT-perf-5-<date>.md`), under about 450 words: the list of
cast writers and how each invalidates; the clear rule before → after; counts per world; tests; what remains;
**Noticed, not done**.

## NOT BUILT (2026-11-17, cold review) — do not launch

The premise is false. The `castWrite` epoch covers only this run's own writes outside the two wrappers (five
sites: `pipelines/runtime/bindings.state.ts` 1070, 1088, 1108, 1113; `host.call.ts:720`); writes by other
requests (bench, seats, seat names, envoys, cards, bindings, calendar, guests, other members' messages) are
seen today only because every call's exit clears the memo (`host.ts` 851–856, wrappers at 7627–7647). The
commit half fails too: a message insert can change `storyTime.sessionStart`
(`host.read.sessionCast.ts:582`; every new row is stamped, `messages/store.ts` 95–110). What is left is one
miss in the Lair after embed calls, about 51 of 1928 statements (2.6 %), 0 for Story, and it would need the
owner to accept that an outside write during an embed is seen at the next boundary. Registry path is
`pipelines/runtime/sessionCastWrites.ts`. Programme 0.5 is closed at Story 806 / the Lair 1928.
