<script lang="ts">
	import type { PoolItem } from "../poolFilter"
	import { kindLabel } from "../sections/kinds"
	import { castMacroLines, entryRefs, type RefLink } from "./refs"

	/**
	 * What points at this entry, with the sentence each reference comes from.
	 *
	 * The list is what a reader wants before deleting something, so the heading
	 * says what deleting would do rather than leaving it to be discovered in
	 * the confirmation.
	 */
	interface Props {
		subject: PoolItem
		pool: readonly PoolItem[]
		/** The book's typed edges, which are references in their own right. */
		links?: readonly RefLink[]
		/** What the session reading this book is called, or null for none. */
		sessionName: string | null
		/** `{{char:1}}` to the name it stands for in this book. */
		resolveBinding: (tag: string) => string | null
		onOpenItem: (item: PoolItem) => void
	}

	let {
		subject,
		pool,
		links = [],
		sessionName,
		resolveBinding,
		onOpenItem
	}: Props = $props()

	let rows = $derived(entryRefs(subject, pool, links))
	let macros = $derived(
		castMacroLines(subject.content, resolveBinding, sessionName)
	)
</script>

<div class="flex flex-col gap-2" data-lore-refs>
	<p class="text-surface-600-400 text-xs">
		What points at this entry. Deleting it would leave these behind.
	</p>
	{#if rows.length}
		<ul class="flex flex-col">
			{#each rows as row (row.item.key)}
				<li>
					<button
						type="button"
						class="hover:bg-surface-200-800 flex w-full flex-col gap-0.5 rounded p-1.5 text-left transition-colors"
						onclick={() => onOpenItem(row.item)}
					>
						<span class="flex items-baseline gap-2">
							<span
								class="text-surface-600-400 shrink-0 text-[0.68rem] tracking-wider uppercase"
							>
								{kindLabel(row.item.kind)}
							</span>
							<span
								class="min-w-0 flex-1 truncate text-xs font-medium"
							>
								{row.item.name}
							</span>
							{#if row.tag}
								<span
									class="badge preset-tonal-surface shrink-0 text-[0.62rem]"
								>
									{row.tag}
								</span>
							{/if}
						</span>
						{#each row.clauses as clause (clause)}
							<span class="text-surface-600-400 text-[0.68rem]">
								{clause}
							</span>
						{/each}
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-surface-600-400 text-xs">
			Nothing in this book points at this entry.
		</p>
	{/if}
	{#each macros as line (line)}
		<p class="text-surface-600-400 text-[0.68rem]">{line}</p>
	{/each}
</div>
