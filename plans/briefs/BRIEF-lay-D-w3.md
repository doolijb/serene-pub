# BRIEF lay-D-w3 — the desktop layout editor on panels v2: canvas, inspector pane, chosen tab

Worker for lane lay-D (supervisor: lay-D). App: /home/jody/github/serene-pub. SDK (read only, built): /home/jody/github/serene-pub-sdk.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal
Owner rulings (2026-11-05, quoted): R1 "Get rid of pin." — in the session AND in the editor. R2 "One type of group, each zone can have groups." R4 "No more pop-up widget settings. Settings are accessed through the layout settings." Plan ★10: **Priority** High · Normal · Low per panel beside Fit / Fill; default from the widget's declaration (Composer High, Turn line Normal, Messages Low, others Normal). Lead decision D12: inline inspector pane (chosen tab → its settings + style; nothing chosen → Backing / Opacity / Widget gap); look edits go through `arrangeOps.setLook` (Undo/Cancel cover them); widget settings still write immediately (unchanged).

The editor now edits **panels v2** (`PanelLayoutV2 = { version: 2, left, middle, right: PanelV2[], backing?, opacity?, gap? }`, `PanelV2 = { key, tabs, open?, height?, priority?, title? }`): three plain stacks. No rail strip, no rail-only narrow side, no Crown / "make main", no primary card, no pin.

## Files owned (edit only these)
- `src/lib/client/sessionLayout/SessionLayoutEditor.svelte`
- `src/lib/client/sessionLayout/ArrangeCanvas.svelte` + `arrangeCanvas.dom.test.svelte.ts`
- `src/lib/client/sessionLayout/editorMembership.svelte.ts` + `editorMembership.dom.test.svelte.ts`
- `src/lib/client/sessionLayout/widgetTray.dom.test.svelte.ts`
- `src/lib/client/sessionLayout/LayoutEditorToolbar.svelte` (hint text + one stale comment only)
- `src/lib/client/surfaces/panelManager.presets.test.ts` lines ≈187-192 only, and only if that test fails because of the editor

NOT yours (another worker, lay-D-w4, is rewriting it right now): `MobileLayoutEditor.svelte`, `mobileEdit.ts`. Don't edit them. Done already, read only: `arrangeOps.ts` (v2 API), `ArrangeInspector.svelte`, `LayoutLookSection.svelte`, `widgetSettingsFlow.svelte.ts` (`askSettingsInArrange`, `settingsInArrangeAsk`), `presetPreview.ts`. Runtime files (sessionLayoutModel, SessionLayout.svelte, SessionLayoutRender, ZoneColumn…) are another lane's: read only.

## The API you build on (already in `arrangeOps.ts` — read it)
`StackPlace = "left"|"middle"|"right"`, `PanelSlot { place; index }`, `TabSlot`, `ArrangeOutcome { layout: PanelLayoutV2 } | { refused }`, `MIDDLE_EMPTY`, `stackOf`, `allPanels`, `placedIds`, `panelOfTab`, `addTab`, `newPanel(layout,id,at,init?)`, `removeTab`, `moveTab`, `splitOut`, `movePanel` (index counts the target stack WITHOUT the panel), `setHeight(layout,key,asked)` (asked equal to the open tab's declared default is stored as absent), `setPriority(layout,key,asked)` (same rule), `setLook(layout, patch)`, `lookOf(layout)`, `declaredPanelOf(id)`, `heightOf(panel)` / `priorityOf(panel)` (EFFECTIVE values: stored, else the open tab's declaration), `setTitle`, `setTabOrder`, `samePanels`. `NOT_A_STACK`, `setPinned`, `setPrimary` no longer exist.

`ArrangeInspector.svelte` props: `{ panels: PanelLayoutV2; chosenId: string | null; label(id); kindLabel(id); look: PanelLook; onLook(patch: Partial<PanelLook>) }` + instance export `escape(): boolean` (blurs a field being typed in, then backs out of the style editor; true when it handled the key). It is a column that fills the box you give it.

