<script lang="ts">
	/**
	 * The other jobs this pub can do, as tiles.
	 *
	 * ## Why tiles and not rows
	 *
	 * The readiness card gave each capability a row with a sentence and a **Set
	 * up** button. At 400px every one of those sentences truncated — *"Not set ·
	 * pictures stay off until yo…"*, *"Not set · lore retrieval answers fr…"* —
	 * and the six the card could not fit folded behind *"6 more · vision,
	 * document reading, image editin…"*, truncated in its turn.
	 *
	 * A tile is the button. Two words and a state fit in half a column, so two
	 * fit across the dock and four across the page, and there is no per-row
	 * button to truncate around. Nine tiles take the room three rows used to.
	 *
	 * ## The labels are the SDK's, not ours
	 *
	 * `label` and `tagline` come from `TRANSFORMS` in the SDK. Writing our own
	 * here would be a second vocabulary for the same ten things, drifting from
	 * the one the pipeline and the admin screen already use — NOMENCLATURE R1.
	 * A transform a plugin introduces that core does not name shows as its id,
	 * which is `capabilityLabel`'s existing contract and is correct: better a
	 * raw id than a guess at what somebody else's transform does.
	 *
	 * ⚠ **No fraction, and no "of ten".** The count says how many are set and
	 * stops there. Nine of these are optional and off is a perfectly good
	 * answer for all nine; scoring them turns a list of things you *could* do
	 * into a list of things you have failed to do.
	 */
	import * as Icons from "@lucide/svelte"
	import type { JobTile } from "./jobTile"

	interface Props {
		tiles: readonly JobTile[]
		onOpen: (capability: string) => void
		/**
		 * How many to show before folding.
		 *
		 * ⚠ The grid is not the point of this panel. Nine tiles two-across is
		 * five rows and about 470px, which pushed the CONNECTIONS — the thing
		 * the view is named after — below the fold in the dock. Four is the
		 * four modalities that have a section, which are the four a person can
		 * act on from here; the rest are one press away and were behind a fold
		 * in the readiness card too.
		 *
		 * `Infinity` at full page, where there is room for all of them.
		 */
		limit?: number
		/**
		 * Tiles across.
		 *
		 * ⚠ A PROP, not a container query. `@min-[900px]/view` measures the
		 * whole view, and at full page the view is wide while the list column
		 * beside the detail is 340px — so the query fired inside the list and
		 * squashed four tiles into a 340px strip reading "V…", "D…", "I…",
		 * "E…". A column's own width is not something a `view` container can
		 * answer; the caller knows it and says.
		 */
		columns?: 2 | 4
	}
	let { tiles, onOpen, limit = 4, columns = 2 }: Props = $props()

	let expanded = $state(false)

	const setCount = $derived(
		tiles.filter((t) => t.modelName && !t.problem).length
	)
	/**
	 * A folded tile that is SET is pulled forward, so "2 set up" and the tiles
	 * on screen never disagree. Nothing is more confusing than a count that
	 * names something you cannot see.
	 */
	const ordered = $derived.by(() => {
		if (expanded || tiles.length <= limit) return tiles
		const set = tiles.filter((t) => t.modelName && !t.problem)
		const rest = tiles.filter((t) => !(t.modelName && !t.problem))
		return [...set, ...rest].slice(0, limit)
	})
</script>

<section aria-label="Other jobs">
	<div class="mb-2 flex items-baseline gap-2 px-0.5">
		<h3 class="text-surface-600-400 text-xs font-medium">Other jobs</h3>
		<span class="text-surface-600-400 text-[11px]">
			{setCount
				? `${setCount} set up · the rest optional`
				: "all optional"}
		</span>
	</div>

	<!-- Two across in a column, four in the detail pane. See `columns`. -->
	<div class="grid gap-2 {columns === 4 ? 'grid-cols-4' : 'grid-cols-2'}">
		{#each ordered as tile (tile.capability)}
			{@const TileIcon =
				((Icons as any)[tile.icon ?? ""] as any) ?? Icons.Sparkles}
			{@const on = !!tile.modelName && !tile.problem}
			<button
				type="button"
				class="panel-card hover:preset-tonal-primary focus-visible:ring-primary-500 flex min-h-[72px] flex-col gap-1 !p-3 text-left focus-visible:ring-2 focus-visible:outline-none {on
					? 'border-success-500/30!'
					: ''}"
				onclick={() => onOpen(tile.capability)}
			>
				<span class="flex min-w-0 items-center gap-1.5">
					<TileIcon
						size={14}
						class={on
							? "text-success-800 dark:text-success-300 shrink-0"
							: "text-surface-600-400 shrink-0"}
						aria-hidden="true"
					/>
					<span class="min-w-0 truncate text-[13px] font-medium">
						{tile.label}
					</span>
				</span>
				<span
					class="block truncate text-xs {tile.problem
						? 'text-primary-900 dark:text-primary-300'
						: on
							? 'text-success-800 dark:text-success-300'
							: 'text-surface-600-400'}"
				>
					{tile.problem ?? tile.modelName ?? "Not set up"}
				</span>
				{#if tile.tagline}
					<span
						class="text-surface-600-400 mt-auto line-clamp-1 text-[11px]"
					>
						{tile.tagline}
					</span>
				{/if}
			</button>
		{/each}

		{#if !expanded && tiles.length > limit}
			<button
				type="button"
				class="panel-card hover:preset-tonal-primary focus-visible:ring-primary-500 flex min-h-[72px] flex-col justify-center gap-1 border-dashed! !p-3 text-left focus-visible:ring-2 focus-visible:outline-none"
				onclick={() => (expanded = true)}
			>
				<span class="flex items-center gap-1.5">
					<Icons.Ellipsis
						size={14}
						class="text-surface-600-400 shrink-0"
						aria-hidden="true"
					/>
					<span class="text-[13px] font-medium">
						{tiles.length - limit} more
					</span>
				</span>
				<span class="text-surface-600-400 truncate text-xs">
					{tiles
						.slice(limit)
						.map((t) => t.label.toLowerCase())
						.join(", ")}
				</span>
			</button>
		{/if}
	</div>

	{#if expanded && tiles.length > limit}
		<button
			type="button"
			class="text-surface-600-400 hover:text-surface-950-50 mt-2 px-0.5 text-xs"
			onclick={() => (expanded = false)}
		>
			Show fewer
		</button>
	{/if}
</section>
