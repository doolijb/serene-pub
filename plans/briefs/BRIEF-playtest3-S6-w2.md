# BRIEF playtest3-S6-w2 — SDK: `HistoryEntriesV1.unfiledDays`; the Chronicle draws *Not yet compiled* under Now

Lane `playtest3-S6` · worker 2 · the supervisor reads your final hand-back (put the full report there; do not write a report file).

## Goal
Owner ruling (2026-11-04, ★S2-1b): *"the Chronicle lists the Not yet compiled scenes under Now, by date, with S5's Compile per date (one optional field on `HistoryEntriesV1`)."* You build the SDK half: the field, the Chronicle's view of it, and its markup. **The per-day Compile is NOT built in this pass** — a widget can only press a host request kind, none exists for compile, and a new request kind is a new published SDK name the owner must rule (the supervisor raises it). Build no Compile button, no request kind, no placeholder.

All SDK edits happen in `/home/jody/github/serene-pub-sdk`.

### 1. The field — `sdk/src/widgets.ts`, `interface HistoryEntriesV1` (~:2397)
⚠ Lane T2 just edited this file (`MessageMetadataV1.turnCause`) and others may too: re-read the interface immediately before editing; use Edit, never Write; touch nothing else in the file. Add, after `unsummarizedScenes?`:
```ts
	/**
	 * 🚧 ★S2-1b (owner, 2026-11-04): this session's scenes on its line that no
	 * history entry holds yet — **Not yet compiled** — by day in story order,
	 * *Undated* last: the lorebook History lens's own grouping, read for this
	 * session. Absent on a host that predates it; empty when none wait.
	 * ⚠ Not `ungraphedScenes` (a count of scenes the graph has not read) and
	 * not `scenes` (the ones filed under `current`).
	 */
	unfiledDays?: Array<{
		/** The day; null = the scenes opened with no story clock (*Undated*). */
		date: StoryTime | null
		/** The day as the page spells it through the book's calendar; empty when undated. */
		label: string
		/** This session's scenes of that day not yet compiled, in id order. */
		scenes: HistorySceneV1[]
	}>
```
`StoryTime` is already in scope in that file (used by `HistoryEntryV1.date`) — check; import nothing new if so. No other SDK type changes.

### 2. The view — `core-catalog/src/shared/ui/chronicle/index.ts`
- `ChronicleView` gains `unfiled` (🚧 doc: *Not yet compiled* under Now, ★S2-1b): `Array<{ key: string; date: string; count: string; scenes: ChronicleSceneView[] }>` — an inline type, **no new exported type name**. `key` is stable per day (`${year}-${month ?? ''}-${day ?? ''}` or `'undated'`); `date` is the page's `label`, else `String(date.year)` for a dated day with an empty label, else `t('Undated')`; `count` is `count(n, '1 scene', '{n} scenes', t)` (the existing local helper).
- Default `unfiled: []` in `none` (loading / no-book / ownerOnly all draw nothing).
- In the ready view: `unfiled: (result.unfiledDays ?? []).filter((d) => d.scenes.length).map(...)`. Each scene maps through **the very same** scene mapping `scenes` uses (summary dot, *Summarize*, *Ready to review*, swatch, open, written-from) — extract the existing inline `result.scenes.map((s) => { … })` body into one local function inside `chronicleView` and call it for both. `scenes`' behaviour must not change. `unfiled` is filled whether or not `now` is null.
- Add one sentence to the module note's 🚧 paragraphs: the answer also carries the session's scenes not yet compiled, by day (`unfiledDays`), which the view draws as *Not yet compiled* under Now.

### 3. The markup — `core-catalog/components/shared/chronicle/ChronicleWidget.svelte` (NOT `Chronicle.svelte`, which another lane has edited — do not touch it)
- Move the scene row `<li data-widget-part="chronicle.scene row">…</li>` into a `{#snippet sceneRow(s)}` and render it from both lists, so the two lists are one row markup. Behaviour and parts of the existing Scenes list must not change.
- After the `{#if view.now}…{/if}` Scenes section and before `{#if view.earlierHead}`, add:
```svelte
{#if view.unfiled.length}
	<section data-widget-part="chronicle.unfiled" aria-labelledby="{uid}-unfiled">
		<h3 id="{uid}-unfiled" data-widget-part="chronicle.heading label">{t("Not yet compiled")}</h3>
		{#each view.unfiled as day (day.key)}
			<div data-widget-part="chronicle.unfiled-day" role="group" aria-label={day.date}>
				<div data-widget-part="chronicle.unfiled-day-head">
					<span data-widget-part="chronicle.unfiled-date">{day.date}</span>
					<span data-widget-part="chronicle.unfiled-count">{day.count}</span>
				</div>
				<ul data-widget-part="chronicle.scene-list list">
					{#each day.scenes as s (s.id)}{@render sceneRow(s)}{/each}
				</ul>
			</div>
		{/each}
	</section>
{/if}
```
- Add one paragraph to the component's doc comment: 🚧 ★S2-1b — under Now, **Not yet compiled**: the session's scenes no history entry holds yet, by day (*Undated* last), each row the same as a Scenes row.
- Copy is exactly *Not yet compiled* and *Undated* (lane S5's History lens group's words — reuse, never vary).

