<script lang="ts">
	/**
	 * The New Connection service picker — search plus cards, one modality at
	 * a time.
	 *
	 * Was a combobox: type, arrow-down, Enter. A service you have never heard
	 * of is not discoverable that way — the picker is the first control
	 * anyone meets in onboarding, and it showed an empty box. Cards show what
	 * is on offer; the search narrows them.
	 *
	 * The modalities share this picker but never mix, so a slot asking for
	 * one never offers another. The toggle is built from
	 * `CONNECTION_SECTIONS`, not from hardcoded buttons: the hardcoded pair
	 * is what made embeddings a separate panel rather than a third entry.
	 *
	 * A service this machine can't run (the local ONNX types, where the
	 * runtime didn't load) stays listed as a disabled card with its reason
	 * in place of its setup-need chip — hidden, it would read as "not built".
	 *
	 * Each card's chip says what the service asks of the person: **Needs an
	 * API key**, **Runs locally** or **Address only** (`SETUP_NEED_LABELS`).
	 */
	import { getContext, tick } from "svelte"
	import * as Icons from "@lucide/svelte"
	import {
		buildConnectionServiceItems,
		groupConnectionServiceItems,
		filterConnectionServiceItems,
		filterConnectionServiceItemsByModality,
		CATEGORY_LABELS,
		SETUP_NEED_LABELS,
		type ConnectionServiceCategory,
		type ConnectionServiceItem
	} from "$lib/shared/utils/connectionServiceItems"
	import { CONNECTION_SECTIONS } from "$lib/shared/constants/connectionSections"

	interface Props {
		selectedItem: ConnectionServiceItem | undefined
		label: string
		/** Seed the modality toggle (e.g. the Embeddings section). */
		initialModality?: string
		/**
		 * Open narrowed to one category — the "A custom connection" door
		 * opens on Local / Self-hosted (ruled 2026-09-24). Clearable.
		 */
		initialCategory?: ConnectionServiceCategory
	}
	let {
		selectedItem = $bindable(),
		label,
		initialModality,
		initialCategory
	}: Props = $props()
	/** The person pressed "Show all": the seeded category stops applying. */
	let categoryCleared = $state(false)
	const category = $derived(
		categoryCleared ? null : (initialCategory ?? null)
	)

	const systemSettingsCtx = getContext<SystemSettingsCtx | undefined>(
		"systemSettingsCtx"
	)
	// Built from CONNECTION_TYPES + OPENAI_COMPATIBLE_PRESETS, which never
	// change at runtime, and the local ONNX verdict, which arrives once with
	// the system settings — derived from that alone, so a keystroke never
	// rebuilds it.
	const allItems = $derived(
		buildConnectionServiceItems({
			localOnnx: systemSettingsCtx?.settings?.localOnnxAvailability
		})
	)

	// One button per section, seeded from the current selection so re-opening
	// on an image connection stays on Image. A hand-set choice wins; the seed
	// applies until then, read through a derived so it is not captured once.
	let modalityOverride = $state<string | null>(null)
	const modality = $derived(
		modalityOverride ??
			initialModality ??
			selectedItem?.modality ??
			"text-gen"
	)
	function setModality(m: string) {
		if (m === modality) return
		modalityOverride = m
		// A selection from the other modality no longer belongs — clear it so
		// the cards reflect the new modality cleanly.
		if (selectedItem && selectedItem.modality !== m) {
			selectedItem = undefined
		}
	}

	let search = $state("")
	/** This section's services matching the search, in every category. */
	const matchingItems = $derived(
		filterConnectionServiceItems(
			filterConnectionServiceItemsByModality(allItems, modality),
			search
		)
	)
	// 🚧 The custom door's narrowing (Local / Self-hosted) keeps the
	// **Custom (OpenAI-compatible)** entry beside the local servers
	// (2026-10-18, the 100-turn walk #31: the very option the door promised
	// sat behind Show all).
	let visibleItems = $derived(
		matchingItems.filter(
			(i) =>
				!category ||
				i.category === category ||
				(category === "local" && i.category === "custom")
		)
	)
	let groups = $derived(groupConnectionServiceItems(visibleItems))

	// ── Nothing matches ──────────────────────────────────────────────────
	// The line names two ways out, and both are controls. Each removes the
	// control that was pressed, so focus moves to what took its place.
	let searchInput = $state<HTMLInputElement>()
	let cardList = $state<HTMLElement>()
	/** The bare OpenAI-compatible entry, where this section offers one. */
	const customItem = $derived(
		allItems.find(
			(i) =>
				i.category === "custom" &&
				i.modality === modality &&
				!i.disabledReason
		)
	)
	/**
	 * Drop the category, and the search too when nothing outside the
	 * category matches it either — "Show all" must never show nothing.
	 */
	function showAll() {
		categoryCleared = true
		if (matchingItems.length === 0) search = ""
		void tick().then(() => searchInput?.focus())
	}
	/**
	 * The line, as text and controls in order. Rendered part after part with
	 * no whitespace between them — the formatter breaks lines between
	 * elements, and a break before a comma would print " ," otherwise.
	 */
	const noMatchLine = $derived.by(() => {
		const q = search.trim()
		return [
			{
				text: `${q ? `No service called “${q}”.` : "No service here."} Try `
			},
			{ text: "Show all", onclick: showAll },
			...(customItem
				? [
						{ text: ", or pick " },
						{ text: customItem.label, onclick: pickCustom }
					]
				: []),
			{ text: "." }
		] as { text: string; onclick?: () => void }[]
	})
	function pickCustom() {
		if (!customItem) return
		categoryCleared = true
		search = ""
		selectedItem = customItem
		void tick().then(() =>
			cardList
				?.querySelector<HTMLElement>("[role=radio][aria-checked=true]")
				?.focus()
		)
	}
