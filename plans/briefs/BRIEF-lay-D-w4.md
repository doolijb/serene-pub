# BRIEF lay-D-w4 — the phone layout editor on panels v2: three sections, Priority, pushed settings

Worker for lane lay-D (supervisor: lay-D). App: /home/jody/github/serene-pub. SDK (read only, built): /home/jody/github/serene-pub-sdk.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal
Owner rulings (2026-11-05, quoted): R1 "Get rid of pin." — in the session AND in the editor. R4 "No more pop-up widget settings. Settings are accessed through the layout settings." Lead decision D12: "Phone editor: three sections; settings as a pushed screen; 'Layout settings' in the bottom bar." Plan ★10: **Priority** High · Normal · Low per panel beside Fit / Fill.

The phone editor (`MobileLayoutEditor.svelte`) now edits **panels v2** (`PanelLayoutV2 = { version: 2, left, middle, right: PanelV2[], backing?, opacity?, gap? }`): three plain stacks — no Above/Below, no primary, no Docked / In the rail groups, no Make main.

## Files owned (edit only this)
- `src/lib/client/sessionLayout/MobileLayoutEditor.svelte`

NOT yours (lay-D-w3 is editing it right now): `SessionLayoutEditor.svelte` — w3 will pass ONE new prop to you: `kindLabel: (id: string) => string`. Add it to your Props (required). Every other prop stays as SessionLayoutEditor passes it today (you may stop USING one — e.g. `mainWidgetTitle` is still needed for the Start from scratch question — but don't remove a prop from Props). Done already, read only: `mobileEdit.ts` (v2), `arrangeOps.ts` (v2: `setLook`, `lookOf`, `samePanels`…), `ArrangeInspector.svelte`, `LayoutLookSection.svelte`.

## The API you build on (read the files)
- `mobileEdit.ts`: `PHONE_SECTIONS` (Left · Middle · Right), `phoneSections(layout): PhoneSection[]` with `PhoneSection = { place: StackPlace; label; rows: PhoneRow[]; add: AddTarget }`, `PhoneRow = { key; place; tabs; title?; height: "fit"|"fill" (effective); priority: PanelPriority (effective); canMoveUp; canMoveDown; aboveKey; belowKey }`, `moveRow`, `moveRowTo` (within the zone), `moveTabWithin`, `moveTabInto`, `canSplitOut`, `splitTab`, `mintFor`, `addAt`, `duplicateTab`, `removeTabFrom`, `setRowHeight(layout,key,"fit"|"fill")`, `setRowPriority(layout,key,p)`. GONE: `SideGroup`, `SIDE_GROUPS`, `groups`, `canMakeMain`, `makeMain`.
- `ArrangeInspector.svelte` props `{ panels: PanelLayoutV2; chosenId: string | null; label(id); kindLabel(id); look: PanelLook; onLook(patch: Partial<PanelLook>) }` + instance export `escape(): boolean` (blurs a field being typed in, then backs out of the style editor; true when it handled the key). `chosenId` null → titled "Layout settings" with Backing / Opacity / Widget gap. It is a column that fills whatever box you give it.
- `./widgetSettingsModal.svelte` is DELETED: remove its import and the `openWidgetSettings` call.

## Build
1. Types: `editPanels` / `openedPanels` / `opened` / `cur()` are `PanelLayoutV2`. The fallback default document (≈ line 84) becomes `{ version: 2, left: [], middle: [{ key: "p1", tabs: ["messages"] }], right: [] }`.
2. **Sections Left · Middle · Right** from `phoneSections`. Remove the side groups (group heads, "Nothing docked." / "Nothing in the rail.", `data-side-group*`), the Make main button, and every `above/primary/below` reference (the drag handle's `columnIndex` now counts within the row's own zone). Each section's **Add** lands a new panel at the end of that zone (`section.add`). Keep the per-row plus (adds a tab to that panel).
3. **Each row**: up / down (within its zone), **Fit · Fill** (the existing chip, on EVERY row now — no primary, no rail rows; it reads `row.height`, which is effective), and **Priority**: a segmented **High** · **Normal** · **Low** (`role="group" aria-label="Priority"`, `aria-pressed` + the pressed treatment, `data-priority-high|normal|low={row.key}`), pressed = `row.priority`; a press of a different value applies `setRowPriority(cur(), row.key, v)`; a press of the shown value does nothing.
4. **Pushed settings screen**: each tab item's gear (keep its accessible name, "{label} settings"; drop `aria-haspopup="dialog"`) PUSHES a full-height screen inside the editor (over the row list, inside the editor's own fixed box, NOT a Dialog/Portal): a header with a **Back** button (`Icons.ChevronLeft` + the word Back) and then `<ArrangeInspector bind:this={inspector} panels={editPanels} chosenId={id} label={widgetLabel} {kindLabel} look={lookOf(editPanels)} onLook={(patch) => apply(setLook(cur(), patch))} />` filling the rest and scrolling inside itself. State: `let pushed = $state<{ id: string | null; from: HTMLElement | null } | null>(null)` (id null = Layout settings). On push, focus the Back button; on Back, `pushed = null` and focus returns to `from` when it is still connected. While a screen is pushed the sticky bottom bar stays hidden or inert (choose one; say which), and the row list is `inert`.
5. **Bottom bar**: add a **Layout settings** button beside **Layouts** and the reset chip (`Icons.SlidersHorizontal`, same chip style as Layouts; label visible) that pushes the screen with `id: null`. Keep Cancel / Done.
6. **Escape**: extend the existing document keydown effect so it also runs while a screen is pushed: with a screen pushed (and no confirm dialog open — reuse the existing guards), Escape first asks `inspector?.escape()`; if that answers false, it goes Back. A sheet over the pushed screen does not happen (the bar is hidden/inert), so order is: dialog → pushed screen → picker sheet → layouts sheet.
7. Rewrite the file's header comment and the template comments for v2 (three sections; no groups; no Make main; settings pushed inside the editor; Layout settings in the bar).

