<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { LibraryCatalogItem } from "$lib/shared/library/types"

	interface Props {
		item: LibraryCatalogItem
		imageUrl: string | null
		onclick: () => void
	}

	let { item, imageUrl, onclick }: Props = $props()

	// A thumbnail request can fail (eg. the CharaVault image proxy returning
	// 429 when its background-priority rate-limit slot times out behind
	// interactive traffic) — fall back to the placeholder icon instead of
	// leaving the browser's broken-image glyph. Resets whenever imageUrl
	// itself changes (new item, or a retried URL).
	let imageFailed = $state(false)
	$effect(() => {
		void imageUrl
		imageFailed = false
	})

	function getExcerpt(text: string, maxLength: number = 90): string {
		// Iterate by code point (not UTF-16 code unit) so truncation can't
		// split a surrogate pair (eg. an emoji) in half.
		const chars = Array.from(text)
		if (chars.length <= maxLength) return text
		return chars.slice(0, maxLength).join("").trim() + "…"
	}
</script>

<button
	type="button"
	class="group relative aspect-[3/4] w-full overflow-hidden rounded-xl text-left shadow-md transition-transform hover:scale-[1.02] hover:shadow-xl focus-visible:scale-[1.02] focus-visible:outline-none"
	onclick={() => onclick()}
	aria-label="View details for {item.name}"
>
	{#if imageUrl && !imageFailed}
		<img
			src={imageUrl}
			alt=""
			loading="lazy"
			onerror={() => (imageFailed = true)}
			class="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
		/>
	{:else}
		<div
			class="bg-surface-300-700 absolute inset-0 flex items-center justify-center"
		>
			<Icons.User class="text-surface-400 h-16 w-16" aria-hidden="true" />
		</div>
	{/if}

	<!-- Bottom fade with name + excerpt -->
	<div
		class="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-10"
	>
		<span class="truncate text-sm font-bold text-white drop-shadow-sm">
			{item.name}
		</span>
		<span class="line-clamp-2 text-xs leading-snug text-white/80">
			{getExcerpt(item.description)}
		</span>
	</div>

	<div class="absolute top-2 right-2 flex items-center gap-1">
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
				class="bg-surface-950/70 rounded-full px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
			>
				{item.category}
			</span>
		{/if}
	</div>
</button>
