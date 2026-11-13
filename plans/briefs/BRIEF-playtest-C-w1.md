# BRIEF playtest-C-w1 — the model finder becomes the Models view's detail pane (item 20, steps 1–3 and 8)

Supervisor: lane `playtest-C`. Report back in your final message (no report file: the harness refuses
report writes). Work in `/home/jody/github/serene-pub`. Use absolute paths. Client only.

## Goal

Today **Get a model** (`ModelFinderView`) opens as a `<Dialog>` over the Models view
(`src/lib/client/components/sidebars/ModelsSidebar.svelte:184-206, 414-454`). Move it into the view's
existing `PanelSplit` detail pane (`:332-343`, `detail={detailPane}`), beside the list at desk and in
place of the list at compact, like a model's own view.

### 1. `ModelsSidebar.svelte`

- Replace `selected` (`:83-98`) with ONE pane state, a small union (local, unexported type):
  `{ kind: "model"; connectionId: number; modelId: number } | { kind: "finder"; scope: { capability?: string; connectionId?: number } } | null`.
  **No `add-by-name` kind** (Add by name keeps its own dialog; it needs nothing from the union). If
  you need a remount key for the finder, add it as one extra field on the finder kind (a counter) —
  name it in your report.
- Derive what the rest of the file reads from it: the `{connectionId, modelId}` passed to
  `ModelsListView`'s `selected` (null unless the model kind), `selectedRow`, `openManager`'s use of
  `selectedRow`, `detailUseIn`'s `connectionId`. `openModel` sets the model kind (keep its
  `requestSync` and `announce`); `closeModel` becomes closing the pane (`pane = null`).
- `openFinder(opts)` sets `{ kind: "finder", scope: { ...opts } }`. Every door already goes through
  it (the toolbar's `onGetModel`, and the `digest.modelsFinder` effect at `:292-300` that Loadouts'
  **Get a model…** and a runtime's / the ONNX endpoint's **Get more…** set). A door pressed while the
  finder is already open must land its new scope: remount the finder (a `{#key}` on the counter, or
  equivalent) so its hand-set scope/destination overrides reset and focus moves to the heading again.
- `openSetupChat` today does `finderOpen = false`; keep that parity: if the pane is the finder,
  close it, then open the stepper. Set up chat itself is untouched.
- `hasDetail={pane != null}`. In `detailPane`, the model kind renders exactly what it renders now;
  the finder kind renders
  `<ModelFinderView capability={…} connectionId={…} onBack={closePane} onOpenConnection={(id) => openConnections(id)} />`
  — the **Open connection** hand-off no longer closes anything, it just opens the connection.
- Delete the whole `<Dialog>…</Dialog>` block (`:414-454`), `finderOpen`, `finderScope`, and the
  imports that become unused (`Dialog`, `Portal`, `Icons` — check each). `SetupChatFlow` and
  `AddModelByNameDialog` stay where they are, unchanged.
- Rewrite the comments that say the finder is a dialog: the file header `:22-25` ("Mounted here,
  never places: Get a model (`ModelFinderView` in a dialog)…") and the section comment `:184`. Say:
  the detail pane holds a model's view or Get a model (the finder), which every finder door opens;
  Set up chat and Add a model by name are still dialogs mounted here.

### 2. `ModelFinderView.svelte` (src/lib/client/components/connections/)

The pane form is the existing "stands alone" branch: `onBack` given and not `embedded`
(`:1042-1055`). Change only that branch's behaviour; the `embedded` form (Set up chat's Model step,
`SetupChatFlow.svelte:307`) and the bare form (no `onBack`, as `indexRows.ssr.test.ts` renders it)
must render exactly as today.

- Its `PanelNavHeader`: keep `title="Get a model"`, change `backLabel` from "Back to connections"
  (stale: nothing opens it from Connections) to **"Back"**, the same label a model's own view uses
  (`ModelDetailView.svelte:239`). Back at every width, as `ModelDetailView`/`OnnxModelView` do — at
  desk it is how the list gets the whole view back.
- **One scroller under a pinned header.** In the pane form the header stays pinned (`shrink-0`) and
  everything under it — the search box, **For**, **Download to** with its note line, and the results
  — sits in ONE scroller, instead of today's pinned controls + a results-only scroller (`:1243`).
  On a phone the controls would otherwise leave the results a sliver. Embedded/bare keep today's
  structure. No fixed height anywhere (the dialog's `h-[min(90vh,760px)]` lived in
  `ModelsSidebar` and dies with the dialog block).
