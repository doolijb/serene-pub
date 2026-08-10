<script lang="ts">
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import PanelToolbar from "./PanelToolbar.svelte"

	/**
	 * The in-panel back/title header, plus an optional action row.
	 *
	 * THE RULE THIS COMPONENT EXISTS TO ENFORCE: actions never share the
	 * title's row. Skeleton's `.btn` has `white-space: nowrap` and no
	 * flex-shrink, so its min-width:auto resolves to full min-content width
	 * and it cannot give ground; a sibling `<h2 class="flex-1 truncate">` has
	 * overflow:hidden, so ITS min-width:auto resolves to 0. Put them on one
	 * row and the title absorbs 100% of the deficit — measured at 1024x768 the
	 * Lorebooks+ header rendered its title at clientWidth 0 (scrollWidth 123)
	 * while "Detach from Chat" still overflowed the panel.
	 *
	 * Hence: row 1 is back + title only, row 2 wraps.
	 */
	interface Props {
		title: string
		onBack?: () => void
		/** Accessible name + tooltip for the back button. */
		backLabel?: string
		/** Visible text on the back button. Omit for the icon-only style. */
		backText?: string
		/** 2 for a top-level sidebar view, 3 when this renders inside a
		    Tabs.Content that already sits under an <h2> (the lorebookForms
		    managers) — keeps the heading outline honest. */
		headingLevel?: 2 | 3
		/** eg. "text-sm" — several callers size the title down. */
		titleClass?: string
		/** Rendered as its own wrapping row below the title. */
		actions?: Snippet
		/** Accessible name for the action row. Required whenever `actions` is
		    passed; falls back to "<title> actions". */
		actionsLabel?: string
		/** Anything that belongs between the title and the actions. */
		subtitle?: Snippet
	}

	let {
		title,
		onBack,
		backLabel = "Back",
		backText,
		headingLevel = 2,
		titleClass = "",
		actions,
		actionsLabel,
		subtitle
	}: Props = $props()

	const tag = $derived(`h${headingLevel}` as "h2" | "h3")
</script>

<div class="flex min-w-0 flex-col gap-2">
	<div class="flex min-w-0 items-center gap-2">
		{#if onBack}
			<button
				type="button"
				class="btn btn-sm preset-filled-surface-400-600 shrink-0 {backText
					? ''
					: 'p-2'}"
				onclick={onBack}
				title={backLabel}
				aria-label={backLabel}
			>
				<Icons.ChevronLeft size={16} aria-hidden="true" />
				{#if backText}{backText}{/if}
			</button>
		{/if}
		<!-- data-panel-title is the hook the Mode-A width assertion selects on;
		     see the plan's verification section. Selecting on it rather than
		     `aside h2` avoids flagging legitimately-narrow headings inside
		     cards and list items, and covers the mobile dialog branch (which
		     is a role="dialog", not an <aside>).

		     Deliberately NO `capitalize` here: this slot renders user data
		     (lorebook/character/tag names) and text-transform:capitalize
		     mangles "iPhone" -> "IPhone". -->
		<svelte:element
			this={tag}
			data-panel-title
			class="min-w-0 flex-1 truncate font-semibold {titleClass}"
		>
			{title}
		</svelte:element>
	</div>
	{@render subtitle?.()}
	{#if actions}
		<PanelToolbar label={actionsLabel ?? `${title} actions`}>
			{@render actions()}
		</PanelToolbar>
	{/if}
</div>
