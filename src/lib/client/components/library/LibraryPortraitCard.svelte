<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { LibraryCatalogItem } from "$lib/shared/library/types"
	import RetryableImage from "./RetryableImage.svelte"
	import { characterSummary } from "$lib/shared/characters/characterSummary"

	interface Props {
		item: LibraryCatalogItem
		imageUrl: string | null
		/** The result whose detail is open beside the grid. */
		active?: boolean
		/** Already imported in this visit. */
		imported?: boolean
		onclick: () => void
	}

	let {
		item,
		imageUrl,
		active = false,
		imported = false,
		onclick
	}: Props = $props()

	/** What the card is, not its raw sheet (plan F1): the description's
	 *  first sentence, clipped by code point so an emoji is never split. */
	const excerpt = $derived(
		characterSummary(
			{ name: item.name, description: item.description },
			{ maxLength: 90 }
		)
	)
</script>

<button
	type="button"
	class="group relative aspect-[3/4] w-full overflow-hidden rounded-xl text-left shadow-md transition-shadow hover:shadow-xl focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none {active
		? 'ring-primary-500 ring-offset-surface-50 dark:ring-offset-surface-950 ring-2 ring-offset-2'
		: ''}"
	onclick={() => onclick()}
	aria-current={active ? "true" : undefined}
	aria-label="View details for {item.name}"
>
	{#snippet placeholder()}
		<div
			class="bg-surface-300-700 absolute inset-0 flex items-center justify-center"
		>
			<Icons.User class="text-surface-600-400 h-16 w-16" aria-hidden="true" />
		</div>
	{/snippet}

	{#if imageUrl}
		<RetryableImage
			src={imageUrl}
			alt=""
			loading="lazy"
			class="absolute inset-0 h-full w-full object-cover"
			fallback={placeholder}
		/>
	{:else}
		{@render placeholder()}
	{/if}

	<!-- Bottom fade with name + excerpt -->
	<div
		class="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-10"
	>
		<span class="truncate text-sm font-bold text-white drop-shadow-sm">
			{item.name}
		</span>
		{#if excerpt}
			<span class="line-clamp-2 text-xs leading-snug text-white/80">
				{excerpt}
			</span>
		{/if}
	</div>

	<div class="absolute top-2 right-2 flex items-center gap-1">
		{#if imported}
			<span
				class="bg-surface-950/70 rounded-full p-1 text-white backdrop-blur-sm"
				title="Imported"
				aria-label="Imported"
			>
				<Icons.Check size={12} aria-hidden="true" />
			</span>
		{/if}
		{#if item.hasLorebook}
			<span
				class="bg-surface-950/70 rounded-full p-1 text-white backdrop-blur-sm"
				title="Includes a lorebook"
				aria-label="Includes a lorebook"
			>
				<Icons.BookOpen size={12} aria-hidden="true" />
			</span>
		{/if}
		{#if item.category && item.source !== "charavault"}
			<span
				class="bg-surface-950/70 rounded-full px-2 py-0.5 text-meta font-medium text-white backdrop-blur-sm"
			>
				{item.category}
			</span>
		{/if}
	</div>
</button>
