# BRIEF — worker `tl-2e-w1` — no story date in a prompt when the session's lorebook keeps no timeline

Repo `/home/jody/github/serene-pub`. Supervisor: lane `tl-2e` (brief `plans/briefs/BRIEF-tl-2e.md`; you need not read it,
everything you need is here).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

*"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
*"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
*"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (This task needs no `sdk:build`: do not run one.)

Also: never `git checkout / restore`; never `prettier --write`; no migration, no full test run, no `npm run build`.
Always absolute paths (your cwd resets between bash calls).

## Goal (owner, standing)

"Prompts: comprehension and fidelity first": a story date the lorebook does not keep misleads the model. P1: same
inputs, same result. When the lorebook the session reads keeps **no timeline**, every story-time part of the prompt is
**absent** (no block, no heading, no empty line), whatever the clock columns or stale dated history entries still hold
from before the timeline was switched off. On a lorebook **with** a timeline nothing changes, byte for byte.

## What is already true (verified by the supervisor; do not re-derive)

- `src/lib/server/pipelines/runtime/host.read.sessionCast.ts` ~550–575 builds the cast's `storyTime = { now, calendar }`.
  With the timeline off `now` is already null (`storyNowOf` / `sessionStoryNowOf` return null; `ownBookDaysCounted`
  returns `{ now: null }` when `reading.timelineOff`). It passes through `bindings.prompt.ts` ~532 as
  `templateContext.storyTime` into `assemble`.
