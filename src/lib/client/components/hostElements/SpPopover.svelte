<script lang="ts">
	/** `sp-popover` — a positioned panel: the `trigger` slot opens it, the body is the panel. */
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { flag, mirrorTrigger, portalScope, returnFocus, withoutAria, type SpElementProps } from "./spElement.svelte"

	let { attrs, writes, emit, slot, host }: SpElementProps = $props()
	let open = $state(false)
	let triggerBox = $state<HTMLElement | null>(null)
	let panel = $state<HTMLElement | null>(null)
	// A write is a command: `open` re-opens after the person closed it.
	$effect(() => {
		void writes.open
		open = flag(attrs.open)
	})
	const scope = $derived(portalScope(host))
	type Side = "top" | "bottom" | "left" | "right" | "top-start" | "top-end" | "bottom-start" | "bottom-end"
</script>

<Popover
	{open}
	onOpenChange={(e) => {
		open = e.open
		if (!e.open) returnFocus(triggerBox, panel)
		emit("open-change", { open: e.open })
	}}
	positioning={{ placement: (attrs.placement ?? "bottom") as Side }}
>
	<Popover.Trigger>
		{#snippet element(attributes)}
			<span
				{...withoutAria(attributes as Record<string, unknown>)}
				class="sp-popover-trigger"
				{@attach slot("trigger")}
				{@attach (el: HTMLElement) => {
					triggerBox = el
				}}
				{@attach mirrorTrigger(() => ({ ...(attributes as Record<string, unknown>), "aria-haspopup": "dialog" }))}
			></span>
		{/snippet}
	</Popover.Trigger>
	<Portal>
		<Popover.Positioner class="z-[1000]!" {...scope}>
			<Popover.Content class="sp-popover-panel" aria-label={attrs.label ?? undefined} {@attach (el: HTMLElement) => { panel = el }}>
				<div {@attach slot()}></div>
			</Popover.Content>
		</Popover.Positioner>
	</Portal>
</Popover>
