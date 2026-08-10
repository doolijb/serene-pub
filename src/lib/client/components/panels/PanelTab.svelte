<script lang="ts">
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { Component, Snippet } from "svelte"

	/**
	 * One tab trigger: ICON ONLY, at every width.
	 *
	 * There is deliberately no visible text. The previous attempt rendered the
	 * active tab's label and capped its width, so "Character Lore" displayed as
	 * "Chara…" — and a label that can be trimmed is worse than no label,
	 * because it reads as a bug rather than as a deliberate affordance. With no
	 * text at all there is nothing to trim, and the strip holds one row.
	 *
	 * The section's full name is shown by PanelSectionTitle, directly above the
	 * content — so the name is always available in full, it just isn't repeated
	 * inside a 36px trigger.
	 *
	 * The accessible name is unaffected: `aria-label` and `title` both come
	 * from `label`, so screen readers and tooltips still get the real name. The
	 * component sets it unconditionally so no call site can forget.
	 */
	interface Props {
		value: string
		label: string
		/** A @lucide/svelte icon component. */
		icon?: Component<any>
		disabled?: boolean
		/** eg. an unread/ready count, rendered after the icon. */
		badge?: Snippet
		/** Escape hatch for per-tab visibility, eg. ContextSidebar hides its
		    Cards tab below `lg` because that editor isn't usable at mobile
		    widths yet. */
		class?: string
	}

	let {
		value,
		label,
		icon: Icon,
		disabled = false,
		badge,
		class: className = ""
	}: Props = $props()
</script>

<!--
	Tabs.Trigger MUST be this component's root element with no wrapper: zag's
	keyboard navigation would survive a wrapper (getElements is descendant-
	scoped) but the flex list layout would not.

	Skeleton's tabs.css applies `@apply btn` to [data-part='trigger'] inside
	layer(base) — that is where the button/pill look came from. Utilities
	outrank the base layer, so the classes below restyle it as a real underlined
	tab: no fill, no rounding, and a transparent bottom border that colours in
	on selection. Matches the hand-rolled strip in ActivitySidebar:117-121 so
	the two agree.

	`flex-1 min-w-0` makes the strip fit BY CONSTRUCTION rather than by
	arithmetic: the triggers divide whatever width the list has, so the row
	can never wrap or clip no matter the tab count or the panel size. Fixed
	padding was tried first and is too fragile — six 33px triggers plus gaps
	need 218px, which fits the 220px content box until a tall tab (Bindings)
	raises a 15px scrollbar and drops it to 205px, at which point the strip
	silently became two rows. Same idiom as ActivitySidebar's hand-rolled strip.
-->
<Tabs.Trigger
	{value}
	{disabled}
	title={label}
	aria-label={label}
	class="text-surface-700-300 hover:text-primary-500 data-[selected]:border-primary-500 data-[selected]:text-primary-500 min-w-0 flex-1 rounded-none border-b-2 border-transparent bg-transparent px-1 py-1.5 {className}"
>
	{#if Icon}
		<Icon size={18} aria-hidden="true" />
	{/if}
	{@render badge?.()}
</Tabs.Trigger>
