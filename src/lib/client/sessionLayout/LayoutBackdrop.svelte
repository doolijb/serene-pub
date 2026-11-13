<script lang="ts">
	/**
	 * The picture behind the panels: the session's backdrop, dimmed, drawn over
	 * the whole layout body and under every zone. Draws nothing while the
	 * layout's look says "your background", or while the session has no
	 * backdrop. It is decoration (`aria-hidden`) and takes no pointer.
	 */
	import { sessionBackdropSrc } from "$lib/client/components/host/backdropSrc"

	interface Props {
		look: { behind: "background" | "backdrop"; behindDim: number }
		backdropMediaId: number | null | undefined
	}

	let { look, backdropMediaId }: Props = $props()

	let src = $derived(
		look.behind === "backdrop" ? sessionBackdropSrc(backdropMediaId) : null
	)
</script>

{#if src}
	<div
		class="layout-backdrop"
		aria-hidden="true"
		data-dim={look.behindDim}
		style:--dim="{look.behindDim}%"
	>
		<img class="layout-backdrop-img" alt="" {src} />
		<div class="layout-backdrop-dim"></div>
	</div>
{/if}

<style>
	.layout-backdrop {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.layout-backdrop-img {
		position: absolute;
		inset: 0;
		inline-size: 100%;
		block-size: 100%;
		object-fit: cover;
	}
	.layout-backdrop-dim {
		position: absolute;
		inset: 0;
		background: color-mix(
			in oklab,
			var(--color-surface-950) var(--dim),
			transparent
		);
	}
</style>
