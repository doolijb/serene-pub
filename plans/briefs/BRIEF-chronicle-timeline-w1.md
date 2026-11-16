# BRIEF — worker `chronicle-timeline-w1` — the SDK half: one field, the Chronicle's view and widget, tests

SDK repo `/home/jody/github/serene-pub-sdk`. Supervisor: lane `chronicle-timeline`. Report back as your final
message: changed files, what you ran and its result, anything you could not do, Noticed-not-done.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**You do not build and you do not run the SDK test suite.** The supervisor builds (`npm run sdk:build` from the
app root) and runs `npm run sdk:test` after you report. You may typecheck your files only with
`cd /home/jody/github/serene-pub-sdk/core-catalog && npx tsc --noEmit -p .` and
`cd /home/jody/github/serene-pub-sdk/sdk && npx tsc --noEmit -p .` if those tsconfigs exist (check first; if a
package has no tsconfig, skip it). Nothing else.

## Rules you work under

- In the SDK repo: never `git checkout`, `git restore` or `git stash` (most of it is uncommitted).
- Edit ONLY the four files listed under **Files owned**. Never `prettier --write`; never reformat lines you did
  not change. Keep each file's existing style (tabs, quotes, semicolons as the file has them).
- Comments state the rule, not the story (no "the lane added", no "previously"). Mark new behaviour 🚧 as the
  neighbouring comments do.
- No other product's name in any file.
- It is a **session**, never a *chat*.
- **No new names** besides exactly the ones this brief gives: the field `timeline`, the two sentences below. No new
  field on `ChronicleView` or any other type, no new export, no new widget part (`data-widget-part` values):
  reuse the existing parts named below. If you find you need one, stop and say so in your report.

## Owner rulings (quoted)

- 2026-11-13: "hide all the extra time management noise in entries and the lorebook when timelines aren't
  enabled"; "No history entries for undated lorebooks, maybe scenes only."
- 2026-11-13: "Do not provide SDK api for this yet" (the Timeline switch and the timeless copy).
- 2026-11-15: approved exactly one new SDK name: an optional, read-only, `@experimental` `timeline?: boolean` on
  `HistoryEntriesV1`. "It is one additive, read-only name." Nothing else is added to any SDK contract: no write,
  no setting, no outlet, no pipeline surface.

## Files owned

1. `sdk/src/widgets.ts` — only `HistoryEntriesV1` (~line 2596) and its `unfiledDays` comment.
2. `core-catalog/src/shared/ui/chronicle/index.ts`
3. `core-catalog/components/shared/chronicle/ChronicleWidget.svelte`
4. `sdk-tests/coreChronicle.test.ts`

## What to build

### 1. The field (`sdk/src/widgets.ts`, inside `HistoryEntriesV1`, after `unfiledDays`)

```ts
	/**
	 * 🚧 Whether the lorebook this session reads keeps a timeline. False: the
	 * answer carries no time. `clock` has no present, `current` is null,
	 * `scenes` and `earlier` are empty, `earlierTotal` is 0 and the open
	 * scene's `since` is empty; `unfiledDays` is one group (`date` null,
	 * `label` empty) holding every scene of this session on its line, filed or
	 * not, in played order. Absent or true reads as a timeline (a host that
	 * predates it).
	 * @experimental
	 * @ruling owner 2026-11-15 (★T-C6)
	 */
	readonly timeline?: boolean
```

And append one sentence to the `unfiledDays` comment: `With \`timeline\` false it holds every scene of this
session instead (see there).` Touch nothing else in the file.

### 2. The view (`chronicle/index.ts`, `chronicleView`)

- After the `lorebookId === null` return: `const timeless = result.timeline === false` (absent or true = a
  timeline, as today).
- `clock` is built only when `settings.clock && !timeless`; otherwise null. This comes before the `ownerOnly`
  return, so a guest with the timeline off gets no clock.
- The `ownerOnly` return: its sentence, when `timeless`, is exactly
  `t("This session's scenes are its lorebook owner's to read.")` (no mention of history entries); otherwise
  unchanged.
