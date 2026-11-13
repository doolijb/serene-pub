# Rules shared by every `ui-borders` worker brief (quoted by the supervisor)

Read this file in full, then your own brief `BRIEF-ui-borders-w<n>.md`. Your brief names the only files you may edit.

## Verbatim lines every implementation brief carries

- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (This lane never runs `sdk:build`.)

## Standing rules

- Never `git commit`, push, `git stash`, `git checkout`, `git restore`. Never `prettier --write` on a directory (on a single owned file is fine). Never `kill -9`. Never glob-delete under `/tmp`.
- Client-only: no server file, no migration, no SDK edit.
- **Do not run vitest or `npm run check`.** The supervisor runs the tests one at a time after you finish. You may run `npx prettier --check <file>` on files you edited.
- Never touch `components/panels/PanelSplit.svelte`, `components/Layout.svelte`, `src/routes/+page.svelte`, `settingsTabs/UserSettingsTab.svelte`, `src/app.css`, `STYLE-GUIDE.md`, or any file not in your brief.
- **Line numbers are from a scan on 2026-11-12 and have moved.** Re-read each site (search for the quoted class string) before editing. If a site is not what the brief describes, leave it and say so.
- It is a **session**, never a *chat*. No reference to any other project or product in any file or comment.
- Change only class strings (and remove `<hr>` / separator elements where told). No layout, spacing scale, radius, colour stop or copy change beyond what replacing a line with a gap needs. No new component, utility, shared class or prop.

## The design rules (from STYLE-GUIDE.md, quoted)

§1 rule 4: "**Cards, not separators.** Sections sit in cards. Horizontal rules and `border-t` separators between sections are retired."

§2.3: "**What is it sitting on?** Grounds alternate between `950` and `900`. The sidebar and popovers are `950`; the page is `900`. A card on the sidebar is `900`; an input or card on the page is `950`. Never stack the same stop on itself. Borders are `800` on either ground."

§2.3: "**A pair exists only when its stops sum to 1000** (2026-10-24). `bg-surface-100-800`, `border-surface-200-700`, `border-surface-300-600` render nothing … The grounds are three tiers: ground `surface-100-900` (a card), panel `surface-50-950` (the sidebar, a popover, an inset), raised `surface-200-800` (a chip, a hover, a selected row); the hairline is one, `border-surface-200-800` (`panel-card`, `panel-edge`, `panel-inset` included). `surface-300-700` is kept for what must read stronger than a hairline: a dashed drop zone, a meter's track, a divider dot."

§6.4: "Never write a bare `border` / `border-l` / `border-t`: Tailwind 4's default border colour is `currentColor`, which is how white bars ended up between the Lorebooks panes."

## What changes in this lane (the supervisor does `app.css` itself)

- **`panel-card`** (the shared card utility, `bg-surface-100-900 rounded-container p-4`) **no longer has a border.** Its fill is its edge: it reads because it is one step off the sidebar ground (`50-950`).
- **`panel-inset`** (`bg-surface-50-950 rounded-base border p-3`, a section inside a card) **keeps its border.** Never edit a `panel-inset`.
- **`panel-edge`** is colour only (`border-surface-200-800`), used with `border` for structural lines. Never change the utility; you may remove `panel-edge border` from a box when told.

### Grounds — how to tell what a box sits on

- The sidebar view ground is `bg-surface-50-950`.
- Inside a `panel-card` or a `card preset-filled-surface-100-900` (or a hand-written `bg-surface-100-900` box), the ground is `100-900`.
- Inside a `panel-inset` (or a hand-written `bg-surface-50-950` box), the ground is `50-950`.
- Trace the **immediate** parent that has a fill, up through the file and, if the box is at the top of its component, through the component's call sites (`grep -rn "<ComponentName" src/lib/client`). If a component is rendered in more than one place with different grounds, say so.
- **Width-dependent ground**: the lorebook editors sit inside a `panel-card` at desk width and straight on the sidebar ground at dock width (`lorebooks/CastWorkspace.svelte` ~2103–2124 `memberPage`/`loreEditor`; `lorebooks/time/TimeLens.svelte` ~910–927; `lorebooks/GraphsWorkspace.svelte` ~1894–1907 the `sideColumn`; `lorebooks/EntryWorkspace.svelte` ~2253–2280). Anything rendered inside those editors has a ground that depends on the width, so no fixed fill reads in both.

### The three moves

1. **Hand-written card loses its border.** A filled `bg-surface-100-900` box with `border` on the `50-950` ground, or a `bg-surface-50-950` box with `border` on a `100-900` ground: remove `border` and its colour class (`border-surface-200-800` or `panel-edge`). Keep fill, radius, padding.
2. **Separator becomes spacing.** A `border-t`/`border-b`/`<hr>` between sections or inside a card: remove it (and any padding/margin that only existed to sit off the line, e.g. `pt-3` paired with `border-t`), and keep or add the gap the surrounding stack already uses (or one step more). Never replace a line with another line.
3. **Fill-less box with an outline gets a quiet fill.** A box whose only boundary is `border` (no `bg-*`) takes **the other of the two grounds from its immediate parent** (`bg-surface-50-950` ↔ `bg-surface-100-900`) and loses the border. An inset counts as a `50-950` parent, so a box in an inset is `100-900`. Keep radius and padding. If it is interactive and used a border-colour change as its hover or selected cue (`hover:border-*`), move the cue to the fill: `hover:bg-surface-200-800`; keep any selected ring.

### Exceptions — keep the edge

- **Width-dependent ground** (above): keep the edge, written as `panel-edge border` (replace `border-surface-200-800 border` with `panel-edge border` if it was spelled that way; leave it if already `panel-edge border`). List it in your report.
- **A box whose fill equals its parent ground and no other fill reads**: keep its edge and report.
- **Signal edges** (a `border-primary-*`, `border-error-*`, `border-warning-*`, `border-success-*` colour on a card or box): they must still show. If the colour relied on the card's border width, add an explicit `border` beside the colour.

### Never touch (these borders carry meaning)

Form controls (`input`, `select`, `textarea`, `.input`, `.select`) and their error states; **fieldsets** and radio marks; dashed drop zones, "add" tiles and empty states (`EmptyState.svelte`, `FileDropzone.svelte` and the like); warning, error and success edges; the selected-row marker and selected rings; the tab strip's underline (`panels/PanelTabStrip.svelte`); the list/detail line (`panels/PanelSplit.svelte`, `panels/SectionList.svelte`); pinned footers' `border-t`; menu-group hairlines in popovers; the timeline axis, crop mask, indent and quote bars; outlined service chips and pills (leave all chips and pills; list any you saw); thumbnails' and swatches' frames; table and list **row dividers** (`divide-y`, per-row `border-b`) unless your brief says otherwise. Session widgets, modals, dialogs, popovers and menus are out of scope even inside your files.

## Stop and report (do not improvise) when

- Removing a border would make something unreadable in either theme and no ground step fixes it.
- A signal colour would be lost.
- A change would need a new shared class or prop.
- A site is not what the brief describes, or the parent ground cannot be determined.

## Report shape

Write to the report path in your brief, and return the same text as your final message:

1. Per file: each site changed — old class string → new, and for every fill you chose, **the parent ground and where you found it** (file:line).
2. Every border you kept, and why.
3. Every site in your brief you did not change, and why.
4. Chips and pills you saw and left.
5. Test files that render your touched components (`grep -rln "<ComponentName\|ComponentName.svelte" src --include=*.test.*`), for the supervisor to run.
6. Assumptions; **Noticed, not done**.
