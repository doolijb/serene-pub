<script lang="ts">
	/**
	 * One library result as a row, for the Library view's narrow list (the
	 * 400px dock). The portrait grid's `LibraryPortraitCard` is the same result
	 * given room; this is it without any, in the app's one row anatomy
	 * (STYLE-GUIDE §6.4, PLAN-0-5-polish-parity L6, 2026-10-24): the 44px
	 * round face, the 15px name, and one meta line — what it is, then who
	 * made it. It was a 56×72 portrait over three lines.
	 */
	import * as Icons from "@lucide/svelte"
	import type { LibraryCatalogItem } from "$lib/shared/library/types"
	import RetryableImage from "./RetryableImage.svelte"
	import { characterSummary } from "$lib/shared/characters/characterSummary"
	import MetaLine from "../panels/MetaLine.svelte"

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

	/** What the card is, not its raw sheet (plan F1). */
	const excerpt = $derived(
		characterSummary({ name: item.name, description: item.description })
	)
</script>

<button
	type="button"
	class="flex w-full min-w-0 items-center gap-3 rounded-base px-3 py-2 text-left transition-colors {active
		? 'sidebar-row-active'
		: 'hover:bg-surface-200-800'} focus-visible:ring-primary-500 focus-visible:ring-2 focus-visible:outline-none"
	onclick={() => onclick()}
	aria-current={active ? "true" : undefined}
>
	{#snippet placeholder()}
		<span
			class="bg-surface-200-800 grid h-full w-full place-items-center"
		>
			<Icons.UsersRound
				class="text-surface-700-300 size-5"
				aria-hidden="true"
			/>
		</span>
	{/snippet}
	<!-- The avatar's row step (44px, round, top-cropped), drawn here and not
	     with `Avatar` because a library picture is remote and retried. -->
	<span
		class="relative block size-11 shrink-0 overflow-hidden rounded-full"
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
			<span class="truncate text-lead font-medium">{item.name}</span>
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
		{#if excerpt}
			<MetaLine items={[item.author && `by ${item.author}`]}>
				{excerpt}
			</MetaLine>
		{:else if item.author}
			<MetaLine items={[`by ${item.author}`]} />
		{/if}
	</span>
</button>
