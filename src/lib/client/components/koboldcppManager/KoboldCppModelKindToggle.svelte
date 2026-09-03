<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { Component } from "svelte"

	/**
	 * The Text | Image segmented control shared by the Models and Available
	 * tabs.
	 *
	 * ONE component rather than a copy in each tab, because the two things that
	 * would drift are exactly the two that are invisible when they do: the
	 * labels (so the same switch reads as two different switches) and the aria
	 * wiring (so one tab announces the current mode to a screen reader and the
	 * other silently doesn't).
	 *
	 * Styling follows the Auto/On/Off thinking control in KoboldCppManagedForm
	 * — a flex row inside a rounded, clipped border, the active segment filled
	 * primary. That control has no aria at all, so it isn't copied wholesale:
	 * `role="group"` plus `aria-pressed` per segment is added here, which is
	 * what makes "Image is currently selected" audible rather than purely a
	 * colour difference.
	 *
	 * Note the Recommended/Hugging Face control next to this one on the
	 * Available tab is a `<select>`, not a button group — different question
	 * (where to search), different affordance, left alone.
	 */
	interface Props {
		/** The kind of model being managed. Bindable because the SIDEBAR owns
		 * this, not either tab: flipping to Image on Available and then opening
		 * Models must land in the image world, not silently back in text. */
		kind: Sockets.KoboldCPP.ModelKindFilter
		/** Called after `kind` has already been updated, for callers that need
		 * to act on the switch (re-run a search, refetch a catalog) rather than
		 * just re-filter what they already hold. */
		onchange?: (kind: Sockets.KoboldCPP.ModelKindFilter) => void
		disabled?: boolean
		/** Escape hatch for spacing at the call site — the control itself has
		 * no margin so each tab can place it against its own layout. */
		class?: string
	}

	let {
		kind = $bindable(),
		onchange,
		disabled = false,
		class: className = ""
	}: Props = $props()

	const OPTIONS: {
		value: Sockets.KoboldCPP.ModelKindFilter
		label: string
		icon: Component<any>
	}[] = [
		{ value: "text", label: "Text", icon: Icons.MessageSquareText },
		{ value: "image", label: "Image", icon: Icons.Image }
	]

	function select(next: Sockets.KoboldCPP.ModelKindFilter) {
		// Re-clicking the active segment is a no-op rather than a re-emit: the
		// Available tab hangs a search off the switch, and a second click on
		// "Image" spending another slot of the shared searchModels rate-limit
		// budget for an identical result set is the kind of thing only ever
		// noticed as a mysterious "too many requests".
		if (next === kind) return
		kind = next
		onchange?.(next)
	}
</script>

<div
	class="border-surface-300-700 flex overflow-hidden rounded border text-sm {className}"
	role="group"
	aria-label="Model type"
>
	{#each OPTIONS as opt}
		{@const Icon = opt.icon}
		<button
			type="button"
			class="flex items-center gap-1.5 px-3 py-1 transition-colors {kind ===
			opt.value
				? 'preset-filled-primary-500'
				: 'preset-filled-surface-400-600'}"
			aria-pressed={kind === opt.value}
			{disabled}
			onclick={() => select(opt.value)}
		>
			<Icon size={14} />
			{opt.label}
		</button>
	{/each}
</div>
