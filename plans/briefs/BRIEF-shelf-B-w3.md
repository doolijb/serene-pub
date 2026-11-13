# BRIEF shelf-B-w3 — Get a model: the sentence line

You are a `lane-worker` in lane `shelf-B` (supervisor: the shelf-B lane-supervisor). Report back to your supervisor in your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

In the model finder (`ModelFinderView.svelte`), the **For** pill row, the **Download to** pill row and the landing line (`{note} · {tier} tier · Change`) collapse into **one sentence of menus**:

> **[Chat]** models for **[KoboldCPP]** · sized for **[8 GB]**

Each bracket is a trigger that opens a popover of `role="radio"` rows. Only the presentation changes; every rule in `finder.ts` stays.

## Files owned (the only files you may edit)

- `src/lib/client/components/connections/ModelFinderView.svelte` — **only** the top of `finderBody` (the For row, the Download to row, the landing/tier line and the tier-reason line, today :1124-1300) and the script state they need. Do not touch the results markup, the row snippets, the download functions or the socket wiring: another worker edits those next.
- `src/lib/client/components/connections/finderViews.ssr.test.ts`
- `src/lib/client/components/connections/finder.dom.test.svelte.ts`

## Files readable

Everything. Start with `ModelFinderView.svelte` :1-80 (header), :200-270 (scope, tier, destinations, `scopeOptions`, `destination`), :1010-1060 (`note`, `kcppNotReady`, `pane`), :1083-1300 (header, pills, landing line, the existing tier `Popover` — the pattern to copy). `finder.ts` `FINDER_SCOPES`, `destinationsFor`, `pickDestination`, `landingNote`. `memoryTier.ts` `MEMORY_TIERS`, `tierLabel`. The Skeleton popover reference: `grep -n "^# Popover" AI-TEMP/skeleton-llms-svelte.txt`, then `sed -n` that section only. `docs/connections.md` :63-90 (Get a model, as it reads today).

## What to build

1. **One sentence line**, `text-sm`, wrapping (`flex flex-wrap items-center gap-x-1 gap-y-1.5`, `min-w-0`), in this order:
   - the **scope part** → the word ` models for ` → the **destination part** → ` · ` (`aria-hidden`) → the words `sized for ` → the **tier part**.
   - No destination at all (`destinations.length === 0`): the sentence is just **[scope part]** ` models`, and the existing "Nothing here can hold …" card stays under it, unchanged, with its Add buttons.
   - The destination is ONNX: drop ` · sized for [tier]` (the tier has no bearing on a CPU model — today's rule at the landing line).
2. **A part the door fixed is plain text**, same words, no trigger, no chevron:
   - the scope part when `embedded` (the host already decided — today that row is `hidden`) or when `scopeOptions.length === 1`;
   - the destination part when `destinations.length === 1`.
   - The tier part is always a trigger.
   - A `connectionId` door pre-selects its destination but leaves it pickable, as today.
3. **Each trigger**: an inline `button` (Skeleton `Popover.Trigger`), `inline-flex min-h-9 items-center gap-0.5 rounded-base px-2 font-medium preset-tonal-surface pointer-coarse:min-h-11`, the current choice's label then `Icons.ChevronDown` 14px `aria-hidden`. Never gold, never filled (gold means "do this" only). `aria-label` = `For: <label>`, `Download to: <label>`, `Memory tier: <label>`. Labels: the scope's `FINDER_SCOPES` label (Chat, Images, …), the destination's `label`, `tierLabel(tier)`.
4. **Each popover** copies the existing tier popover's shape (`Popover` + `Portal` + `Popover.Positioner class="z-[1000]!"` + `Popover.Content` card, `positioning={{ placement: "bottom-start" }}`), its content a `role="radiogroup"` with `aria-label` **For**, **Download to**, **Memory tier** respectively, rows `role="radio"` `aria-checked`, `h-9 w-full rounded-lg px-2.5 text-left text-sm`, checked row `sidebar-row-active`, others `hover:bg-surface-200-800`. Picking a row sets the choice (`scopeOverride` / `destinationOverride` / `pickTier`) and closes that popover. Separate open state per popover (`scopeOpen`, `destinationOpen`, existing `tierOpen`).
   - The tier popover keeps its question line (*How much memory does this machine have?*) and `tierReason` line inside, exactly as today. The header `⋯` item **Change memory tier** still opens it (`tierOpen = true`).
   - A destination with a `disabledReason` stays a pickable row, dimmed `opacity-70`, `title={reason}`.
5. **Lines under the sentence** (`text-surface-600-400 text-xs`, `break-words`, never truncated): the chosen destination's `disabledReason`, else the `kcppNotReady` sentence that `note` carries today; then `tierReason` when present and the destination is not ONNX (as today). The plain landing sentence (`Files land in …`, `Pulled into Ollama`) **leaves** the top of the finder — keep the `note`/`landingNote` derived values in the script (a later worker shows the landing folder on the model page's footer); only the markup goes.
6. Update the component's header comment where it describes "the four rows" so it describes the search box, the sentence, then the results. Keep it short; don't rewrite unrelated sections.

