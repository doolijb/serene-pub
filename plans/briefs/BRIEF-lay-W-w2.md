# BRIEF lay-W-w2 — widget CSS: Scenario, "Writing to", sheet faces, the hand cursor (2026-11-06)

Lane lay-W (supervisor: lay-W). Worker: lane-worker (Sonnet). App: /home/jody/github/serene-pub.

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."

You do NOT run `sdk:build`. Do not touch any SDK file.

## Goal — three owner-reported visual bugs, causes verified in the browser by the supervisor

The owner (2026-11-06): "Scenario widget is missing styling. Cursor behavior (i.e. pointer) not working correctly."
Plus a sibling of the first: the Composer's *Writing to ‹channel›* line has no rule either.

## Files owned (the only files you may edit)
- `src/lib/client/styles/widgets.css`
- `src/lib/client/sessionLayout/PanelTabs.svelte` (its `<style>` only)
- NEW `src/lib/client/styles/widgets.parts.test.ts`

## Background rules (quoted — your CSS must follow them)
- widgets.css header: every rule sits in `@layer sp-widgets`, ordered LAST among the layers: "it still beats the
  utilities in a widget's markup … anything UNLAYERED beats it whatever its specificity: a style preset row or a
  person's own style … always wins over the default." Keep every new rule inside the existing `@layer sp-widgets { … }`.
- STYLE-GUIDE §6.16: "A session widget's markup carries **no look** … Its elements carry **widget parts** … selected
  with `~=`: `[data-widget-part~="stats.card"]`." Style by part, never by class or tag alone.
- STYLE-GUIDE §9: "Targets are 44px on touch." "Nothing is hover-only." "Focus is visible … never removed without a
  replacement of equal contrast."
- No new part names, no new tokens, no new custom properties. Use the existing tokens (`--spacing`, `--text-scaling`,
  `--color-*`, `--sp-w-*`).

## 1. Scenario (Author's note widget) — §authors-note, widgets.css ≈ 6379–6523
Markup (SDK `core-catalog/components/genres/story/authors-note/AuthorsNoteWidget.svelte`, read-only for you): the
root holds `<section data-widget-part="authors-note.scenario">` (its alert, note, `authors-note.field` label with a
`<textarea data-widget-part="authors-note.scenario-text">`, then the same `authors-note.actions` / `.unsaved` /
`.discard` / `.save` the note uses) before the note's own fields. **No rule names `authors-note.scenario` or
`authors-note.scenario-text`** (grep: 0) — so the textarea draws as the browser's white default and the section's
children have no gap. Fix, "one look for both sections":
- `authors-note.scenario`: the same column as the root — `display:flex; flex-direction:column; gap: calc(var(--spacing) * 3);` (no padding: the root pads).
- `authors-note.scenario-text`: join EVERY selector list that styles `authors-note.text` — the shared `.text, .number`
  block, the `.text`-only block (resize / min-height), `:focus`, `:disabled`. Append `[data-widget-part~="authors-note.scenario-text"]` (and its `:focus` / `:disabled` forms) to those lists; don't duplicate declarations.
- Update the section's header comment Parts list to name `.scenario · .scenario-text`.

## 2. *Writing to ‹channel›* — the Composer's `composer.writing-to` (`<p role="status">`, above the compose area)
No rule exists; it draws at the browser's 16px with default margins. Add one rule next to the
`composer.root` / `turn-line.root` rule (widgets.css ≈ 195–205): a quiet status line —
`margin: 0 0 0.375rem; padding-inline: 0.5rem; font-size: calc(0.75rem * var(--text-scaling)); line-height: calc(calc(1 / 0.75) * var(--text-scaling)); color: light-dark(var(--color-surface-600), var(--color-surface-400));`
(the type and colour `authors-note.note` / `.help` use; the margin of `messages.rewind-replace`).

## 3. The Characters sheet's faces crop the head (§state-widgets ≈ 5354–5375)
`stats.face-img` / `stats.faces-img` are `object-fit: cover` with the default centre position, so a 2:3 portrait
cropped to the round face loses the top of the head (the Characters sheet draws it at 12rem). Add
`object-position: top;` to that base rule only (Scene Portraits' faces already anchor top — widgets.css
`scene-portraits.face-img`). Nothing else changes about the faces.

## 4. The hand cursor on widget controls
Verified: every `button` in a widget that has no part rule saying otherwise shows the arrow (Tailwind 4 / Skeleton 5
give buttons `cursor: default`; widgets.css names `cursor: pointer` on only ~9 parts) — the Composer's attach,
preview, ⋯ and Actions toggle, Stats' chips and trail button, the Turn line's retry, Scene Portraits' faces menu… while
the message rows' buttons show the hand. One rule, right after the `:root { … }` widget-token block and before
§conversation, with a short comment (what and why: "Whatever a widget offers to press shows the hand; a part rule
that says otherwise wins (zero specificity)"):
```css
:where(
	:is([data-sp-widget-box], [data-widget-part])
		:is(button, [role="button"], [role="tab"], [role="option"], [role="menuitem"],
			[role="menuitemradio"], [role="menuitemcheckbox"], summary, select,
			input[type="checkbox"], input[type="radio"], label:has(> input[type="checkbox"]),
			label:has(> input[type="radio"]))
		:not(:disabled, [aria-disabled="true"])
) {
	cursor: pointer;
}
```
(Format it the way prettier formats this file.) It must stay zero-specificity (the whole selector inside `:where`), so
every existing part rule with `cursor: not-allowed / default / grab / zoom-in` keeps winning.

Then `PanelTabs.svelte` `<style>`: add `cursor: pointer;` to the existing `.wtab { … }` rule (the session panel's tab
buttons, ≈ line 173). Nothing else in that file.

## Tests — NEW `src/lib/client/styles/widgets.parts.test.ts` (vitest; pure string parsing, no DOM)
Copy the `leafRules()` helper pattern from `src/lib/client/styles/widgets.fill.test.ts` (read the CSS file, strip
comments, list innermost rules). Assert:
- some leaf rule whose selector names `authors-note.scenario-text` sets `box-shadow` and `background-color`, and the
  rule that names `authors-note.text` with `resize` also names `authors-note.scenario-text`;
- a leaf rule naming `authors-note.scenario` (exact token, not `-text`) sets `display: flex` and `gap`;
- a leaf rule naming `composer.writing-to` sets `font-size`;
- the cursor rule: a leaf rule whose selector starts with `:where(` and contains `button` and `:not(:disabled` sets
  `cursor: pointer`;
- the `stats.face-img` base rule sets `object-position: top`.
Assert only strings/booleans.

## How to run (inside the memory-capped scope, never bare; log to a file)
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run src/lib/client/styles/widgets.parts.test.ts src/lib/client/styles/widgets.fill.test.ts src/lib/client/styles/widgets.narrow.test.ts src/lib/client/sessionLayout/panelTabs.dom.test.svelte.ts > /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-W-w2-t.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-W-w2-t.log'
```
then `grep -E "Test Files|Tests|FAIL|×|test-exit" <log>`. Never pipe vitest into `head`. Never hand a DOM node to an
assertion. `npx prettier --check` on the three files (report pre-existing drift in widgets.css rather than reformatting
the whole file — only your hunks should change).

## Out of scope
Any other widget's look, the Author's note's `advanced` / `role` parts, the app shell's buttons (header, nav rail,
zone switch), the layout editor, SDK markup.

## Stop and ask when
a new part, token or custom property seems needed; a rule outside the four listed areas seems needed.

## Done means
Tests above green in a capped run; prettier clean on your hunks. Report: each change with its widgets.css line range,
test counts, anything noticed and not done.
