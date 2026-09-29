<script lang="ts">
	/**
	 * One library result as a row, for the Library view's narrow list (the
	 * 400px dock). The portrait grid's `LibraryPortraitCard` is the same result
	 * given room; this is it without any: a small portrait, the name, who made
	 * it, and two lines of what it is.
	 */
	import * as Icons from "@lucide/svelte"
	import type { LibraryCatalogItem } from "$lib/shared/library/types"
	import RetryableImage from "./RetryableImage.svelte"

	interface Props {
		item: LibraryCatalogItem
		imageUrl: string | null
		/** The result whose detail is open. */
		active?: boolean
		/** Already imported in this visit. */
		imported?: boolean
		onclick: () => void
	}

	let { item, imageUrl, active = false, imported = false, onclick }: Props =
		$props()
</script>

<button
	type="button"
	class="flex w-full min-w-0 items-start gap-3 rounded-[12px] p-2 text-left transition-colors {active
		? 'sidebar-row-active'
		: 'hover:bg-surface-200-800'} focus-visible:ring-primary-500 focus-visible:ring-2 focus-visible:outline-none"
	onclick={() => onclick()}
	aria-current={active ? "true" : undefined}
>
	{#snippet placeholder()}
		<span
			class="bg-surface-300-700 grid h-full w-full place-items-center"
		>
			<Icons.User class="text-surface-600-400 size-6" aria-hidden="true" />
		</span>
	{/snippet}
	<span
		class="relative block h-[4.5rem] w-14 shrink-0 overflow-hidden rounded-[9px]"
	>
		{#if imageUrl}
			<RetryableImage
				src={imageUrl}
				alt=""
				loading="lazy"
				class="h-full w-full object-cover object-top"
				fallback={placeholder}
			/>
		{:else}
			{@render placeholder()}
		{/if}
	</span>
	<span class="flex min-w-0 flex-1 flex-col gap-0.5">
		<span class="flex min-w-0 items-center gap-1.5">
			<span class="truncate text-[15px] font-medium">{item.name}</span>
			{#if item.hasLorebook}
				<Icons.BookOpen
					size={13}
					class="text-surface-600-400 shrink-0"
					aria-label="Includes a lorebook"
				/>
			{/if}
			{#if imported}
				<Icons.Check
					size={13}
					class="text-success-600-400 shrink-0"
					aria-label="Imported"
				/>
			{/if}
		</span>
		{#if item.author}
			<span class="text-surface-600-400 truncate text-xs">
				by {item.author}
			</span>
		{/if}
		{#if item.description}
			<span
				class="text-surface-600-400 line-clamp-2 text-xs leading-snug"
			>
				{item.description}
			</span>
		{/if}
	</span>
</button>
