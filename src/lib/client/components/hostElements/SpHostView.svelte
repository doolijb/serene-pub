<script lang="ts">
	/**
	 * `sp-host-view` — one of the page's own views, drawn where a widget
	 * placed the element (C0b). The page supplies them by name
	 * (`setHostViews`); the widget never sees inside — a remote's box is
	 * mirrored one way, so nothing drawn here reaches the worker.
	 */
	import type { HostViewName } from "@serene-pub/sdk"
	import type { SpElementProps } from "./spElement.svelte"
	import { hostElementContext } from "./context.svelte"

	let { attrs }: SpElementProps = $props()
	const view = $derived(attrs.name ? hostElementContext.views?.[attrs.name as HostViewName] : undefined)
</script>

{#if view}{@render view()}{/if}
