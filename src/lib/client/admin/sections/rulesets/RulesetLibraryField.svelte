<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	/**
	 * 🚧 A ruleset's **library** on Admin › Rulesets' change form
	 * (PLAN-ruleset-editor §6.3 step 7, lane P2) — §28's word for its
	 * compendium, always qualified: _the Sword and Sail library_. Where its
	 * rows come from and under what licence, once at the top; then, for each
	 * of its items, spells and the like that become lorebook entries (and any
	 * that already has rows), its rows: add, open one to edit it
	 * (`RulesetLibraryRowForm`, the lorebook entry's own form), remove, and
	 * **Import rows from JSON**. A list added or made entryable since the last
	 * Save opens here once it is saved: its form is the saved shape's.
	 * Every change waits for the page's Save (`rulesetLibraryForm.ts`).
	 */
	import * as Icons from "@lucide/svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"
	import CodeField from "$lib/client/components/codeField/CodeField.svelte"
	import RulesetLibraryRowForm from "./RulesetLibraryRowForm.svelte"
	import type { Json } from "./rulesetFormParts"
	import {
		mergeImported,
		newLibraryRow,
		parseImportedRows,
		pieceListOf,
		type DerivedEntryTypeShape,
		type LibraryForm,
		type LibraryRow
	} from "./rulesetLibraryForm"
	/** A list the library may hold rows for: an entry type, by its id and name. */
	type RepertoireCard = { id: string; label: string; entryable: boolean; original: { id?: string } | null }

	interface Props {
		library: LibraryForm
		/** The saved draft: the shape a row's form is drawn from. */
		savedDoc: Json
		/** The derived entry types the saved draft yields (`detail.derivedEntryTypes`). */
		entryTypes: readonly DerivedEntryTypeShape[]
		/** The form's cards, for labels and the lists not saved yet. */
		repertoires: readonly RepertoireCard[]
		/** The ruleset's name: "the ‹name› library". */
		name: string
		readonly?: boolean
	}
	let { library = $bindable(), savedDoc, entryTypes, repertoires, name, readonly = false }: Props = $props()

	const title = $derived(`The ${name || "ruleset's"} library`)
	let open = $state<string | null>(null)
	let importing = $state<string | null>(null)
	let importText = $state("")
	let importErrors = $state<string[]>([])
	let imported = $state<{ list: string; words: string } | null>(null)

	const cardFor = (repId: string) => repertoires.find((c) => (c.original?.id ?? c.id) === repId)
	const labelFor = (repId: string) => {
		const c = cardFor(repId)
		return c?.label.trim() || c?.id.trim() || repId
	}
	/** Entryable cards with no list here yet: new, or made entryable since Save. */
	const waiting = $derived(
		repertoires.filter((c) => c.entryable && !library.lists.some((l) => l.repertoireId === (c.original?.id ?? c.id)))
	)
	const pieceLists = $derived(new Map(library.lists.map((l) => [l.repertoireId, pieceListOf(l.repertoireId, savedDoc, entryTypes)])))
	const librarySource = $derived({ document: library.sourceDocument, licence: library.sourceLicence })

	/** A filter box over a list's rows once it is longer than this. */
	const FILTER_FROM = 10
	const ROW_GRID = "grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_5rem_minmax(0,1.5fr)_auto]"
	let filters = $state<Record<string, string>>({})
	const matches = (repId: string, r: LibraryRow) => {
		const q = (filters[repId] ?? "").trim().toLowerCase()
		return !q || `${rowName(r)} ${r.id}`.toLowerCase().includes(q)
	}

	const rowName = (r: LibraryRow) => (typeof r.piece.name === "string" && r.piece.name.trim()) || r.id || "New row"
	const rowSource = (r: LibraryRow) =>
		r.sourceDocument || r.sourceLicence
			? [r.sourceDocument, r.sourceLicence].filter(Boolean).join(", ")
			: library.sourceDocument
				? "As the library says"
				: "No source said"

	function addRow(listIndex: number) {
		const row = newLibraryRow()
		library.lists[listIndex]!.rows.push(row)
		open = row.uid
	}
	function removeRow(listIndex: number, uid: string) {
		const list = library.lists[listIndex]!
		list.rows = list.rows.filter((r) => r.uid !== uid)
		if (open === uid) open = null
	}
	function startImport(repId: string) {
		importing = importing === repId ? null : repId
		importText = ""
		importErrors = []
		imported = null
	}
	function runImport(listIndex: number) {
		const list = library.lists[listIndex]!
		const parsed = parseImportedRows(importText)
		if (!parsed.ok) {
			importErrors = parsed.errors
			return
		}
		const merged = mergeImported(list.rows, parsed.rows)
		list.rows = merged.rows
		const parts = [
			merged.added ? `Added ${merged.added} row${merged.added === 1 ? "" : "s"}` : "",
			merged.replaced ? `replaced ${merged.replaced}` : ""
		].filter(Boolean)
		imported = { list: list.repertoireId, words: `${parts.join(", ")}. They are saved with the rest.` }
		importing = null
		importText = ""
		importErrors = []
	}
