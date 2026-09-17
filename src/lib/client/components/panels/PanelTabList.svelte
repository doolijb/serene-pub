<script lang="ts">
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { Snippet } from "svelte"

	/**
	 * Standard panel tab strip: one row of icon-only triggers with a bottom
	 * rule, so it reads as a tab bar rather than a row of buttons.
	 *
	 * Since PanelTab renders no text, the strip's width is a pure function of
	 * the tab COUNT, not the current selection, so the content below never
	 * jumps and no height reservation is needed to guard against it.
	 *
	 * `flex-wrap` is kept purely as a safety net: it is not expected to trigger
	 * at any current tab count, but if a 7th tab is ever added the strip should
	 * degrade by wrapping rather than by clipping a trigger — flex-nowrap meets
	 * the panel's overflow-x:hidden with nothing in between, and a clipped
	 * trigger is unreachable by pointer.
	 *
	 * ## The labelled rail
	 *
	 * Given room — a view measured at `DESK_MIN_PX` — the same strip becomes a
	 * ~200px LEFT column of icon + label rows, and PanelTab reveals its label
	 * (see there). That is asked for by passing `orientation="vertical"` to the
	 * owning `<Tabs>` and nothing else: zag stamps `data-orientation` on the
	 * root, the list, every trigger and every panel, so the two forms are one
	 * set of `data-[orientation=vertical]:` utilities rather than a second
	 * component — and it is the honest way to ask, because a vertical tablist
	 * also wants `aria-orientation` and Up/Down arrow keys, which zag only
	 * gives when it has been told.
	 *
	 * This element does not read its own width: it is 200px wide in the rail
	 * form, so its own container says nothing about whether the view has
	 * room. The owner measures itself (`ViewModeTracker`) and decides.
	 *
	 * ⚠ A panel that never passes `orientation` is untouched by all of it —
	 * `data-orientation` is `horizontal` and every rail utility is inert.
	 */
	interface Props {
		children: Snippet
		class?: string
	}

	let { children, class: className = "" }: Props = $props()
</script>

<!-- The vertical overrides undo exactly the three things the strip form
     asserts and Skeleton's own vertical base rules cannot: the bottom rule
     (which would draw in ADDITION to the rail's inline-end one), the wrap
     safety net, and the centred cross-axis that would shrink each row to its
     label's width. The column direction and the inline-end border come from
     `[data-part='list'][data-orientation='vertical']` in skeleton-common. -->
<Tabs.List
	class="border-surface-200-800 flex min-w-0 shrink-0 flex-wrap items-center gap-1 border-b data-[orientation=vertical]:w-50 data-[orientation=vertical]:flex-nowrap data-[orientation=vertical]:items-stretch data-[orientation=vertical]:gap-0.5 data-[orientation=vertical]:border-b-0 {className}"
>
	{@render children()}
</Tabs.List>
