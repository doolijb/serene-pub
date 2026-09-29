<script lang="ts">
	/**
	 * `sp-host-view` — one of the page's own views, drawn where a widget
	 * placed the element (C0b). The page supplies them by name
	 * (`setHostViews`); the widget never sees inside — a remote's box is
	 * mirrored one way, so nothing drawn here reaches the worker. `channel`
	 * (1.1, lair re-plan S1) is handed to the view: the channel the place is
	 * for, so a channel-pinned conversation's chips are that channel's.
	 */
	import type { HostViewName } from "@serene-pub/sdk"
	import type { SpElementProps } from "./spElement.svelte"
	import { hostElementContext } from "./context.svelte"

	let { attrs }: SpElementProps = $props()
	const view = $derived(attrs.name ? hostElementContext.views?.[attrs.name as HostViewName] : undefined)
</script>

{#if view}{@render view(attrs.channel || undefined)}{/if}
