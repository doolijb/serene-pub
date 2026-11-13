# BRIEF shelf-A-w2 — Models list: grouped view, Group by popout, toolbar downloads count

You are a `lane-worker` for lane `shelf-A` (supervisor: shelf-A). Plan: `plans/PLAN-models-tidy-shelf-2026-11-08.md` §1 items 1–7 (read §1 and the owner rulings at its top; they are final).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

The Svelte half of the Models view's grouped list: `ModelsListView` draws the groups `groupModels` returns (headers with size totals, fold lines with **Show**, the background remover in its group, the catch-all's reasons), the filter popout gains the two narrowings (they come with `MODEL_SCOPES`) and a **Group by** radio group remembered per browser, the toolbar shows a **↓ n** downloads button while anything arrives, Ollama rows end their meta line with *lives in Ollama*, and `ModelsSidebar` hands the view which models sit in a loadout.

A second worker (w1) is writing the pure `.ts` half **at the same time** — `modelsList.ts` and the new `modelsGroupBy.ts`. **Never edit those two files.** Code against the exact API below. Do the Svelte work first; run the tests last. If an import from them fails because w1 has not landed yet, finish everything else, check again (`grep -n "export function groupModels" src/lib/client/components/connections/modelsList.ts`), and if it is still missing, report that and stop — never write a stand-in.

## Files owned (the only files you may edit)

- `src/lib/client/components/connections/ModelsListView.svelte`
- `src/lib/client/components/connections/ModelRow.svelte`
- `src/lib/client/components/sidebars/ModelsSidebar.svelte`
- `src/lib/client/components/connections/modelsListView.ssr.test.ts`

## Files readable