## Copy
No new user-visible word beyond: Priority, High, Normal, Low, Back, Layout settings (all quoted by the lane brief). Remove the now-dead copy (Above, Below, Docked, In the rail, Nothing docked., Nothing in the rail., Make main).

## Rules (quoted from CLAUDE.md / STYLE-GUIDE / the lane's common brief)
- STYLE-GUIDE §6.5: "A control that picks one value from a short fixed set is not a tab and may be segmented … a `role="group"` of options, the chosen one `preset-pressed` with `aria-pressed`". §9: "Targets are 44px on touch."; every interactive element a real button with an accessible name; "Never an interactive inside an interactive."; focus visible; `Esc` closes what is open. §6.6: "when a yes removes the control it was asked from, focus goes to the nearest control that brings it back, never the page". Phone: keep `env(safe-area-inset-bottom)` padding on anything fixed to the bottom.
- `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`. Browser code: no `crypto.randomUUID`, no `navigator.clipboard` (the phone runs on plain-http LAN addresses). Views never call `toaster`. "session", never "chat".
- **Every test or typecheck run goes inside a memory-capped scope** (VS Code has been OOM-killed by bare runs), never bare, one group at a time, logging to a file:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run <test files> > /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-D-w4-t.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-D-w4-t.log'` then grep the log. `tsc` / `npm run check`: same scope with `MemoryMax=12G` and `--max-old-space-size=8192` (`npx tsc --noEmit -p .`; `npm run check`), logs `lay-D-w4-tsc.log` / `lay-D-w4-check.log`; grep for YOUR file only (SessionLayoutEditor/ArrangeCanvas may still be mid-edit by w3).
- Never pipe vitest into `head` (SIGPIPE leaks PGlite temp dirs). **Never hand a DOM node to an assertion** (`expect(el).toBeNull()` / `toBe(node)` balloon when they fail and have OOM-killed VS Code): compare `expect(el === null).toBe(true)`, assert on strings/booleans/counts only.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build.)
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.
- Don't start a dev server (the supervisor walks it in a browser afterwards).

## Tests
There is no dom test for this component today and none is required (the supervisor walks it in a browser). Run `mobileEdit.test.ts` (must stay green — you don't edit it) and make `npm run check` clean for `MobileLayoutEditor.svelte`.

## Stop and ask (in your report, don't decide)
Any user-visible word not listed above; a change to another file; a new setting.

## Done means
`npm run check` and `tsc` show no error in `MobileLayoutEditor.svelte`; `npx prettier --check` on it; mobileEdit.test green. Report (final message): props added/changed, decisions (bar hidden vs inert, focus), test/check commands + results, Noticed-not-done.
