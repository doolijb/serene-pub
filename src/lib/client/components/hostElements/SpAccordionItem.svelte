<script lang="ts">
	/** `sp-accordion-item` — its trigger is `heading`, its body the panel. */
	import type { SpElementProps } from "./spElement.svelte"

	let { attrs, slot, host }: SpElementProps = $props()
	type Parent = HTMLElement & { spState?: { open?: string[]; toggle?: (v: string) => void } }
	const parent = $derived(host.closest("sp-accordion") as Parent | null)
	const value = $derived(attrs.value ?? attrs.heading ?? "")
	const open = $derived(!!parent?.spState?.open?.includes(value))
	const id = `sp-acc-${Math.random().toString(36).slice(2)}`
	const level = $derived(Math.min(6, Math.max(2, Number(attrs.level) || 3)))
</script>

<div class="sp-accordion-heading" role="heading" aria-level={level}>
	<button
		type="button"
		class="sp-accordion-trigger"
		aria-expanded={open}
		aria-controls={id}
		onclick={() => parent?.spState?.toggle?.(value)}
	>
		{attrs.heading ?? ""}
	</button>
</div>
<div class="sp-accordion-panel" {id} role="region" hidden={!open} {@attach slot()}></div>
