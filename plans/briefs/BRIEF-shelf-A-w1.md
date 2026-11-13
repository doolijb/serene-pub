# BRIEF shelf-A-w1 — Models list: pure grouping logic, remembered Group by, audio.cpp sizes

You are a `lane-worker` for lane `shelf-A` (supervisor: shelf-A). Plan: `plans/PLAN-models-tidy-shelf-2026-11-08.md` §1 items 1–6 (read §1 and the owner rulings at its top; they are final).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

The pure `.ts` half of the Models view's new grouped list: the three groupings, the fold, the two new narrowings, size totals, the Ollama tag and the reason line — in `modelsList.ts` with unit tests; the remembered **Group by** choice in a new `modelsGroupBy.ts` with unit tests; and audio.cpp model rows declaring their size as model facts. A second worker (w2) is writing the Svelte half **at the same time against the exact API below** — match names and signatures exactly.

## Files owned (the only files you may edit or create)

- `src/lib/client/components/connections/modelsList.ts`
- `src/lib/client/components/connections/modelsList.test.ts`
- new `src/lib/client/components/connections/modelsGroupBy.ts`
- new `src/lib/client/components/connections/modelsGroupBy.test.ts`
- `src/lib/server/connectionAdapters/AudioCppManagedAdapter.ts` — `modelsFromPackages` and the `AudioCppModelRow` type only
- new `src/lib/server/connectionAdapters/AudioCppManagedAdapter.test.ts`

## Files readable

