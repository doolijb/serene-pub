<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { groupLooseEnds, type LooseEnd } from "./looseEnds"
	import { kindLabel } from "./sections/kinds"

	/**
	 * The Loose ends queue, drawn where the entry list stands (note 5).
	 *
	 * Grouped by chore, each group collapsible with its count; pressing a row
	 * opens what it is about with the fixing field focused, and Save in the
	 * editor moves on to the next row. The rows are the snapshot taken when
	 * the queue opened, less those fixed since — nothing joins or moves while
	 * the reader works.
	 */
	interface Props {
		/** The queue as it stands: the snapshot, fixed rows gone. */
		rows: LooseEnd[]
		/** The row the reader is on. */
		currentId: string | null
		onOpen: (row: LooseEnd) => void
		onNext: () => void
		/** Leaves the queue; it is taken afresh the next time it opens. */
		onLeave: () => void
	}

	let { rows, currentId, onOpen, onNext, onLeave }: Props = $props()

	let groups = $derived(groupLooseEnds(rows))
	const collapsed = new SvelteSet<string>()

	function toggle(id: string) {
		if (collapsed.has(id)) collapsed.delete(id)
		else collapsed.add(id)
	}
</script>

<section
	class="flex min-h-0 flex-1 flex-col gap-2"
	aria-labelledby="looseEndsTitle"
	data-loose-ends
>
	<div class="flex flex-wrap items-center gap-2">
		<h3 id="looseEndsTitle" class="text-sm font-semibold">Loose ends</h3>
		<span class="text-surface-600-400 text-xs" data-loose-ends-left>
			{rows.length} left
		</span>
		<span class="flex-1"></span>
		<button
			type="button"
			class="btn btn-sm preset-tonal-primary gap-1"
			disabled={rows.length === 0}
			data-loose-ends-next
			onclick={onNext}
		>
			<span>Next loose end</span>
			<Icons.ArrowRight size={14} aria-hidden="true" />
		</button>
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface"
			title="Leave the queue; it is taken afresh next time"
			data-loose-ends-leave
			onclick={onLeave}
		>
			Done
		</button>
	</div>

	{#if rows.length === 0}
		<p class="text-surface-700-300 p-6 text-center text-sm italic">
			Nothing left to finish in this book.
		</p>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
			{#each groups as group (group.chore.id)}
				{@const open = !collapsed.has(group.chore.id)}
				<div class="flex flex-col gap-1" data-loose-ends-chore={group.chore.id}>
					<button
						type="button"
						class="btn btn-sm hover:preset-tonal-surface w-full justify-start gap-2"
						aria-expanded={open}
						aria-controls="looseEnds-{group.chore.id}"
						onclick={() => toggle(group.chore.id)}
					>
						<Icons.ChevronRight
							size={14}
							class="shrink-0 transition-transform {open
								? 'rotate-90'
								: ''}"
							aria-hidden="true"
						/>
						<span class="flex-1 truncate text-left font-semibold">
							{group.chore.label}
						</span>
						<span class="badge preset-tonal-surface shrink-0">
							{group.rows.length}
						</span>
					</button>
					{#if open}
						<p class="text-surface-600-400 px-2 text-xs">
							{group.chore.fix}
						</p>
						<ul
							id="looseEnds-{group.chore.id}"
							class="flex flex-col gap-1"
						>
							{#each group.rows as row (row.id)}
								<li>
									<button
										type="button"
										class="btn btn-sm w-full justify-start gap-2 {currentId ===
										row.id
											? 'sidebar-row-active'
											: 'hover:preset-tonal-surface'}"
										aria-current={currentId === row.id
											? "true"
											: undefined}
										data-loose-end={row.id}
										onclick={() => onOpen(row)}
									>
										<span
											class="text-surface-600-400 shrink-0 text-xs"
										>
											{kindLabel(row.kind)}
										</span>
										<span class="min-w-0 flex-1 truncate text-left">
											{row.name || "Untitled"}
										</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</section>
