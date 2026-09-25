<script lang="ts">
	/** `sp-tab-panel` — shown while its `sp-tabs` parent's value is this panel's. */
	import type { SpElementProps } from "./spElement.svelte"

	let { attrs, slot, host }: SpElementProps = $props()
	type Parent = HTMLElement & { spState?: { value?: unknown; base?: string } }
	const parent = $derived(host.closest("sp-tabs") as Parent | null)
	const shown = $derived(!parent?.spState || parent.spState.value === attrs.value)
	const base = $derived(parent?.spState?.base)
</script>

<div
	class="sp-tab-panel-body"
	role="tabpanel"
	id={base && attrs.value ? `${base}-panel-${attrs.value}` : undefined}
	aria-labelledby={base && attrs.value ? `${base}-tab-${attrs.value}` : undefined}
	hidden={!shown}
	{@attach slot()}
></div>
