<script lang="ts">
	/** `sp-progress` — a bar; no `value` is indeterminate. */
	import type { SpElementProps } from "./spElement.svelte"

	let { attrs }: SpElementProps = $props()
	const max = $derived(Number(attrs.max) > 0 ? Number(attrs.max) : 100)
	const value = $derived(attrs.value === null ? null : Math.min(max, Math.max(0, Number(attrs.value) || 0)))
</script>

<!-- The one look the behaviour needs: a bar you can see. `currentColor`
     keeps it the theme's; a skin replaces both. -->
<div
	class="sp-progress-track"
	style:block-size="0.375rem"
	style:background="color-mix(in oklab, currentColor 20%, transparent)"
	role="progressbar"
	aria-label={attrs.label ?? undefined}
	aria-valuemin={0}
	aria-valuemax={max}
	aria-valuenow={value ?? undefined}
	data-indeterminate={value === null ? "" : undefined}
>
	<div
		class="sp-progress-fill"
		style:block-size="100%"
		style:background="currentColor"
		style:inline-size={value === null ? "30%" : `${(value / max) * 100}%`}
	></div>
</div>
