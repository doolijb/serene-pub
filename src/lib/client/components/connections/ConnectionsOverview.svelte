<script lang="ts">
	/**
	 * The detail pane at full page with nothing selected.
	 *
	 * ## What it replaces
	 *
	 * `PanelSplit`'s `emptyMessage`, which read *"Pick a connection, or add
	 * one."* — one sentence centred in 1,150px of a 1,600px screen, beside a
	 * list column that full page made NARROWER than the dock's. Expanding the
	 * view made every row truncate harder and filled the room it won with an
	 * apology.
	 *
	 * `PanelSplit` has always taken an `empty` snippet for exactly this
	 * ("Pass this for anything richer than a line of text"); nobody had passed
	 * one. So the pane is the dashboard: the same question the index answers in
	 * a column, answered in a page.
	 *
	 * ## What the width is for
	 *
	 * The jobs grid goes four across instead of two, and the taglines the dock
	 * has to clip are readable. That is the whole of it — this view deliberately
	 * shows the SAME facts as the index rather than extra ones, because a person
	 * who learns the panel in the dock and then expands it should find what they
	 * know, laid out better. The facts full page adds are on a connection:
	 * its model table and its request log.
	 *
	 * ⚠ It is not a second index. There is no list here and no Add button: the
	 * list is beside it, permanently, which is the point of being full page.
	 */
	import * as Icons from "@lucide/svelte"
	import JobsGrid from "./JobsGrid.svelte"
	import type { JobTile } from "./jobTile"

	interface Props {
		tiles: readonly JobTile[]
		/** How many connections there are, for the one line of orientation. */
		connectionCount: number
		onOpenCapability: (capability: string) => void
		onGetModel: () => void
	}
	let { tiles, connectionCount, onOpenCapability, onGetModel }: Props =
		$props()
</script>

<div class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
	<!--
		A plain div, not a `<header>`: inside the view's landmark a `<header>`
		is announced as a second banner (axe: `landmark-banner-is-top-level`).
	-->
	<div>
		<h2 class="[font-family:var(--typo-heading--font-family)] text-2xl font-semibold tracking-tight">
			What this pub can do
		</h2>
		<p class="text-surface-600-400 mt-1.5 text-sm">
			Chat is the only one a session needs. The rest add things, and cost
			nothing while they are off.
		</p>
	</div>

	<!--
		⚠ No status strip here. The list column beside this one carries it
		permanently, and two copies of "Sessions can reply" on one screen is not
		emphasis — it is the same landmark twice (axe: `landmark-unique`)
		answering a question the first copy already answered a few hundred
		pixels to the left. The list keeps it because it is the blocking
		question and has to survive opening a connection; this pane takes the
		grid, which is what the width is actually for.
	-->

	<!-- No fold at full page: there is room for all of them, four across. -->
	<JobsGrid {tiles} onOpen={onOpenCapability} limit={Infinity} columns={4} />

	<div
		class="flex flex-wrap items-center gap-3 pt-5"
	>
		<p class="text-surface-600-400 min-w-0 flex-1 text-xs">
			{connectionCount === 1
				? "1 connection"
				: `${connectionCount} connections`} in the list beside this. Pick
			one to see its models and settings.
		</p>
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface shrink-0"
			onclick={onGetModel}
		>
			<Icons.Download size={15} aria-hidden="true" />
			Get a model
		</button>
	</div>
</div>
