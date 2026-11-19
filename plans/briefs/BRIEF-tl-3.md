# BRIEF — build lane `tl-3` — a new session's own lorebook starts without a timeline unless its genre requires one or its preset says so (programme 1.7)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, the programme's
"Latest rulings" (`plans/PLAN-programme-2026-11-15.md`: "A story's first date" and "Undated by default includes
Story"), `plans/INVENTORY-timeline-stance-2026-11-16.md` §1 and §6, `plans/REPORT-tl-2b-*.md` if it exists (how
a new dated session gets its first date), `docs/lorebook-time.md`, `docs/sessions.md`, `docs/genre-story.md`,
`NOMENCLATURE.md` rows **timeline**, **timeline mandate**, **keepsTime**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write` (nor a scratch-copy equivalent). Never commit.
Never `npm test` / `npm run build` at the SDK root. `sdk:build` only from the app root after checking no dev /
preview server (`pgrep -af "vite"`) and no vitest is up
(`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`). Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-3-<n>.log 2>&1"`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No migration. No full run, no build.

## Owner (2026-11-16)

"If the genre/preset supports undated, use undated by default." Asked whether that includes Story: "Yes, story
as well". Earlier (2026-11-14): "preset may override the genres default, but not it's mandate".

## Build

1. **The rule.** `timelineDefaultFor` (`src/lib/server/lorebooks/timeline.ts` 50–69): a genre that declares
   `timeline: 'required'` → on; else the preset's `defaults.timeline` when it is a boolean; **else off** (today:
   on when `keepsTime: 'story'`). The unresolved-genre case (`!genre` → on today): report what reaches it and
   propose; change it only if nothing shipped depends on it. Every other reader of the same derivation follows
   the one function (the timeline pass, `timelinePass.ts:69`: read what it uses the genre for and say whether
   it is the same question).
2. **Shipped presets.** `story-minimal`'s `defaults: { timeline: false }` (`core-catalog/src/seed/presets.ts`
   51, 64) is now the default: leave it (harmless, explicit) and correct its description if it says otherwise.
   **No shipped preset is given `timeline: true`** unless its own description already promises story time in a
   way that would now be false: list any such preset as a ★ with its sentence; change none.
3. **What a Story session without a timeline does** must be said in words, never broken silently (genres
   expect, never lock): walk a first Story turn on a fresh install's default preset and each shipped Story
   preset with the timeline off: every step that needs a clock (the round tick, scene stamps, "time passes",
   dated history, the story clock control, the Chronicle / Timeline views) must degrade with its existing
   sentence or be absent, and no write may be refused in ordinary play. List what a player loses compared with
   today, each with the sentence shown and where "Switch the timeline on" is offered. A step that throws or
   toasts on every turn is a defect to fix here.
4. **The start form** (`StartSessionForm.svelte` `timelineOfferFor` ~947, copy ~2418–2433): its advisory copy
   and the preset list's `timelineDefault` (`sockets/sessionAdmin.ts:753`) follow the new default; a Story
   session's start form offers story time on in one control if it does not already (find what exists; new copy
   is ★).
5. **Existing data is untouched:** no boot pass; a lorebook's own switch decides afterwards, as today. Test
   that an existing Story session's own lorebook keeps its timeline across a boot.
