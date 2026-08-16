<script lang="ts">
	import type { Snippet } from "svelte"

	interface Props {
		id?: number
		content: Snippet
		extraContent?: Snippet
		controls?: Snippet
		onclick: (e: MouseEvent) => void
		contentTitle: string
		classes?: string
		itemType?: string // e.g., "Character", "Chat", "Persona"
		totalItems?: number // Total items in the list for context
		currentIndex?: number // Current position in list
	}

	let {
		id,
		content,
		extraContent,
		controls,
		onclick,
		contentTitle,
		classes = "",
		itemType = "Item",
		totalItems,
		currentIndex
	}: Props = $props()

	// Create comprehensive aria-label
	const ariaLabel = $derived(
		(() => {
			let label = `${itemType}: ${contentTitle}`

			if (currentIndex !== undefined && totalItems !== undefined) {
				label += ` - ${currentIndex + 1} of ${totalItems}`
			} else if (id !== undefined) {
				label += ` - ID ${id}`
			}

			return label
		})()
	)
</script>

<div
	class="card preset-tonal hover:preset-filled-surface-300-700 relative flex w-full gap-2 overflow-hidden rounded-lg py-2 pr-3 pl-2 {classes}"
	role="listitem"
>
	<div class="relative flex min-w-0 flex-1 gap-2">
		{#if id !== undefined}
			<button
				{onclick}
				class="flex min-w-0 gap-2"
				title={contentTitle}
				aria-label={ariaLabel}
				type="button"
			>
				<span
					class="text-muted-foreground my-auto h-fit w-8 flex-shrink-0 text-center text-xs"
					aria-hidden="true"
				>
					{id}
				</span>
			</button>
		{/if}
		<div class="flex w-full min-w-0 flex-col">
			<div class="flex min-w-0">
				<button
					{onclick}
					class="flex min-w-0 flex-1 gap-2"
					title={contentTitle}
					aria-label={ariaLabel}
					type="button"
				>
					{@render content()}
				</button>
			</div>
			{@render extraContent?.()}
		</div>
	</div>
	<div class="controls" role="group" aria-label="Actions for {contentTitle}">
		{@render controls?.()}
	</div>
</div>
