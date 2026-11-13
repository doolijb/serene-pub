# BRIEF shelf-B-w2 — finder.ts helpers for the finder model page

You are a `lane-worker` in lane `shelf-B` (supervisor: the shelf-B lane-supervisor). Report back to your supervisor in your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Pure helpers in `finder.ts` that a new **finder model page** (a model's own page inside the Get a model pane — built by a later worker) needs: which Hugging Face repo a result names, filling file sizes from the Hub's answer, a fit bar's share, and the page's facts strip. No Svelte, no sockets in this task.

## Files owned (the only files you may edit)

- `src/lib/client/components/connections/finder.ts`
- `src/lib/client/components/connections/finder.test.ts`

## Files readable

Everything. Start with `finder.ts`: `FinderRow` (:416), `HubRow` (:742), `formatCount` (:792), `licenseFromTags` (:800), `QuantFile` (:912), `quantFit` (:1041), `preselectedQuantIndex` (:1077), and `memoryTier.ts` (`fitFor`, `tierBudget`, `fitSentence`). The server's quant labelling is `src/lib/server/connections/hfGgufQuants.ts` (`ggufQuantOptions`, `ollamaQuantRows` — a quant label is the last hyphen segment of the file stem; a `UD-` prefix belongs to the quant; `mmproj` and `MTP` drafter files are never quants). Row keys: `kcpp:<name>`, `ollama:<pull>`, `onnx:<id>`, `audio:<key>`, `hub:<name>`. An Ollama recommended pull is either a library name (`llama3.2:3b`) or `hf.co/<owner>/<repo>:<quant>`. Look in `src/lib/client/utils/` for an existing date formatter before writing one.

## The wire type you read (being added to `src/lib/shared/sockets/types.ts` in parallel by another worker — use it by name; do not edit `types.ts`)

```ts
Sockets.Models.HubCard.Card = {
	license?: string; languages?: string[]; contextLength?: number
	baseModel?: string; downloads?: number; lastModified?: string
}
Sockets.Models.HubCard.File = { rfilename: string; size?: number }
```

## What to build (all exported, each with a short doc comment in the file's style)

1. **`hubRepoOf(row: { key: string; name: string }): string | null`** — the Hugging Face repo a result row names, or null.
   - `hub:` rows → the name, with a leading `hf.co/` or `huggingface.co/` and any trailing `:<tag>` removed.
   - `kcpp:` rows → the name.
   - `ollama:` rows → parse the pull after `ollama:`: `hf.co/<owner>/<repo>[:tag]` (or `huggingface.co/…`) → `<owner>/<repo>`; a library name → null.
   - `onnx:` / `audio:` / anything else → null.
   - Whatever comes out must match `/^[A-Za-z0-9][\w.-]*\/[\w.-]+$/` and contain no `..`, else null (the server applies the same guard).
2. **`withHubFileSizes(quants: readonly QuantFile[], files: readonly Sockets.Models.HubCard.File[] | null | undefined): QuantFile[]`** — fills each quant's **missing** `bytes` from the Hub's files; never overwrites a known size; returns the input unchanged when `files` is empty/absent. Match, in order: exact `quant.filename === file.rfilename`; else the quant's `name` (case-insensitive) equals the quant label of a file — the last hyphen segment of its stem (basename without `.gguf`), or `UD-<label>` when the segment before it is `UD` — counting only files that are not `mmproj`/`MTP` drafters, and only when **exactly one** file matches (a split model's parts never get a guessed size).
3. **`fitBar(quant: QuantFile, tier: MemoryTier): { percent: number; tone: QuantFitTone } | null`** — null whenever `quantFit(quant, tier)` is null (Not sure, or no size). Otherwise `percent` = `bytes / tierBudget(tier) * 100`, rounded, clamped to 1–100, and `tone` = `quantFit`'s tone.
4. **`modelPageFacts(input, formatDate?)`** → `{ label: string; value: string }[]`, only the facts known, in exactly this order with exactly these labels: **Parameters**, **Context**, **Licence**, **Languages**, **Downloads**, **Updated**.
   - `input: { parameters?: string | null; card?: Sockets.Models.HubCard.Card | null; tags?: readonly string[] | null; downloads?: number | null }`
   - Parameters: `input.parameters` when non-empty.
   - Context: `card.contextLength` → `"<n/1024>k tokens"` when divisible by 1024 (131072 → `128k tokens`), else `"<n with en-US grouping> tokens"` (`40000` → `40,000 tokens`).
   - Licence: `card.license`, else `licenseFromTags(input.tags)`.
   - Languages: the first 3 of `card.languages` joined `", "`, then ` +N more` when there are more (`en, fr, de +2 more`).
   - Downloads: `formatCount(card.downloads ?? input.downloads)`.
   - Updated: `card.lastModified` through `formatDate` (default: an existing client date helper if one fits, else `new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })`); an unparseable date drops the fact. Tests pass their own `formatDate` so they do not depend on locale.
   - A missing card yields only what the other inputs know; an empty result is `[]`.

## Rules (quoted from the lane's brief, the plan and CLAUDE.md)

- "facts strip shows only known facts (Parameters, Context, Licence, Languages, Downloads, Updated)" — an absent fact is dropped, never "unknown" (the module header's rule: "a line of blanks says the app failed rather than that the Hub was quiet").
- "*Not sure* suppresses every fit hint" — `fitBar` follows `quantFit`, which already returns null for Not sure.
- "The rules in `finder.ts` stay" — do not change any existing function's behaviour or signature (`destinationsFor`, `pickDestination`, `landingNote`, `preselectedQuantIndex`, `quantFit`, `quantChoice`, …). Add only.
- Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`.
- No new user-facing words beyond the labels and value formats specified above. Anything else a user would see, or any new name → stop and report.

## Tests

Add `describe` blocks to `finder.test.ts` for all four helpers, covering each bullet above (including: ollama library name → null; `hf.co/a/b:Q4_K_M` → `a/b`; `a/../b` → null; a known size is never overwritten; the `UD-` label; two matching split parts → no size; mmproj ignored; Not sure → `fitBar` null; percent clamps; facts order and drops; languages `+N more`; licence from tags).

Run: `npx vitest run src/lib/client/components/connections/finder.test.ts` and `npx prettier --check` on both files.

Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout (none expected here).

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No SDK change is expected in this task.)

## Report (your final message)

Changed files; the exported signatures exactly as written; tests run with results; choices you made (e.g. the date helper you used); anything you stopped on.
