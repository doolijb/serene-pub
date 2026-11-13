# BRIEF lay-B-w4 — no placeholder text in empty widgets (owner R10) (SDK core-catalog)

Worker (Sonnet) for lane lay-B. Supervisor: lay-B. Paths: SDK = /home/jody/github/serene-pub-sdk.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (In this lane: **do not run sdk:build / any build at all**.)

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.

## The ruling (owner R10, 2026-11-05, as the lane brief states it)
"No placeholder text when empty: every core widget EXCEPT Messages draws nothing when it has nothing to show — remove the default empty sentences (Stats incl. the Characters sheet and *tracks no stats*, Places *This book has no places yet*, Backdrop *No backdrop yet…* (keep its owner buttons), Who's here *Nobody else is here.*, Annex *Nothing written yet*, Album, Chronicle, Lore entries, Scene Portraits, Turn order, While you were away, Author's note, Turn line, any other). Keep: Messages' empty line, error/stopped states, a greyed control's reason, loading spinners if any. Existing 🚧 **When empty** settings stay, default empty (show the author's text only when set). List every sentence removed in your report."

## What to do
Sweep every core component under `SDK/core-catalog/components/**` EXCEPT `components/shared/messages/MessagesWidget.svelte` / `SessionContainer.svelte` (the Messages log's empty line stays) — i.e. `actions`, `album`, `annex`, `attendance`, `backdrop`, `chronicle`, `lore-entries`, `places`, `routine-log`, `scene-portraits`, `stats` (`StatsWidget.svelte`), `state/*` if it draws a widget-level empty line, `turn-order`, `genres/story/authors-note`, `composer`, `turn-line` and `messages/TurnLine.svelte` / `NextCharacterBlock.svelte` (the turn line's). For each:
- **Remove** every sentence (and the element that only carries it — typically `<x>.empty empty` with its icon) that a widget says because it has nothing to show: "no X yet", "nothing here", "no stats to show", "This session's rules declare no attributes.", "Your sheet appears once your character is made.", "nobody else is here", "no order yet / why there is no order", "no places", "no backdrop yet", "nothing written yet", "No routine has run in this session yet.", a no-lorebook / no-entry / no-scenes line, *This kind of session has no author's note.* (already gone — check), a per-card "No stats to show for this member." etc. When the widget then has nothing at all to draw, it renders its root element empty (keep the root and its `data-*`, so the host still mounts and measures it).
- **Remove** loading sentences ("Loading the session's stats…", "Reading the author's note…", "Reading …") — the ruling keeps "loading spinners if any", not loading text: where a loading state has an icon/spinner only, keep the icon; where it is text only, draw nothing while loading.
- **Keep**: every error or refusal (`*.alert`, `role="alert"`, a read that failed, a press the page declined), stopped/failed run states, the not-granted line (`data-scope-not-granted` — a permission state, not emptiness), a greyed or withheld control's reason (*Only the session's owner can change …*, *the book is its owner's* notes, a disabled button's title), every owner button and action (Backdrop's Change / Clear), the Messages log's empty line.
- **"When empty" settings** (`emptyState` on Stats; any other widget's equivalent — grep `emptyState`): the setting stays; show its text ONLY when it is set (non-empty). Where code falls back to a default sentence when it is unset, remove the fallback.
- Do not change any registry declaration text except where a `description` promises the removed sentence (e.g. a `When empty` description saying "Empty explains why in its own words" → "Empty draws nothing"); `core-catalog/src/registry/widgets.ts` is being edited by another worker in its `panel` hunks of the `messages`/`composer`/`turn-line` entries — use exact Edit hunks in other entries only, re-read before each edit.
- Do NOT touch `core-catalog/src/registry/layouts.ts` / `genres.ts` (genre-pinned `emptyState` texts are an author's text and stay) or anything under `core-catalog/src/shared/**` unless a sentence there is only a default empty sentence rendered by a component (then say so first in the report and change it). Tests decide nothing about the copy: a test that asserts a removed sentence is updated to assert the widget draws nothing there.

## Tests (`cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test <file>`, one file at a time, never piped into `head`)
Find every test that asserts a removed sentence: `grep -rln "<sentence fragment>" sdk-tests/*.test.ts`. Likely: `coreActions`, `coreAlbum`, `coreAnnex`, `coreAttendance`, `coreChronicle`, `coreLoreEntriesComponent`, `corePlaces`, `coreRoutineLog`, `coreTurnOrder`, `coreStateWidgets`, `coreStatsKinds`, `coreStatsPieces`, `coreStatsTies`, `coreAuthorsNoteScenario`, `coreScenePortraitsComponent`, `coreTurnLineComponent`, `coreComposerComponent`, `dungeonCrawlerWalk3`, `coreConversationComponent` (turn-line parts only). Update them to assert absence. Some mount the BUILT dist (`dist/components/*.js`, or `coreComponentEntry`) — those read stale code until the lead rebuilds: update their assertions anyway and list them as "updated, not runnable until rebuild". Run every source-mounted file you touched and report counts. Add no new test files; one assertion per widget that an empty state draws no text is enough where none exists.
Typecheck: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "sdk-tests/core|registry/widgets"` prints nothing.

## Rules (CLAUDE.md, quoted)
- STYLE-GUIDE §6.16: "A session widget's markup carries **no look** … Its elements carry **widget parts**." Removing an element removes its part; list removed parts.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." No new words, no new parts, no new settings.
- "It is a **session**, never a *chat*."

## Files owned
`SDK/core-catalog/components/**` except `messages/MessagesWidget.svelte`, `messages/SessionContainer.svelte`; `SDK/core-catalog/src/registry/widgets.ts` (description text only, not the messages/composer/turn-line entries); the sdk-tests named above.

## Report
Final message (you cannot write report files): EVERY sentence removed, verbatim, by widget and file:line; every element/part removed; every `emptyState` fallback removed; sentences you judged to KEEP and why (one line each); tests changed and run with counts; the built-dist tests updated but not runnable; Noticed-not-done.
