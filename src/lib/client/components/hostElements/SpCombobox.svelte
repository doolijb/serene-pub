<script lang="ts">
	/**
	 * `sp-combobox` — host-owned: a pick holds without a write-back. Options
	 * come from its `sp-option` children; `input` carries `{ query }` as the
	 * person types, `change` carries `{ value }`. A written `value` sets it.
	 */
	import { Combobox, Portal, useListCollection } from "@skeletonlabs/skeleton-svelte"
	import { flag, portalScope, type SpElementProps } from "./spElement.svelte"

	let { attrs, writes, emit, items, host }: SpElementProps = $props()
	let query = $state("")
	let selected = $state<string[]>([])
	$effect(() => {
		void writes.value
		selected = attrs.value ? [attrs.value] : []
	})
	const scope = $derived(portalScope(host))
	const options = $derived(
		items
			.map((o, i) => ({
				value: o.attrs.value ?? String(i),
				label: o.text,
				disabled: flag(o.attrs.disabled),
				className: o.attrs.class ?? ""
			}))
			.filter((o) => !query || o.label.toLowerCase().includes(query.toLowerCase()))
	)
	const collection = $derived(
		useListCollection({
			items: options,
			itemToString: (o) => o.label,
			itemToValue: (o) => o.value,
			isItemDisabled: (o) => o.disabled
		})
	)
</script>

<Combobox
	{collection}
	value={selected}
	placeholder={attrs.placeholder ?? undefined}
	disabled={flag(attrs.disabled)}
	onInputValueChange={(e) => {
		query = e.inputValue
		emit("input", { query: e.inputValue })
	}}
	onValueChange={(e) => {
		selected = e.value
		emit("change", { value: e.value[0] ?? null })
	}}
>
	{#if attrs.label}<Combobox.Label class="sp-combobox-label">{attrs.label}</Combobox.Label>{/if}
	<Combobox.Control class="sp-combobox-control">
		<!-- Named even without a label: the placeholder, else the role alone would be all a reader hears. -->
		<Combobox.Input aria-label={attrs.label ? undefined : (attrs.placeholder ?? "Choose")} />
		<Combobox.Trigger />
	</Combobox.Control>
	<Portal>
		<Combobox.Positioner class="z-[1000]!" {...scope}>
			<Combobox.Content class="sp-combobox-panel">
				{#each options as item, i (i)}
					<Combobox.Item {item} class="sp-option {item.className}">
						<Combobox.ItemText>{item.label}</Combobox.ItemText>
						<Combobox.ItemIndicator />
					</Combobox.Item>
				{/each}
			</Combobox.Content>
		</Combobox.Positioner>
	</Portal>
</Combobox>