- The owner's view when `timeless`:
  - `now: null`, `nowEmpty: null`, `earlier: []`, `earlierHead: null`, `earlierMore: null`, `unfiled: []`,
    `scenesEmpty: null`;
  - `scenes`: every scene in `result.unfiledDays` (all groups flattened, in the answer's order) through the same
    `sceneView`;
  - the open scene's `since` is `''` whatever the answer says;
  - `canSummarize`, `summarizeAll`, `extend`, `canWrite`, `openScene` (apart from `since`) exactly as today.
- With `timeline` absent or true, everything is exactly as today.
- Update the doc comments: `ChronicleView.clock` ("null when the `clock` setting is off, the lorebook keeps no
  timeline, or before an answer"), `ChronicleView.scenes` (add: "🚧 with the timeline off (`timeline` false),
  every scene of this session on its line, in played order"), and one 🚧 paragraph in the module doc saying
  what the view draws with the timeline off (no clock, no Now, no earlier, no days; the scenes and the open scene
  stay; the widget says why in the clock's place).

### 3. The widget (`ChronicleWidget.svelte`)

- `const timeless = $derived(answer?.timeline === false)`.
- In the clock's place: when `timeless`, draw
  `<p data-widget-part="chronicle.note">{t("This lorebook keeps no timeline, so there are no dates here.")}</p>`
  instead of the clock section (whatever the `clock` setting); otherwise the clock section exactly as today.
  It sits inside the existing `view.state !== "no-book"` gate, so no lorebook still draws nothing.
- The `chronicle.now` section (heading **Now**, the entry card, **Open in lorebook**, **Start new history
  entry**) is not drawn when `timeless`.
- The `chronicle.scenes` section is drawn when `view.now || timeless` (today: `view.now`). When `timeless`, its
  toolbar (`chronicle.scene-actions toolbar`) is drawn and its FIRST button is **Open in lorebook**, reusing
  part `chronicle.open` and the `external-link` icon as the Now toolbar's does, pressing
  `open-lore` with `{ lorebookId (when known), scope: "scenes" }` and no `sceneId` (write a small function
  beside `openEntry`/`openScene`, e.g. `openScenes()`). The toolbar's other buttons stay as they are.
- *Not yet compiled* and *Earlier* need no change (the view gives them nothing when `timeless`).
- Add one 🚧 paragraph to the component's top doc comment saying the same as the module doc.

### 4. Tests (`sdk-tests/coreChronicle.test.ts`), a new `describe('🚧 a lorebook with no timeline', …)`

Using the file's `answer()` fixture and `OWNER` / `GUEST`:
- `timeline: false`, owner, with `unfiledDays: [{ date: null, label: '', scenes: [three scenes, one with an
  order out of id order] }]`, an `openScene` with `since: 'Friday, 2 March, Year 1'`, `current` and `earlier`
  still filled in the fixture (the view must ignore them): `clock` null, `now` null, `earlier` [],
  `earlierHead` null, `unfiled` [], `nowEmpty` null, `scenes` = those three ids in the answer's order,
  `openScene.since` `''`, `canSummarize` true, `extend` non-null when `ungraphedScenes > 0`.
- the clock setting on or off: `clock` null either way with `timeline: false`.
- a guest (`ownerOnly: true`, viewer `GUEST`) with `timeline: false`: `clock` null and `ownerOnly` equals
  `"This session's scenes are its lorebook owner's to read."`.
- `timeline: true` and absent: the view deep-equals today's view of the same answer (compare
  `chronicleView(answer({ timeline: true }), …)` with `chronicleView(answer(), …)`, and the guest's sentence is
  the old one).
- One mount test like the file's last one (`mountEmpty`-style, `timeout: 120_000`, unmount in `finally`), with
  the request answering `answer({ timeline: false, unfiledDays: [one group of two scenes] })`: no
  `chronicle.clock` part, no `chronicle.now` part, a `chronicle.note` whose text is
  `This lorebook keeps no timeline, so there are no dates here.`, a `chronicle.scenes` section whose heading
  text is `Scenes` holding two `chronicle.scene` rows, and a `chronicle.open` button inside
  `chronicle.scenes`. Keep assertions on strings and null checks (`=== null`), never `assert.ok` on a
  happy-dom element in a way that prints the element (an assert that prints a happy-dom element has
  OOM-killed the editor): compare `el === null` booleans and `textContent` strings only.

Do not run the tests. Report the exact test names you added.