</script>

<AdminFieldset
	id="library"
	{title}
	description="The ready-made rows people pick from: weapons, spells, conditions. Each row is edited as the same thing is edited as a lorebook entry."
>
	{#if readonly}
		{#if library.sourceDocument || library.sourceLicence}
			<p class="text-sm">From {library.sourceDocument || "an unnamed document"}{library.sourceLicence ? `, licensed ${library.sourceLicence}` : ""}.</p>
		{/if}
		{#each library.lists as list (list.repertoireId)}
			<div class="flex flex-col gap-1" data-library-list={list.repertoireId}>
				<h3 class="text-sm font-medium">{labelFor(list.repertoireId)}</h3>
				<p class="text-surface-600-400 text-xs">
					{list.rows.length ? list.rows.map(rowName).join(" · ") : "No rows."}
				</p>
			</div>
		{:else}
			<p class="text-surface-600-400 text-sm">No rows.</p>
		{/each}
	{:else}
		<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
			<AdminField id="ruleset-library-source" label="Comes from" help="The document the rows are from, like SRD 5.2.1. A row may say its own.">
				<input
					id="ruleset-library-source"
					class="input"
					type="text"
					bind:value={library.sourceDocument}
					aria-describedby={describedBy("ruleset-library-source", false)}
				/>
			</AdminField>
			<AdminField id="ruleset-library-licence" label="Licence" help="It travels with every copy, like CC-BY-4.0.">
				<input
					id="ruleset-library-licence"
					class="input"
					type="text"
					bind:value={library.sourceLicence}
					aria-describedby={describedBy("ruleset-library-licence", false)}
				/>
			</AdminField>
		</div>

		{#each library.lists as list, li (list.repertoireId)}
			{@const label = labelFor(list.repertoireId)}
			{@const pieceList = pieceLists.get(list.repertoireId) ?? null}
			<section class="flex flex-col gap-2" aria-label="{label} in {title.toLowerCase()}" data-library-list={list.repertoireId}>
				<div class="flex flex-wrap items-center gap-2">
					<h3 class="text-sm font-medium">{label}</h3>
					<span class="text-surface-600-400 text-xs">
						{list.rows.length} row{list.rows.length === 1 ? "" : "s"}
					</span>
				</div>
				{#if !pieceList}
					<p class="text-warning-700-300 text-xs">
						These rules no longer declare {label}: its rows are kept, and can be edited in the Document.
					</p>
				{/if}
				{#if list.rows.length > FILTER_FROM}
					<label class="flex max-w-xs flex-col gap-1 text-xs">
						<span class="sr-only">Filter {list.rows.length} rows of {label}</span>
						<input
							class="input text-sm"
							type="search"
							placeholder="Filter {list.rows.length} rows"
							value={filters[list.repertoireId] ?? ""}
							oninput={(e) => (filters[list.repertoireId] = e.currentTarget.value)}
						/>
					</label>
				{/if}
				{#if list.rows.length}
					<!-- A table's columns from 45rem of pane (Name · Id · Version · Comes from); stacked below. -->
					<div
						class="text-surface-600-400 hidden gap-3 px-1 text-xs @min-[45rem]/content:grid {ROW_GRID}"
						aria-hidden="true"
					>
						<span>Name</span><span>Id</span><span>Version</span><span>Comes from</span><span></span>
					</div>
					<ul class="flex flex-col">
						{#each list.rows as row, ri (row.uid)}
							{#if open === row.uid || matches(list.repertoireId, row)}
								<li class="border-surface-200-800 flex flex-col gap-3 border-b px-1 py-2 last:border-b-0" data-library-row={row.id}>
									<div class="flex flex-wrap items-center gap-x-3 gap-y-1 @min-[45rem]/content:grid {ROW_GRID}">
										<p class="min-w-0 flex-[1_1_12rem] truncate text-sm font-medium">{rowName(row)}</p>
										<p class="text-surface-600-400 min-w-0 font-mono text-xs break-all">{row.id || "no id yet"}</p>
										<p class="text-surface-600-400 text-xs">{row.version || "no version"}</p>
										<p class="text-surface-600-400 min-w-0 text-xs break-words">{rowSource(row)}</p>
										<span class="ml-auto inline-flex items-center gap-1">
											{#if pieceList}
												<button
													type="button"
													class="btn btn-sm preset-tonal-surface"
													aria-expanded={open === row.uid}
													onclick={() => (open = open === row.uid ? null : row.uid)}
												>
													{open === row.uid ? "Close" : "Edit"} <span class="sr-only">{rowName(row)}</span>
												</button>
											{/if}
											<button
												type="button"
												class="btn-icon btn-icon-sm hover:preset-tonal-error"
												aria-label="Remove {rowName(row)}"
												onclick={() => removeRow(li, row.uid)}
											>
												<Icons.X size={14} aria-hidden="true" />
											</button>
										</span>
									</div>
									{#if open === row.uid && pieceList}
										<RulesetLibraryRowForm
											bind:row={list.rows[ri]}
											list={pieceList}
											{librarySource}
											idPrefix="ruleset-library-{list.repertoireId}-{ri}"
										/>
									{/if}
								</li>
							{/if}
						{/each}
					</ul>
					{#if (filters[list.repertoireId] ?? "").trim() && !list.rows.some((r) => matches(list.repertoireId, r))}
						<p class="text-surface-600-400 text-sm">No row of {label} matches.</p>
					{/if}
				{/if}
				{#if imported?.list === list.repertoireId}
					<p class="text-sm" role="status">{imported.words}</p>
				{/if}
				{#if pieceList}
					<div class="flex flex-wrap gap-2">
						<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => addRow(li)}>
							<Icons.Plus size={14} aria-hidden="true" /> Add a row <span class="sr-only">to {label}</span>
						</button>
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface"
							aria-expanded={importing === list.repertoireId}
							onclick={() => startImport(list.repertoireId)}
						>
							<Icons.FileJson size={14} aria-hidden="true" /> Import rows from JSON <span class="sr-only">into {label}</span>
						</button>
					</div>
				{/if}
				{#if importing === list.repertoireId}
					<div class="flex flex-col gap-2" data-library-import={list.repertoireId}>
						<FieldHelp>
							Paste a list of rows, each <span class="font-mono">{"{ id, version, source?, lang?, piece: { name, description, … } }"}</span>. A
							row whose id is already here replaces it.
						</FieldHelp>
						<CodeField
							id="ruleset-library-import-{list.repertoireId}"
							label="Rows to import into {label} (JSON)"
							value={importText}
							oninput={(v) => (importText = v)}
							rows={8}
							describedBy={importErrors.length ? `ruleset-library-import-${list.repertoireId}-issues` : undefined}
							invalid={importErrors.length > 0}
						/>
						{#if importErrors.length}
							<ul id="ruleset-library-import-{list.repertoireId}-issues" class="text-error-600-400 flex flex-col gap-0.5 text-xs" role="alert">
								{#each importErrors as e (e)}<li>{e}</li>{/each}
							</ul>
						{/if}
						<div class="flex flex-wrap gap-2">
							<button type="button" class="btn btn-sm preset-tonal-primary" disabled={!importText.trim()} onclick={() => runImport(li)}>
								Add these rows
							</button>
							<button type="button" class="btn btn-sm preset-tonal-surface" onclick={() => startImport(list.repertoireId)}>Cancel</button>
						</div>
					</div>
				{/if}
			</section>
		{/each}

		{#each waiting as card, i (card.id || i)}
			<p class="text-surface-600-400 text-xs" data-library-waiting={card.id}>
				{card.label.trim() || card.id.trim() || "The new one"}: save first, and its rows can be added here.
			</p>
		{/each}

		{#if !library.lists.length && !waiting.length}
			<p class="text-surface-600-400 text-sm">
				None yet. Rows are added for items, spells and the like that can be lorebook entries.
			</p>
		{/if}
	{/if}
</AdminFieldset>