- **Focus moves to its heading on open** (pane form only). The heading is `PanelNavHeader`'s
  `[data-panel-title]` `h2`; you may NOT edit `PanelNavHeader.svelte`. On mount, find that element
  inside the finder's own root (bind the root element), give it `tabindex="-1"` and `focus()` it.
  Guard for SSR (effects don't run there anyway).
- Update the comments that call it a dialog: the file header `:21-28` ("it opens as the **Get a
  model** dialog of the Models view…") and the `onBack` prop doc `:155-161` ("in the **Get a model**
  dialog the dialog's title is its header"). Say: it is the Models view's detail pane, opened from
  every finder door; standing alone (`onBack`) it draws its own header and one scroller.
- Don't touch the quant picker (`QuantPicker` stays a Dialog), finder.ts, or any copy other than the
  Back label.

### 3. Tests

**`src/lib/client/components/connections/finder.dom.test.svelte.ts`** — keep every existing test
passing; add a `describe("Get a model, a pane of the Models view", …)` that mounts
`ModelsSidebar.svelte` (happy-dom; `ViewModeTracker` answers `compact` until measured, so compact is
the default; mock `$lib/client/shell/viewMode.svelte` to answer `desk` for the desk test). Supply a
reactive `panelsCtx` (`$state({ digest: {}, openPanel: vi.fn() … })` — the file is `.svelte.ts`, so
runes work) plus the contexts the view and `ModelsListView` read; mock what you must. Cases:
1. **Renders in a pane, not a dialog:** press the toolbar's **Get a model** → a heading with text
   "Get a model" is in the document, `document.querySelector('[role="dialog"]') === null`, and
   `document.activeElement` is that heading (compare tag name / text as booleans).
2. **Back returns to the list** (compact): press Back (`aria-label="Back"`) → the finder heading is
   gone and the list's toolbar is back.
3. **Desk:** with the mode mocked to desk, the list's toolbar and the finder are both present.
4. **Get keeps the pane:** with a KoboldCPP connection listed, answer `koboldcpp:recommendedModels`
   with a one-file model (as the existing "single-file row" test does), press its Get → a
   `koboldcpp:downloadModel` was emitted and the finder heading is still present.
5. **Each door opens the pane with the right scope:** set `panelsCtx.digest.modelsFinder` — a
   Loadouts door `{ capability: "text->audio" }` → the **For** radio checked is Speech; a Get more…
   door `{ connectionId: <the KoboldCPP id> }` → the **Download to** radio checked is that
   connection; the toolbar → Chat. Also: the digest slot is cleared after it is consumed.
6. **axe:** run `axe-core` (a dependency, `^4.12.1`; `import axe from "axe-core"`) over the mounted
   view with `color-contrast` disabled (happy-dom has no layout); expect zero violations, asserting
   on the violation ids array, never on nodes. If axe cannot run under happy-dom, say exactly why in
   your report and keep the structural assertions of case 1; don't hack around it.

**`src/lib/client/components/connections/finderViews.ssr.test.ts`** — its `finder()` helper already
passes `onBack`. Add: the pane form renders an `h2` "Get a model" and a "Back" button and no
`role="dialog"`; `embedded` renders no "Get a model" heading. Existing tests keep passing.

## Files owned (edit only these)
- `src/lib/client/components/sidebars/ModelsSidebar.svelte`
- `src/lib/client/components/connections/ModelFinderView.svelte`
- `src/lib/client/components/connections/finder.dom.test.svelte.ts`
- `src/lib/client/components/connections/finderViews.ssr.test.ts`

Readable: anything. Especially `panels/PanelSplit.svelte`, `panels/PanelNavHeader.svelte`,
`connections/ModelsListView.svelte`, `ModelDetailView.svelte`, `OnnxModelView.svelte`,
`SetupChatFlow.svelte`, `contexts/testProvideConnections.ts`, `shell/viewMode.svelte.ts`.

## Out of scope (never build)
Quant picker inline; Add by name as a pane (no `add-by-name` kind); Set up chat moved; a `?get=`
view state; server changes; any new setting, flag, prop or UI string other than the Back label. If
the work seems to need one, stop and say so.

## Rules this work depends on (quoted)
- STYLE-GUIDE §5.2: *"**A scroller never carries padding** (owner ruling 2026-10-11). Padding on the
  scrolling box put the card at its clip edge … The inset is a **margin on the content wrapper
  inside** the scroller"* — today's results scroller has `pb-2`; your one scroller must not carry
  padding (put it on an inner wrapper).
- STYLE-GUIDE §5.2: *"A list-with-detail view uses `PanelSplit`: one pane in the dock, list beside
  detail at desk width."* `PanelSplit` owns the panes' padding; the finder draws none of its own.
- PanelNavHeader `onBack` doc (ruling Q3): pass Back only when the level it returns to is off
  screen. This view's model details already show Back at every width; the finder matches them
  (lane decision, reported).
- STYLE-GUIDE §9: *"Every interactive element is a real `button`, `a` or input with an accessible
  name"*; *"Focus is visible … never removed without a replacement"* — don't add `outline-none` to
  the heading.
- STYLE-GUIDE §10: sentence case, plain words; it is a *session*, never a *chat* (Chat is fine as the
  For pill's existing label).
- NOMENCLATURE R3/§24: no new user-facing name. **Get a model** is the canon name; keep it.
- CLAUDE.md: views never call `toaster`; `socket.off(event)` always with its handler;
  `$state(new Set())`/`Map` is not reactive (use `SvelteSet`/`SvelteMap`); no
  `crypto.randomUUID` or `navigator.clipboard` in browser code.
- Tests: never hand a DOM node to an assertion (a failing assert formats it, and a happy-dom node
  formats to gigabytes — it has OOM-killed VS Code). Compare booleans/strings:
  `expect(x === null).toBe(true)`, never `expect(node).toBe(null)`.

## Done means
Green, run in a capped scope, logged to the scratchpad:
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/components/connections/finder.dom.test.svelte.ts src/lib/client/components/connections/finderViews.ssr.test.ts src/lib/client/components/connections/indexRows.ssr.test.ts src/lib/client/components/connections/setupChatFlow.ssr.test.ts src/lib/client/components/connections/setupChatFlow.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest-C-w1-<n>.log 2>&1; echo exit=$?'
```
(if `systemd-run` is refused, use `timeout 900` with the same NODE_OPTIONS). Never pipe vitest into
`head`. Also `npx prettier --check` on each file you changed (format with `npx prettier --write
<file>` on your files only). No `tsc` over the project, no `npm run check`, no `npm test`.

Report: changed files; each test command with pass/fail counts; every choice you made (the remount
key, how focus is set, the scroller structure); anything you couldn't do; Noticed, not done.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no `sdk:build`.)
- Also never `git checkout`, `git restore` or `git clean` in either repo. Other lanes are editing other files right now; touch nothing outside Files owned.
