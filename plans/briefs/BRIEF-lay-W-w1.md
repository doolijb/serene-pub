# BRIEF lay-W-w1 — Fit panels measure their widget's natural height (2026-11-06)

Lane lay-W (supervisor: lay-W). Worker: lane-worker (Sonnet). App: /home/jody/github/serene-pub.

"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
"Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`."

You do NOT run `sdk:build` at all in this brief.

## Goal

The owner: "Character image widgets don't render properly." Verified in the browser by the supervisor:
the common layout's **Last character** / **Last persona** panels (Scene Portraits, `arrangement: stage`,
height **Fit**) draw as a 30px sliver at 1440x900 (the portrait 11px tall).

**Root cause (verified):** `src/lib/client/sessionLayout/ZoneColumn.svelte` `watchFit().measure()` (≈ lines
140–170) reads the widget root's height with `Math.max(root.scrollHeight, root.getBoundingClientRect().height)`
**while the root is constrained by its row**: the host chain `[data-sp-widget-box]` (class `h-full`) → root
`height: 100%` (widgets.css `scene-portraits.root`), the stage `flex: 1`, the picture `max-height: 100%`. So the
"content" it measures is the row it was already given (circular), and a picture that loads later never changes
the root's size, so nothing re-measures. In the browser, setting the box's inline `height: auto !important`
for the read gave the natural height (360px) and restoring it left the layout as it was.

## Files owned (the only files you may edit)
- `src/lib/client/sessionLayout/ZoneColumn.svelte`
- `src/lib/client/sessionLayout/zoneColumn.dom.test.svelte.ts`

## What to build (ZoneColumn.svelte, `watchFit` only)
1. **Natural measure.** In `measure()`, after finding `root` and the shown box (`node.querySelector(BOX)`),
   read the root's natural height by temporarily un-constraining the **host's box** (never the widget's own root):
   save `box.style.getPropertyValue("height")` and `getPropertyPriority("height")`, set
   `box.style.setProperty("height", "auto", "important")`, read `root.getBoundingClientRect().height`, then restore
   exactly (re-set the saved value + priority, or `removeProperty("height")` when there was none). Use the rect
   only (drop `scrollHeight`): with the box at auto the rect IS the content, and a widget that caps its own root
   (a `max-block-size`) is then honoured.
2. **Empty = nothing inside the padding.** A root whose natural height minus its own computed
   padding-top/bottom and border-top/bottom-width is ≤ 0.5 counts as drawing nothing → `setWant(key, 0)` (the
   existing `isEmpty` path; R10 "an empty widget draws nothing"). Today only a 0-high root counts, so a root
   with padding and no children draws a blank card.
3. **Late pictures.** Listen for `load` and `error` on `node` in the **capture** phase
   (`node.addEventListener("load", onLoad, true)`; they don't bubble) and re-measure; remove both in `destroy()`.
4. **Text changes.** Add `characterData: true` to the MutationObserver options. Do **not** add `attributes`:
   step 1 writes a `style` attribute and an attribute observer would loop.
5. Keep everything else (strip + `edgePx`, `FIT_FLOOR_PX` when there is no box, `setWant` semantics, the
   `.zone-cell.empty` CSS) as it is. Update the component's doc comment where it describes the measure (one or
   two sentences; it currently says "measured with a ResizeObserver on the active widget's root").

## Tests (zoneColumn.dom.test.svelte.ts)
happy-dom has no layout: the file stubs `scrollHeight` from `data-h`. Since the measure now reads
`getBoundingClientRect().height`, stub that from `data-h` too (keep the existing tests passing; adjust the stub,
not the assertions). Add:
- after a measure, the box's inline `height` is back to what it was (`""` when none) — compare strings;
- a root with only padding (inline `style="padding:8px"`, `data-h="16"`) and no content counts as empty (its cell
  gets `.empty` → assert `cell.classList.contains("empty") === true`);
- a `load` event dispatched on an `<img>` inside the root (change the root's `data-h` first, then
  `img.dispatchEvent(new Event("load"))`, then flush) changes the column's `grid-template-rows` string.
**Never hand a DOM node to an assertion** — compare `x === null` to `true`, compare strings/numbers/booleans only
(a failing assertion on a happy-dom node has OOM-killed VS Code).

## How to run (every run inside the memory-capped scope, never bare; one group at a time; log to a file)
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run src/lib/client/sessionLayout/zoneColumn.dom.test.svelte.ts src/lib/client/sessionLayout/zoneHeights.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-W-w1-t.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-W-w1-t.log'
```
then `grep -E "Test Files|Tests|FAIL|✗|×|test-exit" <log>`. Never pipe vitest into `head`.
Typecheck (own scope, 12G): `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; cd /home/jody/github/serene-pub && timeout 1200 npx tsc --noEmit -p . > <scratch>/lay-W-w1-tsc.log 2>&1; echo exit=$? >> <scratch>/lay-W-w1-tsc.log'` then grep the log for `ZoneColumn|zoneColumn` (other lanes' errors are not yours). `npx prettier --check` on both files.

## Rules that apply (quoted)
- CLAUDE.md: "`socket.off(event)` with no handler removes every listener app-wide" (n/a here); "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- PLAN D10: "Host measures Fit content with a ResizeObserver on the widget root (Composer root must not be `block-size:100%`)."
- R10 (owner): "an empty widget draws nothing".
- Every panel is one cell, always mounted (the no-reload law) — never unmount or re-key a cell.

## Out of scope
zoneHeights.ts (`allocateZone`, floors), widgets.css, any SDK file, PanelTabs, the editor. No new exported name.

## Stop and ask when
a new exported name, setting or attribute seems needed; the measure can't be done without touching the widget's own
root; anything outside the two files.

## Done means
The targeted tests above green in a capped run; tsc clean for ZoneColumn; prettier clean. Report: what changed (by
function), test results (counts), anything noticed and not done.