### 4. Tests
- `sdk-tests/coreChronicle.test.ts`: add `describe('🚧 ★S2-1b: Not yet compiled', …)`: days drawn in the answer's order with their label, *Undated* for a null date, the count words; each scene row equals what the same `HistorySceneV1` gives in `scenes` (dot, Summarize); a day with no scenes is dropped; absent `unfiledDays` (an older host) → `[]`; ownerOnly / no-book / loading → `[]`; filled when `current` is null. Existing assertions that deep-equal a whole view may need `unfiled: []` — add it, never loosen them.
- `/home/jody/github/serene-pub/src/lib/client/components/sessionPage/remoteChronicle.dom.test.ts` (the built widget mounted in the app): one `test(...)` — an answer with two `unfiledDays` (one dated, one `date: null`) draws `[data-widget-part~="chronicle.unfiled"]` after the Scenes section, its heading *Not yet compiled*, two `chronicle.unfiled-day` groups with their dates (*Undated* for the second) and the scene names in `chronicle.scene-name`. Read the file's existing harness and copy its pattern; add nothing else to it. Use the file's existing per-test timeout pattern.

### Running
- SDK test: `cd /home/jody/github/serene-pub-sdk/sdk-tests && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test coreChronicle.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S6-w2-sdk.log 2>&1; echo exit=$?'` then read the log. Never the whole `sdk:test`, never `npm test` at the SDK root.
- The DOM test needs the built `chronicle.js`: first `pgrep -af "[v]ite dev"` — if any serene-pub dev server is up, do NOT build; report "blocked on your dev server". Else from `/home/jody/github/serene-pub`: `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S6-w2-build.log 2>&1; echo exit=$?`. If the build fails in a file that is not yours, report it with the log line and stop — never fix another lane's file. Then:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/components/sessionPage/remoteChronicle.dom.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S6-w2-dom.log 2>&1; echo exit=$?'` then read the log. Never pipe vitest into `head`.
- `npx prettier --check` on each file you changed (the SDK repo has its own prettier config; if the file was not prettier-clean before you touched it, say so rather than reformatting it).

## Files owned (edit only these; re-read each immediately before editing)
- `../serene-pub-sdk/sdk/src/widgets.ts` — the one field only
- `../serene-pub-sdk/core-catalog/src/shared/ui/chronicle/index.ts`
- `../serene-pub-sdk/core-catalog/components/shared/chronicle/ChronicleWidget.svelte`
- `../serene-pub-sdk/sdk-tests/coreChronicle.test.ts`
- `src/lib/client/components/sessionPage/remoteChronicle.dom.test.ts` — the one new test only

## Files readable
Everything. `src/lib/client/lorebooks/sections/HistoryUnfiledGroup.svelte` (S5's group: its words). `src/lib/client/styles/widgets.css` §chronicle (how parts are styled — NOT yours; the supervisor queues the CSS).

## Out of scope — never built
A Compile button or request kind; a setting; changing what Now or Scenes lists; CSS (`widgets.css`), `STYLE-GUIDE.md`, `NOMENCLATURE.md`, `Chronicle.svelte`, any golden or frozen hash unless a test you run fails on one — then stop and report which.

## Stop and ask when
`HistoryEntriesV1` cannot take the field additively; any name beyond: `unfiledDays`, `ChronicleView.unfiled`, the parts `chronicle.unfiled` · `chronicle.unfiled-day` · `chronicle.unfiled-day-head` · `chronicle.unfiled-date` · `chronicle.unfiled-count`, the local scene-mapping function and the `sceneRow` snippet; a golden/hash test fails.

## Rules you work under (quoted)
- STYLE-GUIDE §6.16: widget markup carries no look — "its elements carry `chronicle.*` widget parts"; no classes, no inline style.
- CLAUDE.md: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." · "Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted." · "It is a **session**, never a *chat*."
- Every sentence the widget shows goes through `t(...)` (English source).

## Verbatim lane lines
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*

## Hand back
The diff summary per file, test commands with pass/fail counts, the build result, every name you added, anything noticed.