6. **SDK and docs:** the doc comment on `GenreDecl.timeline` / `keepsTime` (`sdk/src/genres.ts` ~236–241),
   `INTEGRATING.md` where the default is described, `docs/lorebook-time.md`, `docs/sessions.md`,
   `docs/genre-story.md`, `docs/genres.md`; `NOMENCLATURE.md` (the default's rule; §25). If only comments change
   in the SDK, do not build it.

## Tests

`lorebooks/timelineDefault.test.ts`, `sockets/sessions.timelineDefault.int.test.ts` (changed on purpose: list
old → new); every test that creates a Story session through the real create path and then expects a clock, a
dated write or a scene stamp: find them (grep the create helper's users), and for each decide: the test meant
"a session with a timeline" → make it say so explicitly (a preset with `timeline: true`, or switching it on),
never weaken an assertion; a first turn of each shipped Story preset with the timeline off; both prompt
baselines (they may change because `current-date` is absent: report the diff and that this is the cause).

## Files owned

`src/lib/server/lorebooks/timeline.ts`, the tests above and the tests that must state their timeline, the start
form's copy, any step fixed under item 3 (report each before a large change), the SDK doc comments and docs,
`NOMENCLATURE.md`. Lane `tl-2c` (not started) will own how play's writes are dated: do not touch dating.

## Stop and ask when

CLAUDE.md §Decisions applies; a shipped Story preset cannot play a first turn without a timeline; more than
about 25 tests need their timeline stated (report the count and the pattern first); a prompt baseline changes
for a reason other than the missing date.

## Report

Final message = the report (lead saves `plans/REPORT-tl-3-<date>.md`): the rule as built; what a Story player
loses without a timeline and what is shown instead; presets flagged; tests changed (old → new, counts); every
sentence (★); **Noticed, not done**. Under about 600 words.

## Added 2026-11-16 (owner, same day): "User gets a choice, undated by default without an existing lorebook."

Item 4 is now required, not optional: when a session is started **with no existing lorebook**, the start form
offers one control for story time, **off by default**, whatever the genre (hidden only where the genre requires
a timeline: the Lair, Dungeon Crawler; there the form says story time is kept). Switching it on makes the new
lorebook keep a timeline and start as lane `tl-2b` built (the real calendar, today's date, shown and editable).
With an **existing** lorebook the control is absent: that lorebook's own switch stands and the form says which
it is. A preset's `defaults.timeline` sets the control's initial value (Story: Minimal's `false` and the new
default agree). The control's label and help are ★ (one sentence of purpose, STYLE-GUIDE copy rules).

## Added after lane `tl-2d` landed (2026-11-16)

Read `plans/REPORT-tl-2d-2026-11-16.md` too: the first date of a new dated session is built there, not in
`tl-2b` (the real calendar preset `real-calendar`; create's `today` branch sets the session's clock to today's
date with no time of day; `lorebooks:storyTime` replies `start: {branchId, date, cause}`; the start form shows
the date line and a **Change** button for a chosen existing lorebook). The story-time control for a session with
**no existing lorebook** reuses that line and control once switched on; do not build a second date picker.
`StartSessionForm.svelte` was edited by `tl-2d`: re-read before editing. A new own-notes lorebook gets the real
calendar whether its timeline is on or off (so switching the timeline on later needs no calendar step).

## Cold review corrections (2026-11-16) — these rule over the text above

**The lane is split. This brief builds `tl-3a` only: items 1, 2, 3, 5, 6 and the tests. Item 4 and the
"Added 2026-11-16" start-form control are lane `tl-3b`, briefed separately after `tl-3a` reports: do not build
them, do not edit `StartSessionForm.svelte` or `sockets/sessions.create.ts` except a copy sentence that the new
default makes false (list each).** Save logs as `plans/tl-3a-<n>.log`; the report is `REPORT-tl-3a-<date>.md`.

1. **The boot pass is a different question and stays unchanged.** `lorebooks/timelinePass.ts` 66–70 is a
   once-per-install pass over **existing** data; moving it to the new rule would switch off existing Story
   lorebooks (owner 2026-11-16: "Go with the safest option for existing lorebooks"). Do not touch it; the
   item 5 boot test also proves that an install which has **not** yet run the pass keeps its existing Story
   lorebooks' timelines.
2. **The ruling this reverses (quote both in NOMENCLATURE §25 and the report).** Owner 2026-11-14
   (`plans/PLAN-entry-time-and-lines-2026-11-14.md` 37–38): "By default, Story Minimal will use an undated
   book. Messages will just display real time. All other Story presets will continue defaulting to timelined
   storybooks." Superseded by the owner 2026-11-16: "If the genre/preset supports undated, use undated by
   default." / "Yes, story as well". The old rule is still written in `docs/sessions.md` 48–56 (including "An
   administrator's copy of Story Minimal…") and `sdk/src/genres.ts:238` ("'story' starts a new lorebook with a
   timeline"): correct those. "Messages will just display real time" still stands and tells item 3 what an
   undated Story session shows.
3. **Item 3 reports dating defects, it does not fix them.** A defect in how a write is dated, or `current-date`
   appearing with the timeline off (found by `tl-2a`, owned by `tl-2c`), is listed under **Noticed, not done**
   for `tl-2c`. Fix here only a step that throws or toasts on an ordinary turn for a reason other than dating.
   Report the prompt-baseline diff whichever way it goes (it may be unchanged because `current-date` still
   prints).
4. What the default Story preset needs a clock for (verify): the round tick moves only a set clock
   (`docs/genre-story.md:64`); the reckoning's **Move the clock** ships off; Rest and Time passes return a
   receipt with the clock sentence (`host.ts` ~5223–5230); a scene with no day still saves (`scenes.ts`
   ~339–341), compile and history refuse with a sentence (~1407, ~1534).
5. `timelineOfferFor` is now at `StartSessionForm.svelte:1014`, its copy at 2494–2525 (read-only for this lane
   apart from a false sentence). The existing **Create a lorebook** › **Keep a timeline** switch
   (`docs/sessions.md:56`) is `tl-3b`'s to reuse: report how it behaves under the new default.
