# BRIEF shelf-B-w4 — the finder model page component, sharing the quant picker's rows

You are a `lane-worker` in lane `shelf-B` (supervisor: the shelf-B lane-supervisor). Report back to your supervisor in your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

A new presentational component `FinderModelPage.svelte`: a model's own page inside the Get a model pane (the **finder model page**). Its title is the model's name; it shows a hero, description, a facts strip, the presence line, a **files table** (the quant picker's rows plus a fit bar and a radio) and a footer with the destination, the landing folder and **Download ‹quant›**. It knows nothing about sockets: the finder view (wired by a later worker) passes everything in and hears `onDownload` / `onCancel` / `onBack`. The quant picker's row markup is shared with it, not copied.

## Files owned (the only files you may edit)

- new `src/lib/client/components/connections/FinderModelPage.svelte`
- `src/lib/client/components/connections/QuantPicker.svelte` — only to share its rows with the page (no behaviour or look change to the inline picker).

Do **not** edit `ModelFinderView.svelte`, `finder.ts` or any test file (another worker is in `ModelFinderView.svelte` and the test files right now).

## Files readable

Everything. Start with `QuantPicker.svelte` (whole), `finder.ts` — `QuantFile`, `FinderTier`, `quantFit`, `preselectedQuantIndex`, `repoTitle`, `repoOwner`, and the new helpers `fitBar` and `modelPageFacts` (grep them), `memoryTier.ts` (`MemoryTier`, `tierLabel`), `components/panels/PanelNavHeader.svelte` (props), `components/panels/DetailHero.svelte` (props), `components/Badge.svelte`, and the result-row snippet in `ModelFinderView.svelte` (:1440-1600: tier chip classes, the held badge, the progress bar and Cancel — mirror them). STYLE-GUIDE §6.3 (the nav header paragraph and "Escape over an in-view sub-route is Back") and §6.1 (one primary per surface).

## Props (exactly these; doc-comment each)

```ts
interface Props {
	/** The row's name: "owner/repo", or a list's own name. */
	name: string
	/** Which group the row came from: drives the hero's source word and icon. */
	source: "recommended" | "hub"
	tier: MemoryTier
	/** The row's tier chip, when the list graded it. */
	tierChip?: FinderTier | null
	description?: string | null
	/** From `modelPageFacts` — only the facts known. */
	facts: readonly { label: string; value: string }[]
	/** The presence sentence (D3), e.g. "You have this on KoboldCPP". */
	presenceText?: string | null
	/** The files, sizes already merged from the Hub's answer. */
	quants: readonly QuantFile[]
	/** Why there are no files (Ollama's `quantsNote`). */
	quantsNote?: string | null
	noun?: "size" | "precision"
	/** True while the Hub card is being asked. */
	cardLoading?: boolean
	/** The Hub card's failure, as a sentence. */
	cardError?: string | null
	/** The destination's label ("KoboldCPP", "Home · Ollama"), or null. */
	destinationLabel: string | null
	/** Where the files land (`landingNote`), or null. */
	landingNote: string | null
	/** Set when nothing can be downloaded to this destination. */
	disabledReason?: string | null
	/** The destination already holds it. */
	held?: "on_disk" | "pulled" | null
	/** This model is arriving right now. */
	busy?: { percent: number | null; progress: string } | null
	onDownload: (quant: QuantFile | null) => void
	onCancel: () => void
	onBack: () => void
}
```

## Layout (top to bottom)

1. **`PanelNavHeader`**: `title={repoTitle(name)}`, `onBack`, `backLabel="Back"`. No `primaryAction`, no `menuItems`. Back is always drawn: the results level is off screen (the page replaces it). Pinned; everything under it except the footer is ONE scroller (`min-h-0 flex-1 overflow-y-auto`, the scroller carries no padding — STYLE-GUIDE §5.2), and the pane's gap is the root's `gap-3`.
2. **`DetailHero`**: `title={repoTitle(name)}`, `subtitle` = `[repoOwner(name), source === "hub" ? "Hugging Face" : "Recommended"]` non-empty parts joined ` · `, `icon` = `Icons.Package` (recommended) / `Icons.Globe` (hub), `chips` = the tier chip when `tierChip` (same classes as the result row: `preset-tonal-primary` when `matches`, else `preset-tonal-surface`, `text-meta rounded-full px-2 py-0.5`). Check `DetailHero`'s props for how it renders its title; it must not add a second heading level above the nav header's `h2`.
3. **Description**: `text-surface-700-300 text-sm leading-relaxed` paragraph, full (no clamp), when present.
4. **Facts strip**: when `facts.length`, a `<dl>` laid out as a wrapping row of small pairs (`flex flex-wrap gap-x-4 gap-y-1.5`), each `<div>` with `<dt class="text-surface-600-400 text-xs">` label and `<dd class="text-sm">` value. Nothing at all when empty.
5. **Presence line**: `presenceText` as `text-surface-600-400 text-xs`.
6. **Card state**: `cardLoading` → `text-surface-600-400 text-xs` "Reading the repo from Hugging Face…"; `cardError` → the sentence, `text-surface-600-400 text-xs`, `role="status"`. Never a toast.
7. **Files table**: a `section` with an `h3` heading in the quant picker's words — "Pick a size" / "Choose a precision" (by `noun`, default size) — then the **shared rows** (below) with fit bars on, `selected` seeded once per `name` from `Math.max(0, preselectedQuantIndex(quants, tier))` (the same seeding QuantPicker does). One file → one row, checked. No files → instead of rows, `quantsNote` if given, else the quant picker's own empty sentence for the noun ("This repo publishes no GGUF files to choose between." / "This model lists no precisions to choose between.").
8. **Footer** (pinned under the scroller, `flex flex-wrap items-center gap-2`, a top border `border-surface-200-800 border-t pt-3`): on the left, `min-w-0 flex-1` muted `text-xs` truncated line `To <destinationLabel>` · `<landingNote>` (each part only when present; full text in `title`); on the right, exactly one of:
   - `busy` → the progress bar + text exactly as the result row draws it (`role="progressbar"`, `aria-label="Downloading <name>"`, `bg-warning-500` fill, clamped 0–100) and a **Cancel** button (`btn btn-sm preset-tonal-error`, per STYLE-GUIDE §6.1 "stops work in flight is error") calling `onCancel`;
   - `held` → the result row's `Badge tone="success" size="sm"` **On disk** / **Pulled**;
   - else **Download ‹quant›**: `btn btn-sm preset-filled-primary-500` with `Icons.Download` 14px, label `Download <chosen.name>` (truncate long names, full in `title`), or plain `Download` when there are no files; `disabled` when `disabledReason` (with `title={disabledReason}`); calls `onDownload(chosen ?? null)`. This is the page's one filled primary.
9. **Escape is Back**: the root element listens to `keydown`; on `Escape` while focus is inside it and not in an `input`/`textarea`/`select`/contenteditable, and not already `defaultPrevented`, call `preventDefault()` and `onBack()`.
10. **Focus on open**: on mount, focus the nav header's `[data-panel-title]` (set `tabindex="-1"` first), as `ModelFinderView` does for its own heading.

## Sharing the rows with QuantPicker

Move the row list (the `role="radiogroup"` and its `role="radio"` buttons, today QuantPicker :146-190) into a snippet **exported from QuantPicker's `<script module>`** (Svelte ≥ 5.5 supports exporting top-level snippets; this repo pins `svelte ^5.35`). Suggested signature: `quantRows(quants, tier, selected: number, onSelect: (i: number) => void, label: string, bars: boolean)`. Everything the snippet reads must be module-level (move `TONE`, and the imports it needs, to `<script module>`). QuantPicker renders `{@render quantRows(..., false)}` and must look and behave exactly as before (its SSR test asserts the rows, the recommended chip and the fit). With `bars` on, each row adds under its size/fit line a fit bar from `fitBar(quant, tier)`: a track `bg-surface-300-700 mt-1 block h-1 w-full overflow-hidden rounded-full` with a fill `block h-full rounded-full` at `width: <percent>%` coloured by tone — good `bg-success-500`, warn `bg-warning-500`, bad `bg-error-500`, muted `bg-surface-500` — `aria-hidden="true"` (the fit sentence already says it). No bar when `fitBar` is null (Not sure, or no size). If Svelte refuses the module-exported snippet, stop and report the exact compiler error rather than duplicating the markup.

## Rules (quoted from the lane's brief, STYLE-GUIDE and CLAUDE.md)

- "Finder model page: no UI label (title = model name); … facts strip shows only known facts (Parameters, Context, Licence, Languages, Downloads, Updated); presence line (D3); files table = quant picker rows + fit bar + radio, pre-selected by `preselectedQuantIndex`; footer = destination + landing folder + **Download ‹quant›** (the one gold button). One-file repo → one row; Ollama library name with no files → `quantsNote`."
- "Errors: inline on the page in a sentence, never a toast from the view."
- STYLE-GUIDE §6.3: "nav header = back · title · primary · ⋯, Back drawn only when the level it returns to is off screen"; "Escape over an in-view sub-route is Back … only while focus is inside it and not in a text box, and calls `preventDefault`. A portaled popover or menu answers its own Escape." §6.1: "One primary button per surface"; an action that "stops work in flight … is `error` — `preset-tonal-error` in a row or footer".
- *Not sure* suppresses every fit hint (no sentence, no bar).
- Svelte 5 runes; `SvelteMap`/`SvelteSet` for mutated collections. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- New user-facing words allowed in this task: only *To*, *Recommended*, *Hugging Face*, *Download*, *Reading the repo from Hugging Face…*, and words already in QuantPicker. Anything else, or any new prop beyond the list above → stop and report.

## Tests

You may not edit test files in this task (another worker holds them). Verify by running the existing suites that render QuantPicker — they must stay green:
`npx vitest run src/lib/client/components/connections/finderViews.ssr.test.ts src/lib/client/components/connections/finder.dom.test.svelte.ts` (if the other worker's in-progress edits make an unrelated test there fail, say which and why you believe it is theirs). Do not run `svelte-check` or `tsc` (the lead runs those once at the end). To compile-check the page, you may create a **temporary** `src/lib/client/components/connections/shelfB-w4-scratch.ssr.test.ts` that SSR-renders `FinderModelPage` (pattern: `finderViews.ssr.test.ts` and its `vi.mock` lines) with a few prop sets — files with sizes and tier 8gb (bars present), Not sure (no bars, no fit sentence), no files with a `quantsNote`, `held`, `busy`, `cardError` — run it, and **delete it before you report** (say that you did). Then `npx prettier --check` on your two files. A later worker writes the page's tests.

Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout (none expected here).

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No SDK change is expected in this task.)

## Report (your final message)

Changed files; the exported snippet's exact signature; the component's props as written; tests and checks run with results; choices you made; anything you stopped on; Noticed, not done.
