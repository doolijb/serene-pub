<script lang="ts">
	import type { EntryEditorProps } from "./types"
	import EntryAdvancedFields from "./EntryAdvancedFields.svelte"
	import EntryCoreFields from "./EntryCoreFields.svelte"
	import PlaceLinks from "../places/PlaceLinks.svelte"
	import PlaceStats from "../places/PlaceStats.svelte"
	import { socketPlaceStatsApi } from "../places/placeStatsApi"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getLorePoolCtx } from "./poolContext"
	import { getBookRelationships } from "../relationships.svelte"
	import { loreRoute } from "../loreRoute.svelte"
	import { openBookTime } from "../time/bookTime.svelte"

	/**
	 * A place (plan places-graph §10.3, B5): world lore's fields, its
	 * **Category**, and its **Links** — the relationships that give a place
	 * its shape, each said from here and edited with the canvas's own fields.
	 *
	 * ⚠ **No Part of.** A place is never filed under anything (owner ruling
	 * 2026-09-29, the role map): `EntryCoreFields`' `PartOfField` draws
	 * nothing for a type that declares no `parent` role. "Inside" is a link
	 * (`is inside` / `holds`).
	 * ⚠ **Links are not entry columns.** Each row saves on its own, through the
	 * relationship store, never with Save or Save as of (§9).
	 * **Read links from the Exits line** (B7) reads the body as it stands in
	 * the editor, saved or not: the line on screen is the line read.
	 * 🚧 **Stats** (L4): what the lorebook holds for the place before play —
	 * its inventory, and the place stats the book records. Written at once,
	 * like a Link, at the line and moment being read; never part of Save.
	 */
	let {
		draft = $bindable(),
		bindings = $bindable(),
		vectorizationEnabled,
		lorebookId,
		source,
		isNew
	}: EntryEditorProps = $props()

	const poolCtx = getLorePoolCtx()
	const relationships = getBookRelationships()
	const statsApi = socketPlaceStatsApi(useTypedSocket())

	let route = $derived(loreRoute.route)
	let reading = $derived({
		branchId: route.branch ?? null,
		line: openBookTime.lineOf(route.branch ?? null),
		moment: route.moment,
		datedBy: poolCtx.historyEntries,
		lineName: (branchId: number | null) => openBookTime.lineName(branchId)
	})
</script>

<EntryCoreFields
	bind:draft
	bind:bindings
	idPrefix="ple"
	{vectorizationEnabled}
	namePlaceholder="The Guardroom"
/>

<div class="flex flex-col gap-1">
	<label class="text-sm font-semibold" for="pleCategory">Category</label>
	<input
		id="pleCategory"
		class="input preset-filled-surface-200-800 w-full rounded-lg"
		type="text"
		placeholder="A floor, a district, a wing"
		aria-describedby="pleCategoryHint"
		value={draft.category ?? ""}
		oninput={(e) => (draft.category = e.currentTarget.value || null)}
	/>
	<p class="text-surface-600-400 text-xs" id="pleCategoryHint">
		Groups places together. Free text.
	</p>
</div>

{#if isNew || !source}
	<div class="flex flex-col gap-1" data-place-links-unsaved>
		<p class="text-sm font-semibold">Links</p>
		<p class="text-surface-600-400 text-xs">
			Create the place first, then link it to the places it leads to.
		</p>
	</div>
	<div class="flex flex-col gap-1" data-place-stats-unsaved>
		<p class="text-sm font-semibold">Stats</p>
		<p class="text-surface-600-400 text-xs">
			Create the place first, then set what lies in it.
		</p>
	</div>
{:else}
	<PlaceLinks
		place={{ id: source.id, name: (source.name ?? "").trim() || "This place" }}
		{lorebookId}
		{relationships}
		pool={poolCtx.pool}
		{reading}
		createPlace={poolCtx.createPlace}
		content={typeof draft.content === "string" ? draft.content : ""}
	/>
	<PlaceStats
		place={{ id: source.id, name: (source.name ?? "").trim() || "This place" }}
		{lorebookId}
		pool={poolCtx.pool}
		{reading}
		api={statsApi}
	/>
{/if}

<EntryAdvancedFields bind:draft idPrefix="ple" {vectorizationEnabled} />
