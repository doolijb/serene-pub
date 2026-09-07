<script lang="ts">
	import { collection } from "@zag-js/combobox"
	import { Combobox, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import {
		buildConnectionServiceItems,
		groupConnectionServiceItems,
		filterConnectionServiceItems,
		filterConnectionServiceItemsByModality,
		type ConnectionServiceItem
	} from "$lib/shared/utils/connectionServiceItems"

	interface Props {
		selectedItem: ConnectionServiceItem | undefined
		label: string
		/** Seed the Text/Image toggle (e.g. the Image Generation category). */
		initialModality?: "text-gen" | "image-gen"
	}
	let { selectedItem = $bindable(), label, initialModality }: Props = $props()

	// Static for the app's lifetime (built from CONNECTION_TYPES +
	// OPENAI_CHAT_PRESETS, neither of which change at runtime) — computed
	// once rather than on every keystroke.
	const ALL_ITEMS = buildConnectionServiceItems()

	// Text vs Image generation — the two modalities share this picker but never
	// mix, so a widget slot asking for one never offers the other. Seeded from
	// the current selection so re-opening on an image connection stays on Image.
	let modality = $state<"text-gen" | "image-gen">(
		initialModality ?? selectedItem?.modality ?? "text-gen"
	)
	function setModality(m: "text-gen" | "image-gen") {
		if (m === modality) return
		modality = m
		// A selection from the other modality no longer belongs — clear it and
		// the search so the list reflects the new modality cleanly.
		if (selectedItem && selectedItem.modality !== m) {
			selectedItem = undefined
			inputValue = ""
		}
	}

	let inputValue = $state(selectedItem?.label ?? "")
	let visibleItems = $derived(
		filterConnectionServiceItems(
			filterConnectionServiceItemsByModality(ALL_ITEMS, modality),
			inputValue
		)
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

<!-- Modality toggle: Text vs Image generation. The two never mix in one picker. -->
<div
	class="border-surface-300-700 mb-2 inline-flex overflow-hidden rounded-lg border"
	role="group"
	aria-label="Generation type"
>
	<button
		type="button"
		class="flex items-center gap-1.5 px-3 py-1.5 text-sm {modality ===
		'text-gen'
			? 'preset-filled-primary-500'
			: 'preset-tonal-surface'}"
		aria-pressed={modality === "text-gen"}
		onclick={() => setModality("text-gen")}
	>
		<Icons.Type size={14} />
		Text
	</button>
	<button
		type="button"
		class="flex items-center gap-1.5 px-3 py-1.5 text-sm {modality ===
		'image-gen'
			? 'preset-filled-primary-500'
			: 'preset-tonal-surface'}"
		aria-pressed={modality === "image-gen"}
		onclick={() => setModality("image-gen")}
	>
		<Icons.Image size={14} />
		Image
	</button>
</div>

<!-- `inputBehavior="autohighlight"` is not cosmetic. Without it, typing a filter
     and pressing Enter selects NOTHING — zag highlights no row on its own, and
     Enter with nothing highlighted is a no-op, so the user must press ArrowDown
     first. A native <select> accepts type-then-Enter, and this is the first
     control anyone meets in onboarding. Measured on a live instance: after
     typing "Ollama", both matching rows reported `data-highlighted` absent.
     Matches `inputs/Select.svelte`, which sets the same. -->
<Combobox
	collection={comboboxCollection}
	value={selectedItem ? [selectedItem.key] : []}
	{inputValue}
	openOnClick
	inputBehavior="autohighlight"
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
		<!-- Centred by `translate` with `transform-none`, matching
		     `inputs/Select.svelte` — see the note there for the full mechanism.
		     In short: skeleton-common's combobox.css ships the trigger as
		     `top:50%; transform:translateY(-50%)` in `layer(base)`, so a utility
		     replaces only the properties it sets. `inset-y-0` used to overwrite
		     `top` while leaving the base's transform standing, which put this
		     chevron's centre on the input's TOP EDGE — 17px high, measured. And
		     Tailwind v4 emits translate utilities as the independent `translate`
		     property, so it COMPOSES with a surviving `transform` rather than
		     replacing it; `transform-none` is what stops the shift applying
		     twice. Sizing/colour come from the base's own btn-icon preset. -->
		<Combobox.Trigger
			class="absolute end-1.5 top-1/2 -translate-y-1/2 transform-none cursor-pointer"
			aria-label="Show all services"
		>
			<Icons.ChevronDown size={16} />
		</Combobox.Trigger>
	</Combobox.Control>
	<Portal>
		<Combobox.Positioner class="z-[1000]!">
			<Combobox.Content
				class="card preset-filled-surface-100-900-surface bg-surface-100-900 max-h-72 w-[26rem] max-w-[90vw] overflow-y-auto p-1 shadow-xl"
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
							<!-- `data-[highlighted]` as well as `hover`: zag sets the
							     former for BOTH arrow keys and pointermove, and with
							     only `hover` styled the keyboard got nothing but
							     skeleton-common's faint base tint (measured at 10%
							     alpha) while the mouse got the full tonal preset. Same
							     movement, two different strengths. -->
							<Combobox.Item
								{item}
								class="hover:preset-tonal-primary data-[highlighted]:preset-tonal-primary data-[state=checked]:preset-filled-primary-500 flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm"
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
