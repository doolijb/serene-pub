# BRIEF — build lane `tl-2e` — no story date in a prompt when the lorebook keeps no timeline (programme 1.7; small)

Repo `/home/jody/github/serene-pub` (app); SDK `/home/jody/github/serene-pub-sdk` not expected to change (a doc
comment at most; no build). Supervisor: read `.claude/guides/multi-agent.md`, then `plans/REPORT-tl-2a-2026-11-16.md`
(its finding: `current-date` can appear with the timeline off), `plans/REPORT-tl-2c-*.md` (the typed dating
result `dated` / `timeless` / `undatable`: use it, do not add a second answer), `plans/REPORT-tl-3a-2026-11-16.md`
(a first Story turn without a timeline; its test `sockets/sessions.storyUndated.int.test.ts`),
`docs/lorebook-time.md`, `docs/context-templates.md`, `NOMENCLATURE.md` rows **timeline**, **current-date**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash / checkout / restore`; `npx prettier --check` only; never commit. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-2e-<n>.log 2>&1"`,
one run at a time (`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done` first).
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No migration, no full run, no build.
One worker is enough.

## Owner

2026-11-16: "This is what we are enforcing type safety on timelines lorebooks". 2026-11-14: "By default, Story
Minimal will use an undated book. Messages will just display real time." Standing: prompts: comprehension and
fidelity first (a date the story does not keep misleads the model); P1 (same inputs, same result).

## Build

1. **Find every prompt part that prints story time** (`currentDateOf` in `pipelines/…/assemble.ts` ~343 / ~801;
   any variable, layout or tool result that prints the story date, clock, weekday, "days since", a scene's
   story stamp, a history day's date) and, for each, what it does today when the session's lorebook keeps **no**
   timeline: list them in the report (part → today → after).
2. **The rule, at the one read:** when the lorebook the session reads keeps no timeline (`timeless`), story-time
   parts are **absent** (no block, no heading, no empty line), whatever clock columns happen to hold (a clock
   left from before the timeline was switched off must not print). Fix at the function the parts share, not
   per genre and not in a layout. A layout that names the variable renders nothing for it (verify how an empty
   variable is laid out; no new sentence in the prompt).
3. **Real time is not story time:** a part that prints the real date / time for Chat or Guide
   (`keepsTime: 'real'`) is untouched; say which parts those are.
4. **`undatable`** (a timeline, no date anywhere): unchanged; report what prints.
5. Docs: `docs/context-templates.md` and `docs/lorebook-time.md` (one sentence each: the date is left out when
   the lorebook keeps no timeline); `NOMENCLATURE.md` only if a row states otherwise.

## Tests

Per part: timeline on with a date → printed as before (byte-identical); timeline off with stale clock columns →
absent; Chat / Guide real time unchanged. Both prompt baselines: report each sha that changes and show that the
only difference is a story date now absent on a `timeless` session; a baseline changing for another reason is a
stop. Extend `sessions.storyUndated.int.test.ts` only if it does not already cover an attached lorebook with the
timeline off and a stale clock.

## Files owned

The shared read in `assemble.ts` (and the sibling that owns `currentDateOf`'s inputs), the tests, the two docs.
Do not edit dating of writes (`tl-2c`), the start form, or `lorebooks/timeline.ts`.

## Stop and ask when

CLAUDE.md §Decisions applies; a shipped layout would print a dangling heading; a part is ambiguous between
story time and real time.

## Report

Final message = the report (lead saves `plans/REPORT-tl-2e-<date>.md`): the table of parts; the rule and where;
baseline shas changed and why; tests; **Noticed, not done**. Under about 400 words.
