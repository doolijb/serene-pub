# REPORT playtest3-S6 — the Chronicle lists the Not yet compiled scenes (★S2-1b)

Relayed status question: none was relayed. The lane is built except the per-day **Compile**, which needs a new name (★S6-1).

S5's report did not exist when this lane started. I built against what has landed: `Sockets.Scenes.Compile.Params = ByEntry | ByDate` (`shared/sockets/types.ts` ~:14148), the server's by-date path in `sockets/scenes.ts` ~:1140, and S5's client grouping `unfiledScenesByDay` (`lorebooks/sections/unfiledScenes.ts`). None of S5's files were edited.

## What I found first
The brief names a "server projection". There isn't one: `history-entries` is answered on the **client**, by `readChronicle` in `src/lib/client/components/sessionPage/requests/historyEntries.ts`. It works from the page's own `scenes:list` rows, which already carry `openedStoryClock*`, and it already knows the session's line (`branchId`). The field is filled there.

A widget can only press a host **request kind**. No request kind exists for compiling, so the Chronicle's Compile cannot "send S5's by-date ask" without a new published SDK name. That falls under the brief's stop rule, so the Compile is not built (★S6-1).

## Changed files
**App (`/home/jody/github/serene-pub`)**
- `src/lib/client/components/sessionPage/requests/historyEntries.ts`
  - The answer gains `unfiledDays`, built with S5's `unfiledScenesByDay(scenes, branchId)`. That is the one client rule, mirroring the server's `dayOnly`, so there is no second grouping.
  - Only this session's unfiled scenes on its own line are listed, by day, *Undated* last. Each day is spelled through the book's calendar.
  - The ownerOnly and no-book answers carry no `unfiledDays` field.
  - `SceneRow` gains the three `openedStoryClock*` columns, which come from the schema.
  - The scene mapping was pulled into a local `sceneOf`, so a row reads the same under Now and under Not yet compiled.
  - Decision: `sceneOf(x as SceneRow)`. S5's helper returns `PoolSource` (`Record<string, any>`), and the input is `SceneRow[]`, so the cast hides nothing.
- `src/lib/client/components/sessionPage/requests/historyEntries.test.ts`: new describe "🚧 ★S2-1b: Not yet compiled", 5 tests:
  - scenes listed by day, Undated last;
  - filed scenes, scenes on another line and another session's scenes are not listed;
  - the days are listed when `current` is null;
  - a guest and a no-book answer get no field;
  - a row reads the same as it does in `scenes`.
- `src/lib/client/components/sessionPage/remoteChronicle.dom.test.ts`: one new test. The built widget draws `chronicle.unfiled` after Scenes, with the heading *Not yet compiled*, two day groups (one dated, one *Undated*) and the scene names.
- `docs/sessions.md` § The composer's panels › Lore, the Chronicle paragraph (~:573), one sentence added. It says the Chronicle lists the session's scenes not yet compiled, by day (*Undated* for scenes with no story date), and that you compile them from the lorebook History lens's *Not yet compiled* group. It does not mention a Compile in the Chronicle.
- ⚠ Formatting only: worker 1 ran `prettier --write` on `historyEntries.ts` and `historyEntries.test.ts`. Neither file was prettier-clean before. Lines it did not otherwise touch were rewrapped (`summaryStatusOf`, `throughLabelOf`, `open`/`cast` in the .ts; about 40 lines of older fixtures and asserts in the test). The logic is unchanged and all tests pass. I kept the rewraps rather than hand-reverting them; the scope reviewer flagged this as low severity.