`memoryTier.ts` (lines 36–80 and 143–178: the wrapped-storage pattern to mirror) and `memoryTier.test.ts` (how it tests storage); `connectionGroups.ts` (`CONNECTION_GROUPS`, labels at :48 and :53 — reuse, never retype) and `$lib/shared/connections/connectionGroup.ts` (`connectionGroupOf`); `finder.ts` `FINDER_SCOPES` (:63–113, labels Chat · Images · Embeddings · Entities · Speech · Transcription — import, never retype; another lane is editing finder.ts, **read only**); `modelManagement.ts` (`endpointKind`, `isLocalOnnxType`); `modelDisplay.ts` (`formatSize`); `connectionIndexFilter.ts` (`serviceLabel`); `useInMenu.ts` :12–13 and :76–86 (merged loadouts skipped; the current pair); `$lib/shared/sockets/types.ts` ~:3245–3275 (`Sockets.Loadouts.Summary`: `connectionId`, `connectionModelId`, `mergedInto`, `filled`); `$lib/shared/connections/modelFacts.ts` (:72 additive rule; `readModelFacts` / `readDeclared` — a producer's declared `facts` wins); `server/connectionAdapters/audioCppReady.ts` (`EnabledAudioCppPackage`); `server/audiocpp/packages.ts` :404, :495 (`sizeBytes` on the package row); `server/connectionAdapters/KoboldCppManagedAdapter.ts` :318–352 (how a file-backed adapter declares `facts`); `@serene-pub/sdk` `capabilityLabel`.

## The API — exact

### `modelsGroupBy.ts` (new)

```ts
export type ModelsGroupBy = "where" | "can-do" | "connection"
export const MODELS_GROUP_BY: readonly { value: ModelsGroupBy; label: string }[] = [
	{ value: "where", label: "Where it lives" },
	{ value: "can-do", label: "What it can do" },
	{ value: "connection", label: "Connection" }
]
export const DEFAULT_MODELS_GROUP_BY: ModelsGroupBy = "where"
export const MODELS_GROUP_BY_KEY = "serene-pub:modelsGroupBy"
export function parseModelsGroupBy(value: string | null | undefined): ModelsGroupBy // unknown → default
export function readModelsGroupBy(): ModelsGroupBy   // try { parse(localStorage.getItem(KEY)) } catch { default }
export function writeModelsGroupBy(value: ModelsGroupBy): void // try { setItem } catch { /* nothing to tell */ }
```
Mirror `memoryTier.ts`'s wrapped accessors and its comment on why (a getter that throws when site data is blocked). File header comment: what it is, why per browser (plan ruling: "remembered per browser (like the memory tier)"). Tests: parse of each value / junk / null; read with a stubbed `localStorage` (`vi.stubGlobal`), with one that throws, and with none; write that throws is swallowed.

### `modelsList.ts` (additions; keep every existing export working)

```ts
import type { ModelsGroupBy } from "./modelsGroupBy"

// MODEL_SCOPES gains two narrowings at the end, transform null:
//   { id: "in-loadout", label: "In a loadout", transform: null },
//   { id: "on-disk", label: "On disk", transform: null }

export function modelKey(connectionId: number, modelId: number): string // `${connectionId}:${modelId}`

/** The pairs a loadout's CURRENT pair names: filled, not merged (useInMenu.ts:12-13). */
export function loadoutModelKeys(
	loadouts: readonly {
		filled: boolean
		connectionId: number | null
		connectionModelId: number | null
		mergedInto: number | null
	}[]
): Set<string>

/** On this machine (connectionGroupOf(type) === "local"), still listed, and — for a local ONNX row — on disk. */
export function isOnDisk(entry: FlatModel<any>): boolean

/** facts.sizeBytes ?? (local.state === "on_disk" ? local.sizeBytes : null); positive finite numbers only, else null. */
export function sizeOnDiskOf(entry: FlatModel<any>): number | null

/** "lives in Ollama" for an Ollama connection's row (endpointKind(type) === "ollama", word from entry.serviceLabel), else null. */
export function livesInOf(entry: Pick<FlatModel<any>, "connectionType" | "serviceLabel">): string | null

/** Belongs in the last group: set aside (isSetAside) or able to do nothing (capabilities empty). */
export function isCantUse(entry: FlatModel<any>): boolean

/**
 * Why, for the meta line — or null where the row already says it:
 *   missingSince set → null (ModelRow's "No longer listed" badge says it)
 *   enabled false → "Switched off"
 *   a local ONNX row not on disk → null (its download line, localCatalogLine, says it)
 *   no capabilities → "No default loadout can run this model"
 *   otherwise null
 */
export function cantUseNoteOf(entry: FlatModel<any>): string | null

// inScope / filterModels / scopeCounts gain an optional loadout set:
export function inScope(entry: FlatModel<any>, scope: ModelScope, inLoadout?: ReadonlySet<string> | null): boolean
//   "in-loadout" → !!inLoadout?.has(modelKey(entry.connectionId, entry.model.id))
//   "on-disk"    → isOnDisk(entry)
//   otherwise    → today's transform rule
export function filterModels<E extends FlatModel<any>>(entries: readonly E[], opts: { query: string; scope: ModelScope; inLoadout?: ReadonlySet<string> | null }): E[]
export function scopeCounts(entries: readonly FlatModel<any>[], inLoadout?: ReadonlySet<string> | null): Record<ModelScope, number>
// modelsSummaryLine: unchanged; a scope with no transform says "n models".

export const FOLD_THRESHOLD = 12

export interface ModelsFold {
	connectionId: number
	/** The connection's name leading the line — in "where" only; null elsewhere. */
	title: string | null
	/** "312 models · 1 in a loadout" · "312 models" (before loadouts answer) · "+ 300 on OpenRouter" */
	text: string
}

export interface ModelsGroup<E> {
	/** Unique in one result: "local", "service", "conn:3", "built-in", "cap:text->text", "cut-outs", "cant-use". */
	key: string
	label: string
	/** formatSize(sum of sizeOnDiskOf over rows) — local side only; null when none known. */
	sizeLabel: string | null
	rows: E[]
	/** Drawn after the rows. */
	folds: ModelsFold[]
	/** Draw the background remover as this group's last row. */
	remover: boolean
}

export function groupModels<E extends FlatModel<any>>(
	entries: readonly E[], // already filtered and sorted (flatModels → filterModels)
	opts: {
		groupBy: ModelsGroupBy
		/** Every connection, in the Connections index's order (the view's `rows`). */
		connections: readonly { id: number; name?: string | null; type?: string | null; models: readonly unknown[] }[]
		inLoadout: ReadonlySet<string> | null // null = loadouts:list has not answered
		unfolded: ReadonlySet<number> // connection ids the person pressed Show on
		folding: boolean // false while the filter box has text
		remover: boolean // the background remover is drawn (admin)
	}
): ModelsGroup<E>[]
```

### `groupModels` rules — exact

- **Catch-all:** rows with `isCantUse` go to the LAST group, key `"cant-use"`, label **Can't be used right now**, `sizeLabel` null, in every grouping. All other rows are *usable*.
- **Folded connection:** `folding && !unfolded.has(id) && connectionGroupOf(type) === "service" && connection.models.length > FOLD_THRESHOLD`. **Exempt** row: `inLoadout?.has(modelKey(...))` (none exempt while `inLoadout` is null). A row is **hidden** when its connection is folded and it is not exempt. Hidden rows are never in `rows`.
- **Fold text:** in "where" and "connection": `${n} ${n === 1 ? "model" : "models"}` where n = that connection's usable rows in the group (shown + hidden), then ` · ${k} in a loadout` with k = its exempt usable rows in the group — the ` · k in a loadout` part omitted entirely while `inLoadout` is null (k = 0 still prints "0 in a loadout"). In "can-do" kind groups and in the catch-all group, in every grouping: `+ ${hiddenCount} on ${connectionNameOf(connection)}`, only where it hides at least one row. A fold line is emitted only where the folded connection has rows in that group.
- **"where":** group `"local"` labelled `CONNECTION_GROUPS` local label (*On this machine*): usable rows with `connectionGroupOf(entry.connectionType) === "local"`, `remover: opts.remover`, `sizeLabel` = formatted sum. Then `"service"` (*Services*): usable service rows not hidden; `folds` one per folded service connection (in `connections` order) with `title: connectionNameOf(connection)`. Then the catch-all.
- **"connection":** one group per connection, key `conn:${id}`, label `connectionNameOf(connection)`, local connections first then services, each side in `connections` order; usable rows not hidden; a folded connection's one fold has `title: null`; `sizeLabel` for local connections only. Then group `"built-in"` labelled **Built in** with `remover: true`, `rows: []` — only when `opts.remover`. Then the catch-all.
- **"can-do":** one group per `FINDER_SCOPES` entry in its order, key `cap:${scope.capability}`, label `scope.label`; a usable row is listed under EVERY kind its `capabilities` include (not hidden); fold lines `+ n on ‹name›` per folded connection that hides rows in that kind. A usable row whose capabilities include **none** of the six kinds is listed under one group per capability it has, key `cap:${transform}`, label `capabilityLabel(transform)` from `@serene-pub/sdk` (never a new word; such groups after the six, in first-seen order). Then group `"cut-outs"` labelled **Cut-outs** with `remover: true` — only when `opts.remover`. `sizeLabel` null for every group here. Then the catch-all.
- Rows keep the input order (name order, `compareFlatModels`) inside every group.
- **Drop** a group with no rows, no folds and `remover` false. (The `"local"` group with only the remover is kept.)

### `AudioCppManagedAdapter.ts`

`AudioCppModelRow` gains `facts?: { sizeBytes: number; source: "file" }`. `modelsFromPackages` takes `readonly (EnabledAudioCppPackage & { sizeBytes?: number | null })[]` and, when a package's `sizeBytes` is a positive finite number, adds `facts: { sizeBytes, source: "file" }` (last key) to that row, tts and asr alike; otherwise the row is exactly what it is today (the existing test in `speech/audiocppManagedSpeech.test.ts` uses `toEqual` on rows without sizes and must stay green). Nothing else in the file changes. (`audioCppReady.ts` does not yet carry `sizeBytes` — not yours; the supervisor queues it.) New test file next to it: a sized tts and asr package get the facts; an unsized, zero or NaN size gets none. If importing the adapter module drags in the database, `vi.mock` what it needs — do not edit other files.

## Rules (quoted; your work depends on them)

- Brief, from the lead: *"Labels are ruled: Group by options **Where it lives** · **What it can do** · **Connection**; last group **Can't be used right now**; fold line *‹n› models · ‹k› in a loadout* · **Show**; in What it can do *+ ‹n› on ‹service›* · **Show**; downloads button title *Downloads*. Any other new user-facing string or exported name → stop and ask the lead."* The supervisor has cleared the strings and names in this brief (including *In a loadout*, *On disk*, *Cut-outs*, *Built in*, *lives in Ollama*, *Switched off*, *No default loadout can run this model*); **add no other user-facing string and no other export.** Need one → stop and say so in your report.
- *"Fold: Services connection with > 12 models; exempt = models that sit in a loadout (a loadout's current pair names the model; merged loadouts skipped). Non-empty filter ignores folds. Until loadouts answer: fold with no exemptions, omit the loadout count."*
- *"No new wire field on model rows. Sizes = `facts.sizeBytes ?? local.sizeBytes`."*
- *"Pure logic lives in `.ts` files with unit tests; the Svelte files decide no sentences."* `modelsList.ts` stays pure: no Svelte, no socket (its header says so).
- CLAUDE.md R5: reconcile vocabularies at boundaries — group labels come from `CONNECTION_GROUPS` and `FINDER_SCOPES`, imported, never retyped. It is a **session**, never a *chat* (except the existing *Chat* kind label).
- `modelFacts.ts:72`: *"Additive only. A new fact is a new optional field here… Nothing else in the app has to learn about it."* — `sizeBytes` already exists; add no field.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Comments: say what and why, in the files' existing voice (look at `modelsList.ts`); no "added by" or ticket chatter.

## Out of scope

Svelte files (w2 owns them), `finder.ts`, `audioCppReady.ts`, docs, STYLE-GUIDE, NOMENCLATURE, migrations. Findings go in your report under **Noticed, not done**.

## Stop and ask when

A new string or export beyond this brief seems needed; a rule above conflicts with the code; a file outside **Files owned** needs a change.

## Done means

- `npx vitest run src/lib/client/components/connections/modelsList.test.ts src/lib/client/components/connections/modelsGroupBy.test.ts src/lib/server/connectionAdapters/AudioCppManagedAdapter.test.ts src/lib/server/connectionAdapters/speech/audiocppManagedSpeech.test.ts` — all green. Never pipe vitest into `head`.
- Tests cover every rule above: each grouping's group order and labels; a row under several kinds; the none-of-six row; the catch-all with *Switched off* / no-capability / missing; fold on at 13 models and off at 12; exemption; the no-loadouts text; `unfolded`; `folding: false`; local-only size totals (and a not-downloaded ONNX row's size not counted); remover placement per grouping and its absence when `remover: false`; the two narrowings and their counts; `loadoutModelKeys` skipping merged and unfilled.
- `npx prettier --check` on every file you changed or created (fix with `npx prettier --write <file>` on your files only).
- `npx tsc --noEmit -p .` is the lead's job; do not run it.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should need no `sdk:build`.)

## Report

Reply with: changed files; tests run with pass counts; any deviation from the API above (there should be none); **Noticed, not done**.
