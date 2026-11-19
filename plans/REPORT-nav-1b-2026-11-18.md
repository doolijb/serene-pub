# REPORT nav-1b — line navigator: the drawing (vertical), the full view, and nav-1a's review fixes — 2026-11-18

Saved by the lead from the supervisor's hand-back. Brief: `briefs/BRIEF-nav-1b.md`; plan `PLAN-line-navigator-2026-11-18.md`.

## Built
- `shared/lorebooks/lineColumns.ts` (+ test): the date-placed drawing-column model. `client/lorebooks/navigator/`: `lineDrawing.ts` (+ test), `LineDrawing.svelte`, `LineNode.svelte`, `ForkEdge.svelte`, `LineNavigator.svelte`, `lineNavigator.dom.test.svelte.ts`.
- `LinePickerDialog.svelte`: **Show the drawing** / **Show the list**, the grown layout, **Cancel**, the "Not in use yet" sentence, one scrolling column below 42rem. `LineDateScrubber.svelte`: the unused `disabled` prop removed.
- `sockets/lorebookStoryTime.ts` (`bookLineSpansReply`, new `lineSpanRows`): the caps bound the query (one statement, the per-line cap in SQL); a test shows 999 rows come back for 1200 dates.
- `docs/sessions.md`; STYLE-GUIDE §6.6 (line picker, line navigator); NOMENCLATURE §8 (**line navigator**, **drawing column**, line picker) and §25.

## Tests
First full run 14 files, 170/170; after the last fixes 13 files, 161/161 (the lineSpans int test, 9/9, was in the first run only). `tsc` 0; `npm run check` 0 errors. Prettier clean on the lane's files.

## New copy (provisional)
**Show the drawing**, **Show the list**, **Undated**, *Nothing on these lines is dated, so the drawing has no place for them.*, **Cancel**, *Not in use yet. Press Follow the line's present or Use this date to read ‹line›.* / *Not in use yet. Press Use this line to read ‹line›.*

## Behaviour
Phone: below 42rem one scrolling column (list, the line being read, Cancel and the verb); Show the drawing is absent there; below 480px of its own container the navigator never mounts the drawing. Keyboard / screen reader: each placed line is one button labelled as its list row, `aria-current` when selected; Tab runs top to bottom; a line focused off screen is centred; undated lines are buttons under **Undated**; the picture, ruler and edges are `aria-hidden`. The installed flow library (1.6.6) did everything without an upgrade; the drawing loads on demand (~34 KB of source, sharing the library with the pipeline map).

## Open ★
1. Show the drawing is absent when the lorebook has no timeline.
2. A line starting where another ended shares its column (the plan's rule), so the earlier line's dashed tail overlaps the later rail's start.
3. A fork dated before its parent's first date leaves from above the parent's rail.

## Noticed, not done
`parentsOf` exists twice (`lineTree.ts`, `lineColumns.ts`); `state_proxy_equality_mismatch` warnings in the navigator dom runs; the library's zoom buttons are `disabled` at their limits; edges do not render in the test DOM, so they are untested; **not checked in a browser.**

## Scope review (2026-11-18)
In scope; nothing built for later; `package.json` untouched; the drawing loads only through `import()`; editing off; selection shared; colours from tokens. Five findings → fix task `nav-1b-fix`: (1) a fork was drawn at the child's start, not at the date it forked; (2) touching spans shared a drawing column, so one line's tail ran onto another's rail (the lead reverses the plan's equal-dates rule: touching spans block a column); a fork dated before its parent's first date is anchored to the line that covers the date; (3) below ~55rem the drawing was a sliver, and could collapse to zero height when the dialog narrowed; (4) the comment and the vocabulary row described a different cut from the code's; (5) exported names unrecorded, bare "Column" in names, an unused import.
**Known, not changed:** the lineSpans query still scans every dated row of the lorebook (it bounds what it returns, not what it reads). The flow library's own zoom buttons are disabled at their limits, as on the pipeline map. **Needs a browser:** the fork edges render, fit and ruler gutter, dark and light, centring a focused line, nothing clipped at phone width, the real chunk split.

## Fix task `nav-1b-fix` (2026-11-18)
All five done. A fork is drawn at its own fork date; touching spans take separate drawing columns; a fork dated before its parent's first date leaves the nearest line up its chain that covers the date; the drawing mounts only when its container is at least 880px at a 16px rem (the list only below that) and the dialog returns to the list when the window narrows below 42rem; names recorded (`DrawingColumn…`, `DRAWING_COLUMN_PX`), `parentsOf` kept once. Tests: 11 files, 109 pass; `npm run check` 0 errors; `tsc` errors only in the turn-order lane's `pipelines/entities/swapTarget.fixture.ts` (mid-build). **Still owed: a browser walk of the picker and the drawing.**
