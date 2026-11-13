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
	import { reduce } from "$lib/shared/lorebooks/loreRoute"
	import CastWorkspace from "../CastWorkspace.svelte"
	import EntryWorkspace from "../EntryWorkspace.svelte"
	import { getBookData } from "../bookData.svelte"
	import { loreRoute } from "../loreRoute.svelte"
	import {
		descriptorFor,
		rulesListDoor,
		SECTION_DESCRIPTORS
	} from "../sections"
	import type { LensProps } from "./types"
	import { getContext } from "svelte"
	import { showsAdvancedControls } from "$lib/client/advancedControls"

	let {
		lens,
		lorebookId,
		bench,
		hasUnsavedChanges = $bindable(false)
	}: LensProps = $props()

	const book = getBookData()

	let scope = $derived(bench.route.scope)
	let section = $derived(descriptorFor(scope, book.lorebookId))
	/**
	 * Every door the pool draws, which is what "Everything" holds: core's,
	 * then each of the book's rules lists (PLAN-lorebook-kinds §C). Every
	 * list's rows are the book's, so all of them are here; New offers only
	 * the lists the book draws (ruled 2026-10-21), so the rest are not
	 * creatable from Everything.
	 */
	const coreDoors = SECTION_DESCRIPTORS.filter((d) => d.id !== "all")
	let doors = $derived.by(() => {
		const drawn = new Set(book.drawnRulesLists.map((l) => l.typeId))
		return [
			...coreDoors,
			...book.rulesLists.map((list) => {
				const door = rulesListDoor(list, book.lorebookId)
				return drawn.has(list.typeId) ? door : { ...door, creatable: false }
			})
		]
	})

	// Advanced controls off hides the Graph lens, so its door goes too (★adv-D-1).
	const userSettingsCtx = getContext<UserSettingsCtx | undefined>(
		"userSettingsCtx"
	)
	const advanced = $derived(showsAdvancedControls(userSettingsCtx?.settings))

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
		onViewRelationships={advanced ? viewRelationships : undefined}
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
			bind:hasUnsavedChanges
			onFilters={bench.applyFilters}
			onNavigateToGraph={advanced
				? () => bench.openLens("graph")
				: undefined}
			queue={bench.queue}
			focusField={bench.focusField}
			onSaved={bench.onSaved}
		/>
	{/key}
{/if}
