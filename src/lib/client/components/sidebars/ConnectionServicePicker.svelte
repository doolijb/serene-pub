<script lang="ts">
	import { collection } from "@zag-js/combobox"
	import { Combobox, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import {
		buildConnectionServiceItems,
		groupConnectionServiceItems,
		filterConnectionServiceItems,
		type ConnectionServiceItem
	} from "$lib/shared/utils/connectionServiceItems"

	interface Props {
		selectedItem: ConnectionServiceItem | undefined
		label: string
	}
	let { selectedItem = $bindable(), label }: Props = $props()

	// Static for the app's lifetime (built from CONNECTION_TYPES +
	// OPENAI_CHAT_PRESETS, neither of which change at runtime) — computed
	// once rather than on every keystroke.
	const ALL_ITEMS = buildConnectionServiceItems()

	let inputValue = $state(selectedItem?.label ?? "")
	let visibleItems = $derived(
		filterConnectionServiceItems(ALL_ITEMS, inputValue)
	)
	let groups = $derived(groupConnectionServiceItems(visibleItems))

	let comboboxCollection = $derived(
		collection({
			items: visibleItems,
			itemToValue: (i: ConnectionServiceItem) => i.key,
			itemToString: (i: ConnectionServiceItem) => i.label,
			groupBy: (i: ConnectionServiceItem) => i.category
		})
	)
</script>

<Combobox
	collection={comboboxCollection}
	value={selectedItem ? [selectedItem.key] : []}
	{inputValue}
	openOnClick
	onInputValueChange={(details) => {
		inputValue = details.inputValue
	}}
	onValueChange={(details) => {
		const item = details.items[0] as ConnectionServiceItem | undefined
		if (!item) return
		selectedItem = item
		inputValue = item.label
	}}
>
	<Combobox.Label class="font-semibold">{label}</Combobox.Label>
	<Combobox.Control class="relative">
		<Combobox.Input
			class="input w-full pr-8"
			placeholder="Search for a service (Groq, Ollama, Mistral, ...)"
		/>
		<Combobox.Trigger
			class="btn-ghost absolute inset-y-0 right-0 flex items-center px-2"
			aria-label="Show all services"
		>
			<Icons.ChevronDown size={16} />
		</Combobox.Trigger>
	</Combobox.Control>
	<Portal>
		<Combobox.Positioner class="z-[1000]!">
			<Combobox.Content
				class="card preset-tonal-surface bg-surface-100-900 max-h-72 w-[26rem] max-w-[90vw] overflow-y-auto p-1 shadow-xl"
			>
				{#if groups.length === 0}
					<p class="text-surface-700-300 p-2 text-sm">
						No matching service.
					</p>
				{/if}
				{#each groups as group (group.category)}
					<Combobox.ItemGroup>
						<Combobox.ItemGroupLabel
							class="text-surface-700-300 px-2 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase"
						>
							{group.label}
						</Combobox.ItemGroupLabel>
						{#each group.items as item (item.key)}
							<Combobox.Item
								{item}
								class="hover:preset-tonal-primary data-[state=checked]:preset-filled-primary-500 flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm"
							>
								<Combobox.ItemText>
									{item.label}
								</Combobox.ItemText>
								<Combobox.ItemIndicator>
									<Icons.Check size={14} />
								</Combobox.ItemIndicator>
							</Combobox.Item>
						{/each}
					</Combobox.ItemGroup>
				{/each}
			</Combobox.Content>
		</Combobox.Positioner>
	</Portal>
</Combobox>
