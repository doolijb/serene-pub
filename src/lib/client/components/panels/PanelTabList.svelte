<script lang="ts">
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { Snippet } from "svelte"

	/**
	 * Standard panel tab strip.
	 *
	 * The strip WRAPS. It must: flex-nowrap meets the panel's
	 * overflow-x:hidden with nothing in between, so any strip too wide for one
	 * row gets its last trigger clipped and unreachable by pointer. This was
	 * tried nowrap-first and measurement rejected it — at 1024x768 the tab-list
	 * content box is 220px and an icon-only btn-sm trigger measures 36px, but
	 * the ACTIVE trigger also grows a label (up to the 5.5rem cap in PanelTab),
	 * so the real requirement is `36n + 4(n-1) + label`:
	 *
	 *   2 tabs -> 76  + ~88 = 164px  fits
	 *   4 tabs -> 156 + ~88 = 244px  does NOT fit
	 *   5 tabs -> 196 + ~88 = 284px  does NOT fit
	 *   6 tabs -> 236 + ~88 = 324px  does NOT fit
	 *
	 * i.e. essentially every real strip needs to wrap at the narrowest panel.
	 * Wrapping costs nothing where it isn't needed — a strip that fits stays on
	 * one row.
	 *
	 * `reserveRows` is then the separate, opt-in fix for the *jump*: because
	 * only the active tab renders a label, a strip's row count can change with
	 * the selection, moving the content below. Reserve only where that's been
	 * measured, since a reservation on a strip that never wraps is permanent
	 * dead space.
	 */
	interface Props {
		children: Snippet
		/** Reserve this many rows so the content below never moves when the
		    active tab's label changes the row count. Height is derived from
		    the button sizing tokens rather than hardcoded px, so it tracks any
		    change to button padding. Only set this where the row count has
		    actually been measured to vary. */
		reserveRows?: number
		class?: string
	}

	let { children, reserveRows, class: className = "" }: Props = $props()

	// Height of one trigger row. Derived from --text-sm (the btn-sm font size)
	// so it tracks the type scale, with a +0.5rem allowance for the trigger's
	// own vertical padding and border.
	//
	// The naive `2 * var(--text-sm) - 0.125rem` reading of Skeleton's .btn
	// padding formula is NOT enough: it computes 26px against a row that
	// actually measures ~32.5px, so a 2-row reservation came out at 56px
	// against a real 69px and failed to stop the jump. Verify with a
	// measurement if you change this, don't re-derive it from the CSS.
	const ROW = "calc(var(--text-sm) * 1.5 + 0.75rem)"
	const reservedHeight = $derived(
		reserveRows
			? `calc(${reserveRows} * ${ROW} + ${reserveRows - 1} * 0.25rem)`
			: undefined
	)
</script>

<Tabs.List
	class="flex min-w-0 shrink-0 flex-wrap items-center gap-1 {className}"
	style={reservedHeight ? `min-height: ${reservedHeight}` : undefined}
>
	{@render children()}
</Tabs.List>
