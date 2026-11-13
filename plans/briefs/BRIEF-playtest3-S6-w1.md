# BRIEF playtest3-S6-w1 — the Chronicle's projection lists this session's scenes not yet compiled, by day

Lane `playtest3-S6` · worker 1 · the supervisor reads your final hand-back (put the full report there; do not write a report file).

## Goal
Owner ruling (2026-11-04, ★S2-1b): *"the Chronicle lists the Not yet compiled scenes under Now, by date, with S5's Compile per date (one optional field on `HistoryEntriesV1`)."* You build the page's half: the answer to `history-entries` gains that field, filled from the page's own scene list.

The projection is **client-side**: `src/lib/client/components/sessionPage/requests/historyEntries.ts`, `readChronicle(deps, earlierLimit)`. It already has the session's line (`branchId`), the calendar (`calendar = readStoryCalendar(...)`), the session's scenes (`scenes` = `deps.sceneList()` filtered to this session), the `order` map and `liveLines`.

### The field (the SDK side is worker 2's; its exact shape — type against it, do not edit the SDK)
```ts
// on HistoryEntriesV1 (../serene-pub-sdk/sdk/src/widgets.ts), optional:
unfiledDays?: Array<{
	/** The day; null = the scenes with no story clock (*Undated*). */
	date: StoryTime | null          // { year, month?, day? } — the same shape HistoryEntryV1.date uses
	/** The day as the page spells it through the book's calendar; "" when undated. */
	label: string
	/** This session's scenes of that day that no history entry holds yet, in id order. */
	scenes: HistorySceneV1[]
}>
```
Until worker 2's field lands in the SDK dist, TypeScript may not know `unfiledDays`; vitest does not typecheck, so build against the shape above. Do NOT add a cast that hides a real type error; a plain property on the object literal is fine.

### What to change in `historyEntries.ts`
1. **One rule, reused — never a second one.** Import S5's client grouping `unfiledScenesByDay(scenes, branchId)` from `$lib/client/lorebooks/sections/unfiledScenes` (read it first; it is lane S5's file — **never edit it**). It takes the scenes with `historyEntryId == null` on the line's OWN `branchId`, groups by day (`sceneDayOf`: the opened story clock, hour/minute dropped, a day with no month dropped), story order, *Undated* (`date: null`) last, scenes in id order. Pass it this session's `scenes` and `branchId`.
2. `SceneRow` (the local interface) gains the three optional columns the page's `scenes:list` rows already carry: `openedStoryClockYear?: number | null`, `openedStoryClockMonth?: number | null`, `openedStoryClockDay?: number | null` (one 🚧 doc line: the story clock the scene opened at, its day for *Not yet compiled*).
3. Extract the existing inline `HistorySceneV1` mapping (the `.map((s): HistorySceneV1 => ({ ... }))` under `scenes:`) into one local function inside `readChronicle` (e.g. `const sceneOf = (s: SceneRow): HistorySceneV1 => …`) and use it for both `scenes` and the new field, so a row reads the same in both places. Behaviour of `scenes` must not change.
4. In the `answer` (NOT in `empty` — ownerOnly / no-book answers carry no field): `unfiledDays: unfiledScenesByDay(scenes, branchId).map((d) => ({ date: d.date ? { year, ...(month != null ? { month } : {}), ...(day != null ? { day } : {}) } : null, label: d.date ? formatDate(d.date, calendar) : "", scenes: d.scenes.map(sceneOf) }))` — the same date spread `entryOf` uses. Present even when `currentRow` is null (no history entry yet is exactly when it matters). Empty array when none wait.
5. Update the module note at the top: one bullet that **Not yet compiled** (`unfiledDays`, ★S2-1b) is this session's unfiled scenes on its line by day, by S5's `unfiledScenesByDay` — the History lens's own grouping.

### Tests — `src/lib/client/components/sessionPage/requests/historyEntries.test.ts`
Read its existing fixtures first and reuse them. Add a `describe("🚧 ★S2-1b: Not yet compiled", …)` with:
- a session's unfiled scenes are listed by day, story order, Undated last, each day spelled (label non-empty for a dated day, "" for undated), scenes in id order; **filed scenes are not listed** (a scene with `historyEntryId` set never appears in `unfiledDays`);
- a scene on another line (`branchId` ≠ the session's line) is not listed; another session's scene is not listed;
- listed even when the line has no history entry (`current` null);
- a guest / not the owner, and no lorebook: no `unfiledDays` field (the early answers);
- a row in `unfiledDays` reads the same as in `scenes` (summaryStatus, lineCount from the open-scene read).
Also check that the existing tests still pass unchanged (an existing deep-equal on the whole answer may now need the new field added — add it, don't loosen the assertion).

### Docs — `docs/sessions.md`, the one paragraph at ~:573 only
It starts *"The session's history and scenes are in the **Chronicle** widget"*. Add, in the same plain user-facing voice, that under the history entry the Chronicle lists the session's scenes **not yet compiled**, by day (scenes with no story date under *Undated*). Do not mention a Compile button in the Chronicle (it is not built yet). You may say they are compiled from the lorebook's History lens (*Not yet compiled* group, its **Compile** per day). Touch no other line of that file (lane S5 edits § Scenes in the same file: re-read the paragraph immediately before editing; Edit, never Write).

## Files owned (edit only these; re-read each immediately before editing)
- `src/lib/client/components/sessionPage/requests/historyEntries.ts`
- `src/lib/client/components/sessionPage/requests/historyEntries.test.ts`
- `docs/sessions.md` — the one paragraph above only.

## Files readable
Everything. Notably `src/lib/client/lorebooks/sections/unfiledScenes.ts` and `HistoryUnfiledGroup.svelte` (S5's, read only), `$lib/shared/lorebooks/storyDate` (`formatDate`).

## Out of scope — never built
A second grouping rule or a copy of `sceneDayOf`; any setting; changing what `scenes` (Now's filed scenes) lists; a Compile request; any edit to S5's files, `NOMENCLATURE.md`, `STYLE-GUIDE.md`, the SDK.

## Stop and ask when
Any new name beyond `unfiledDays` and the local `sceneOf` helper (and the three `SceneRow` columns, which are the schema's own); `unfiledScenesByDay`'s signature does not fit (say so, do not edit it); an existing test's expectation would have to change in meaning.

## Rules you work under (quoted from CLAUDE.md / the lane rules)
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "It is a **session**, never a *chat*."
- Names: NOMENCLATURE §24 — "Grep for it first — across `src`, the SDK, and the schema."

## Done means
Green: `src/lib/client/components/sessionPage/requests/historyEntries.test.ts`. Run exactly:
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/components/sessionPage/requests/historyEntries.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S6-w1.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`. Also `npx prettier --check` on the two .ts files.
Hand back: the diff summary, test counts, every name you added, anything noticed.

## Verbatim lane lines
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no `sdk:build`; don't run one.)
