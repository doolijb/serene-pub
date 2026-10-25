<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { Component } from "svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import type { LoreScope } from "$lib/shared/lorebooks/loreRoute"
	import { toolbarButtonClass } from "$lib/client/components/panels/toolbarButton"
	import { SAVED_SCOPE_ICONS, savedKey, scopeIcon } from "./LoreRail.svelte"
	import {
		looseEndsLabel,
		SAVED_SCOPES,
		scopeChipLabel,
		type SavedScopeId,
		type ScopeFacet
	} from "./scopes"

	/**
	 * The compact scope picker (design A.4): the rail's rows in a popout, for
	 * the find row beside the filter box. A 40px toolbar button wearing the
	 * chosen scope's icon, tonal primary while anything narrower than
	 * Everything is chosen (STYLE-GUIDE §6.3, the filter popout), opening
	 * `role="radio"` rows — the seven scopes, then the saved scopes, each with
	 * its figure. The chosen scope is said once more as one dismissible chip
	 * under the find row (`scopeChipLabel`), which the workspace draws.
	 *
	 * The Loose ends queue's line closes the popout, after the rows and
	 * outside them: the queue is a chore list, never a scope.
	 */
	interface Props {
		scopes: ScopeFacet[]
		scope: LoreScope
		savedCounts: Record<SavedScopeId, number>
		/** The saved scope in force, which is chosen instead of a scope. */
		saved: SavedScopeId | null
		onScope: (scope: LoreScope) => void
		onSaved: (saved: SavedScopeId | null) => void
		/** How many loose ends the book has; 0 draws no line. */
		looseEndsCount?: number
		/** Opens the Loose ends queue. Absent draws no line. */
		onOpenLooseEnds?: () => void
		/** Opens Book settings. Absent (a shared book) draws no line. */
		onOpenSettings?: () => void
		/** The book's rules lists under the rules' name, as the rail draws them. */
		rulesGroup?: { label: string; facets: ScopeFacet[] } | null
	}

	let {
		scopes,
		scope,
		savedCounts,
		saved,
		onScope,
		onSaved,
		looseEndsCount = 0,
		onOpenLooseEnds,
		onOpenSettings,
		rulesGroup = null
	}: Props = $props()

	let open = $state(false)

	const chosenLabel = $derived(scopeChipLabel(scope, saved))
	const ChosenIcon = $derived(
		saved
			? SAVED_SCOPE_ICONS[saved]
			: (scopeIcon(scope) ?? Icons.LayoutList)
	)
	const label = $derived(`Views: ${chosenLabel ?? "Everything"}`)

	/** A pick applies and closes the popout: one choice, one interaction. */
	function pickScope(next: LoreScope) {
		open = false
		if (saved) onSaved(null)
		onScope(next)
	}

	function pickSaved(next: SavedScopeId) {
		open = false
		onSaved(next)
	}

	function openLooseEnds() {
		open = false
		onOpenLooseEnds?.()
	}

	function rowClass(checked: boolean) {
		return `flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm ${
			checked ? "sidebar-row-active" : "hover:bg-surface-200-800"
		}`
	}
</script>

{#snippet row(
	key: string,
	text: string,
	Icon: Component<any> | undefined,
	count: number | undefined,
	checked: boolean,
	onclick: () => void
)}
	<button
		type="button"
		role="radio"
		aria-checked={checked}
		class={rowClass(checked)}
		data-lore-scope={key}
		{onclick}
	>
		{#if Icon}
			<Icon
				size={16}
				class="text-surface-600-400 shrink-0"
				aria-hidden="true"
			/>
		{/if}
		<span class="min-w-0 flex-1 truncate">{text}</span>
		{#if count !== undefined}
			<span
				class="badge shrink-0 text-meta {checked
					? 'bg-surface-300-700'
					: 'preset-tonal-surface'}"
			>
				{count}
			</span>
		{/if}
	</button>
{/snippet}

<Popover
	{open}
	onOpenChange={(e) => (open = e.open)}
	positioning={{ placement: "bottom-end" }}
>
	<Popover.Trigger
		class={toolbarButtonClass(chosenLabel !== null)}
		title={label}
		aria-label={label}
		aria-expanded={open}
		data-lore-scope-popout
	>
		<ChosenIcon size={16} aria-hidden="true" />
	</Popover.Trigger>
	<Portal>
		<Popover.Positioner class="z-[1000]!">
			<Popover.Content
				class="card bg-surface-50-950 border-surface-200-800 w-[min(90vw,260px)] border p-2 shadow-xl"
			>
				<div
					class="flex max-h-[min(60vh,420px)] flex-col gap-0.5 overflow-y-auto"
					role="radiogroup"
					aria-label="Views"
				>
					{#each scopes as facet (facet.id)}
						{@render row(
							facet.id,
							facet.label,
							scopeIcon(facet.id),
							facet.count,
							!saved && scope === facet.id,
							() => pickScope(facet.id)
						)}
					{/each}
					{#if rulesGroup}
						<!-- The book's rules lists, under the rules' name,
						     as the rail's group after Views. -->
						<p
							class="text-surface-600-400 mt-2 px-2.5 text-xs font-semibold"
							data-lore-rules-group
						>
							{rulesGroup.label}
						</p>
						{#each rulesGroup.facets as facet (facet.id)}
							{@render row(
								facet.id,
								facet.label,
								scopeIcon(facet.id),
								facet.count,
								!saved && scope === facet.id,
								() => pickScope(facet.id)
							)}
						{/each}
					{/if}
					<div
						class="border-surface-200-800 my-1 border-t"
						aria-hidden="true"
					></div>
					{#each SAVED_SCOPES as s (s.id)}
						{@render row(
							savedKey(s.id),
							s.label,
							SAVED_SCOPE_ICONS[s.id],
							savedCounts[s.id],
							saved === s.id,
							() => pickSaved(s.id)
						)}
					{/each}
				</div>
				{#if onOpenSettings}
					<!-- A place, not a view: after the rows, like the
					     rail's Book group (2026-10-21). -->
					<div class="border-surface-200-800 mt-1 border-t pt-1">
						<button
							type="button"
							class="btn btn-sm hover:preset-tonal-surface w-full justify-between"
							title="Name, cover, rules, calendar and clock"
							data-lore-book-settings-open
							onclick={() => {
								open = false
								onOpenSettings?.()
							}}
						>
							<span class="flex items-center gap-2">
								<Icons.SlidersHorizontal size={14} aria-hidden="true" />
								Book settings
							</span>
							<Icons.ChevronRight size={14} aria-hidden="true" />
						</button>
					</div>
				{/if}
				{#if onOpenLooseEnds && looseEndsCount > 0}
					<div class="border-surface-200-800 mt-1 border-t pt-1">
						<button
							type="button"
							class="btn btn-sm hover:preset-tonal-surface text-surface-600-400 w-full justify-between"
							title="What is left to finish in this book, one fix at a time"
							data-lore-loose-ends
							onclick={openLooseEnds}
						>
							<span>{looseEndsLabel(looseEndsCount)}</span>
							<Icons.ChevronRight size={14} aria-hidden="true" />
						</button>
					</div>
				{/if}
			</Popover.Content>
		</Popover.Positioner>
	</Portal>
</Popover>
