<script lang="ts">
	/** `sp-tooltip` — a tooltip over its body, which is the trigger. */
	import { Portal, Tooltip } from "@skeletonlabs/skeleton-svelte"
	import { mirrorTrigger, portalScope, withoutAria, type SpElementProps } from "./spElement.svelte"

	let { attrs, slot, host }: SpElementProps = $props()
	const placement = $derived((attrs.placement ?? "top") as "top" | "bottom" | "left" | "right")
	const scope = $derived(portalScope(host))
</script>

<Tooltip positioning={{ placement }}>
	<Tooltip.Trigger>
		{#snippet element(attributes)}
			<span
				{...withoutAria(attributes as Record<string, unknown>)}
				class="sp-tooltip-trigger"
				{@attach slot()}
				{@attach mirrorTrigger(() => attributes as Record<string, unknown>)}
			></span>
		{/snippet}
	</Tooltip.Trigger>
	<Portal>
		<Tooltip.Positioner class="z-[1000]!" {...scope}>
			<Tooltip.Content class="sp-tooltip-panel">{attrs.text ?? ""}</Tooltip.Content>
		</Tooltip.Positioner>
	</Portal>
</Tooltip>
