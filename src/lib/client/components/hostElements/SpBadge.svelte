<script lang="ts">
	/** `sp-badge` — a short label; `tone` is a hook for the skin, not a colour. */
	import type { SpElementProps } from "./spElement.svelte"

	let { attrs, slot }: SpElementProps = $props()
</script>

<span class="sp-badge-label" data-tone={attrs.tone ?? "neutral"} {@attach slot()}></span>
