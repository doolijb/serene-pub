<script lang="ts">
	/**
	 * A mini bar row: one owner's bounded stats, read-only.
	 *
	 * Read-only on purpose. This sits under a portrait, where the pointer is
	 * already doing something else (pinning an image, opening a character), and
	 * a bar you can nudge by a stray click is a stat nobody can trust. Editing
	 * lives in the Stats widget, one click away.
	 *
	 * Only slots whose configuration declares both ends of a range are drawn:
	 * everything else is not a bar, and this row has no room to say what it is.
	 */
	import { barView } from "$lib/shared/state/barMath"
	import { sessionState } from "$lib/client/state/sessionState.svelte"

	interface Props {
		/** The owner key the resolved state files this member's values under. */
		ownerKey: string
		/** How many bars the row has room for. */
		limit?: number
	}
	let { ownerKey, limit = 3 }: Props = $props()

	const store = sessionState()

	let bars = $derived(
		store
			.slotsFor(ownerKey)
			.map((slot) => ({
				slot,
				bar: barView(
					store.valueOf(ownerKey, slot.slotId),
					store.configOf(ownerKey, slot.slotId) as { min?: number }
				)
			}))
			.filter((row) => !!row.bar)
			.slice(0, limit)
	)
</script>

{#if bars.length}
	<div class="mini" data-state-bars={ownerKey}>
		{#each bars as row (row.slot.slotId)}
			<div
				class="mini-row"
				title="{row.slot.label} {row.bar!.label}"
				aria-label="{row.slot.label} {row.bar!.label}"
			>
				<span class="mini-label">{row.slot.label}</span>
				<span class="mini-track">
					<span
						class="mini-fill"
						style:width="{row.bar!.percent}%"
					></span>
				</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.mini {
		display: flex;
		flex-direction: column;
		gap: 0.12rem;
		width: 100%;
		padding: 0.15rem 0.2rem;
		font-size: 0.6rem;
	}
	.mini-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
	}
	.mini-label {
		max-width: 4.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.7;
	}
	.mini-track {
		position: relative;
		flex: 1;
		height: 0.3rem;
		border-radius: 999px;
		background: color-mix(in oklab, currentColor 18%, transparent);
		overflow: hidden;
	}
	.mini-fill {
		position: absolute;
		inset-block: 0;
		inset-inline-start: 0;
		border-radius: 999px;
		background: color-mix(in oklab, currentColor 62%, transparent);
	}
</style>
