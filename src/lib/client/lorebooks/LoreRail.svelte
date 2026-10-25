<script lang="ts" module>
	import * as Icons from "@lucide/svelte"
	import type { Component } from "svelte"
	import type { LoreLens, LoreScope } from "$lib/shared/lorebooks/loreRoute"
	import type { SavedScopeId } from "./scopes"
	import { descriptorFor } from "./sections"

	/**
	 * A scope's icon is its door's (`sections/index.ts`); Cast has no door of
	 * its own — it is the board — so it takes the board's people. The rail
	 * and the compact scope popout draw the same icon for the same scope.
	 */
	export function scopeIcon(id: LoreScope): Component<any> | undefined {
		return id === "cast" ? Icons.Users : descriptorFor(id)?.icon
	}

	/** A saved scope's icon, in the rail and the scope popout alike. */
	export const SAVED_SCOPE_ICONS: Record<SavedScopeId, Component<any>> = {
		pinned: Icons.Pin
	}

	/** Book settings' row key, beside the scopes' and saved scopes' keys. */
	const BOOK_SETTINGS_KEY = "book:settings"

	/** A saved scope's row key, beside the scopes' own keys. */
	export function savedKey(id: SavedScopeId): string {
		return `saved:${id}`
	}
</script>

<script lang="ts">
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import SectionList from "$lib/client/components/panels/SectionList.svelte"
	import type { SectionGroup } from "$lib/client/components/panels/sectionList"
	import { DEFAULT_LENS } from "$lib/shared/lorebooks/loreRoute"
	import { lensDescriptor, lensDrawsScope } from "./lenses/registry"
	import { looseEndsLabel, SAVED_SCOPES, type ScopeFacet } from "./scopes"

	/**
	 * The book's section list: the scopes, and only the scopes (design A.3).
	 *
	 * - Head: the filter box. Nothing else.
	 * - **Views**: the seven scopes with their figures.
	 * - 🚧 **‹Rules›** (Vis Itineris): the book's rules lists — Weapons,
	 *   Spells… — one row per list the book draws, which is only where it has
	 *   something in it (ruled 2026-10-21, `rulesListFacets`). Absent when it
	 *   draws none, so a Freeform book's rail is the rail it always was.
	 * - **Saved**: the saved scopes — Pinned — each a row like a scope's,
	 *   current INSTEAD of one (`aria-current`), because a saved scope is a
	 *   scope (`scopes.ts`), and choosing one opens Everything
	 *   (`savedScopeRoute`). Future saved scopes land here.
	 * - **Book**: **Book settings** — a place (it has a route, and Escape
	 *   leaves it), so it is a row, current while it is open (2026-10-21,
	 *   owner: "make the edit lorebook settings more obvious"). Owners only.
	 * - Foot: one quiet line, "3 loose ends ›", which opens the Loose ends
	 *   queue. The queue is a chore list, never a place, so it is not a row.
	 *
	 * Nothing here is a mode. The scopes are facets over one pool and every one
	 * of them is offered in every book: an empty facet sorts last and shows its
	 * 0 rather than disappearing, because a facet that vanishes teaches the
	 * reader the capability does not exist. It stays a row that opens: an empty
	 * scope is where its lens offers to add the first one.
	 *
	 * Under a lens that draws its own set whatever the scope (Lives, Places:
	 * `drawsScope` "ignores"), the Views rows are dimmed, which is the lens ×
	 * scope rule said on screen; choosing one still opens that scope, in the
	 * default lens (`scopeRoute`).
	 */
	interface Props {
		scopes: ScopeFacet[]
		/**
		 * The scope in force; null when no row is current, the saved scope's
		 * included (Book settings is open).
		 */
		scope: LoreScope | null
		/** The lens in force, which says whether the scope rows draw anything. */
		lens: LoreLens
		search: string
		savedCounts: Record<SavedScopeId, number>
		/** The saved scope in force, which is current instead of a scope. */
		saved: SavedScopeId | null
		/** How many loose ends the book has now (note 5). */
		looseEndsCount: number
		/** Whether the Loose ends queue is open, which hides the foot's line. */
		looseEndsOpen?: boolean
		/** Opens the Loose ends queue. */
		onOpenLooseEnds: () => void
		onScope: (scope: LoreScope) => void
		onSaved: (saved: SavedScopeId | null) => void
		onSearch: (search: string) => void
		/** Opens Book settings; absent (a book shared with the reader) draws no row. */
		onOpenSettings?: () => void
		/** Book settings is open: its row is the current one. */
		settingsOpen?: boolean
		/**
		 * The book's rules lists, under the rules' name; null (or absent)
		 * draws no group.
		 */
		rulesGroup?: { label: string; facets: ScopeFacet[] } | null
	}

	let {
		scopes,
		scope,
		lens,
		search,
		savedCounts,
		saved,
		looseEndsCount,
		looseEndsOpen = false,
		onOpenLooseEnds,
		onScope,
		onSaved,
		onSearch,
		onOpenSettings,
		settingsOpen = false,
		rulesGroup = null
	}: Props = $props()

	const groups = $derived<SectionGroup[]>([
		{
			label: "Views",
			items: scopes.map((facet) => ({
				key: facet.id,
				label: facet.label,
				icon: scopeIcon(facet.id),
				count: facet.count
			}))
		},
		...(rulesGroup
			? [
					{
						label: rulesGroup.label,
						items: rulesGroup.facets.map((facet) => ({
							key: facet.id,
							label: facet.label,
							icon: scopeIcon(facet.id),
							count: facet.count
						}))
					}
				]
			: []),
		{
			label: "Saved",
			items: SAVED_SCOPES.map((s) => ({
				key: savedKey(s.id),
				label: s.label,
				icon: SAVED_SCOPE_ICONS[s.id],
				count: savedCounts[s.id]
			}))
		},
		...(onOpenSettings
			? [
					{
						label: "Book",
						items: [
							{
								key: BOOK_SETTINGS_KEY,
								label: "Book settings",
								icon: Icons.SlidersHorizontal
							}
						]
					}
				]
			: [])
	])

	/** One row is current: the saved scope in force, else the scope. */
	const value = $derived(
		settingsOpen
			? BOOK_SETTINGS_KEY
			: scope === null
				? null
				: saved
					? savedKey(saved)
					: scope
	)

	const showLooseEnds = $derived(looseEndsCount > 0 && !looseEndsOpen)

	/** Every scope row is ignored by the lens in force (Lives, Places). */
	const scopesIgnored = $derived(
		scopes.length > 0 &&
			scopes.every(
				(facet) => lensDrawsScope(lens, facet.id) === "ignores"
			)
	)

	function select(key: string) {
		if (key === BOOK_SETTINGS_KEY) {
			onOpenSettings?.()
			return
		}
		const savedScope = SAVED_SCOPES.find((s) => savedKey(s.id) === key)
		if (savedScope) {
			onSaved(savedScope.id)
			return
		}
		// A scope chosen is current instead of the saved scope, so the
		// saved scope's narrowing goes with it.
		if (saved) onSaved(null)
		onScope(key as LoreScope)
	}
