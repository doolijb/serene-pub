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
	 */
	import type { Snippet } from "svelte"
	import type { ViewMode } from "$lib/client/shell/viewMode.svelte"

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
		/** The list column. The whole of it: toolbar, filter, rows. */
		list: Snippet
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
		detail,
		empty,
		emptyMessage = "Nothing selected.",
		listWidth = "340px",
		detailWidth
	}: Props = $props()

	const columns = $derived(
		detailWidth
			? `minmax(0, 1fr) ${detailWidth}`
			: `max(${listWidth}, min(22%, 560px)) minmax(0, 1fr)`
	)

	// Both panes scroll themselves rather than letting the shell's wrapper
	// scroll the pair: in desk mode a single outer scrollbar would move the
	// list and the detail together, which is exactly what a two-pane layout
	// exists to stop.
	const paneClass = "flex min-h-0 flex-col overflow-y-auto p-4"
</script>

{#if mode === "desk"}
	<!-- The list is `listWidth` up to ~1600px of view, then grows with it
	     to a 560px ceiling, so a 4K Focus is not two card columns beside an
	     ocean. `minmax(0, 1fr)` and not `1fr`: a grid track's automatic minimum is
	     min-content, so one long unbreakable string in the detail (a model id,
	     a pasted URL) would otherwise widen the column and push the list off
	     the panel instead of scrolling inside itself. -->
	<div
		class="grid min-h-0 flex-1"
		style="grid-template-columns: {columns};"
	>
		<!-- Each pane is a named inline-size container (`list`, `detail`;
		     STYLE-GUIDE §5.3), so what is inside it answers the room IT has —
		     the `view` container is the whole view, list and detail together,
		     and a detail asking it would grow columns into the list's width. -->
		<div class="{paneClass} panel-edge @container/list border-r">
			{@render list()}
		</div>
		<div class="{paneClass} @container/detail">
			{#if hasDetail}
				<!-- A reading width, centred in whatever room is left: at 4K
				     the detail pane is ~3400px, and a description set across
				     all of it is one unreadable line with its tabs a screen
				     apart. The same 1120px the app's other reading columns use. -->
				<div class="mx-auto flex w-full max-w-[1120px] min-h-0 flex-1 flex-col">
					{@render detail()}
				</div>
			{:else if empty}
				{@render empty()}
			{:else}
				<p class="text-surface-600-400 m-auto px-6 text-center text-sm">
					{emptyMessage}
				</p>
			{/if}
		</div>
	</div>
{:else}
	<div
		class="{paneClass} flex-1 {hasDetail
			? '@container/detail'
			: '@container/list'}"
	>
		{#if hasDetail}
			{@render detail()}
		{:else}
			{@render list()}
		{/if}
	</div>
{/if}
