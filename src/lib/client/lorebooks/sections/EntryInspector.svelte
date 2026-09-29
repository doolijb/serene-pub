<script lang="ts">
	import EntryFireTest from "$lib/client/components/lorebookForms/EntryFireTest.svelte"
	import type { EntryTypeId } from "$lib/shared/entries/types"
	import { loreRoute } from "../loreRoute.svelte"
	import { containedBy } from "../editor/partOf"
	import { entryRefs, type RefLink } from "../editor/refs"
	import { inspectorTabsFor } from "../editor/inspectorTabs"
	import RefsList from "../editor/RefsList.svelte"
	import { SCENE_KIND, type PoolItem } from "../poolFilter"
	import HistorySceneList from "./HistorySceneList.svelte"
	import { getLorePoolCtx } from "./poolContext"
	import { kindLabel } from "./kinds"
	import type { PoolSource, SectionDescriptor } from "./types"

	/**
	 * The second level of the editor, and the last one.
	 *
	 * Three questions about the row already open, each answered where it is
	 * asked: whether the next turn would read it in, what points at it, and
	 * what is filed under it. The tabs a door offers are its own declaration
	 * (`SectionDescriptor.inspector`), so a door whose rows are not entries
	 * cannot offer a retrieval verdict about something retrieval never sees.
	 *
	 * The selected tab is the route's, which is what makes it addressable: a
	 * receipt links to "this entry, on its Read in? account" and lands there.
	 */
	interface Props {
		lorebookId: number
		/** The selected row, as the pool reads it. */
		item: PoolItem
		/** The saved row behind it. */
		source: PoolSource
		/** The door that curates this row. */
		door: SectionDescriptor
		/**
		 * Every row the book holds, which is where a reference and a child are
		 * resolved. Never one scope's share of it: what is filed under a row
		 * does not change with the list the reader is standing in.
		 */
		pool: PoolItem[]
		/**
		 * The book's typed edges. An edge that touches this row is a direct
		 * reference; one that lands on the row it is filed under is a step
		 * away, and both are references no text scan could find.
		 */
		links?: RefLink[]
		/**
		 * Whether to draw the selected tab's body. The compact layout puts the
		 * body on a step of its own, so there the strip is all that sits under
		 * the editor.
		 */
		showBody?: boolean
		onOpenItem: (item: PoolItem) => void
	}

	let {
		lorebookId,
		item,
		source,
		door,
		pool,
		links = [],
		showBody = true,
		onOpenItem
	}: Props = $props()

	const uid = $props.id()
	const poolCtx = getLorePoolCtx()

	let refs = $derived(entryRefs(item, pool, links))
	let children = $derived(containedBy(item.key, pool))
	let tabs = $derived(
		inspectorTabsFor(door.inspector, {
			references: refs.length,
			contains: children.length
		})
	)
	/** The route's tab when the door has it, and the door's first otherwise. */
	let selected = $derived(
		tabs.find((t) => t.id === loreRoute.route.inspector)?.id ??
			tabs[0]?.id ??
			null
	)
	/** `{{char:1}}` to the name it stands for, through the book's bindings. */
	const resolveBinding = (tag: string) => poolCtx.bindingForTag(tag)
</script>

{#snippet contains()}
	{#if children.length}
		<ul class="flex flex-col">
			{#each children as child (child.key)}
				<li>
					<button
						type="button"
						class="hover:bg-surface-200-800 flex w-full items-baseline gap-2 rounded p-1.5 text-left transition-colors"
						onclick={() => onOpenItem(child)}
					>
						<span
							class="min-w-0 flex-1 truncate text-xs font-medium"
						>
							{child.name}
						</span>
						<span
							class="text-surface-600-400 shrink-0 text-xs"
						>
							{kindLabel(child.kind)}
						</span>
					</button>
				</li>
			{/each}
		</ul>
		<!-- Said here, because the confirmation is not where a reader should
		     first learn what a delete takes with it. -->
		<p class="text-surface-600-400 text-[11px]">
			Deleting this entry deletes what is filed under it.
		</p>
	{:else}
		<p class="text-surface-600-400 text-xs">
			Nothing is filed under this entry. Drag a row onto it, or set Part
			of on the row itself.
		</p>
	{/if}
{/snippet}

{#if tabs.length}
	<div
		data-lore-inspector
		class="border-surface-300-700 flex flex-col gap-2 border-t pt-2"
	>
		<div class="flex flex-wrap gap-1" role="tablist" aria-label="Inspector">
			{#each tabs as tab (tab.id)}
				<button
					type="button"
					role="tab"
					id="{uid}-tab-{tab.id}"
					aria-selected={selected === tab.id && showBody}
					aria-controls="{uid}-panel"
					data-lore-inspector-tab={tab.id}
					class="btn btn-sm {selected === tab.id && showBody
						? 'preset-tonal-primary'
						: 'preset-tonal-surface'}"
					onclick={() => loreRoute.openInspector(tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</div>

		{#if showBody && selected}
			<div
				id="{uid}-panel"
				role="tabpanel"
				aria-labelledby="{uid}-tab-{selected}"
				class="flex flex-col gap-2"
			>
				{#if selected === "fires"}
					<!-- ⚠ The SAVED row, always: the pipeline gathers lore out
					     of the database, so a verdict about the draft on
					     screen would be about text no run has read.

					     Keyed on the row, because a verdict belongs to the
					     entry it was asked about: moving to another row is a
					     new question, and the answer to the last one must not
					     stand under its heading. -->
					{#key source.id}
						<EntryFireTest
							entryId={source.id}
							typeId={source.typeId as EntryTypeId}
							{lorebookId}
							enabled={source.enabled !== false}
							constant={!!source.constant}
						/>
					{/key}
				{:else if selected === "references"}
					<RefsList
						subject={item}
						{pool}
						{links}
						sessionName={poolCtx.reading.sessionName}
						{resolveBinding}
						{onOpenItem}
					/>
				{:else if selected === "contains"}
					{@render contains()}
				{:else if selected === "scenes"}
					{#if item.kind === SCENE_KIND}
						<p class="text-surface-600-400 text-xs">
							Scenes are compiled into a history entry. Open the
							entry this one belongs to to see them together.
						</p>
					{:else}
						<HistorySceneList entry={source} />
					{/if}
				{/if}
			</div>
		{/if}
	</div>
{/if}
