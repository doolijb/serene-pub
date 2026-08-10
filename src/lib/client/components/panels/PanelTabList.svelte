<script lang="ts">
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { Snippet } from "svelte"

	/**
	 * Standard panel tab strip: one row of icon-only triggers with a bottom
	 * rule, so it reads as a tab bar rather than a row of buttons.
	 *
	 * Since PanelTab renders no text, the strip's width is a pure function of
	 * the tab COUNT — it no longer changes with the selection, which is what
	 * used to make the content below jump. That also removed the need for the
	 * height reservation this component used to carry.
	 *
	 * `flex-wrap` is kept purely as a safety net: it is not expected to trigger
	 * at any current tab count, but if a 7th tab is ever added the strip should
	 * degrade by wrapping rather than by clipping a trigger — flex-nowrap meets
	 * the panel's overflow-x:hidden with nothing in between, and a clipped
	 * trigger is unreachable by pointer.
	 */
	interface Props {
		children: Snippet
		class?: string
	}

	let { children, class: className = "" }: Props = $props()
</script>

<Tabs.List
	class="border-surface-200-800 flex min-w-0 shrink-0 flex-wrap items-center gap-1 border-b {className}"
>
	{@render children()}
</Tabs.List>
