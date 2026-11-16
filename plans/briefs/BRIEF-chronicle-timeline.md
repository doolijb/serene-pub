# BRIEF — build lane `chronicle-timeline` — the Chronicle on a lorebook with no timeline (★T-C6)

Repo `/home/jody/github/serene-pub`, SDK in `/home/jody/github/serene-pub-sdk` (edit it there; never `git
checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`../serene-pub-sdk/INTEGRATING.md` (the section on widgets and their requests only), `NOMENCLATURE.md` §1, §24
and the rows for **Timeline** and the Chronicle, `plans/REPORT-timeline-c-2026-11-14.md` (★T-C6 and what the
session side already hides), `docs/lorebook-time.md` ("A lorebook's timeline"), `docs/session-layout.md` (the
Chronicle), `STYLE-GUIDE.md` (copy).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

When the lorebook a session reads keeps no timeline, the Chronicle widget shows no time: no clock section, no
**Move the clock…**, no **Follow the line's present**, no step button, no dates, no history day. It keeps what
is not time: the open scene (without its *since ‹date›*), this session's scenes, **Close scene**, **Close and
summarize**, **Summarize**, **Open in lorebook**. One sentence says why the time is missing.

Seen in a running app on 2026-11-15 with the Timeline off: *No date yet · This session's own clock*, **Move the
clock…**, **Follow the line's present**, the open scene's *since Friday, 2 March, Year 1*, and a **Now** block
with the history day *Friday, 2 March, Year 1 · Nothing written yet · 1 scene*.

## Owner rulings (quote them in worker briefs)

- 2026-11-13: "hide all the extra time management noise in entries and the lorebook when timelines aren't
  enabled"; "No history entries for undated lorebooks, maybe scenes only."
- 2026-11-13: "Do not provide SDK api for this yet" (the Timeline switch and the timeless copy).
- 2026-11-15, shown the Chronicle with the Timeline off and the lead's recommendation — "Add the field, marked
  experimental. The Chronicle hides its clock section, dates and history day when the timeline is off, and keeps
  scenes. It is one additive, read-only name." — the owner: "Ok, as recommended". This softens the 2026-11-13
  ruling by exactly one read-only value on what `history-entries` answers; nothing else: no write, no setting,
  no outlet, no pipeline surface, no way for a plugin to change the switch.

## What exists (re-verify)

- `HistoryEntriesV1` (`../serene-pub-sdk/sdk/src/widgets.ts` ~2596, `@experimental`, with `clock: StoryClockV1`,
  `current`, `scenes`, `earlier`, `openScene?` whose `since` is "the story clock as it opened, spelled through
  the book's calendar", `unfiledDays?`).
- The Chronicle: `../serene-pub-sdk/core-catalog/src/shared/ui/chronicle/index.ts` (`chronicleView`, the
  `ChronicleView` model, `chronicleStep`) and
  `../serene-pub-sdk/core-catalog/components/shared/chronicle/ChronicleWidget.svelte`; tests
  `../serene-pub-sdk/sdk-tests/coreChronicle.test.ts`.
- The app fills the answer on the page: `src/lib/client/components/sessionPage/requests/historyEntries.ts`,
  composed from `sessions:storyClock` (whose reply already carries `timeline: boolean`, lane `timeline-c`),
  `entries:list` for history entries, `lorebooks:lines`, the page's scene list and `scenes:openScenes`. Tests
  `src/lib/client/components/sessionPage/remoteChronicle.dom.test.ts` and the request's own tests.
- The SDK is consumed from its built `dist`: after the SDK edit, `npm run sdk:build` **from the app root**, only
  with no serene-pub dev server and no vitest run up; then `npm run sdk:test` from the app root in the capped
  scope below.

## Build

1. **The one name.** `HistoryEntriesV1` gains an optional, read-only `timeline?: boolean` 🚧 `@experimental`:
   *false when the lorebook this session reads keeps no timeline; absent or true reads as a timeline (a host
   that predates it)*. Check NOMENCLATURE §24 for the word (the app's wire already says `timeline`); record it
   in §25 with the ruling quoted above. Do not add it to any other contract, outlet or settings shape. The
   surface test (`sdk-tests/surface.test.ts`) must still pass: the type is `@experimental`, so no golden moves;
   if one does, stop and report.
2. **The app's answer** (`requests/historyEntries.ts`): `timeline` from the `sessions:storyClock` reply. When it
   is false: do not ask for history entries or lines (`current: null`, `earlier: []`, `earlierTotal: 0`,
   `unfiledDays` one *Undated* group or absent, as the code does today for scenes with no clock: keep this
   session's scenes reachable), and give the open scene an empty `since`. The clock object stays well-formed
   (the contract requires it) with no present. Nothing else about the request changes.
3. **The view** (`chronicleView` and the widget): with `timeline === false` the clock section is not drawn at
   all (not *No date yet*), there is no **Now** block and no earlier history, and one sentence shows in the
   clock's place: *This lorebook keeps no timeline, so there are no dates here.* 🚧 The open scene, the scenes
   list (this session's scenes, in played order, with **Summarize** as today), **Close scene**, **Close and
   summarize** and **Open in lorebook** stay. The widget's own `clock` setting is untouched (it still hides the
   clock section on a timelined lorebook).
4. **A flip while the page is open**: the Chronicle already re-asks on `story:moved` (the page sends it on
   `state:changed`); confirm with a test that a flip redraws it, and change nothing if it does.
5. Docs: `docs/session-layout.md` (the Chronicle), `docs/lorebook-time.md` (the list under "A lorebook's
   timeline": the Chronicle shows scenes only), the SDK's widget guide if it lists what `history-entries`
   answers. `NOMENCLATURE.md` §25. No other product's name in any file.

## Files owned

- SDK: `sdk/src/widgets.ts` (the one field and its comment), `core-catalog/src/shared/ui/chronicle/index.ts`,
  `core-catalog/components/shared/chronicle/ChronicleWidget.svelte`, `sdk-tests/coreChronicle.test.ts`, the
  widget guide page if it lists the answer's fields
- App: `src/lib/client/components/sessionPage/requests/historyEntries.ts` and its tests,
  `src/lib/client/components/sessionPage/remoteChronicle.dom.test.ts`, the docs above, `NOMENCLATURE.md`

## Out of scope (write down, never build)

Any other SDK name; a way to read or set the switch from a pipeline, outlet or plugin setting; the Summarize
modal; **Time passes…** in the composer's actions; Edit Session's clock (★T-C5); the Stats or Scene widgets;
`src/lib/server/**`.

## Stop and ask when

CLAUDE.md §Decisions applies; a second SDK name seems needed; a public golden moves; the Chronicle cannot keep
this session's scenes reachable without the history entries; `sdk:build` is blocked by a dev server.

## Done means

- SDK tests: `npm run sdk:build` then `npm run sdk:test` from the app root, as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npm run sdk:test > plans/chronicle-timeline-sdk.log 2>&1"`:
  the Chronicle's tests pass, including new ones for `timeline: false` (no clock, no Now, no earlier, the
  sentence, scenes kept) and for absent / true (as today). The four failures known before this lane
  (`deriveDontSpell` ×2, `surface` untagged exports, `vocabulary` in `your-first-plugin.md`) are not this
  lane's; any other failure is.
- App tests (targeted files only, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/chronicle-timeline-<name>.log 2>&1"`,
  one at a time, checking for a running vitest first): the request with `timeline` false and true; the remote
  Chronicle DOM test; a flip redraws.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-chronicle-timeline-2026-11-15.md`):
changed files in both repos; tests with results; every name, sentence and label added; open ★; **Noticed, not
done**. Under about 700 words.

## Corrections after the cold review (2026-11-15) — these rule over the text above

Checked and fine: the field is the smallest surface (`present: null` cannot tell "no timeline" from "nothing
dated yet"); the surface test tracks `@public` names only, so no golden moves; the client's `sessions:storyClock`
reply type already carries `timeline`; a flip reaches the Chronicle (`state:changed` → `story:moved`); the remote
Chronicle is the same component; no other core widget reads `history-entries`.

1. **This session's scenes must all stay, filed or not.** Setting `current: null` empties `scenes`
   (`requests/historyEntries.ts` ~343–351), and `unfiledScenesByDay`
   (`src/lib/client/lorebooks/sections/unfiledScenes.ts` ~44–50) keeps only scenes with no history entry, sorts
   by id and groups by each scene's stored opening clock (dated labels would come back). With `timeline ===
   false` build **one list from the page's scene list**: every scene of this session on its line, filed or not,
   in played order (`order`), carried as one `unfiledDays` group with `date: null` and an empty label. Say that
   rule in the `timeline` field's comment in `sdk/src/widgets.ts` (the `unfiledDays` comment "no history entry
   holds yet" does not hold while the switch is off). Test: a filed scene stays listed.
2. **Everything inside the hidden sections is decided here** (`ChronicleWidget.svelte` ~469–573,
   `chronicle/index.ts` ~443–504):
   - hidden with the Timeline off: the clock section, **Now**, earlier history, **Compile**, the *Not yet
     compiled* heading, the *Undated* label, `nowEmpty` (*No history entries yet…*), **Start new history
     entry**, every day label and *since ‹date›*;
   - kept, drawn outside the `view.now` gate under a plain heading **Scenes** 🚧: the scene list, **Summarize
     scene**, **Summarize all (N)**, **Extend graph**, the open scene with **Close scene** and **Close and
     summarize**;
   - **Open in lorebook** is kept and opens the lorebook's **Scenes** list (`scope: "scenes"`), since the
     History lens is hidden with the Timeline off.
   Each of these is a user-visible choice by the lead: list them as ★ in the report.
3. **A guest too.** The early-return answer for a viewer who is not the owner (`historyEntries.ts` ~234–246)
   carries `timeline`; in `chronicleView` the timeline check comes before the `ownerOnly` return (`index.ts`
   ~383–391); with the Timeline off the guest's sentence does not mention history entries. Test: a guest with
   the Timeline off sees no clock.
4. **Skip the history reads only on the answer path.** `readChronicle` also backs `start-history-entry`
   (`requests/startHistoryEntry.ts` ~36–43) and `compile-history-entry` (`requests/compileHistoryEntry.ts` ~66):
   pass one argument so only `answerHistoryEntries` skips them; those two requests keep reading as today (the
   server refuses them with its own sentence when the Timeline is off, and the widget no longer offers them).
