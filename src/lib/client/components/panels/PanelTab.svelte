<script lang="ts">
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { Component, Snippet } from "svelte"

	/**
	 * One tab trigger: icon always, text label only while active.
	 *
	 * TWO THINGS THIS COMPONENT GUARANTEES SO CALL SITES CANNOT FORGET:
	 *
	 * 1. An accessible name. Inactive tabs are icon-only by convention, and
	 *    the active tab's label truncates — to nothing at the narrowest panel
	 *    widths. So visible text is never a reliable accessible name for any
	 *    tab in any state, and aria-label is set unconditionally from `label`.
	 *    (Note it is bare `label`, not the "<label> tab" the old hand-written
	 *    markup used — zag already emits role="tab", so that spelling
	 *    announced "X tab tab".)
	 *
	 * 2. A visible selected state. Skeleton's tabs.css styles
	 *    [data-part='trigger'] with `@apply btn` and defines NOTHING for the
	 *    selected state, so today the conditional label is doing double duty
	 *    as the only selection cue. Once that label can truncate away, a strip
	 *    without data-[selected] styling has no active indicator at all —
	 *    which is why the fill below ships in the same change as the
	 *    truncation, not as a follow-up.
	 */
	interface Props {
		value: string
		label: string
		/** A @lucide/svelte icon component. */
		icon?: Component<any>
		disabled?: boolean
		/** Whether this tab is the active one. Drives the visible label; the
		    fill is handled by data-[selected] so it stays correct even if a
		    caller gets this wrong. */
		active?: boolean
		/** eg. an unread/ready count, rendered after the label. */
		badge?: Snippet
	}

	let {
		value,
		label,
		icon: Icon,
		disabled = false,
		active = false,
		badge
	}: Props = $props()
</script>

<!--
	Tabs.Trigger MUST be this component's root element with no wrapper: zag's
	keyboard navigation would survive a wrapper (getElements is descendant-
	scoped) but the flex list layout would not.

	btn-sm matters for more than looks — it is what brings the 5-tab strips
	under the 220px budget at a 1024px viewport. Icon size is deliberately not
	a prop: .btn sets `& > svg { width: var(--btn-size) }`, so the CSS wins
	over any size attribute and a prop would silently do nothing.
-->
<Tabs.Trigger
	{value}
	{disabled}
	title={label}
	aria-label={label}
	class="btn-sm data-[selected]:preset-filled-primary-500"
>
	{#if Icon}
		<Icon size={16} aria-hidden="true" />
	{/if}
	{#if active}
		<!-- max-w bounds the widest a trigger can get. Without it the longest
		     label ("Character Lore") pushed the Lorebooks+ strip from two rows
		     to three, which defeats PanelTabList's reserved height; truncate
		     alone doesn't help, because in a wrapping row the trigger simply
		     takes a line of its own at full width rather than shrinking. -->
		<span class="max-w-[5.5rem] min-w-0 truncate">{label}</span>
	{/if}
	{@render badge?.()}
</Tabs.Trigger>