- `src/lib/server/pipelines/prompt/assemble.ts` reads that one `storyTime` in four places, and these are the leaks:
  1. `currentDateOf` (~343): with `now` null it **falls back to the newest allocated history entry** — so a stale dated
     history entry prints *The current date in the story is …* on a timeless session.
  2. `datedOf` (~277), used by `historyRowsOf` (history band rows) and `earlierScenes` (~810): prints a row's `date`
     from its own stored year/month/day (history meta, a scene's `openedStoryClock`) whatever the timeline.
     (`dateDelta` is already null because `now` is null.)
  3. `calendarOf` (~273) → `storyCalendar` (~816): the book's calendar is printed whatever the timeline. Per
     `docs/lorebook-time.md` §A lorebook's timeline the calendar is part of the timeline, so it is a story-time part.
- The typed answer exists: `loreWriteDateOf(db, sessionId)` → `LoreWriteDate` (`{kind:'dated', …}` / `{kind:'timeless'}` /
  `{kind:'undatable'}`) in `src/lib/server/state/storyTime.ts`. **Use it; do not add a second derivation.**

## Build (the design is fixed; deviations are a stop)

1. **Cast read** (`host.read.sessionCast.ts`, the `storyTime` block only): when the computed `now` is null (and only
   then, so a dated session costs no extra statement), call `loreWriteDateOf(db, sessionId)`; when it answers
   `timeless`, add `timeline: false` to the `storyTime` object (`{ now: null, calendar, timeline: false }`). Otherwise the
   object is exactly as today (no key). `timeline` reuses the established word with its established meaning
   (`SessionSettingsV1.timeline`, `StoryClock.Reading.timeline`); do not invent another name. Update the block's comment.
2. **Assemble** (`assemble.ts`): add `timeline?: boolean` to `StoryTimeReading` and **one** predicate (e.g.
   `keepsNoTimeline(storyTime)` → `storyTime?.timeline === false`). Apply it in exactly these three shared helpers:
   `currentDateOf` → `undefined` (before the clock and before the allocations fallback); `datedOf` →
   `{ date: null, dateDelta: null }`; `calendarOf` → `null`. Nothing per genre, nothing in a layout, no new prompt text.
   Update the doc comments (`currentDateOf`'s "else the most recent allocated history entry" must say: not when the
   lorebook keeps no timeline). `undatable` (timeline on, no date anywhere) gets no key and is unchanged.
3. Do **not** edit `src/lib/server/state/storyTime.ts` (another worker is editing its clock-move functions now),
   `sockets/sessions.*` handlers, `lorebooks/timeline.ts`, the start form, `runtime/host.ts`, or any layout in
   `variableLayouts.ts` / `contextTemplateDefaults.ts`.

## Find and list (report table, no code change outside the above)

Every prompt part that prints story time (story date, clock, weekday, "days since", a scene's story stamp, a history
day's date; variables, layouts, tool results, summarize/routine prompts — e.g. `host.read.summarize.ts` ~351 message
`storyClock*`, `routines/evaluate.ts` `storyTimeText`, `state/resolve.ts` `storyDateOf`, SDK `core:var/*` variables),
and per part: what it does today on a timeless session with stale clock columns → after. A part that prints a stale
story date on a timeless session and does **not** go through the cast's `storyTime` is a **stop**: report it, do not fix
it per part. Also confirm by grep whether any prompt part prints the **real** date/time (Chat / Guide,
`keepsTime: 'real'`); name them or say "none" with the grep you ran. Verify how each part renders when absent: the
shipped `currentDate` layout wraps *The current date in the story is …* — prove it never prints that sentence (or an
empty one) when the value is `undefined`; the History JSON layout prints a row with no date as `"date":""` (the form
an undated history entry already has) — say whether that is what a timeless session now gets for stale history rows.

## Tests

- **Unit** — extend `src/lib/server/pipelines/prompt/currentDate.storyTime.test.ts`: with
  `storyTime: { now: null, calendar: THAW, timeline: false }` and a dated history allocation → no current-date sentence
  (`render` output has no "current date"); history rows carry `date: null`; an earlier scene with an
  `openedStoryClock` carries `date: null`; `storyCalendar` absent. The existing dated cases stay green unchanged
  (byte-identical). An `undatable`-shaped `storyTime` (`now: null`, no `timeline` key) behaves as today.
- **Int** — extend `src/lib/server/sockets/sessions.storyUndated.int.test.ts` (it covers only own notes, no attached
  lorebook, no stale clock): an **attached** lorebook that had a timeline, a dated history entry and a set session clock
  (stale `story_clock_*` columns on `sessions`), then its timeline switched off (`timeline_enabled = false`; the notes
  copy it — set both if the test DB needs it) → a first turn's compiled prompt has no "current date in the story", no
  stale year in the history block; the same world with the timeline on → the date is printed (control).
- **Baselines** — run `src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts` and
  `src/lib/server/sockets/sessions.lairUnknownEntries.int.test.ts` with `KN2_SHA_LOG=/home/jody/github/serene-pub/plans/tl-2e-shas.txt`
  and compare each sha with `plans/tl-2c-shas.txt` (identical to `tl-3a-shas.txt`). Report each sha that changed; if any
  changed, show the first difference and prove the only difference is a story date now absent on a timeless session. A
  sha changing for any other reason is a **stop**. Note statement-count changes.

Test command — only this form, one run at a time, wait first:
```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-2e-<n>.log 2>&1"
```
(for the baselines put `KN2_SHA_LOG=… ` before `npx` inside the quotes). Never pipe vitest into `head`. An int test that
opens a DB inside an `it` needs a 60 s timeout. Also run, also wait first:
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p /home/jody/github/serene-pub` and report the count of errors in
your files. `npx prettier --check` your changed files (report; drift that predates you is fine).

Known failing tests that are not yours (leave alone): `sockets/sessions.creationModes.int.test.ts` (one),
`sockets/sessions.timePasses.int.test.ts` (one), `pipelines/runtime/host.historyWrites.int.test.ts` "a month or a day
without a year is refused…", nine `pipelines/boot` tests.

## Docs (one sentence each, exactly; adjust only if a link anchor is wrong)

- `docs/context-templates.md`, the **`currentDate`** bullet (~183), after "Empty when the session reads no dated
  lorebook.": *With the lorebook's [timeline](./lorebook-time.md#a-lorebooks-timeline) off it is empty, and so are
  `storyCalendar` and every row's `date` and `dateDelta`, whatever clock or dated history the lorebook still stores.*
- `docs/lorebook-time.md`, the **has no story date.** bullet (~14), appended: *A clock or dated history entries kept
  from before the timeline was switched off aren't shown to the model either: the prompt carries no date, no dates on
  history rows or scenes, and no calendar.*

## Files owned

`src/lib/server/pipelines/runtime/host.read.sessionCast.ts` (the `storyTime` block only),
`src/lib/server/pipelines/prompt/assemble.ts` (the predicate and the three helpers only),
`src/lib/server/pipelines/prompt/currentDate.storyTime.test.ts`, `src/lib/server/sockets/sessions.storyUndated.int.test.ts`,
`docs/context-templates.md`, `docs/lorebook-time.md`, your logs `plans/tl-2e-*.log`, `plans/tl-2e-shas.txt`.

## Files readable

Anything. Start with the line ranges above.

## Stop and ask (write it in your report and stop that item) when

A new name beyond `timeline` on `storyTime`; a shipped layout would print a dangling heading or sentence; a part is
ambiguous between story time and real time; a part leaks outside `storyTime`; a baseline changes for another reason; any
change outside Files owned would be needed.

## Report

Final message, under ~400 words: changed files; the parts table (part → today → after), real-time parts; baseline shas
(changed or identical) and statement counts; tests run with pass/fail and log paths; tsc / prettier; open questions;
**Noticed, not done**.
