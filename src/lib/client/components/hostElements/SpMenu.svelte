<script lang="ts">
	/** `sp-menu` — a menu of actions from its `sp-menu-item` children; `select` carries `{ value }`. */
	import { Menu, Portal } from "@skeletonlabs/skeleton-svelte"
	import { flag, mirrorTrigger, portalScope, returnFocus, withoutAria, type SpElementProps } from "./spElement.svelte"

	let { attrs, writes, emit, slot, items, seatItem, host }: SpElementProps = $props()
	let open = $state(false)
	let triggerBox = $state<HTMLElement | null>(null)
	let panel = $state<HTMLElement | null>(null)
	$effect(() => {
		void writes.open
		open = flag(attrs.open)
	})
	const scope = $derived(portalScope(host))
	type Side = "top" | "bottom" | "left" | "right" | "top-start" | "top-end" | "bottom-start" | "bottom-end"
</script>

<Menu
	{open}
	onOpenChange={(e) => {
		open = e.open
		if (!e.open) returnFocus(triggerBox, panel)
		emit("open-change", { open: e.open })
	}}
	onSelect={(e) => emit("select", { value: e.value })}
	positioning={{ placement: (attrs.placement ?? "bottom-start") as Side }}
>
	<Menu.Trigger>
		{#snippet element(attributes)}
			<span
				{...withoutAria(attributes as Record<string, unknown>)}
				class="sp-menu-trigger"
				{@attach slot("trigger")}
				{@attach (el: HTMLElement) => {
					triggerBox = el
				}}
				{@attach mirrorTrigger(() => attributes as Record<string, unknown>)}
			></span>
		{/snippet}
	</Menu.Trigger>
	<Portal>
		<Menu.Positioner class="z-[1000]!" {...scope}>
			<Menu.Content class="sp-menu-panel" aria-label={attrs.label ?? undefined} {@attach (el: HTMLElement) => { panel = el }}>
				<!-- Keyed by position: two items may share a value. Each row shows
				     its `sp-menu-item`'s own content (an icon, a note, a badge). -->
				{#each items as item, i (i)}
					<Menu.Item
						value={item.attrs.value ?? String(i)}
						disabled={flag(item.attrs.disabled)}
						class="sp-menu-row"
					>
						<Menu.ItemText>
							<span class="sp-menu-row-body" {@attach seatItem(item.el)}></span>
						</Menu.ItemText>
					</Menu.Item>
				{/each}
			</Menu.Content>
		</Menu.Positioner>
	</Portal>
</Menu>