## 1. editorMembership.svelte.ts
- Working panels are `PanelLayoutV2`. `ArrangeTarget = { tab: TabSlot } | { panel: PanelSlot }` (no `rail`). `land` → `newPanel(input.panels, id, at.panel)`. Update the header comment (no rail). Everything else unchanged.

## 2. ArrangeCanvas.svelte
Props:
```ts
panels: PanelLayoutV2
edit: (outcome: ArrangeOutcome, opts?: { merge?: boolean }) => boolean
membership: ArrangeMembership
editGeom: SimGeometry
rail: SideRailModel          // still used only for rail.tabIcon(id)
label: (id: string) => string
/** The editor's chosen tab (instance id), or null. */
chosen: string | null
/** Choose a tab (its settings show in the inspector), or clear the choice (null). */
onChoose: (id: string | null) => void
```
- Remove: `NARROW_SIDE_PX` (and its `<script module>` export), `railOnly`, the narrow side width (sides are `editGeom.left/right`; the centre `editGeom.centre`), `pinIn`, `dropOnRail`, the `railStrip` / `arail*` snippet + CSS, the rail-only dock zone (`adock`), the Crown / `amain` / `dropOnMain`, `setPrimary`, the primary card (`acard-primary`) and every above/primary/below branch, the per-card `chosen` record, `openSettings`.
- The MIDDLE is drawn exactly like a side: one stack — gap(place,0), card, gap, card, … — in all three zones; a zone with no panels draws one filling gap ("Drop a widget here", as today's empty side). Drops: tab strip → `addTab`/`moveTab`/merge a dragged panel's tabs (no primary special case); gap → `newPanel`/`splitOut`/`movePanel` (with `indexWithout` as today).
- **Dividers in every zone**: between two ADJACENT panels of any zone whose EFFECTIVE heights (`heightOf`) are both not `"fit"`, the gap is also the divider (drag / ArrowUp / ArrowDown moves a twelfth, `setHeight` with `{ share }`, merged into one undo step while dragging — today's code, generalised from "docked side panels" to every stack). `growOf` / `shareOf` read effective heights.
- **Selection**: a card's tools act on `sel` = `chosen` when it is one of this panel's tabs, else the panel's open tab (`open`, else the first). Clicking a tab's name calls `onChoose(id)`. The tab's gear (keep the button, its `aria-label`/`title` "{label} settings", drop `aria-haspopup`) becomes "choose this tab": `onChoose(sel)`. The globally chosen tab carries `data-chosen` and a stronger treatment (selected card: `ring-2 ring-primary-500 ring-offset-2 ring-offset-surface-50-950`, STYLE-GUIDE §2.4 "Selected card") on its card. Clicking EMPTY canvas — anywhere not inside a card, a button, an input, or a divider — calls `onChoose(null)`.
- **Fit · Fill on every panel** (middle included): pressed state from `heightOf(p)` ("share" shows neither pressed + the `n/12` note, as today); a press calls `setHeight` only when the value differs from what is shown.
- **Priority** beside Fit · Fill on every panel card: a segmented control **High** · **Normal** · **Low** (`role="group" aria-label="Priority"`, buttons with `aria-pressed` + `preset-pressed`-style `on` class like `aseg-btn`, `data-priority-high|normal|low={p.key}`); pressed = `priorityOf(p)` (so a Composer panel with nothing stored shows High); a press calls `edit(setPriority(panels, p.key, v))` only when v differs from what is shown (the op stores the declared default as absent).
- **Hint** under the MIDDLE zone (inside its zone box, at its foot, muted 12px, one line): "When a zone runs out of height, Low gives way first, then Normal. High keeps its height longest."
- Rewrite the header comment for v2 (no rail, no primary, dividers everywhere, Priority, the chosen tab).

## 3. SessionLayoutEditor.svelte
- Working copy is `PanelLayoutV2` everywhere (`snapshot` = `$state.snapshot(model.savedPanels) as PanelLayoutV2`; `opened`, `editPanels`, `previous`; `onWorking: (panels: PanelLayoutV2) => void`).
- Remove the `onPutAway` prop and its calls; remove every `widgetSettingsModal` import/call (`openSettings`, `closeWidgetSettings`) — the module is deleted.
- **The chosen tab lives here**: `let chosen = $state<string | null>(null)`; a chosen id that is no longer placed in `editPanels` reads as null. Cleared by `seedEditor()` and `closeEditor()`.
- **The style overlay's ask**: an `$effect` on `settingsInArrangeAsk().n` (from `./widgetSettingsFlow.svelte`; remember the `n` seen at init, untracked, so an old ask never fires on open): on a new ask → `model.editTab = "arrange"` and `chosen = ask.id`.
- **Inspector pane**: while the desktop canvas is up (`model.placing && !model.mobileEdit` — both the Actual canvas and a simulated desktop tier), draw a right-hand pane `INSPECTOR_PX = 380` wide below the toolbar (`inset-block-start: model.toolbarH`, to the window's bottom and end edge, above the scrim, opaque `bg-surface-50-950`-style ground with a 1px start border) holding `<ArrangeInspector bind:this={inspector} panels={editPanels} chosenId={chosen} label={widgetLabel} kindLabel={kindLabel} look={lookOf(editPanels)} onLook={(patch) => edit(setLook(editPanels, patch))} />`. The canvas (`.edit-shell`) and the simulator stage end at the pane's start edge. Not drawn for the phone row editor (real or simulated).
- `kindLabel(id)` = the widget kind's title: `CORE_WIDGETS.find((w) => w.id === widgetOfInstance(id))?.title ?? manager.decls.find((d) => d.id === widgetOfInstance(id))?.title ?? widgetLabel(id)` (check the decl type has `title`; adapt).
- **Geometry minus the pane**: the canvas must not use `model.editGeom` (it splits the whole window). Compute a local `editGeom = $derived(simulatedGeometry(model.simWidth ?? Math.max(0, model.vw - INSPECTOR_PX), { available: model.simWidth == null ? undefined : model.containerW - 24 - INSPECTOR_PX }))` (from `./simulator`) and use it for the canvas AND the sim frame's `transform: scale(...)` and its "shown at N%" label (local `simPct = Math.round(editGeom.scale * 100)`). Leave the phone-sim frame (row editor in a frame) on `model.editGeom` / `model.simPct` (no pane there).
- **Escape** (desktop canvas only): `<svelte:window onkeydown>` — when `e.key === "Escape"`, not `e.defaultPrevented`, and the canvas is up: if `inspector?.escape()` → `preventDefault()`; else if `chosen` → `chosen = null`, `preventDefault()`. Nothing else changes (Escape never closes the editor here).
- Canvas props: pass `panels={editPanels}`, `editGeom={editGeom}`, `chosen`, `onChoose={(id) => (chosen = id)}`; drop `openSettings`.
- **Phone editor snippet**: lay-D-w4 is adding ONE new prop to `MobileLayoutEditor`: `kindLabel: (id: string) => string`. Pass `{kindLabel}` in the `phoneEditor` snippet; keep every other prop as it is (don't remove `mainWidgetTitle`, `middleWidgetIcon`, `iconOf` etc. — w4 decides inside its file). Until w4 lands, that line may not typecheck; that is expected.
- Update the header comment (inspector pane; chosen tab; no settings window).

## 4. LayoutEditorToolbar.svelte (text only)
- ≈ line 822 `tap a panel's tabs, a gap, or a rail to place` → `tap a panel's tabs or a gap to place`.
- ≈ lines 826-828 → `Drag onto a panel's tabs or between panels · drop a tab here to remove it`.
- The comment ≈ 841-844 about Ultrawide and "side rails branch to 2-column in `DEFAULT_SIDE_RULES`" is stale (the 2-column rung is gone): reword the comment only. Nothing else in this file.

## Tests (vitest + happy-dom; rewrite, don't delete wholesale — keep every still-valid test)
- `arrangeCanvas.dom.test.svelte.ts`: remove the rail-strip / rail-only / primary tests and the `NARROW_SIDE_PX` import; fix the `createSideRailModel` call (it no longer takes `widgetLabel`; read `sideRailModel.svelte.ts`) and the file's other tsc errors (there were 3). Fixtures v2. Add: the middle draws gaps + cards like a side; a divider appears between two fill panels in the MIDDLE and arrow keys write `{ share }`; no divider next to a Fit (Composer) panel; Priority shows High pressed on a Composer panel with nothing stored, a press of Low writes `priority: "low"`, a press of High on it writes nothing; Fit on a Notes panel writes `height: "fit"`, Fill on a Composer writes `height: "fill"`; clicking a tab name / its gear calls `onChoose`; clicking empty canvas calls `onChoose(null)`; moving the middle's only panel to a side says `MIDDLE_EMPTY` on the status line (editor test). The editor's Done tests (mounting `SessionLayoutEditor` with a fake model): adapt to v2 (Done without change writes nothing; refusal on the status line, never a toast; Done after a change writes; Undo). Add editor tests: choosing a tab shows its title in the inspector pane; Escape clears the choice (inspector back to "Layout settings"); a Backing change from the pane is undone by Undo and written on Done (`panels.backing`); `askSettingsInArrange("notes")` switches `model.editTab` to "arrange" and chooses it.
- `editorMembership.dom.test.svelte.ts`, `widgetTray.dom.test.svelte.ts`: v2 fixtures; drop rail cases.
- Also run `startFromPane.dom.test.svelte.ts` (it mounts the editor; it is not yours — if it fails because of your editor change, report the failure and the one-line cause, don't edit it) and `panelManager.presets.test.ts`.

## Rules (quoted from CLAUDE.md / STYLE-GUIDE / the lane's common brief)
- No new user-visible word beyond: Priority, High, Normal, Low, the middle hint sentence above, and the two toolbar strings above. Everything else is existing copy. "session", never "chat".
- STYLE-GUIDE §6.5: "A control that picks one value from a short fixed set is not a tab and may be segmented … The layout editor's **Fit** / **Fill** is one … a `role="group"` of options, the chosen one `preset-pressed` with `aria-pressed`". §9: real buttons with accessible names; "Targets are 44px on touch. A 32px control gets a 44px hit area on coarse pointers."; "Never an interactive inside an interactive."; focus visible. §2.4 Selected card ring (above).
- `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`. Read-then-write inside an effect: wrap the method body in `untrack`. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`. Views never call `toaster` (refusals go on the editor's status line).
- **Every test or typecheck run goes inside a memory-capped scope** (VS Code has been OOM-killed by bare runs), never bare, one group at a time, logging to a file:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run <your test files> > /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-D-w3-t.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-D-w3-t.log'` then grep the log. `tsc` / `npm run check`: same scope with `MemoryMax=12G` and `--max-old-space-size=8192` (`npx tsc --noEmit -p .`; `npm run check`), logs `lay-D-w3-tsc.log` / `lay-D-w3-check.log`; grep for YOUR files only.
- Never pipe vitest into `head` (SIGPIPE leaks PGlite temp dirs). **Never hand a DOM node to an assertion** (`expect(el).toBeNull()` / `toBe(node)` balloon when they fail and have OOM-killed VS Code): compare `expect(el === null).toBe(true)`, assert on strings/booleans/counts only.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build.)
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.
- Don't start a dev server (the supervisor walks it in a browser afterwards).

## Stop and ask (in your report, don't decide)
Any user-visible word not listed above; a change to a file not owned; a new setting.

## Done means
Your test files green (capped); tsc + `npm run check` show no error in your files (except the one `kindLabel` prop line in SessionLayoutEditor if w4 has not landed — say so); `npx prettier --check` on your files. Report (final message): props/exports changed, test commands + pass counts, decisions you made, Noticed-not-done.
