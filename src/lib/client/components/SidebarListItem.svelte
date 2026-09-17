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
		itemType?: string // e.g., "Character", "Session", "Lorebook"
		totalItems?: number // Total items in the list for context
		currentIndex?: number // Current position in list
		/**
		 * Whether the leading id column is drawn.
		 *
		 * The number is an aid for lists whose rows are otherwise hard to tell
		 * apart; a row carrying an avatar, a name and its tags identifies
		 * itself, so those pass `false` and spend the 32px on content. `id`
		 * still reaches the row's accessible name either way.
		 */
		showIndex?: boolean
		/**
		 * This row is the selected one.
		 *
		 * The app's one selected-row treatment, so that a list does not have to
		 * spell it out (and cannot spell it differently): a tonal surface plus
		 * a primary bar inset on the leading edge — `.sidebar-row-active` in
		 * app.css, where the reasoning lives. It REPLACES `preset` and drops
		 * the hover preset, because a row that is already selected has nothing
		 * to promise on hover.
		 */
		active?: boolean
		/**
		 * The Skeleton preset for the card as a whole (bg/text/border as one
		 * coherent, theme-aware style). Swapped — not layered — so a caller can
		 * restyle a row without stacking two presets whose CSS-source order
		 * would decide the winner.
		 *
		 * ⚠ Not the way to mark a row selected — pass `active`. Passing
		 * `preset-filled-primary-500` here is what `active` exists to retire:
		 * it paints body text on primary at 3.62:1.
		 */
		preset?: string
		/** The hover preset; dropped when a caller wants a fixed active look. */
		hoverPreset?: string
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
		currentIndex,
		showIndex = true,
		active = false,
		preset,
		hoverPreset
	}: Props = $props()

	// `active` wins over both, rather than layering with them: two backgrounds
	// on one element are decided by CSS source order, which is not something a
	// call site can see or a reviewer can check.
	const rowPreset = $derived(
		active ? "sidebar-row-active" : (preset ?? "preset-tonal")
	)
	const rowHover = $derived(
		active ? "" : (hoverPreset ?? "hover:preset-filled-surface-300-700")
	)

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

<!-- `aria-current` and not only colour: selection is a fact about the list,
     and the bar plus the tonal surface say it to everyone who can see them. -->
<div
	class="card {rowPreset} {rowHover} relative flex w-full gap-2 overflow-hidden rounded-lg py-2 pr-3 pl-2 {classes}"
	role="listitem"
	aria-current={active ? "true" : undefined}
>
	<div class="relative flex min-w-0 flex-1 gap-2">
		{#if showIndex && id !== undefined}
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