**SDK (`/home/jody/github/serene-pub-sdk`)**
- `sdk/src/widgets.ts`: `HistoryEntriesV1` gains 🚧 `unfiledDays?: Array<{ date: StoryTime | null; label: string; scenes: HistorySceneV1[] }>`. It is optional and additive, with a ⚠ saying it is not `ungraphedScenes` and not `scenes`. Nothing else in the file was touched (T2's `turnCause` is intact).
- `core-catalog/src/shared/ui/chronicle/index.ts`:
  - `ChronicleView.unfiled` is an inline type `{ key, date, count, scenes: ChronicleSceneView[] }[]`, defaulting to `[]`.
  - The scene mapping was pulled into a local `sceneView`, so unfiled rows keep their summary dot, *Summarize* and *Ready to review*.
  - Days with no scenes are dropped. An absent field (an older host) gives `[]`.
  - The module note has one new paragraph.
- `core-catalog/components/shared/chronicle/ChronicleWidget.svelte`:
  - The scene row is now a `{#snippet sceneRow}` shared by both lists, with its markup unchanged.
  - The new section sits after Now's Scenes and before Earlier: `chronicle.unfiled` › `chronicle.heading label` *Not yet compiled* › per day `chronicle.unfiled-day` (`role="group"`) › `chronicle.unfiled-day-head` (`chronicle.unfiled-date`, `chronicle.unfiled-count`) › `chronicle.scene-list list` of the shared rows.
  - There is no Compile button.
- `sdk-tests/coreChronicle.test.ts`: new describe "🚧 ★S2-1b: Not yet compiled", 5 tests:
  - day order, label, *Undated* and the count words;
  - a row matches the same scene under Scenes;
  - an empty day is dropped, and an absent field gives `[]`;
  - loading, no-book and ownerOnly give `[]`;
  - the section is filled when `current` is null.

## Tests run
- `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/components/sessionPage/requests/historyEntries.test.ts src/lib/client/components/sessionPage/remoteChronicle.dom.test.ts > …/scratchpad/playtest3-S6-1.log 2>&1'`: **2 files, 31/31 passed**, exit 0. That is historyEntries 21 (5 new) and remoteChronicle 10 (1 new).
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test coreChronicle.test.ts` (capped scope): **27/27 passed**, 0 failed.
- `npm run sdk:build` (worker 2, under the flock, after `pgrep -af "[v]ite dev"` showed no server): exit 0.
- `sdk-tests` `tsc --noEmit`: no errors in the chronicle files.
- Before the build, the app's `tsc` reported `unfiledDays` unknown in `historyEntries.ts` and its test. The dist now carries the field; the lead's grouped `tsc` and `check` will confirm.
- Prettier:
  - `widgets.ts`, `chronicle/index.ts` and `coreChronicle.test.ts` already failed prettier at HEAD, so they were left unformatted.
  - The SDK's prettier has no Svelte parser, so `ChronicleWidget.svelte` was not checked.
  - `remoteChronicle.dom.test.ts` is clean.
- Scope review (`scope-reviewer`): no objection on scope; one low finding (the prettier churn above) and one note (the cast, kept).

## Stopped, needs owner
- **★S6-1 — the Chronicle's per-day Compile needs a new widget request kind.**
  - Recommendation: 🚧 `'compile-history-entry'` with params `{ date: StoryTime | null }`, result `void`, askers `'core'`, in `WIDGET_REQUEST_APIS` as `'session'`.
  - The host answers by opening its Compile window, `CompileHistoryEntryModal`, with `byDate={{ lorebookId, date }}` on the session's line and moment. That sends S5's `ByDate` ask, which makes the dated entry when there is none.
  - The host refuses in words when the viewer is not the owner, or when no unfiled scenes of this session wait on that day.
  - The Chronicle draws **Compile** in each `chronicle.unfiled-day-head` when `canWrite`, as a new part `chronicle.unfiled-compile`, with S5's titles.
  - Trade-off: the by-date ask compiles **every** unfiled scene of that day on the line, other sessions' included, while the Chronicle lists only this session's. The button's title should say "this day's scenes", as S5's does.
  - Alternative: no new kind; the button opens the History lens group (`open-lore`). That needs no name, but it is a "Compile" that only navigates.
  - Files it touches beyond this lane: SDK `widgets.ts` (the kind, its API entry and askers), `requests/index.ts` and `askers.ts`, a new `requests/compileHistoryEntry.ts`, and the session page that mounts the modal.
- **★S6-2 — the open scene appears twice.**
  - Under S2/S5 a live scene is unfiled while it is open, so the Chronicle shows it in the **Open scene** card and again as a row under *Not yet compiled*.
  - The row is marked `data-open` and offers no Summarize; the History lens group lists it too, by the same one rule.
  - Recommendation: leave it as built (one rule; the day's Compile takes it too).
  - Alternative: hide the open scene from the Chronicle's list only. That is one filter in `readChronicle`, and it diverges from the lens.

## Canon rows needed (NOMENCLATURE §9 Chronicle row + §25; STYLE-GUIDE §6.16)
- §9 **Chronicle** row, append: 🚧 ★S2-1b (2026-11-04, lane S6): under Now, **Not yet compiled**: the session's scenes on its line that no history entry holds yet, by day (*Undated* last), each row the same as a Scenes row. The page fills it with S5's `unfiledScenesByDay` (the History lens's own grouping, mirroring `dayOnly`). SDK 🚧 **`HistoryEntriesV1.unfiledDays`** (`{ date: StoryTime | null, label, scenes: HistorySceneV1[] }[]`, absent on an older host). Plain half 🚧 **`ChronicleView.unfiled`**. Parts 🚧 `chronicle.unfiled` · `chronicle.unfiled-day` · `chronicle.unfiled-day-head` · `chronicle.unfiled-date` · `chronicle.unfiled-count`. UI *Not yet compiled* · *Undated* · *1 scene* / *{n} scenes*. The per-day Compile waits on ★S6-1. ⚠ `unfiledDays` is not `ungraphedScenes` (the W3 plan's old `unfiledScenes`, a count of scenes not graphed).
- §25 ledger: one row for the same. Amend the round-2b line "with S5's Compile per date" to note the Compile waits on ★S6-1.
- Name choice: **`unfiledDays`**, not the brief's suggested `unfiledScenes`.
  - Its siblings `ungraphedScenes: number` and `unsummarizedScenes?: number` are counts, so `unfiledScenes` would read as a third count (R1).
  - The W3 ledger row (NOMENCLATURE ~:2671) records `unfiledScenes` as the plan's old word for what became `ungraphedScenes`.
  - S5's client grouping is `UnfiledDay` / `unfiledScenesByDay`.
- STYLE-GUIDE §6.16 Chronicle row (~:1797), append after `chronicle.summarize-all in the scene actions`: 🚧 ★S2-1b: `chronicle.unfiled` (*Not yet compiled*, after the Scenes, before Earlier; its heading `chronicle.heading label`) · `chronicle.unfiled-day` (one day, `role="group"`) · `chronicle.unfiled-day-head` (the day and its count on one line) · `chronicle.unfiled-date` (as `chronicle.entry-date`) · `chronicle.unfiled-count` (muted, as `chronicle.entry-scenes`); its rows are `chronicle.scene-list list` / `chronicle.scene row`, the Scenes rows.

## Queued for other lanes
- **`src/lib/client/styles/widgets.css` §chronicle** (owner of widgets.css). The new parts draw unstyled until this lands.
  - ~:7595: add `[data-widget-part~="chronicle.unfiled"], [data-widget-part~="chronicle.unfiled-day"]` to the `chronicle.now, chronicle.scenes` flex-column rule.
  - Add `[data-widget-part~="chronicle.unfiled-day-head"] { display: flex; align-items: baseline; gap: calc(var(--spacing) * 2); min-width: 0; font-size: var(--sp-w-font-row); }`.
  - Add `chronicle.unfiled-date` to the `chronicle.entry-date` rule (~:7621).
  - Add `chronicle.unfiled-count` to the `chronicle.entry-scenes` rule (~:7633).
  - Add the five parts to the parts list in the §chronicle header comment (~:7343).
- **`docs/session-layout.md:55`** (the Chronicle row; the doc's owner): after "…when some scenes aren't in the lorebook's relationship graph yet." insert: "Below them, **Not yet compiled** lists the session's scenes that no history entry holds yet, by day (scenes with no story date under *Undated*); compile them from the lorebook's History lens."
- **S5, optional:** make `unfiledScenesByDay` generic (`<T extends PoolSource>(scenes: readonly T[], …) => { …; scenes: T[] }[]`) so `historyEntries.ts:363` needs no cast.

## Noticed, not done
- `widgets.ts`, `chronicle/index.ts` and `coreChronicle.test.ts` fail `prettier --check` at HEAD. That predates this lane, and they were left as they were.
- The SDK repo's prettier cannot parse `.svelte` (no plugin), so SDK Svelte files are never prettier-checked.
- `archex impact` crashed in its git subprocess (as reported by the scope reviewer). The blast radius was checked by grep instead: `chronicleView(` and `unfiledDays` appear only in the lane's files.

**Scope review (lead, 2026-11-04): no objection; one low finding, done** — the regenerated `../serene-pub-sdk/guides/widgets.md` (the `chronicle` parts line gains the five `unfiled*` parts; `gen:widget-parts`, run by the lead after T2 and S5) belongs in the SDK changed-files list. Formatting churn verified logic-neutral against a prettier pass over HEAD.
