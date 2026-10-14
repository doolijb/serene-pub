<script lang="ts">
	/**
	 * A layout preset's PICTURE: three columns of blocks, drawn from the pure
	 * `previewOf` translation (./presetPreview — a blob → geometry
	 * translation, never a live mount). Deliberately inert — aria-hidden and
	 * pointer-events:none — because it is a diagram of a layout, not a second
	 * live copy of it: mounting the real widgets to preview them would run
	 * their sockets and reload their frames.
	 */
	import { previewOf } from "./presetPreview"

	interface Props {
		/** The preset's stored layout, any shape. */
		preset: unknown
		/** A placed id's title. */
		widgetLabel: (id: string) => string
	}

	let { preset, widgetLabel }: Props = $props()

	/** The three columns a preset picture is drawn in, left to right. */
	const PREVIEW_ZONES = ["left", "middle", "right"] as const
	let pv = $derived(previewOf(preset, widgetLabel))
</script>

<span class="pv" aria-hidden="true">
	{#each PREVIEW_ZONES as key (key)}
		{@const z = pv[key]}
		<span
			class="pv-zone"
			class:pv-middle={key === "middle"}
			class:pv-empty={z.cells.length === 0}
			style={`grid-template-columns:repeat(${z.cols},1fr);grid-template-rows:repeat(${z.rows},1fr);`}
		>
			{#each z.cells as c (c.id)}
				<span
					class="pv-cell"
					style={`grid-column:${c.x + 1}/span ${c.w};grid-row:${c.y + 1}/span ${c.h};`}
				></span>
			{/each}
		</span>
	{/each}
</span>

<style>
	/* The picture itself: inert, and dimmed so it never reads as live chrome. */
	.pv {
		display: grid;
		grid-template-columns: 1fr 2.2fr 1fr;
		gap: 2px;
		width: 6.5rem;
		height: 3.2rem;
		opacity: 0.8;
		pointer-events: none;
	}
	.pv-zone {
		display: grid;
		gap: 1px;
		border-radius: 0.2rem;
		background: color-mix(
			in oklab,
			var(--color-surface-300) 55%,
			transparent
		);
	}
	.pv-zone.pv-empty {
		background: color-mix(
			in oklab,
			var(--color-surface-300) 22%,
			transparent
		);
	}
	.pv-cell {
		border-radius: 0.12rem;
		background: color-mix(
			in oklab,
			var(--color-surface-600) 55%,
			transparent
		);
	}
	.pv-middle .pv-cell {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 55%,
			transparent
		);
	}
	:global([data-mode="dark"]) .pv-cell {
		background: color-mix(
			in oklab,
			var(--color-surface-400) 65%,
			transparent
		);
	}
</style>