</script>

<!-- One button per section. The modalities never mix in one picker. -->
<div
	class="panel-edge mb-2 inline-flex overflow-hidden rounded-lg border"
	role="group"
	aria-label="Connection type"
>
	{#each CONNECTION_SECTIONS as s (s.modality)}
		{@const Icon = (Icons as any)[s.icon] ?? Icons.Cable}
		<button
			type="button"
			class="flex items-center gap-1.5 px-3 py-1.5 text-sm {modality ===
			s.modality
				? 'preset-pressed'
				: 'preset-tonal-surface'}"
			aria-pressed={modality === s.modality}
			onclick={() => setModality(s.modality)}
		>
			<Icon size={14} />
			{s.label}
		</button>
	{/each}
</div>

<span class="font-semibold">{label}</span>
{#if category}
	<p
		class="text-surface-600-400 mt-1 flex flex-wrap items-center gap-2 text-xs"
	>
		Showing {CATEGORY_LABELS[category]} only
		<button
			type="button"
			class="anchor"
			onclick={() => (categoryCleared = true)}
		>
			Show all
		</button>
	</p>
{/if}
<div class="relative mt-1">
	<Icons.Search
		size={14}
		class="text-surface-600-400 pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
		aria-hidden="true"
	/>
	<input
		type="search"
		class="input w-full pl-8 text-sm"
		placeholder="Search for a service (Groq, Ollama, Mistral, ...)"
		bind:this={searchInput}
		bind:value={search}
		aria-label="Search for a service"
	/>
</div>

<!-- Cards, not a dropdown: what is on offer should be visible. Native
     buttons, so Tab/Enter come free; arrow-key roving would be polish on a
     list the search already narrows. -->
{#if groups.length === 0}
	<!-- Outside the radiogroup: it holds radios only. -->
	<p class="text-surface-700-300 mt-2 p-2 text-sm">
		{#each noMatchLine as part, i (i)}
			{#if part.onclick}
				<button type="button" class="anchor" onclick={part.onclick}>
					{part.text}
				</button>
			{:else}
				{part.text}
			{/if}
		{/each}
	</p>
{:else}
	<div
		bind:this={cardList}
		class="mt-2 flex max-h-72 flex-col gap-2 overflow-y-auto pr-0.5"
		role="radiogroup"
		aria-label={label}
	>
		{#each groups as group (group.category)}
			<p class="text-surface-600-400 px-1 pt-1 text-xs">
				{group.label}
			</p>
			{#each group.items as item (item.key)}
				{@const active = selectedItem?.key === item.key}
				<!-- A disabled card says why in its own second line, not only in a
			     tooltip: nothing is hover-only (STYLE-GUIDE §9). -->
				<button
					type="button"
					role="radio"
					aria-checked={active}
					disabled={!!item.disabledReason}
					title={item.disabledReason}
					onclick={() => (selectedItem = item)}
					class="card preset-filled-surface-100-900 flex w-full items-start justify-between gap-2 rounded-xl p-3 text-left {item.disabledReason
						? 'cursor-not-allowed opacity-70'
						: active
							? 'ring-primary-500 ring-offset-surface-50 dark:ring-offset-surface-950 cursor-pointer ring-2 ring-offset-2'
							: 'hover:preset-tonal-primary cursor-pointer'}"
				>
					<span class="min-w-0">
						<span class="block truncate text-sm font-semibold">
							{item.label}
						</span>
						{#if item.disabledReason}
							<span
								class="text-surface-600-400 mt-0.5 block text-xs {active
									? 'opacity-80'
									: ''}"
							>
								{item.disabledReason}
							</span>
						{:else}
							<!-- Outlined, never filled: the whole card is the
						     button, so nothing inside it may look like one. -->
							<span
								class="border-surface-200-800 text-surface-600-400 mt-1 inline-block rounded-full border px-1.5 py-0.5 text-meta {active
									? 'opacity-80'
									: ''}"
							>
								{SETUP_NEED_LABELS[item.setupNeed]}
							</span>
						{/if}
					</span>
					{#if active}
						<Icons.Check size={16} class="mt-0.5 shrink-0" />
					{/if}
				</button>
			{/each}
		{/each}
	</div>
{/if}
