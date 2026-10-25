<script lang="ts">
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import RowMenu, { type RowMenuEntries } from "../menus/RowMenu.svelte"

	/**
	 * The in-panel back/title header. ALWAYS ONE ROW.
	 *
	 * The problem this shape solves: Skeleton's `.btn` sets white-space:nowrap
	 * with no flex-shrink, so a labelled button cannot give ground, while a
	 * sibling `<h2 class="truncate">` can shrink to zero — put them on one row
	 * and the title absorbs the entire deficit (measured: clientWidth 0 against
	 * scrollWidth 123).
	 *
	 * The first attempt fixed that by moving actions to a second row
	 * unconditionally, which wastes a row at every width. The real cause is
	 * that labelled actions are simply too wide for this panel: back(70) +
	 * title(120) + Export(90) + Detach(150) needs ~454px, but the panel's
	 * content box is only ~212px at a 1024px viewport and ~436px even at 1920.
	 *
	 * So secondary actions move into a `⋯` menu, which drops the requirement to
	 * ~88px + title and fits one row everywhere. Their full text labels survive
	 * inside the menu, so nothing is truncated or left to an icon alone.
	 */
	interface Props {
		/**
		 * Set by the component at one size everywhere — 15px semibold in the
		 * heading face (PLAN-sidebar-nav-normalization §2.2).
		 */
		title: string
		/**
		 * Draws the back button. Pass it only when the level it returns to
		 * is OFF screen (ruling Q3): at desk a list column or a section list
		 * is beside the detail, so its header has no back; at compact the
		 * detail replaced the list, so it does.
		 */
		onBack?: () => void
		/** Accessible name + tooltip for the back button. */
		backLabel?: string
		/** 2 for a top-level sidebar view, 3 when this renders inside a
		    Tabs.Content that already sits under an <h2> (the lorebookForms
		    managers) — keeps the heading outline honest. */
		headingLevel?: 2 | 3
		/**
		 * @deprecated The title has one size (15px, set here). The class is
		 * still appended, and a size in it now wins: `text-lead` is an app.css
		 * utility, which Tailwind emits before its own `text-sm`. Pass nothing.
		 * The view phase removes them; do not add new uses.
		 */
		titleClass?: string
		/**
		 * The level's one primary, INLINE after the title — the action that
		 * must not cost a second click. Normally a short LABELLED button
		 * (`btn btn-sm`): a form's Save or Create, a detail's Edit
		 * (STYLE-GUIDE §6.3). Keep the label to one word — the title is what
		 * truncates when the row runs short. An icon-only button is fine
		 * where the icon is unambiguous; give it `title` and `aria-label`.
		 * Everything else goes in `menuItems`.
		 */
		primaryAction?: Snippet
		/** The `⋯` menu's items, with full text labels (a `RowMenu`). */
		menuItems?: RowMenuEntries
		/** The menu's and the trigger's accessible name, eg. "Lorebook". */
		actionsLabel?: string
		/** Anything that belongs directly beneath the title row. */
		subtitle?: Snippet
		/** A small picture before the title, after the back button — a
		 *  lorebook's cover image. Never an action. */
		leading?: Snippet
	}

	let {
		title,
		onBack,
		backLabel = "Back",
		headingLevel = 2,
		titleClass = "",
		primaryAction,
		menuItems,
		actionsLabel,
		subtitle,
		leading
	}: Props = $props()

	const tag = $derived(`h${headingLevel}` as "h2" | "h3")
</script>

<!-- `shrink-0`: in a flex-column pane the header is never what gives
     ground — the content under it scrolls instead. -->
<div class="flex min-w-0 shrink-0 flex-col gap-2">
	<div class="flex min-w-0 shrink-0 items-center gap-2">
		{#if onBack}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface shrink-0 p-2"
				onclick={onBack}
				title={backLabel}
				aria-label={backLabel}
			>
				<Icons.ChevronLeft size={16} aria-hidden="true" />
			</button>
		{/if}
		{@render leading?.()}
		<!-- data-panel-title is the hook the title-width assertion selects on.
		     Selecting on it rather than `aside h2` avoids flagging
		     legitimately-narrow headings inside cards and list items, and
		     covers the mobile dialog branch (a role="dialog", not an <aside>).

		     Deliberately NO `capitalize`: this renders user data
		     (lorebook/character/tag names) and text-transform:capitalize
		     mangles "iPhone" -> "IPhone". -->
		<svelte:element
			this={tag}
			data-panel-title
			class="min-w-0 flex-1 truncate [font-family:var(--typo-heading--font-family)] text-lead leading-tight font-semibold {titleClass}"
		>
			{title}
		</svelte:element>
		{@render primaryAction?.()}
		{#if menuItems?.some(Boolean)}
			<RowMenu items={menuItems} label={actionsLabel ?? title} />
		{/if}
	</div>
	{@render subtitle?.()}
</div>
