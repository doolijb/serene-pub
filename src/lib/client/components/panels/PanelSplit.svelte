<script lang="ts">
	/**
	 * The list-beside-detail shape a sidebar view takes once it has desk room.
	 *
	 * Every one of these views is the same two things — a list, and whatever
	 * the list opens — and until now each of them REPLACED the list with the
	 * detail no matter how much room it had. That is right at 400px and wrong
	 * at 1376px, where the detail is a column of short fields on an ocean of
	 * empty and the list you were picking from is gone.
	 *
	 * So: one shape, stated once. Five views were about to write it, which is
	 * four too many for a rule ("340px of list, a hairline, the rest is
	 * detail") that has to be the same in all of them or the shell looks
	 * assembled rather than designed.
	 *
	 * What it deliberately does NOT do: measure. `mode` comes from the view's
	 * own `ViewModeTracker` (see `$lib/client/shell/viewMode.svelte`), because
	 * the view needs that answer for more than this component — which back
	 * button to show, which row to mark — and two observers on one element that
	 * could disagree by a frame is a worse bargain than one prop.
	 *
	 * Two kinds of left column (PLAN-sidebar-nav-normalization §2.1):
	 *
	 * - `kind="list"` (default) — the column IS the items (Sessions, Users,
	 *   Tags, Help, Connections). A padded pane, `listWidth` wide, with its
	 *   own edge. Pass `toolbar` and the pane pins it: the toolbar is
	 *   `shrink-0`, 12px above the `list` (Q4), and the list alone scrolls,
	 *   so views stop writing `min-h-0 flex-1 overflow-y-auto` wrappers and
	 *   nobody's filter scrolls away. `listFills` (Connections' desk index,
	 *   Q5; every list view since L7, 2026-10-24): with nothing open the
	 *   list takes the whole view, centred at `fillWidth` (560px of rows,
	 *   1120px of cards), instead of sitting beside an empty column.
	 * - `kind="sections"` — the column is the PLACES in the view (Settings,
	 *   Admin, Sampling, Pipelines): a 240px column with no padding and no
	 *   edge of its own, because the `SectionList` it holds is flush and
	 *   draws both. At compact width the split tells the `SectionList`
	 *   (`provideSectionColumn`) to fill the pane instead, so the view writes
	 *   one list for both widths. `toolbar`, `listFills`, `listWidth` and
	 *   `detailWidth` are list-kind only and ignored here.
	 *
	 * Compact is one pane at a time in both kinds: the list, or the detail
	 * once `hasDetail`. The detail pane is padded (`p-4`) in every shape.
	 */
	import type { Snippet } from "svelte"
	import type { ViewMode } from "$lib/client/shell/viewMode.svelte"
	import { provideSectionColumn } from "./sectionList"

	interface Props {
		/**
		 * The view's measured mode. `desk` puts the two panes side by side;
		 * `compact` shows one at a time, which is what these views did
		 * everywhere before.
		 */
		mode: ViewMode
		/**
		 * Whether `detail` currently has something to render — normally the
		 * same condition the view's old `{#if}` chain tested (an id is set, a
		 * form is open). False means: compact shows the list, desk shows the
		 * empty column.
		 */
		hasDetail?: boolean
		/**
		 * The list column's rows. Without `toolbar` it is the whole column —
		 * toolbar, filter, rows — and scrolls with the pane, as before.
		 */
		list: Snippet
		/**
		 * The list's toolbar (`ViewToolbar`, a filter row). Given, it is
		 * pinned at the top of the list pane, `shrink-0`, 12px above the
		 * list, and `list` is wrapped in the pane's one scroller. List kind
		 * only.
		 */
		toolbar?: Snippet
		/**
		 * `list` (default): the column is the items — padded, `listWidth`.
		 * `sections`: the column is a flush 240px `SectionList`; no pane
		 * padding, no edge of its own. See the header comment.
		 */
		kind?: "list" | "sections"
		/**
		 * Desk with nothing open: the list pane alone fills the whole view,
		 * its content centred at `fillWidth`, instead of a column beside
		 * the empty message (Connections' index, ruling Q5; every list view
		 * since PLAN-0-5-polish-parity L7, 2026-10-24 — no voids). Opening
		 * something splits it as usual. List kind only; default false.
		 */
		listFills?: boolean
		/**
		 * How wide a filling list's content may grow (`listFills` only):
		 * `list` — 560px, the list column's own ceiling (STYLE-GUIDE §4.2), so
		 * a list of rows reads the same centred as it will beside a detail;
		 * `reading` (default) — 1120px, the app's reading width, for a card
		 * grid (Connections' index); `whole` — no cap, for a list that IS
		 * the thing being looked at (the Library's portrait grid).
		 */
		fillWidth?: "list" | "reading" | "whole"
		/** What the list opens — a view panel, an edit form, a creator. */
		detail: Snippet
		/**
		 * Desk mode with nothing selected. Pass this for anything richer than
		 * a line of text; otherwise `emptyMessage` is rendered quietly.
		 */
		empty?: Snippet
		/**
		 * The one line the empty detail column says. Phrase it as the next
		 * thing to do ("Pick a session, or start one"), not as a status.
		 */
		emptyMessage?: string
		/**
		 * The list column's width in desk mode, as a CSS length. 340px holds a
		 * title and its chips on one line; the card grids want a little more.
		 */
		listWidth?: string
		/**
		 * Turns the split around: the LIST takes the room and the detail is
		 * the column of this width. For a list that is the thing being looked
		 * at — the Library's portrait grid — where a detail the size of a
		 * card's worth of facts beside ~3000px of grid is the right trade and
		 * a 340px grid beside it is not. Replaces `listWidth` when set.
		 */
		detailWidth?: string
	}

	let {
		mode,
		hasDetail = false,
		list,
		toolbar,
		kind = "list",
		listFills = false,
		fillWidth = "reading",
		detail,
		empty,
		emptyMessage = "Nothing selected.",
		listWidth = "340px",
		detailWidth
	}: Props = $props()

	const sections = $derived(kind === "sections")
	const pinned = $derived(!!toolbar && !sections)
	const fills = $derived(listFills && !sections && !hasDetail)
	/** The filling list's cap, as a whole class so Tailwind can see it. */
	const FILL_CAP: Record<"list" | "reading" | "whole", string> = {
		list: "max-w-[560px]",
		reading: "max-w-[1120px]",
		whole: "max-w-none"
	}
	const capClass = $derived(
		`w-[calc(100%-2rem)] ${FILL_CAP[fillWidth] ?? FILL_CAP.reading} self-center`
	)

	// Read through a getter so the answer follows `mode` without the
	// context being set again (it can only be set during init).
	provideSectionColumn({
		get fill() {
			return kind === "sections" && mode !== "desk"
		}
	})

	const columns = $derived(
		sections
			? "15rem minmax(0, 1fr)"
			: detailWidth
				? `minmax(0, 1fr) ${detailWidth}`
				: `max(${listWidth}, min(22%, 560px)) minmax(0, 1fr)`
	)

	// Both panes scroll themselves rather than letting the shell's wrapper
	// scroll the pair: in desk mode a single outer scrollbar would move the
	// list and the detail together, which is exactly what a two-pane layout
	// exists to stop.
	// A scroller never carries padding (owner ruling 2026-10-11): padding on
	// the scrolling box put the card at its clip edge — a ring or border at
	// the list's end, and the scrollbar over the right edge of every card.
	// The inset is a MARGIN on the content wrapper inside it instead, so the
	// scrollable overflow includes it on every side.
	const paneClass = "flex min-h-0 flex-col overflow-y-auto"
	// With a pinned toolbar the pane stays a column (the rare toolbar taller
	// than the pane still scrolls) and the list below it is the scroller.
	const listPaneClass = paneClass
	// The section column: a flex ROW, so the flush `SectionList` inside is
	// stretched to the pane's full height and its own scroller is bounded.
	const sectionPaneClass = "flex min-h-0 overflow-y-auto"
