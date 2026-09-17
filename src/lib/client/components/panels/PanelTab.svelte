<script lang="ts">
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { Component, Snippet } from "svelte"

	/**
	 * One tab trigger: ICON ONLY in the strip, icon AND label in the rail.
	 *
	 * In the strip form there is deliberately no visible text. The previous
	 * attempt rendered the active tab's label and capped its width, so
	 * "Character Lore" displayed as "Chara…" — and a label that can be trimmed
	 * is worse than no label, because it reads as a bug rather than as a
	 * deliberate affordance. With no text at all there is nothing to trim, and
	 * the strip holds one row.
	 *
	 * The section's full name is shown by PanelSectionTitle, directly above the
	 * content — so the name is always available in full, it just isn't repeated
	 * inside a 36px trigger.
	 *
	 * The rail form (PanelTabList's `## The labelled rail`, asked for with
	 * `orientation="vertical"` on the owning `<Tabs>`) is the case the trimming
	 * argument never applied to: a 200px row has room for the name, so the same
	 * `label` that has always been the accessible name becomes visible text
	 * too. It truncates only where a name genuinely cannot fit, and the `title`
	 * still carries it in full.
	 *
	 * The accessible name is unaffected either way: `aria-label` and `title`
	 * both come from `label`, so screen readers and tooltips still get the real
	 * name. The component sets it unconditionally so no call site can forget.
	 */
	interface Props {
		value: string
		label: string
		/** A @lucide/svelte icon component. */
		icon?: Component<any>
		disabled?: boolean
		/** eg. an unread/ready count, rendered after the icon. */
		badge?: Snippet
		/** Escape hatch for per-tab styling, eg. the Ollama and KoboldCpp
		    managers ring their Available tab during the setup tutorial. A tab that
		    should not be REACHABLE is not rendered at all — see ContextSidebar,
		    whose Cards trigger is wrapped in `{#if}` rather than hidden with a
		    class, so it never sits in zag's arrow-key ring. */
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
<!--
	The rail overrides (`data-[orientation=vertical]:…`) are inert in every
	panel that never asks for one. What they change: a row that fills the rail's
	width instead of dividing the strip's, 40px tall, left-aligned, and — for
	the selected one — the ruled selection look rather than an underline that
	would now be drawn along the bottom of a row. That look is `.sidebar-row-
	active` restated in utilities rather than applied as the class: the class is
	unlayered, so it would win in the strip form too and paint a fill behind the
	selected icon at every width.
-->
<Tabs.Trigger
	{value}
	{disabled}
	title={label}
	aria-label={label}
	class="text-surface-700-300 hover:text-primary-500 data-[selected]:border-primary-500 data-[selected]:text-primary-500 group/tab data-[orientation=vertical]:data-[selected]:bg-surface-200-800 min-w-0 flex-1 rounded-none border-b-2 border-transparent bg-transparent px-1 py-1.5 data-[orientation=vertical]:h-10 data-[orientation=vertical]:w-full data-[orientation=vertical]:flex-none data-[orientation=vertical]:justify-start data-[orientation=vertical]:gap-2 data-[orientation=vertical]:rounded-md data-[orientation=vertical]:border-b-0 data-[orientation=vertical]:px-2.5 data-[orientation=vertical]:text-sm data-[orientation=vertical]:data-[selected]:shadow-[inset_3px_0_0_var(--color-primary-500)] {className}"
>
	{#if Icon}
		<Icon size={18} class="shrink-0" aria-hidden="true" />
	{/if}
	<span
		class="hidden min-w-0 truncate group-data-[orientation=vertical]/tab:block"
	>
		{label}
	</span>
	{@render badge?.()}
</Tabs.Trigger>