</script>

{#snippet head()}
	<!-- The app's one filter box (note 13): the same component and words
	     as every other view's, and no shortcut of its own — Jump (Ctrl K /
	     ⌘K, the pill at the top right) is scoped to this view and fills
	     this box as you type. -->
	<PanelFilterInput
		bind:value={() => search, (next) => onSearch(next)}
		data-lore-search
		placeholder="Search this book"
		aria-label="Search this book"
	/>
	{#if scopesIgnored}
		<p class="sr-only">
			{lensDescriptor(lens).label} draws the same whatever the view; choosing
			a view opens it in {lensDescriptor(DEFAULT_LENS).label}.
		</p>
	{/if}
{/snippet}

{#snippet foot()}
	<button
		type="button"
		class="btn btn-sm hover:preset-tonal-surface text-surface-600-400 self-start"
		title="What is left to finish in this book, one fix at a time"
		data-lore-loose-ends
		onclick={onOpenLooseEnds}
	>
		<span>{looseEndsLabel(looseEndsCount)}</span>
		<Icons.ChevronRight size={14} aria-hidden="true" />
	</button>
{/snippet}

<!-- The Views rows dim as a group while the lens ignores them: the nav's
     first list is the Views group (`groups` above). -->
<SectionList
	ariaLabel="Lorebook"
	flush={true}
	class={scopesIgnored ? "[&>ul:first-of-type]:opacity-60" : ""}
	{groups}
	{value}
	onselect={select}
	{head}
	foot={showLooseEnds ? foot : undefined}
/>
