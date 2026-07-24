<script lang="ts">
	import { dndzone } from "svelte-dnd-action"
	import type { Snippet } from "svelte"
	import type { Card } from "$lib/shared/utils/contextConfigCards"

	interface Props {
		cards: Card[]
		onReorder: (orderedIds: string[]) => void
		row: Snippet<[Card, number]>
	}
	let { cards, onReorder, row }: Props = $props()

	// svelte-dnd-action expects to own the array it's given during a drag
	// gesture — re-deriving `cards` fresh from a re-parsed template on every
	// `consider` tick desyncs its internal drag state and makes the dragged
	// card vanish mid-gesture. This local mirror is what dndzone actually
	// drives; the template is only re-spliced once, on `finalize`.
	let mirror: Card[] = $state([])
	$effect(() => {
		mirror = cards
	})
</script>

<div
	class="flex flex-col gap-2"
	use:dndzone={{
		items: mirror,
		flipDurationMs: 150,
		dragDisabled: !(mirror.length > 1),
		dropFromOthersDisabled: true
	}}
	onconsider={(e) => {
		// See ContextSidebar's original comment on this same guard: dndzone
		// can momentarily hand back an items array that's short a card during
		// a fast/erratic pointer move — never render that, or an aborted
		// gesture can leave the mirror permanently short one card.
		if (e.detail.items.length === mirror.length) {
			mirror = e.detail.items as Card[]
		}
	}}
	onfinalize={(e) => {
		if (e.detail.items.length === cards.length) {
			// Deliberately NOT also setting `mirror = e.detail.items` here —
			// onReorder below triggers a template update that flows back down
			// as a freshly re-parsed `cards` prop, which the effect above
			// applies on its own. Writing the mirror here too raced that
			// effect-driven write right as dndzone's own flipDurationMs
			// drop-settle animation was still running, which is what made
			// cards intermittently vanish right after a drop in the original
			// (pre-generic) version of this Cards tab.
			onReorder((e.detail.items as Card[]).map((c) => c.id))
		} else {
			mirror = cards
		}
	}}
>
	{#each mirror as card, i (card.id)}
		{@render row(card, i)}
	{/each}
</div>
