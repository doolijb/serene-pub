# BRIEF — `ui-borders` worker 3 — session forms and the session card

**Read `plans/briefs/BRIEF-ui-borders-common.md` first and in full.** Every rule there applies. This brief adds only your file list and per-site notes.

## Goal

Remove arbitrary borders from the session forms in the sidebar: the re-spelled card becomes the utility alone, hand-written cards lose their border, a separator becomes spacing, the fill-less seat rows get a quiet fill.

## Files owned (edit only these; all under `src/lib/client/components/`)

- `sessionForms/EditSessionForm.svelte`, `sessionForms/SessionRunsTab.svelte`, `sessionForms/BenchedSeatRow.svelte`, `sessionForms/CharacterPickRow.svelte`, `sessionForms/SessionAnnexPanel.svelte`, `sessionForms/SpeechSettingsBlock.svelte`
- `listItems/SessionCardItem.svelte`

## Files readable

Anything under `src/`, `STYLE-GUIDE.md`.

## Sites (line numbers approximate; re-read)

### Move 1
- `sessionForms/EditSessionForm.svelte` ~163 `CARD_CLASS = "panel-card border-surface-200-800 bg-surface-100-900 rounded-container border p-4"` → `CARD_CLASS = "panel-card"`. The utility already carries the fill, the `rounded-container` radius and `p-4`. Update the doc comment above it in one line if it now says something false (it says the utility is a hook "the day one exists": it exists; keep the comment short and true). Every `class={CARD_CLASS}` / `cardClass={CARD_CLASS}` site then follows.
- `sessionForms/EditSessionForm.svelte` Visibility tab (~3833, ~3843, ~3863, ~3883, ~3917): `border-surface-200-800 bg-surface-100-900 … border` boxes. The supervisor saw ~3843/3863/3883 as siblings under a plain `flex flex-col gap-3` div, not nested in ~3833. Trace the parent ground of each: on `50-950`, remove `border-surface-200-800` and `border`. If one sits inside another `100-900` box or a card, give it `bg-surface-50-950` instead of `100-900`, no border.
- `listItems/SessionCardItem.svelte` ~72 `bg-surface-100-900 panel-edge … border`: rendered only by `sidebars/SessionsSidebar.svelte` ~948 on the sidebar ground → remove `panel-edge` and `border`. Keep `transition-shadow hover:shadow-lg` and the selected ring.

### Move 2
- `sessionForms/SessionRunsTab.svelte` ~256: separator → spacing.

### Move 3 — fill-less boxes
- **The seat rows** in `EditSessionForm.svelte` (~2352, ~2456, ~2529, ~2635, ~2737, ~3098; `border-surface-200-800 rounded-base flex min-h-11 … border p-2`): they sit inside `<section class={CARD_CLASS}>` cards (a `100-900` ground) — verify each — → replace `border-surface-200-800` with `bg-surface-50-950` and drop `border`.
- **Leave the dashed ones** (`… border border-dashed` at ~2322, ~2609, ~2804, ~2948): drop zones are never-touch. Leave the dropdown at ~3703 (`absolute z-10 … shadow-lg`): it is a popover.
- `sessionForms/BenchedSeatRow.svelte` ~43, `sessionForms/CharacterPickRow.svelte` ~173: the same seat-row recipe in components; trace their call sites (`grep -rn "<BenchedSeatRow\|<CharacterPickRow" src/lib/client`) and apply move 3 to the parent ground. If a component renders on different grounds at different call sites, keep its edge as `panel-edge border` and report.
- `sessionForms/SessionAnnexPanel.svelte` ~185, ~268; `sessionForms/SpeechSettingsBlock.svelte` ~254: trace parent ground (through call sites) and apply move 3, or keep the edge when the ground differs by call site.
- If any of these rows is interactive with a `hover:border-*` cue, move it to `hover:bg-surface-200-800`.

## Out of scope

Anything not listed. Do not create a shared class for the repeated seat-row recipe — the supervisor reports it.

## Stop and ask when

Any "Stop and report" condition in the common rules. A ★-type question — report, don't decide.

## Done means

Every listed site handled or reported with a reason; `npx prettier --check` on each edited file (if a file already failed at HEAD, say so — check with `git show HEAD:<path> | npx prettier --stdin-filepath <path> --check`; do not reformat it); no vitest run.

## Report path

`plans/REPORT-ui-borders-w3-2026-11-12.md` — and return the same text as your final message.
