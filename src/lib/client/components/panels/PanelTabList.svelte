<script lang="ts">
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { Snippet } from "svelte"

	/**
	 * Standard panel tab strip.
	 *
	 * Default is a SINGLE NON-WRAPPING row. The jump this fixes was caused by
	 * the strip's width being a function of the selection: only the active tab
	 * renders a text label, so clicking between "Graph" and "Character Lore"
	 * reflowed the list between one and two rows and shoved the content below
	 * up and down. Removing the wrap removes the reflow at its cause, and —
	 * unlike reserving height globally — costs nothing at the widths where one
	 * row was always enough (most panels at 1920, all of them at 4K).
	 * PanelTab's label truncates as the sole deficit-absorber.
	 *
	 * `reserveRows` is the escape hatch, for strips that genuinely cannot fit
	 * on one row. flex-nowrap meets the panel's overflow-x:hidden with nothing
	 * in between, so a strip whose ICON-ONLY min-content width exceeds the
	 * panel doesn't just look cramped — its last trigger is clipped and
	 * becomes unreachable by pointer. Measured at 1024x768 (tab-list content
	 * width 220px), one icon-only btn-sm trigger is ~34px:
	 *
	 *   6 tabs (Lorebooks+) -> 6*34 + 5*4 = 224px  > 220px  => MUST reserve
	 *   5 tabs (KoboldCPP)  -> 5*34 + 4*4 = 186px           => fits
	 *   4 tabs              -> 4*34 + 3*4 = 148px           => fits
	 *
	 * Re-run that arithmetic whenever a tab is added: a 7th tab pushes any
	 * 5- or 6-tab strip over.
	 */
	interface Props {
		children: Snippet
		/** Allow the strip to wrap, reserving this many rows so the content
		    below never moves. Height is derived from the button sizing tokens
		    rather than hardcoded px, so it tracks any change to button
		    padding. */
		reserveRows?: number
		class?: string
	}

	let { children, reserveRows, class: className = "" }: Props = $props()

	// One trigger row = line-height (--btn-size) + vertical padding
	// (2 * ((--btn-size - 0.5 spacing) / 2)), i.e. 2*--btn-size - 0.125rem.
	// Multiple rows add the list's gap-1 (0.25rem) between them.
	const reservedHeight = $derived(
		reserveRows
			? `calc(${reserveRows} * (2 * var(--text-sm) - 0.125rem) + ${reserveRows - 1} * 0.25rem)`
			: undefined
	)
</script>

<Tabs.List
	class="flex min-w-0 shrink-0 items-center gap-1 {reserveRows
		? 'flex-wrap'
		: 'flex-nowrap'} {className}"
	style={reservedHeight ? `min-height: ${reservedHeight}` : undefined}
>
	{@render children()}
</Tabs.List>
