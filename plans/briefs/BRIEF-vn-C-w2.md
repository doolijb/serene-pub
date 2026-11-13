# BRIEF — vn-C-w2: the Dialogue box declaration, the Visual novel layout, the enumerating tests

Supervisor: lane `vn-C`. Repo: **`/home/jody/github/serene-pub-sdk`** (the SDK). Plan: `/home/jody/github/serene-pub/plans/PLAN-visual-novel-layout-2026-11-11.md` — read §0, §1.2, §1.3, §1.6 (the layout literal you write) and §6.

Context: a new core widget, the **Dialogue box** (`dialogue-box`), reads the story one line at a time. Another worker builds its Svelte component under `core-catalog/components/shared/dialogue-box/` (entry `dialogue-box.ts`); it does not exist yet, so a test that compiles core components may fail on it — say so, don't create the component. You write the declaration, the export lists, the layout, the genre entry, three SDK doc comments, and update the tests that enumerate core widgets or layouts.

Names are decided by the plan and the owner: **Dialogue box**, `dialogue-box`, `autoRead` (**Read on by itself**), `readingSpeed` (**Reading speed**), layout slug `visual-novel` named **Visual novel**, export key `dialogueBox`, constant `STORY_VISUAL_NOVEL_LAYOUT`. Coin no other exported name. Never use the word *chat* (it is a **session**).

## Goal

### 1. `core-catalog/src/registry/widgets.ts`

a) A new entry in `CORE_WIDGETS`, placed **directly after the `composer` entry** (the conversation's widgets stay together). Model it on the Turn line (`id: 'turn-line'`) and Album entries in the same file. Exactly:

```ts
	/**
	 * 🚧 The **Dialogue box** (PLAN-visual-novel-layout §1.2; owner 2026-11-11,
	 * "a different widget … not overload the normal widget"): reads the story
	 * one line at a time. It shows ONE row of the main channel — the reader's
	 * **reading place**, client-only, the newest row when it opens — and queues
	 * what follows behind it on its reading bar (*Osk has replied*, *3 more
	 * lines*, **Next line**); the viewer's own line, a change line or a marker
	 * is passed over, and sending catches the reader up
	 * (`SessionDossierV1.ownNewestMessageId`). It tells its host the line it
	 * shows (`show-line`), which the scene follows. **Read on by itself**
	 * moves on once the line's voice has played, or after a reading time when
	 * it has none, with a progress bar and **Pause**.
	 *
	 * Owns the reading place and the pace of reading. Does not own the log
	 * (Messages), writing (the Composer, which keeps following the Messages
	 * copy beside it), who speaks next (the turn order) or speech (the server
	 * and the spoken line). It renders through a panel, not a conversation
	 * mount, so it declares `session:full` for the dossier its rows' verbs
	 * read. Offers no selection for a summary: the selection bar is Messages'.
	 *
	 * ⚠ It shows whole lines, narration included — not speech's *dialogue*
	 * (**Dialogue only**, quoted speech), and not a modal dialog.
	 */
	{
		id: 'dialogue-box',
		title: 'Dialogue box',
		component: 'dialogue-box',
		// A box sized to its line; the Visual novel layout gives its panel a share.
		panel: { height: 'fit', priority: 'normal' },
		maxInstances: 1,
		// Not a conversation mount (no hard-coded grant): the dossier comes by this scope.
		scopes: ['session:full'],
		/** The row, its menu and verbs, its edit field (`layout`'s tier), the viewer and the language. */
		reads: ['layout', 'messages', 'actions', 'settings', 'viewer', 'locale'],
		presets: [DEFAULT_PRESET],
		settings: {
			autoRead: {
				type: 'boolean',
				label: 'Read on by itself',
				description: "Moves to the next line by itself: once a line's voice has played, or after a reading time when it has none.",
				default: false,
			},
			readingSpeed: {
				type: 'integer',
				label: 'Reading speed',
				description: 'Words per minute: how long a line with no voice stays before the next one comes in.',
				min: 80,
				max: 600,
				default: 220,
				showIf: { field: 'autoRead', equals: true },
			},
		},
	},
```

Check the property names against neighbouring entries and the `WidgetDecl` type (`sdk/src/layout.ts`); if `maxInstances`, `scopes`, `panel` or a setting key is spelled differently there, use the type's spelling and say so in your report. If the declaration validator (run the tests below) warns about a setting lacking a `group`, report the warning — do not invent a group.

b) `coreWidgets`: add after `turnLine`:
```ts
	/** 🚧 The Dialogue box: the story one line at a time, its reading bar, Read on by itself (PLAN-visual-novel-layout §1.2). */
	dialogueBox: coreWidget('dialogue-box'),
```

c) `CORE_COMPONENTS`: add after the `turn-line` entry:
```ts
	component({
		slug: 'dialogue-box',
		label: 'Dialogue box',
		entry: 'components/shared/dialogue-box/dialogue-box.ts',
		framework: 'svelte',
	}),
```

d) `CORE_VIEW_ONLY_COMPONENTS`: `['messages', 'composer', 'turn-line', 'dialogue-box']`; extend its doc comment by one clause: "`dialogue-box` likewise: it renders the row with its verbs (plan §6 answer 3)."

