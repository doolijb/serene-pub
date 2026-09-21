<script lang="ts" module>
	import type { Component } from "svelte"

	/** One tab in the strip. */
	export interface PanelTab {
		/** Identifies the tab and names its panel — see `panelIdPrefix`. */
		value: string
		/** Visible text, and the tab's accessible name. */
		label: string
		/** A @lucide/svelte icon component, rendered at 16px. */
		icon: Component<any>
		/** Marks the tab with a dot: something inside its panel needs
		 *  attention while another panel is the one on show. */
		hasError?: boolean
		/** Marks the tab with an ember dot: something inside its panel is
		 *  happening — a download in flight — while another panel is on show.
		 *  A state, not a fault, so it is `warning` and says "in progress"
		 *  rather than "has an error". Ignored when `hasError` is set: one
		 *  signal per tab, and a fault outranks a state. */
		hasActivity?: boolean
	}
</script>

<script lang="ts">
	/**
	 * The LABELLED tab strip: a full-width row of equal icon-and-text tabs
	 * under a rule, with the selected one underlined in primary.
	 *
	 * ⚠ Not the only tab strip. `PanelTabList` + `PanelTab` are the ICON-ONLY
	 * strip a 400px sidebar panel wears — no text at all, because a label that
	 * can be trimmed reads as a bug (the reasoning lives there). This one is
	 * for a view whose tabs are few and whose labels are short enough to spell
	 * out, and for panels that must all stay mounted: it renders the tablist
	 * and nothing else, so the caller owns its panels and decides what
	 * `hidden` means for each of them.
	 *
	 * The two look the same on purpose — same height, same rule, same primary
	 * underline — so a person moving between views sees one idiom.
	 *
	 * ## Ids
	 *
	 * One prefix names both halves, so a caller cannot label a panel with a
	 * tab id that does not exist:
	 *
	 * - panel: `{panelIdPrefix}-{value}` — the caller puts this on its panel
	 * - tab:   `{panelIdPrefix}-{value}-tab` — the caller's panel points at
	 *   this with `aria-labelledby`
	 *
	 * ## Keyboard
	 *
	 * Left/Right, Home and End move the selection AND the focus, and only the
	 * selected tab is in the tab order — the roving-tabindex contract a
	 * `role="tablist"` owes. Selecting emits the new value through `value` and
	 * does nothing else; showing and hiding panels is the caller's.
	 */
	let {
		tabs,
		value = $bindable(),
		ariaLabel,
		panelIdPrefix = "panel",
		class: className = ""
	}: {
		tabs: PanelTab[]
		/** The selected tab's `value`. Bindable. */
		value: string
		/** Names the tablist, eg. "Character fields". */
		ariaLabel: string
		/** See **Ids** above. */
		panelIdPrefix?: string
		class?: string
	} = $props()

	let tabRefs: Record<string, HTMLButtonElement | null> = $state({})

	function select(next: string) {
		value = next
		tabRefs[next]?.focus()
	}

	function handleKeydown(e: KeyboardEvent, index: number) {
		const count = tabs.length
		let next: number
		if (e.key === "ArrowRight") next = (index + 1) % count
		else if (e.key === "ArrowLeft") next = (index - 1 + count) % count
		else if (e.key === "Home") next = 0
		else if (e.key === "End") next = count - 1
		else return
		e.preventDefault()
		select(tabs[next].value)
	}
</script>

<div
	class="border-surface-800 flex shrink-0 border-b {className}"
	role="tablist"
	aria-label={ariaLabel}
>
	{#each tabs as tab, i (tab.value)}
		{@const TabIcon = tab.icon}
		{@const selected = value === tab.value}
		<button
			type="button"
			role="tab"
			id="{panelIdPrefix}-{tab.value}-tab"
			aria-selected={selected}
			aria-controls="{panelIdPrefix}-{tab.value}"
			tabindex={selected ? 0 : -1}
			bind:this={tabRefs[tab.value]}
			class="flex h-10 min-w-0 flex-1 items-center justify-center gap-2 border-b-2 px-1 text-[13px] {selected
				? 'border-primary-500 text-primary-500 font-medium'
				: 'text-surface-400 hover:text-surface-200 border-transparent'}"
			onclick={() => (value = tab.value)}
			onkeydown={(e) => handleKeydown(e, i)}
		>
			<TabIcon size={16} class="shrink-0" aria-hidden="true" />
			<!-- The dot rides the LABEL, not the tab: on a tab that fills a
			     third of the row it would otherwise float in whitespace with
			     nothing to attach it to. It hangs off the OUTER span, which
			     has no overflow of its own — the truncating span clips
			     anything outside its box, and the dot is outside it by
			     design. -->
			<span class="relative flex min-w-0 items-center">
				<span class="min-w-0 truncate">{tab.label}</span>
				{#if tab.hasError}
					<span
						class="bg-error-500 absolute -top-0.5 -right-2 size-1.5 rounded-full"
						aria-hidden="true"
					></span>
					<span class="sr-only">(has an error)</span>
				{:else if tab.hasActivity}
					<span
						class="bg-warning-500 absolute -top-0.5 -right-2 size-1.5 rounded-full"
						aria-hidden="true"
					></span>
					<span class="sr-only">(in progress)</span>
				{/if}
			</span>
		</button>
	{/each}
</div>
