<script lang="ts">
	/**
	 * The pool lenses' mount — List, Cards and Tree draw one pool three ways,
	 * so moving between them never remounts the screen (the list keeps its
	 * scroll, the split its width, an open edit its draft).
	 *
	 * The scope picks the page: the Cast scope is the Cast board (Cards is its
	 * portrait grid, every other pool lens its roster); every other scope is
	 * the entry workspace over that scope's door. `#key` rebuilds the entry
	 * workspace when the scope changes, so one scope never renders another
	 * one's rows. The workspace keys every mount on the book.
	 */
	import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
	import { reduce, SCOPE_LABELS } from "$lib/shared/lorebooks/loreRoute"
	import CastWorkspace from "../CastWorkspace.svelte"
	import EntryWorkspace from "../EntryWorkspace.svelte"
	import { getBookData } from "../bookData.svelte"
	import { loreRoute } from "../loreRoute.svelte"
	import { descriptorFor, SECTION_DESCRIPTORS } from "../sections"
	import type { LensProps } from "./types"

	let {
		lens,
		lorebookId,
		bench,
		hasUnsavedChanges = $bindable(false)
	}: LensProps = $props()

	const book = getBookData()

	let scope = $derived(bench.route.scope)
	let section = $derived(descriptorFor(scope))
	/** Every door the pool draws, which is what "Everything" holds. */
	const doors = SECTION_DESCRIPTORS.filter((d) => d.id !== "all")

	function viewRelationships(castId: number) {
		// ONE transition, one guard (#81, plan B7): two navigates in a row
		// switched the lens even when the discard prompt was cancelled.
		bench.leaveQueue()
		void loreRoute.navigateTo(
			reduce(reduce(bench.route, { type: "openCastMember", castId }), {
				type: "setLens",
				lens: "graph"
			})
		)
	}
</script>

{#if scope === "cast"}
	<CastWorkspace
		{lorebookId}
		mode={bench.mode}
		lens={lens.id}
		decisions={bench.decisions}
		resolveCast={bench.resolveCast}
		castAmendmentsFor={bench.castAmendmentsFor}
		moment={bench.route.moment}
		presences={bench.presences}
		line={bench.line}
		branchName={bench.branchName}
		bind:hasUnsavedChanges
		suggestionsRequest={bench.suggestionsRequest}
		onViewRelationships={viewRelationships}
	/>
{:else if section}
	{#key section.id}
		<EntryWorkspace
			{lorebookId}
			descriptor={section}
			{doors}
			bookPool={bench.bookPool}
			castItems={bench.castItems}
			bookLinks={bench.bookLinks}
			historyEntries={book.rawRows[HISTORY_TYPE_ID] ?? []}
			line={bench.line}
			resolve={bench.resolveRows}
			amendmentsFor={bench.amendmentsFor}
			mode={bench.mode}
			lens={lens.id}
			filters={bench.filters}
			readInKeys={bench.readInKeys}
			decisions={bench.decisions}
			scopeTitle={SCOPE_LABELS[scope]}
			bind:hasUnsavedChanges
			onFilters={bench.applyFilters}
			onNavigateToGraph={() => bench.openLens("graph")}
			queue={bench.queue}
			focusField={bench.focusField}
			onSaved={bench.onSaved}
		/>
	{/key}
{/if}
