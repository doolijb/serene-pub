<script lang="ts">
	/**
	 * The child sp elements a parent reads as data — `sp-menu-item`, `sp-tab`,
	 * `sp-option`. They render nothing of their own: the parent draws them
	 * from their attributes and text, and they sit in the parent's park.
	 */
	import type { SpElementProps } from "./spElement.svelte"

	let { slot }: SpElementProps = $props()
</script>

<span {@attach slot()}></span>