The four above in full; `MattingModelRow.svelte` (renders its own section and *Background remover* label — not yours, draw it as is); `DownloadsTray.svelte` (its `open` is bindable; **View** opens the Downloads list in a popover anchored to the tray); `downloads.svelte.ts` (`downloads.inFlight`); `panels/ViewToolbar.svelte` (`actions` snippet = the action row's secondary icon buttons); `panels/toolbarButton.ts`; `panels/ListGroupLabel.svelte` (the one group label: `label`, `trailing`, `id`, `headingLevel`); `memoryTier.ts` + `ModelFinderView.svelte` :215–233 (stored choice read on mount, because `localStorage` does not exist during SSR); `useInMenu.ts` :12–13; `contexts/testProvideConnections.ts`.

## The API you code against (w1 is writing it — exact)

`modelsGroupBy.ts`:
```ts
export type ModelsGroupBy = "where" | "can-do" | "connection"
export const MODELS_GROUP_BY: readonly { value: ModelsGroupBy; label: string }[] // Where it lives · What it can do · Connection
export const DEFAULT_MODELS_GROUP_BY: ModelsGroupBy // "where"
export function readModelsGroupBy(): ModelsGroupBy // wrapped; default when unreadable
export function writeModelsGroupBy(value: ModelsGroupBy): void // wrapped
```
`modelsList.ts` (existing exports stay; these are new or widened):
```ts
// MODEL_SCOPES gains { id: "in-loadout", label: "In a loadout" } and { id: "on-disk", label: "On disk" } (transform null)
export function loadoutModelKeys(loadouts: readonly { filled: boolean; connectionId: number | null; connectionModelId: number | null; mergedInto: number | null }[]): Set<string>
export function livesInOf(entry): string | null      // "lives in Ollama" or null
export function isCantUse(entry): boolean
export function cantUseNoteOf(entry): string | null  // the reason, or null where the row already says it
export function filterModels(entries, opts: { query: string; scope: ModelScope; inLoadout?: ReadonlySet<string> | null })
export function scopeCounts(entries, inLoadout?: ReadonlySet<string> | null): Record<ModelScope, number>
export interface ModelsFold { connectionId: number; title: string | null; text: string }
export interface ModelsGroup<E> { key: string; label: string; sizeLabel: string | null; rows: E[]; folds: ModelsFold[]; remover: boolean }
export function groupModels<E extends FlatModel<any>>(entries: readonly E[], opts: {
	groupBy: ModelsGroupBy
	connections: readonly { id: number; name?: string | null; type?: string | null; models: readonly unknown[] }[]
	inLoadout: ReadonlySet<string> | null
	unfolded: ReadonlySet<number>
	folding: boolean
	remover: boolean
}): ModelsGroup<E>[]
```
`groupModels` already does all the deciding: which groups, their order and labels (last is *Can't be used right now*), which rows are folded away, the fold texts (*312 models · 1 in a loadout*, *312 models*, *+ 300 on OpenRouter*), the size label, and where the remover goes. The view only draws it.

## What to build — exact

### `ModelRow.svelte`
- New optional prop `metaTail?: string | null` (default null), doc comment: words that close the meta line after the facts or the note — the Models list's *lives in Ollama*.
- Both meta-line branches (with chip and without) draw `[note ?? factLine, metaTail].filter(Boolean).join(" · ")` and render the line when that is non-empty. Nothing else changes.

### `ModelsSidebar.svelte`
- `import { loadoutModelKeys } from "$lib/client/components/connections/modelsList"`.
- `const inLoadout = $derived(loadoutsList ? loadoutModelKeys(loadoutsList.loadouts) : null)` beside `loadoutsList`, with a one-line comment (the pairs a loadout's current pair names; null until `loadouts:list` answers, so the list folds services without exemptions).
- Pass `{inLoadout}` to `ModelsListView`. Update the header comment's "every model of every connection flat" to say grouped. Nothing else changes.

### `ModelsListView.svelte`
- New prop `inLoadout?: ReadonlySet<string> | null` (default `null`), doc comment: which (connection, model) pairs sit in a loadout (`loadoutModelKeys`), null until the loadouts answer — services then fold with no exemptions and the fold line omits the count.
- `let groupBy = $state<ModelsGroupBy>(DEFAULT_MODELS_GROUP_BY)`; read the stored choice on mount (`onMount(() => (groupBy = readModelsGroupBy()))`), never at init (SSR). `pickGroupBy(next)` sets it, calls `writeModelsGroupBy(next)` and closes the popout.
- `const unfolded = new SvelteSet<number>()` from `svelte/reactivity` (component state: per service, across groupings, reset each visit). **Never `$state(new Set())`.**
- `visible = filterModels(all, { query, scope, inLoadout })`; `counts = scopeCounts(all, inLoadout)`; `groups = $derived(groupModels(visible, { groupBy, connections: rows, inLoadout, unfolded, folding: !query.trim(), remover: isAdmin }))`.
- **Body** (the `{:else}` branch that draws the list today): keep the one `sr-only` `aria-live` summary line; then for each group (`{#each groups as group (group.key)}`) a `<section aria-labelledby={id}>` holding `ListGroupLabel` (`id`, `label={group.label}`, `trailing={group.sizeLabel ?? undefined}`), then a `role="list"` of `role="listitem"` rows drawn exactly as today's rows (same `ModelRow` props, same *Use in…* snippet), with two changes: `note={(isCantUse(entry) ? cantUseNoteOf(entry) : null) ?? noteOf(entry)}` and `metaTail={livesInOf(entry)}`; then each fold as one line (below); then `{#if group.remover}<MattingModelRow />{/if}`. DOM ids from the group key with every non-alphanumeric run replaced by `-` (`models-group-cap-text-text`), never `crypto.randomUUID`.
- **A fold line:** one row-height line in the group, muted 12px: the `title` (when non-null) in the row-name ink and weight, then `text`, then a quiet **Show** button (`btn btn-sm hover:preset-tonal-surface text-surface-600-400 shrink-0 text-xs`, the tray's **View** recipe) whose `onclick` is `unfolded.add(fold.connectionId)` and which carries `aria-describedby` pointing at the line's text span (id from group key + connection id). **Show** is the only new word here.
- **The background remover** stays where it is today (after the empty state, standalone) only when the groups are NOT drawn (loading done, admin, and: no connections, no models, or *Nothing matches.*). When groups are drawn it appears only through `group.remover`. Never twice.
- **Filter popout:** the existing `Model scope` radiogroup unchanged (it now lists seven, with their counts). Under it a hairline (`border-surface-200-800 my-1 border-t`), then a label line `Group by` (12px muted, `px-2.5 pt-1 pb-0.5`, with an `id`) and a second `role="radiogroup"` `aria-labelledby` that id: one `role="radio"` row per `MODELS_GROUP_BY` option, same row classes as the scope rows (checked row `sidebar-row-active`), no count. Grouping is not a narrowing: no chip, and it does not light the trigger (`toolbarButtonClass(scope !== "all")` stays as is). The chip for a narrowing stays today's (its label from `MODEL_SCOPES`).
- **Toolbar downloads button:** pass an `actions` snippet to `ViewToolbar` only while `trayCount > 0`: one `<button type="button">` with class `btn h-10 min-w-10 shrink-0 gap-1 px-2.5 preset-tonal-surface`, `title="Downloads"`, `aria-label="Downloads"`, `aria-expanded={trayOpen}`, `onclick={() => (trayOpen = true)}` (opens the tray's existing Downloads list, as its **View** does), content `<Icons.Download size={16} aria-hidden="true" />` then `<span class="text-sm tabular-nums">{trayCount}</span>`. The tray at the foot stays exactly as it is.
- Update the header comment (FLAT and sorted by name → grouped by the remembered **Group by**, services over twelve models folded, the toolbar's ↓ n) in the file's existing voice. Keep "The view decides no sentences and no filtering".

### `modelsListView.ssr.test.ts` (keep every existing test passing; add)
1. Default grouping: a KoboldCPP-managed connection and an OpenRouter one → *On this machine* before *Services*; a switched-off model renders under *Can't be used right now* with *Switched off*.
2. A local group's size total: KoboldCPP models with `facts: { sizeBytes, source: "file" }` → the summed size (e.g. `12 GB`) in the *On this machine* header.
3. Fold before loadouts answer: an OpenRouter connection with 13 models, no `inLoadout` → `13 models` and `Show`, the rows' names absent, and no `in a loadout`.
4. Fold with exemption: same, `inLoadout` = a Set holding one of them (`"<connectionId>:<modelId>"`) → that row present, `13 models · 1 in a loadout`.
5. A filter seeds nothing in SSR, so instead: 12 models → no fold, every row present.
6. An Ollama connection's row (`CONNECTION_TYPE.OLLAMA`) → `lives in Ollama`.
7. Nothing arriving → no `title="Downloads"` button.
Use the file's existing `renderList` helper and fixtures style. `render` from `svelte/server`, so assert markup, never layout.

## Rules (quoted; your work depends on them)

- Brief, from the lead: *"Labels are ruled: Group by options **Where it lives** · **What it can do** · **Connection**; last group **Can't be used right now**; fold line *‹n› models · ‹k› in a loadout* · **Show**; in What it can do *+ ‹n› on ‹service›* · **Show**; downloads button title *Downloads*. Any other new user-facing string or exported name → stop and ask the lead."* The only words your files add are *Show*, *Group by*, *Downloads* and the `metaTail` / `inLoadout` props named here. Need another → stop and say so.
- *"Pure logic lives in `.ts` files with unit tests; the Svelte files decide no sentences (existing pattern, `ModelsListView.svelte:22-23`)."*
- *"`$state(new Set())`/`new Map()` are not reactive on mutation — use `SvelteSet`/`SvelteMap`. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`. Views never call `toaster`. `socket.off(event)` always with the handler."*
- STYLE-GUIDE §6.3 (filter popout): *"a popover of `role="radio"` rows (single choice) with the checked row in the selected treatment; an active choice shows as one dismissible chip under the toolbar"*; *"An icon button that is ON (a filter in force…) is `preset-pressed`… gold, filled or tonal, always means 'do this', never 'this is on'."* **Never a bare icon button**: every toolbar icon button wears a preset.
- STYLE-GUIDE §6.4: the meta line's items are *"joined by ` · ` and never by hand"* — `ModelRow` joins with `" · "` in one place.
- ListGroupLabel: *"12px muted words over the group, sentence case, no rule, no count unless the caller puts one in `trailing`."*
- It is a **session**, never a *chat*, except the existing *Chat* kind label and *Set up chat*.
- Comments: what and why, in the file's voice; no "added by" or ticket chatter.

## Out of scope

`modelsList.ts`, `modelsGroupBy.ts` (w1), `MattingModelRow.svelte`, `DownloadsTray.svelte`, `ViewToolbar.svelte`, finder files, docs, STYLE-GUIDE, NOMENCLATURE. Per-group doors, loadout lines, a Downloads tab. Findings go under **Noticed, not done**.

## Stop and ask when

A new string, prop or export beyond this brief seems needed; the API above does not fit what the view needs (say what and why — do not work around it); a file outside **Files owned** needs a change.

## Done means

- `npx vitest run src/lib/client/components/connections/modelsListView.ssr.test.ts` green (and, once w1 has landed, `src/lib/client/components/connections/modelsList.test.ts` still green). Never pipe vitest into `head`.
- `npx svelte-check --threshold error --workspace . 2>&1 | grep -E "ModelsListView|ModelRow|ModelsSidebar|modelsListView" ` shows nothing (run once, at the end; it is slow).
- `npx prettier --check` on every file you changed (fix with `npx prettier --write <file>` on your files only).

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should need no `sdk:build`.)

## Report

Reply with: changed files; tests and checks run with results; any deviation from this brief; **Noticed, not done**.
