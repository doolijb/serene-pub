# BRIEF shelf-B-w5 — wire the finder model page into Get a model

You are a `lane-worker` in lane `shelf-B` (supervisor: the shelf-B lane-supervisor). Report back to your supervisor in your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

In the model finder, **a result's name opens the finder model page** (`FinderModelPage.svelte`, already built and presentational) inside the finder pane. Opening it asks `models:hubCard { repo }` when the row names a Hugging Face repo; the answer fills the page's facts and the files' sizes (so fit shows). **Back** returns to the results with the query and the scroll kept. **Get** on a result row keeps today's inline quant picker, unchanged. Plus two small fixes to the sentence line.

## Files owned (the only files you may edit)

- `src/lib/client/components/connections/ModelFinderView.svelte`
- `src/lib/client/components/connections/finder.dom.test.svelte.ts`
- `src/lib/client/components/connections/finderViews.ssr.test.ts`

Do not edit `FinderModelPage.svelte`, `QuantPicker.svelte`, `finder.ts`, the server, or `types.ts`. If you need a change there, stop and report it.

## Files readable

Everything. Read first: `FinderModelPage.svelte` (whole — its props are the contract), `ModelFinderView.svelte` — script :180-300 (state, tier, destinations), :340-470 (handlers + `declareInterest` blocks), :640-760 (rows, `liveDownload`, presence: `summaryFor`, `effectivePresence`), :770-1060 (picker state, `start*`, `offer`, `getRecommended`, `getHub`, `downloadPicked`, `cancelRow`, `kcppModelsDir`, `note`, `pane`, the heading-focus effect), and the markup from :1083 (pane header, scroller, `finderBody`, `resultRow`, `hubResultRow`). `finder.ts`: `hubRepoOf`, `withHubFileSizes`, `modelPageFacts`, `landingNote`, `repoTitle`, `FinderRow`, `HubRow`. The wire type (already in `src/lib/shared/sockets/types.ts`):

```ts
Sockets.Models.HubCard.Params   = { repo: string }
Sockets.Models.HubCard.Response = { repo: string; card?: Card; files?: { rfilename: string; size?: number }[]; error?: string }
```

⚠ The client event map `src/lib/client/sockets/typedSocket.ts` does **not** yet have a `"models:hubCard"` entry (the lead adds it; not your file). Write the code exactly as it should read once it exists — `socket.emit("models:hubCard", { repo })` and `declareInterest<"models:hubCard">("models:hubCard", handleHubCard)` — and do not work around the missing entry with casts. Vitest does not type-check, so tests run regardless.

## What to build in `ModelFinderView.svelte`

