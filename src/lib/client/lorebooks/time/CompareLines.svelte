<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { LineDifference } from "$lib/shared/lorebooks/amendments"

	/**
	 * This line beside main: what it has that main does not, and what the two
	 * say differently.
	 *
	 * ⚠ **There is no merge here and there never will be.** Not an omission —
	 * the design's own sentence is "no merge, ever". Two lines are two stories,
	 * and a button that folded one into the other would be asking which of two
	 * true things to destroy. To take something across, read it and write it.
	 *
	 * ⚠ It shows the READING, not the amendments. Two lines can hold different
	 * amendments and still read the same at this moment, and that is not a
	 * difference worth a row — what an author wants to know is whether the two
	 * stories say different things now.
	 */
	interface Props {
		lineName: string
		/**
		 * The differences, already computed against main.
		 *
		 * ⚠ Each carries a `key`, and the list is keyed on it rather than on
		 * `id`: entries and cast members are separate id spaces, so entry 1 and
		 * member 1 both arrive as `1`. Keying on the id raised
		 * `each_key_duplicate` the first time a book had one of each.
		 */
		differences: (LineDifference<any> & { key: string })[]
		/** What a row is called, whatever kind it is. */
		titleOf: (row: any) => string
		/** The reader's words for a column. */
		labelOf: (field: string) => string
		/**
		 * The reader's words for a VALUE, where a raw one means nothing.
		 *
		 * A card is the case that forced this: `characterId` differing between
		 * two lines rendered as "2" beside "1", which is the one comparison in
		 * the book where the answer is a name.
		 */
		valueOf?: (field: string, value: unknown) => string | null
		onOpen?: (difference: LineDifference<any> & { key: string }) => void
		onClose: () => void
	}

	let {
		lineName,
		differences,
		titleOf,
		labelOf,
		valueOf,
		onOpen,
		onClose
	}: Props = $props()

	let only = $derived(differences.filter((d) => d.kind === "only"))
	let differs = $derived(differences.filter((d) => d.kind === "differs"))

	/** A value as a line of text. `null` is a cleared field, not an absence. */
	function show(field: string, value: unknown): string {
		const named = valueOf?.(field, value)
		if (named != null) return named
		if (value === null) return "—"
		if (value === undefined) return "—"
		if (typeof value === "boolean") return value ? "on" : "off"
		if (Array.isArray(value)) return value.length ? value.join(", ") : "—"
		const text = String(value).trim()
		return text === "" ? "—" : text
	}
</script>

<section class="flex min-h-0 flex-1 flex-col gap-3" data-lore-compare>
	<div class="flex flex-wrap items-center gap-2">
		<Icons.GitCompare size={16} class="shrink-0" aria-hidden="true" />
		<h3 class="min-w-0 flex-1 text-sm font-semibold">
			{lineName} beside main
		</h3>
		<button
			class="btn btn-sm preset-filled-surface-400-600 shrink-0"
			type="button"
			onclick={onClose}
		>
			<Icons.X size={14} aria-hidden="true" />
			Back to reading
		</button>
	</div>

	{#if !differences.length}
		<p class="text-surface-700-300 text-sm leading-relaxed">
			Nothing reads differently yet. <strong>{lineName}</strong>
			and main are telling the same story at this moment — write something
			here, or amend a shared entry, and it will show up.
		</p>
	{:else}
		<p class="text-surface-700-300 text-xs leading-relaxed">
			Nothing merges. To take something across, read the line it is on and
			write it on the other.
		</p>

		{#if only.length}
			<div class="flex flex-col gap-1">
				<h4
					class="text-surface-600-400 text-[0.68rem] tracking-wider uppercase"
				>
					Only on {lineName}
				</h4>
				<ul class="flex flex-col gap-1">
					{#each only as d (d.key)}
						<li>
							<button
								class="bg-surface-100-900 hover:preset-tonal-surface flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left"
								type="button"
								onclick={() => onOpen?.(d)}
							>
								<Icons.Plus
									size={14}
									class="text-primary-500 shrink-0"
									aria-hidden="true"
								/>
								<span class="min-w-0 flex-1 truncate text-sm">
									{titleOf(d.line)}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if differs.length}
			<div class="flex min-h-0 flex-col gap-1">
				<h4
					class="text-surface-600-400 text-[0.68rem] tracking-wider uppercase"
				>
					Read differently
				</h4>
				<ul class="flex flex-col gap-2">
					{#each differs as d (d.key)}
						<li
							class="bg-surface-100-900 flex flex-col gap-2 rounded-[10px] px-3 py-2"
						>
							<button
								class="min-w-0 truncate text-left text-sm font-semibold hover:underline"
								type="button"
								onclick={() => onOpen?.(d)}
							>
								{titleOf(d.line)}
							</button>
							{#each d.fields as field (field)}
								<div class="flex flex-col gap-1">
									<span
										class="text-surface-600-400 text-[0.68rem] tracking-wider uppercase"
									>
										{labelOf(field)}
									</span>
									<!-- Side by side at desk, stacked when the
									     column is narrow: two readings are only
									     comparable if both are legible. -->
									<div
										class="grid grid-cols-1 gap-2 @md/view:grid-cols-2"
									>
										<div class="flex flex-col gap-0.5">
											<span
												class="text-surface-600-400 text-[0.68rem]"
											>
												main
											</span>
											<p
												class="text-surface-700-300 text-xs leading-relaxed"
											>
												{show(field, d.main?.[field])}
											</p>
										</div>
										<div class="flex flex-col gap-0.5">
											<span
												class="text-primary-500 text-[0.68rem]"
											>
												{lineName}
											</span>
											<p class="text-xs leading-relaxed">
												{show(field, d.line[field])}
											</p>
										</div>
									</div>
								</div>
							{/each}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
</section>
