# BRIEF lay-D-w2 — the inspector, the layout's look section, and no settings window

Worker for lane lay-D (supervisor: lay-D). App: /home/jody/github/serene-pub. SDK (read only, built): /home/jody/github/serene-pub-sdk.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal
Owner rulings (2026-11-05, quoted): R4 "No more pop-up widget settings. Settings are accessed through the layout settings." R7 "Card/backdrop preset and opacity can be set from the layout settings." R9 "Another layout level setting, widget gap … Narrow, comfortable, spacious, or something along those lines." Lead decision D12: the layout editor gets an inline **inspector** pane: a chosen tab → `WidgetSettingsPanel` + `WidgetStyleSection`; nothing chosen → Backing / Opacity / Widget gap. You build the two new components and remove the settings window. Another worker (later) mounts the inspector in the editor and the canvas; you only build and test them.

## Files owned (edit only these)
- NEW `src/lib/client/sessionLayout/ArrangeInspector.svelte` + `arrangeInspector.dom.test.svelte.ts`
- NEW `src/lib/client/sessionLayout/LayoutLookSection.svelte` + `layoutLookSection.dom.test.svelte.ts`
- DELETE `WidgetSettingsModal.svelte`, `widgetSettingsModal.svelte.ts`, `widgetSettingsModal.dom.test.ts` (use `rm`; if the permission system refuses a deletion, do NOT route around it — leave the file and list it in your report)
- `WidgetStyleOverlay.svelte`, `widgetSettingsFlow.svelte.ts`
- `widgetSettingsPanel.dom.test.ts` (fix the three failing tests: they assert the retired `#sf-hostCard` / Messages `backingMode`; both were retired by ★8 — per-widget Card and Messages' Auto/On/Off are gone. Rewrite those expectations to the current panel; read `WidgetSettingsPanel.svelte` + `$lib/shared/widgets/settings.ts` (`CORE_SETTING_KEYS = ["title","lane"]`) for what it draws now)
- `SessionLayout.svelte` — ONLY these hunks: remove the `WidgetSettingsModal` import (with its 3-line comment, ≈ lines 54-57) and the `<WidgetSettingsModal />` mount (+ its comment, ≈ lines 367-368); remove the `onPutAway={(zoneId) => render?.putAway(zoneId)}` prop line (≈ 350). Leave `render` / `bind:this={render}` alone. Re-read the file immediately before editing; minimal hunks; never rewrite it.
- `SessionLayoutRender.svelte` — ONLY the `putAway` hunk (≈ lines 139-144: the comment + `export function putAway(_zoneId?: string) {}`): delete it.
- `WidgetSettingsPanel.svelte` / `WidgetStyleSection.svelte` only if the inspector truly needs a prop (say why in the report).

Do NOT touch `SessionLayoutEditor.svelte`, `MobileLayoutEditor.svelte`, `ArrangeCanvas.svelte` (they still import `./widgetSettingsModal.svelte` — they will fail to compile after your deletion; another worker rewires them. That is expected).

Readable: `WidgetSettingsModal.svelte` (read it BEFORE deleting: its arm/disarm effect and its Escape handling move into the inspector), `WidgetSettingsPanel.svelte`, `WidgetStyleSection.svelte` (`cancelEditor(): boolean`, `bind:editing`), `$lib/client/stores/widgetStyles.svelte` (`widgetStylesStore().arm/disarm`), `sessionZones.svelte.ts` (`ZONE_LABELS`, `ZoneId`), `panelBacking.ts` (`hostWidgetBox(look)`, `widgetBoxStyle`), `livePanels.ts`, SDK types `PanelLayoutV2`, `PanelLook`, `PanelBacking`, `PanelGap`, `DEFAULT_PANEL_LOOK` (`/home/jody/github/serene-pub-sdk/sdk/dist/sessionLayout.d.ts:430-500`). Pattern for dom tests: `panelTabs.dom.test.svelte.ts`, `zoneSwitch.dom.test.svelte.ts`, `widgetStyleSection.dom.test.ts`.

## 1. LayoutLookSection.svelte
```ts
interface Props {
  /** The layout's look, effective (defaults filled). */
  look: PanelLook
  /** One change to the look; the editor turns it into an undoable edit. */
  onChange: (patch: Partial<PanelLook>) => void
}
```
Three controls, each with exactly this copy (no other user-visible words):
- **Backing** — three swatch radios **Card** · **Glass** · **None** (`role="radiogroup"` labelled Backing, real `<input type="radio">`s with visible labels; each option shows a small swatch drawn with `widgetBoxStyle(hostWidgetBox({ backing, opacity: look.opacity, gap: look.gap }))` or equivalent so Card/Glass/None look like the theme's). One sentence under it: "What every panel sits on. How a card and glass look comes from your theme."
- **Opacity** — `<input type="range" min="0" max="100" step="1">` labelled Opacity, showing the value as `N%`; write `onChange({ opacity })` on `change` (not every `input`; show the dragged value locally meanwhile). Sentence: "Lower lets your background show through."
- **Widget gap** — a segmented control **Tight** · **Comfortable** · **Spacious**. Sentence: "The space between panels and around the zones."
- A small **For style authors** note (heading text exactly that) listing `--sp-widget-margin`, `--sp-widget-background`, `--sp-widget-radius`, `--sp-widget-border` as `<code>`. No other sentence.
Values: backing `card|glass|none`, gap `tight|comfortable|spacious` (SDK `PanelBacking`, `PanelGap`).

## 2. ArrangeInspector.svelte
```ts
interface Props {
  /** The editor's working panels (for where the chosen tab sits). */
  panels: PanelLayoutV2
  /** The chosen tab's instance id, or null: the layout's own look. */
  chosenId: string | null
  /** A placed id's name on screen (the instance's title). */
  label: (id: string) => string
  /** A placed id's WIDGET name (the kind's title, e.g. "Messages" for "messages#journal"). */
  kindLabel: (id: string) => string
  /** The layout's look, effective. */
  look: PanelLook
  onLook: (patch: Partial<PanelLook>) => void
}
/** Escape, asked by the editor first: blur a field being typed in (so its `change` writes), then back out of the style editor. Answers true when it handled the key (the style editor was open). */
export function escape(): boolean
```
- Chosen tab: a header — the title `label(chosenId)` and under it one muted line "‹Widget› · ‹Zone›, ‹nth› panel" (e.g. `Messages · Middle, 2nd panel`): Widget = `kindLabel(id)`, Zone = `ZONE_LABELS[zone]` for the zone holding the tab, nth = 1-based index of its panel in that zone as an English ordinal (1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd…; write a small helper with a test). Then, in a `{#key chosenId}`: `WidgetSettingsPanel widgetId={chosenId}` (hidden while the style editor is open, as the modal did) and `WidgetStyleSection bind:this bind:editing widgetId={chosenId} label={label(chosenId)} mount="remote"` UNCHANGED.
- Move in from the modal, verbatim in behaviour: the chosen widget is ARMED while chosen (`untrack(() => styles.arm(id))`, disarmed + `editing = false` in the effect's teardown — read the modal's comment on why it is untracked); `escape()` = the modal's `onEscapeKeyDown` body (blur an active input/textarea/select; then `section?.cancelEditor()`), returning whether cancelEditor handled it.
- Nothing chosen (or the id is not placed in `panels`): a header titled **Layout settings**, then `<LayoutLookSection {look} onChange={onLook} />`.
- Container-agnostic: the component is a column (header, then a body that scrolls: `min-block-size: 0; overflow-y: auto`) that fills whatever box the editor gives it (a ~380px side pane on desktop; a pushed full-screen page on the phone). No fixed width, no backdrop, no Dialog, no Portal.
- Tokens/patterns: STYLE-GUIDE §6.5 — "A control that picks one value from a short fixed set is not a tab and may be segmented … The layout editor's **Fit** / **Fill** is one … a `role="group"` of options, the chosen one `preset-pressed` with `aria-pressed`, and one consequence line under it in a polite live region." §2.4 "Active toggle or chip | `preset-pressed`". §9: every interactive element is a real button/input with an accessible name; "Targets are 44px on touch. A 32px control gets a 44px hit area on coarse pointers."; focus visible. §10: sentence case; "Help is one sentence." Headings at the dialog-header scale the modal used (`1.125rem` semibold title; muted 14px line).

## 3. No settings window
- Delete the three modal files (above). `widgetSettingsTitle(label)` (used by WidgetStyleOverlay) moves into `widgetSettingsFlow.svelte.ts` as an export with the same name and behaviour.
- `widgetSettingsFlow.svelte.ts`: add a MODULE-level bridge (the overlay is mounted deep inside WidgetHost and has no props path to the editor):
  ```ts
  /** The style overlay's Settings asked for this tab: the editor switches to Arrange with it chosen. */
  export function askSettingsInArrange(instanceId: string): void
  /** Reactive: the last ask (`n` bumps on every ask, so asking for the same tab twice still lands). */
  export function settingsInArrangeAsk(): { readonly id: string | null; readonly n: number }
  ```
  (module `$state`, like the other module bridges in this dir). Update the style-mode comment there (no "settings modal"; the phone's rows open settings as a pushed screen inside the editor).
- `WidgetStyleOverlay.svelte`: its **Settings** button calls `askSettingsInArrange(widgetId)` instead of opening the modal; drop `aria-haspopup="dialog"`; keep its labels (`Open {widgetSettingsTitle(label)}` etc.); rewrite the header comment (no modal; Settings switches to Arrange with that tab chosen, where the inspector shows it).

## Tests (vitest + happy-dom)
- `layoutLookSection.dom.test.svelte.ts`: the three radios reflect `look.backing` and a pick calls `onChange({ backing })`; the range shows `N%` and calls `onChange({ opacity })` on change; the segmented gap has aria-pressed on the current value and a press calls `onChange({ gap })`; the four `--sp-widget-*` names are listed; the three sentences present.
- `arrangeInspector.dom.test.svelte.ts`: nothing chosen → "Layout settings" + the look section; a chosen tab → its title and the "Messages · Middle, 2nd panel" line (build a v2 panels fixture), and the settings panel mounts (`[data-widget-settings]` or whatever the panel's root marker is — read it); a chosen id not in `panels` → the look section; the ordinal helper (1st…4th, 11th–13th, 21st–23rd, 101st, 111th); arm on choose / disarm on clear (spy on the store's `arm`/`disarm` or observe `widgetStylesStore().armed`).
- `widgetSettingsPanel.dom.test.ts`: green.
- Also run `widgetStyleSection.dom.test.ts` (must stay green).

## Rules (quoted from CLAUDE.md / the lane's common brief)
- No new user-visible word beyond the copy quoted in this brief. "session", never "chat".
- `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`. `socket.off(event)` always with its handler. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Sockets/toasts: views never call `toaster`.
- **Every test or typecheck run goes inside a memory-capped scope** (VS Code has been OOM-killed by bare runs), never bare, one group at a time, logging to a file:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run <your test files> > /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-D-w2-t.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-D-w2-t.log'` then grep the log. `tsc` / `npm run check`: the same scope with `MemoryMax=12G` and `--max-old-space-size=8192` (`npx tsc --noEmit -p .`; `npm run check`), logs `lay-D-w2-tsc.log` / `lay-D-w2-check.log`, then grep for YOUR files only (other files have known errors owned by other workers).
- Never pipe vitest into `head` (SIGPIPE leaks PGlite temp dirs). **Never hand a DOM node to an assertion** (`expect(el).toBeNull()` / `toBe(node)` balloon when they fail and have OOM-killed VS Code): compare `expect(el === null).toBe(true)`, assert on strings/booleans/counts only.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build — the SDK is built.)
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.

## Stop and ask (in your report, don't decide)
Any user-visible word not quoted here; a change to a file not owned; a setting that would need its own storage.

## Done means
The four test files green (capped); tsc + `npm run check` show no error in your files; `npx prettier --check` on them. Report (final message): exported names + props, files created/deleted (and any deletion refused), test commands + pass counts, Noticed-not-done.