</script>

<!-- The list pane's body. The toolbar pinned over the scrolling list when
     there is one, else the list as it always was. Under `listFills` with
     nothing open the content is centred at `fillWidth` (560px for rows,
     the app's 1120px reading width for a card grid); otherwise the cap
     classes are absent and change nothing.
     The wrappers are ALWAYS there, so opening a detail beside a filling
     list re-lays the same elements instead of remounting the list (its
     filter, its scroll) — Connections' old full-width bypass did remount.
     With a toolbar the scroller spans the whole pane, so its bar sits at
     the view's edge, not in the middle of a wide Focus. -->
{#snippet listBody(capped: boolean)}
	{#if pinned}
		<div
			class="mx-4 mt-4 shrink-0 {capped ? capClass : ''}"
		>
			{@render toolbar?.()}
		</div>
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<div
				class="mx-4 mt-3 mb-4 flex flex-1 flex-col {capped ? capClass : ''}"
			>
				{@render list()}
			</div>
		</div>
	{:else}
		<div
			class="m-4 flex flex-1 flex-col {capped ? capClass : ''}"
		>
			{@render list()}
		</div>
	{/if}
{/snippet}

{#if mode === "desk"}
	<!-- The list is `listWidth` up to ~1600px of view, then grows with it
	     to a 560px ceiling, so a 4K Focus is not two card columns beside an
	     ocean. `minmax(0, 1fr)` and not `1fr`: a grid track's automatic minimum is
	     min-content, so one long unbreakable string in the detail (a model id,
	     a pasted URL) would otherwise widen the column and push the list off
	     the panel instead of scrolling inside itself. -->
	<div
		class="grid min-h-0 flex-1"
		style="grid-template-columns: {fills ? 'minmax(0, 1fr)' : columns};"
	>
		<!-- Each pane is a named inline-size container (`list`, `detail`;
		     STYLE-GUIDE §5.3), so what is inside it answers the room IT has —
		     the `view` container is the whole view, list and detail together,
		     and a detail asking it would grow columns into the list's width. -->
		{#if sections}
			<div class={sectionPaneClass} data-panel-split-sections>
				{@render list()}
			</div>
		{:else}
			<div
				class="{listPaneClass} @container/list {fills
					? ''
					: 'panel-edge border-r'}"
				data-panel-split-fills={fills || undefined}
			>
				{@render listBody(fills)}
			</div>
		{/if}
		{#if !fills}
			<div class="{paneClass} @container/detail">
				{#if hasDetail}
					<!-- A reading width, centred in whatever room is left: at 4K
					     the detail pane is ~3400px, and a description set across
					     all of it is one unreadable line with its tabs a screen
					     apart. The same 1120px the app's other reading columns use. -->
					<div
						class="m-4 flex min-h-0 w-[calc(100%-2rem)] max-w-[1120px] flex-1 flex-col self-center"
					>
						{@render detail()}
					</div>
				{:else if empty}
					{@render empty()}
				{:else}
					<p
						class="text-surface-600-400 m-auto px-6 text-center text-sm"
					>
						{emptyMessage}
					</p>
				{/if}
			</div>
		{/if}
	</div>
{:else if hasDetail}
	<div class="{paneClass} @container/detail flex-1">
		<div class="m-4 flex min-h-0 flex-1 flex-col">
			{@render detail()}
		</div>
	</div>
{:else if sections}
	<!-- The section list fills the pane (it reads `fill` from the split)
	     and brings its own inset and scroller, so no padding here. -->
	<div
		class="flex min-h-0 flex-1 flex-col overflow-y-auto"
		data-panel-split-sections
	>
		{@render list()}
	</div>
{:else}
	<div class="{listPaneClass} @container/list flex-1">
		{@render listBody(false)}
	</div>
{/if}
