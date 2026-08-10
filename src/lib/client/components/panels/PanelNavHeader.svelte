<script lang="ts">
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"

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
		title: string
		onBack?: () => void
		/** Accessible name + tooltip for the back button. */
		backLabel?: string
		/** 2 for a top-level sidebar view, 3 when this renders inside a
		    Tabs.Content that already sits under an <h2> (the lorebookForms
		    managers) — keeps the heading outline honest. */
		headingLevel?: 2 | 3
		/** eg. "text-sm" — several callers size the title down. */
		titleClass?: string
		/** Stays INLINE next to the title, so it should be icon-only with a
		    title/aria-label. For the one action that must not cost a second
		    click — the lore edit screens put Save here. */
		primaryAction?: Snippet
		/** Rendered inside the `⋯` menu, with full text labels. Use
		    `.popover-menu-btn` for each entry, matching PersonaListItem and the
		    message-options menu. */
		actions?: Snippet
		/** Menu heading + the trigger's accessible name, eg. "Lorebook". */
		actionsLabel?: string
		/** Anything that belongs directly beneath the title row. */
		subtitle?: Snippet
	}

	let {
		title,
		onBack,
		backLabel = "Back",
		headingLevel = 2,
		titleClass = "",
		primaryAction,
		actions,
		actionsLabel,
		subtitle
	}: Props = $props()

	const tag = $derived(`h${headingLevel}` as "h2" | "h3")
	let menuOpen = $state(false)
</script>

<div class="flex min-w-0 flex-col gap-2">
	<div class="flex min-w-0 items-center gap-2">
		{#if onBack}
			<button
				type="button"
				class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
				onclick={onBack}
				title={backLabel}
				aria-label={backLabel}
			>
				<Icons.ChevronLeft size={16} aria-hidden="true" />
			</button>
		{/if}
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
			class="min-w-0 flex-1 truncate font-semibold {titleClass}"
		>
			{title}
		</svelte:element>
		{@render primaryAction?.()}
		{#if actions}
			<Popover
				open={menuOpen}
				onOpenChange={(e) => (menuOpen = e.open)}
				positioning={{ placement: "bottom-end" }}
			>
				<Popover.Trigger
					class="btn btn-sm hover:bg-primary-600-400 shrink-0 p-2 {menuOpen
						? 'bg-primary-600-400'
						: ''}"
					aria-label="{actionsLabel ?? title} options"
				>
					<Icons.EllipsisVertical size={16} aria-hidden="true" />
				</Popover.Trigger>
				<Portal>
					<Popover.Positioner class="z-[1000]!">
						<Popover.Content
							class="card bg-primary-200-800 w-[min(90vw,240px)] space-y-4 p-4 shadow-xl"
						>
							<header class="popover-menu-title">
								<p>{actionsLabel ?? title}</p>
							</header>
							<article
								class="flex flex-col gap-2"
								role="none"
								onclick={() => (menuOpen = false)}
							>
								{@render actions()}
							</article>
						</Popover.Content>
					</Popover.Positioner>
				</Portal>
			</Popover>
		{/if}
	</div>
	{@render subtitle?.()}
</div>