1. **State.** `page = $state<{ key: string; group: "recommended" | "hub"; snapshot: FinderRow | HubRow } | null>(null)`; the live row is `rows.find(key) ?? snapshot` (recommended rows from `recommendedRows`, hub rows from `hubRows`). `hubCard = $state<{ repo: string; loading: boolean; card?: Sockets.Models.HubCard.Card; files?: Sockets.Models.HubCard.File[]; error?: string } | null>(null)`. A plain (non-reactive) `savedScroll` number.
2. **Open.** Each result card's title (`repoTitle(row.name)` in `resultRow` and `hubResultRow`) becomes a `button` (`type="button"`, same text classes plus `hover:underline text-left`, `title={row.name}`, `data-page-opener={row.key}`) that calls `openPage(row, group)`:
   - remember the scroller's `scrollTop` (bind the pane's scroller `div` and, in embedded/bare mode, the results `div` — whichever scrolls);
   - set `page`;
   - **ask the card only when the page opens**, and only if `isAdmin`, the destination kind is `koboldcpp` or `ollama`, and `hubRepoOf(row)` returns a repo: set `hubCard = { repo, loading: true }` and `socket.emit("models:hubCard", { repo })`. Otherwise `hubCard = null` (recommended rows use their list's facts and ask nothing when they name no Hub repo; ONNX and audio rows never ask).
3. **Listen.** Inside the existing `if (!isAdmin) return` `declareInterest` block, add `models:hubCard` → `handleHubCard(msg)`: ignore a reply whose `msg.repo !== hubCard?.repo` (a stale reply for a page already left); else store `card`, `files`, `error`, `loading: false`. No `:error` listener (the handler never throws; failures ride the reply's `error`). **Never toast** from this path.
4. **Render.** While `page` is set, the finder draws the page **instead of** its header + body: in pane mode instead of the `PanelNavHeader "Get a model"` and the scroller; embedded/bare instead of `finderBody`. The page fills the pane (`flex min-h-0 flex-1 flex-col`). Props:
   - `name` row.name; `source` = group; `tier`; `tierChip` = recommended row's `tier` (hub rows: null); `description` = row.description;
   - `facts` = `modelPageFacts({ parameters: <recommended row's facts, only when the destination kind is koboldcpp or ollama — ONNX facts are "384 dims", not parameters>, card: hubCard?.card, tags: <hub row's tags; recommended: row.tags> })`;
   - `presenceText` = `summaryFor(row.key)?.text`;
   - `quants` = `withHubFileSizes(row.quants ?? [], hubCard?.files)`; `quantsNote` = recommended row's `quantsNote`;
   - `noun` = "precision" for ONNX and audio destinations, else "size" (exactly what `getRecommended`/`getHub` pass today);
   - `cardLoading` = `!!hubCard?.loading`; `cardError` = `hubCard?.error ?? null`;
   - `destinationLabel` = `destination?.label ?? null`; `landingNote` = `destination ? landingNote(destination, kcppModelsDir) : null` (the plain landing sentence that left the top of the finder lands here; when `kcppNotReady`, pass the `note` sentence instead, as the top line does); `disabledReason` = `destination?.disabledReason ?? null`;
   - `held` = `effectivePresence(row)`; `busy` = for a recommended row, what `resultRow` computes (`row.downloading || liveDownload(row)`, percent, and the progress text `formatProgress(...) ?? "<n>%"`), else null — mirror `resultRow` exactly, by extracting a small helper both use rather than duplicating the arithmetic;
   - `onDownload(quant)`, `onCancel` → `cancelRow(row)` (recommended rows), `onBack` → `closePage()`.
5. **Download from the page.** Refactor `getRecommended` / `getHub` so the "which source, which repo, which quants, which noun, what to do with no quant" decision lives in one function (e.g. `planFor(row, group)` returning `{ repo, quants, source: PickerSource, noun, go(quant | null) } | null`), used by **Get** (through `offer`, unchanged behaviour: picker for >1, straight download for 1, list tag for 0, and the existing "That repo lists no files to get" for an empty Hub row) and by the page's `onDownload`: with a quant → the same routing `downloadPicked` does for that source (factor the body of `downloadPicked` into a function both call); with `null` (no files) → `plan.go(null)`. The page's quants carry Hub-filled sizes; pass them through (`startKcpp` already forwards `quant.bytes`). After a download starts the page stays open (the footer turns to progress / the badge as the row would).
6. **Back.** `closePage()`: `page = null`, `hubCard = null`; after `tick()`, restore the scroller's `scrollTop = savedScroll` and focus the opener (`[data-page-opener="<key>"]` inside the view's root, via `CSS.escape` or an attribute-safe lookup). The query, the debounced query, `hubShown`, the scope, destination and the fetched lists are untouched — the search must **not** re-run (the signature guards already ensure it; don't reset them).
7. **Leaving.** If the destination or scope changes while a page is open (it cannot from the UI, but a door prop can), close the page. Unmount needs nothing extra.
8. **Sentence fixes** (from the previous worker's notes):
   - With **no destination**, keep the tier part: the sentence reads **[scope] models** ` · sized for [tier]`. The rule for the tier part becomes `destination?.kind !== "onnx"` (so the header ⋯ **Change memory tier** always has a trigger on screen, as the old line guaranteed); the `tierReason` line follows the same rule.
   - Replace the leftover "pills" wording in comments (the header comment near :26, the comment above `scopeOptions` near :253-257) with the sentence's words. Comments only.
9. Update the header comment's description of the results to mention that a result's name opens the model page (one or two sentences).

## Rules (quoted from the lane's brief, STYLE-GUIDE §6.3 and CLAUDE.md)

- "Finder model page: no UI label (title = model name); Back returns to results with query and scroll kept; facts strip shows only known facts …; presence line (D3); files table = quant picker rows + fit bar + radio, pre-selected by `preselectedQuantIndex`; footer = destination + landing folder + **Download ‹quant›** (the one gold button). One-file repo → one row; Ollama library name with no files → `quantsNote`. **Get** on a result row keeps today's inline quant picker."
- "`models:hubCard { repo }` … Asked **only when the page opens**. … Recommended rows use their list's facts and ask the card only when they name a Hub repo." "Admin-only like the searches."
- "Errors: inline on the page in a sentence, never a toast from the view."
- "Sockets: one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler." (Use `declareInterest`, whose release function is handler-specific.)
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." Browser code: "no `crypto.randomUUID`, no `navigator.clipboard`".
- "The Hub search debounce (400 ms) and signature guard stay."
- STYLE-GUIDE §6.3: "Back is drawn only when the level it returns to is not on screen" (the page replaces the results, so its Back is always drawn — the page does that); "Escape over an in-view sub-route is Back" (the page handles it).
- No new user-facing words, names, props, settings or events beyond this brief → stop and report. Findings go under **Noticed, not done**.

## Tests

In `finder.dom.test.svelte.ts` add `describe("the finder model page")` (reuse the file's `render`, `reply`, `byLabel`, the fake socket's `emitted` list and the `handlers` map; a KoboldCPP destination with `koboldcpp:recommendedModels` answered with `model("bartowski/Qwen3-8B-GGUF", [option("Q4_K_M", "Qwen3-8B-Q4_K_M.gguf", <no size>), option("Q8_0", …)])`-style rows — check `option`'s signature and give some quants no size to prove the Hub fills them):
- clicking a result's name shows a heading with the model's title, and emits `models:hubCard` with `{ repo: "<owner/repo>" }` exactly once; the search box is gone;
- a reply `{ repo, card: { license: "apache-2.0", contextLength: 32768 }, files: [{ rfilename, size }] }` shows **Licence** `apache-2.0` and **Context** `32k tokens`, and with tier `8gb` (set via the tier radio, or `localStorage` key `serene-pub:memoryTier` before render) a size-less quant now shows its size and a fit sentence;
- a reply for a different repo changes nothing;
- `{ repo, error: "Hugging Face would not answer for that repo." }` shows that sentence on the page and no toast (`notify`/`toaster` mocks not called — check what the file already mocks);
- **Download ‹quant›** emits `koboldcpp:downloadModel` for the checked quant (the recommended one by default) and the page stays open;
- **Back** returns to the results: the filter input is back with the query typed before opening, and the opener button has focus;
- Escape on the page is Back;
- an Ollama recommended row whose pull is a library name (`llama3.2:3b`, no quants, `quantsNote: "Ollama's library lists no quants for this name."`) opens a page that shows the note, emits **no** `models:hubCard`, and Download emits `ollama:pullModel` with the list's tag;
- **Get** on a row still opens the inline quant picker (an existing test probably covers this — keep it green).
In `finderViews.ssr.test.ts`: update the no-destination sentence test for the tier part coming back (`Memory tier: Not sure` present with no connections).

Nothing here hands a DOM node to an assertion (a failing assert formats the node, and a happy-dom node formats to gigabytes) — assert on strings and booleans.

Run: `npx vitest run src/lib/client/components/connections/finder.dom.test.svelte.ts src/lib/client/components/connections/finderViews.ssr.test.ts src/lib/client/components/connections/finder.test.ts`, then `npx prettier --check` on the three files you changed.

Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout (none expected here).

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No SDK change is expected in this task.)

## Report (your final message)

Changed files with line ranges; the functions you added or refactored; tests run with results; choices you made; anything you stopped on; Noticed, not done.