## Rules (quoted from the lane's brief, STYLE-GUIDE §6.3 and CLAUDE.md)

- "Sentence: *[Chat] models for [KoboldCPP] · sized for [8 GB]*; each bracket a popover of radios; a part the door fixed is plain text; a disabled destination stays pickable with its reason on a line under the sentence; *Not sure* suppresses every fit hint. The rules in `finder.ts` stay; only the presentation changes."
- STYLE-GUIDE §6.3: filters live in "a popover of `role="radio"` rows (single choice) with the checked row in the selected treatment"; "gold, filled or tonal, always means 'do this', never 'this is on'"; "A portaled popover or menu answers its own Escape."
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." Browser code: "no `crypto.randomUUID`, no `navigator.clipboard`".
- "The Hub search debounce (400 ms) and signature guard stay." Don't touch the effects that emit.
- Use only existing words: the scope labels, destination labels, tier labels, *For*, *Download to*, *Memory tier*, *models for*, *sized for*, *models*. Any other new user-facing word, name, setting or prop → stop and report.
- Do what is asked at the size asked. Findings go under **Noticed, not done**, never fixed in passing.

## Tests

- `finderViews.ssr.test.ts`: rewrite the finder tests that asserted the pill rows (`>For<`, `Download to`, `Not sure tier`, `Change`) to assert the sentence instead: the three trigger labels (`For: Chat`, `Download to: …` when there are ≥2 destinations, `Memory tier: Not sure`), `models for`, `sized for`; the scope options still present in the (hidden, portaled) popover content where SSR renders it — check what SSR actually emits before asserting; embedded shows the scope as plain text with no `For:` trigger; a single destination is plain text; a `connectionId` door still narrows the scope options (no Embeddings / Transcription for KoboldCPP). Keep every other test.
- `finder.dom.test.svelte.ts`: add a `describe("the sentence line")`: opening the scope trigger and picking **Images** re-asks `koboldcpp:recommendedModels` with `kind: "image"`; with KoboldCPP + an Ollama connection (`{ id: 9, name: "Ollama", type: "ollama" }`), picking Ollama in the destination popover changes the `Download to:` trigger label; an ONNX destination on a machine without the runtime shows its reason on the line under the sentence (look at how `localOnnxAvailability` reaches the view through `systemSettingsCtx` and how `destinationsFor` words the reason); the ONNX destination draws no `Memory tier:` trigger. If happy-dom cannot open a Skeleton popover, drive the radios that are in the DOM, and say so in your report. Existing tests must stay green (update selectors only where the pills moved).
- Nothing here hands a DOM node to an assertion (a failing assert formats the node, and a happy-dom node formats to gigabytes) — assert on strings and booleans.
- Run: `npx vitest run src/lib/client/components/connections/finderViews.ssr.test.ts src/lib/client/components/connections/finder.dom.test.svelte.ts src/lib/client/components/connections/finder.test.ts`, then `npx prettier --check` on the three files you changed.

Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout (none expected here).

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No SDK change is expected in this task.)

## Report (your final message)

Changed files with line ranges; tests run with results; choices you made; anything you stopped on; Noticed, not done.