Touch **nothing else** in `widgets.ts` (other lanes own other entries).

### 2. `core-catalog/src/registry/layouts.ts`

Add after `STORY_WORLD_LAYOUT` (and before the Lair's comment):

```ts
/**
 * 🚧 Story's **Visual novel** layout (PLAN-visual-novel-layout §1.6, ★4): the
 * session's backdrop fills the window behind glass panels; the last two
 * speakers stand on it (Scene Portraits on the open stage, whoever did not
 * write the line shown dimmed); the Dialogue box reads the story one line at
 * a time in the bottom band, the whole log (titled Log) and the characters
 * as tabs beside it; the Turn line and the Composer under it, as in every
 * layout. The sides are empty.
 *
 * The one shipped layout with look keys (`backing`, `behind`). It pins Scene
 * Portraits' **Open stage** style by slug (`<widgetId>:<preset>`, how core's
 * style rows are seeded); a row id belongs to one install. **Read on by
 * itself** stays off (P1): a new automatic behaviour is a person's choice.
 * @internal
 */
export const STORY_VISUAL_NOVEL_LAYOUT: SessionLayoutV1 = {
	panels: {
		version: 2,
		left: [],
		middle: [
			{ key: "p1", tabs: ["scene-portraits"] },
			{ key: "p2", tabs: ["dialogue-box", "messages", "stats#characters"], height: { share: 4 } },
			{ key: "p3", tabs: ["turn-line"] },
			{ key: "p4", tabs: ["composer"] }
		],
		right: [],
		backing: "glass",
		behind: "backdrop"
	},
	widgetSettings: {
		"scene-portraits": {
			who: "recent",
			recentTurns: 2,
			face: "sprite",
			arrangement: "stage",
			speakerFocus: true
		},
		messages: { title: "Log" },
		"stats#characters": { owners: "cast", castScope: "all", arrangement: "faces", title: "Characters" }
	},
	widgetStyles: {
		"scene-portraits": { slug: "scene-portraits:open-stage" }
	}
}
```

(Scene Portraits' panel has no `height`: absent is the open tab's declaration, else `fill` — the file's convention; the plan's "Fill". The `stats#characters` settings are Story's default layout's, so the tab reads the same.) Also amend the file-head sentence "No look keys: the defaults apply." to "No look keys but the Visual novel's: the defaults apply." — the only other edit in this file.

### 3. `core-catalog/src/registry/genres.ts` — the one entry

In Story's `layouts` (around line 688), after the `world` entry:
```ts
		layout({
			slug: "visual-novel",
			name: { en: "Visual novel" },
			description: { en: "The scene fills the screen and the story reads one line at a time in a box at its foot; the whole log is a tab beside it." },
			preset: STORY_VISUAL_NOVEL_LAYOUT
		})
```
Import `STORY_VISUAL_NOVEL_LAYOUT` the way `STORY_WORLD_LAYOUT` is imported. Update the layouts comment above it by one clause ("and the **Visual novel** (★4): the story one line at a time over the scene"). Nothing else in `genres.ts`; Story's default layout stays first.

### 4. SDK doc comments only (both fields are already declared — do not redeclare or move them)

- `sdk/src/widgets.ts`, the `'show-line'` comment in `WidgetRequests`: name the widget — "A core widget that holds its reader's place (the **Dialogue box**) tells its host…" — and add: "The widget also sends its first value when it mounts, so a host never keeps an earlier mount's line." Keep the rest.
- `sdk/src/sessionDossier.ts`, `ownNewestMessageId`: add one sentence: "The Dialogue box jumps to it only when it is one of its own (main channel) rows."
- `sdk/src/widgets.ts`, `SessionCharacterV1.lastSpokeAt`'s comment ("its newest visible line on the session's line"): add "— while a widget holds its reader's place behind the newest row (`show-line`), its newest at or before the line shown, as `sprite` follows it." Read the `sprite` comment just above it (lane vn-A wrote it) and match its wording.

### 5. Enumerating tests — update where they list core widgets, components or layouts

Run each, read the failure, make the smallest edit that states the new truth, with a dated comment where the file keeps such comments (e.g. deriveDontSpell's `// 2026-11-11: 17 → 18 — PLAN-visual-novel-layout: the Dialogue box names its compiled module ('dialogue-box').`). Known:

- `sdk-tests/coreComponentSources.test.ts:38` — the view-only list gains `'dialogue-box'`; the first test's title says "the conversation's three view-only" → four. (Its per-slug `dist/components/<slug>.source.json` tests will fail for `dialogue-box` until the lead's `sdk:build`; that is expected — report it, change nothing for it.)
- `sdk-tests/deriveDontSpell.test.ts` — the `compiled UI module id` count 17 → 18.
- `sdk-tests/coreShippedLayouts.test.ts` — (i) the panel-defaults test: `dialogue-box` declares `{ height: 'fit', priority: 'normal' }`, and the "no other core widget" list gains it; (ii) a **new test** for `STORY_VISUAL_NOVEL_LAYOUT` (not added to the `shipped` loop, whose look-key assertions it would fail): validates with `{ widgets: CORE_WIDGETS, unknownWidgets: 'warn' }` with no errors and no warnings; version 2; the middle's tabs are exactly `[['scene-portraits'], ['dialogue-box','messages','stats#characters'], ['turn-line'], ['composer']]`; `p2`'s height is `{ share: 4 }`; left and right empty; `backing: 'glass'`, `behind: 'backdrop'`, no `opacity`, `gap`, `behindDim`; keys p1…p4; `widgetSettings` deep-equals the literal; `widgetSettings['dialogue-box']` is undefined (Read on by itself stays off); `widgetStyles` deep-equals `{ 'scene-portraits': { slug: 'scene-portraits:open-stage' } }`; and `storyGenre.layouts` slugs are `['default', 'world', 'visual-novel']` with `default` still `STORY_LAYOUT`. Import `storyGenre` as the file imports `guideGenre`.
- `sdk-tests/sessionLayout.test.ts` ~line 723 — `assert.equal(layouts.length, 2)` holds for the Lair only now: make it per genre (Story 3, Lair 2). Then add the Visual novel to the golden: a third case `[storyGenre, 'visual-novel']` whose golden key is `'core:genre/story#visual-novel'` (the loop reads `before[g.id]`; give each case its golden key explicitly), and add that key to `sdk-tests/goldens/core-session-layouts.json` with the blob `JSON.stringify(STORY_VISUAL_NOVEL_LAYOUT, null, '\t')` produces — generate it, don't hand-type it. Add one dated line to that describe's comment block ("🚧 Added 2026-11-11 (PLAN-visual-novel-layout §1.6): Story's Visual novel, under its own key.").
- `sdk-tests/cliClone.test.ts` (the `--list` test) — only if it fails for a reason other than the missing `dialogue-box.source.json` (that one waits for the build); otherwise leave it and report.

Then run the wider set below and fix only what fails *because of the new widget or layout*. Anything failing for another reason: report it, don't fix it.

### 6. SDK guides

`grep -rn "turn-line\|Turn line" /home/jody/github/serene-pub-sdk/guides /home/jody/github/serene-pub-sdk/INTEGRATING.md /home/jody/github/serene-pub-sdk/docs/*.md` (skip `docs/generated`). Where a guide **lists the core widgets** or **the core-only host requests** by name and would now be wrong without the Dialogue box / `show-line`, add it in the guide's own style. Do **not** touch the generated widget-parts list in `guides/widgets.md` (`npm run gen:widget-parts` writes it; a later worker runs it). Report every guide line you changed, or "none needed".

## Files owned

`core-catalog/src/registry/widgets.ts` (the new entry and the three export lists only), `core-catalog/src/registry/layouts.ts`, `core-catalog/src/registry/genres.ts` (the one entry, its import and comment clause), `sdk/src/widgets.ts` and `sdk/src/sessionDossier.ts` (the three comments only), `sdk-tests/coreComponentSources.test.ts`, `sdk-tests/deriveDontSpell.test.ts`, `sdk-tests/coreShippedLayouts.test.ts`, `sdk-tests/sessionLayout.test.ts`, `sdk-tests/goldens/core-session-layouts.json`, `sdk-tests/cliClone.test.ts` (only as above), any other `sdk-tests/*.test.ts` that fails only because it enumerates core widgets/layouts (name each in the report), and guide lines per §6.

## Files readable

Anything in both repos.

## Out of scope

The component files; `components/shared/messages/`; Scene Portraits' declaration and files (lane vn-A's); any other widget's entry; the app repo; `npm run sdk:build`.

## Stop and ask when

A name above collides with an existing one in code; the validator refuses the layout or warns on it; a test would need a change that is not "the new widget/layout exists"; anything outside the owned files would need to change. Report instead of deciding.

## Done means

From `/home/jody/github/serene-pub-sdk/sdk-tests`:
```
npx tsx --test coreShippedLayouts.test.ts sessionLayout.test.ts deriveDontSpell.test.ts coreComponentSources.test.ts widgetAliases.test.ts coreCatalogCoreWidgets.test.ts widgetDecls.test.ts widgetSections.test.ts coreGenreDefaults.test.ts i18n.test.ts langCatalogs.test.ts panelsV2Of.test.ts resolveDrawn.test.ts presets.test.ts redeclaration.test.ts registrations.test.ts; echo test-exit=$?
npx tsc --noEmit -p . ; echo tsc-exit=$?
```
Everything passes except the per-slug `dialogue-box` source.json cases (and anything you show failed before your change). Report tsc errors in files you did not touch without fixing them. `npx prettier --check` each file you edited (report neighbours' pre-existing state if the file was already unclean).

## Report

Final message: files changed (with the line ranges), each test file run with pass/fail counts, every existing test you edited and why, guide lines changed, anything you stopped on, **Noticed, not done**.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You never run `sdk:build` in this task.)
- Never `git checkout`, `restore` or `clean` in either repo. Never run `prettier --write` on a directory.
- Never pipe a test run into `head`.
- It is a **session**, never a *chat*.
- Scratch files start with `vn-C-`.
