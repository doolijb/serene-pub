<script lang="ts">
	/**
	 * A section list 🚧 — the left column of a view whose column is the
	 * PLACES in the view (Settings, Admin, Sampling, Pipelines, a lorebook's
	 * scopes), not its items. PLAN-sidebar-nav-normalization §2.1; built from
	 * Admin's rail, the most complete of the five recipes it replaces.
	 *
	 * Navigation, not a tablist: a `nav` with links or buttons and
	 * `aria-current="page"` on the chosen one, in natural tab order. Moving
	 * between sections is going somewhere (Admin already addresses them), so
	 * arrow-key roving would promise a widget this is not.
	 *
	 * Selected is the row treatment (STYLE-GUIDE §2.4): `.sidebar-row-active`,
	 * text NEUTRAL. Filled primary is a button and primary text is the rail's
	 * own item; neither marks a section.
	 *
	 * Three shapes, one markup:
	 * - flush (default) — 240px, `panel-edge border-r`, its own scroller; for a
	 *   flex-row parent (Admin's root, `PanelSplit kind="sections"` at desk),
	 *   which stretches it to full height.
	 * - filling — inside `PanelSplit kind="sections"` at compact width the
	 *   split says so (`sectionColumn()`), and the list drops its width and
	 *   edge and fills the pane, still its own scroller. Views do nothing.
	 * - `flush={false}` — no width, edge or scroller, for a caller that
	 *   places it inside a column of its own.
	 */
	import type { Snippet } from "svelte"
	import {
		dotLabelFor,
		sectionColumn,
		type SectionGroup,
		type SectionItem
	} from "./sectionList"
	import ListGroupLabel from "./ListGroupLabel.svelte"

	interface Props {
		groups: SectionGroup[]
		/** The selected item's `key`; `null` when none is. */
		value: string | null
		/**
		 * Called with the row's key on a click. On a link row (`href`) a
		 * plain left click is taken over (`preventDefault`) and this does the
		 * going; a modified or middle click is left to the browser, so "open
		 * in a new tab" still works. Without it a link row just navigates.
		 */
		onselect?: (key: string) => void
		/** The nav's accessible name, eg. "Admin sections". */
		ariaLabel: string
		/**
		 * Above the first group (Admin's "Needs you" card, a lorebook's
		 * filter box). Laid out in a `px-2 pt-2` column with
		 * `gap-2`, the rows' own inset, so a card or a field lines up with
		 * the rows' rounded ground.
		 */
		head?: Snippet
		/**
		 * Pinned to the bottom when the rows are short, after them when
		 * they are long (a lorebook's reading line). Same `px-2` inset.
		 */
		foot?: Snippet
		class?: string
		/** Default true. See the shapes above. */
		flush?: boolean
	}

	let {
		groups,
		value,
		onselect,
		ariaLabel,
		head,
		foot,
		class: className = "",
		flush = true
	}: Props = $props()

	const uid = $props.id()
	const column = sectionColumn()

	const shapeClass = $derived(
		column?.fill
			? "min-h-0 flex-1 overflow-y-auto"
			: flush
				? "panel-edge w-60 shrink-0 overflow-y-auto border-r"
				: ""
	)

	const rowBase =
		"group focus-visible:outline-primary-500 mx-2 flex min-h-10 items-center gap-3 rounded-base px-3 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 pointer-coarse:min-h-11"

	function rowClass(selected: boolean, disabled: boolean, twoLine: boolean) {
		const state = disabled
			? "cursor-not-allowed opacity-60"
			: selected
				? "sidebar-row-active"
				: "hover:bg-surface-200-800"
		return [rowBase, twoLine && "py-1.5", state].filter(Boolean).join(" ")
	}

	function select(e: MouseEvent, item: SectionItem) {
		if (item.disabled) {
			e.preventDefault()
			return
		}
		if (!onselect) return
		if (item.href) {
			// A modified or non-primary click is the browser's (new tab,
			// new window, download). Only a plain click becomes a select.
			if (
				e.button !== 0 ||
				e.metaKey ||
				e.ctrlKey ||
				e.shiftKey ||
				e.altKey
			)
				return
			e.preventDefault()
		}
		onselect(item.key)
	}
</script>

{#snippet rowContent(item: SectionItem, selected: boolean)}
	{#if item.icon}
		{@const Icon = item.icon}
		<Icon
			size={18}
			class="text-surface-600-400 shrink-0"
			aria-hidden="true"
		/>
	{/if}
	<span class="flex min-w-0 flex-1 flex-col">
		<span class="truncate text-sm font-medium">{item.label}</span>
		{#if item.description}
			<!-- Muted measures 3.77:1 on the 200-800 ground a selected or
			     hovered row stands on, so the line steps up to 700-300
			     there (STYLE-GUIDE §6.4, the model table's rule). -->
			<span
				class="truncate text-xs {selected
					? 'text-surface-700-300'
					: 'text-surface-600-400 group-hover:text-surface-700-300'}"
			>
				{item.description}
			</span>
		{/if}
	</span>
	{#if item.count !== undefined}
		<!-- The badge's tonal ground IS the selected and hovered row's
		     ground, so there it steps one further to stay a pill. -->
		<span
			class="badge shrink-0 text-meta {selected
				? 'bg-surface-300-700'
				: 'preset-tonal-surface group-hover:bg-surface-300-700'}"
		>
			{item.count}
		</span>
	{/if}
	{#if item.dot}
		<span
			class="size-2 shrink-0 rounded-full {item.dot === 'error'
				? 'bg-error-500'
				: 'bg-primary-500'}"
			aria-hidden="true"
		></span>
		<span class="sr-only">{item.dotLabel ?? dotLabelFor(item.dot)}</span>
	{/if}
{/snippet}

<nav
	aria-label={ariaLabel}
	class={["flex flex-col pb-3", shapeClass, className]}
	data-section-list
>
	{#if head}
		<div class="flex shrink-0 flex-col gap-2 px-2 pt-2">
			{@render head()}
		</div>
	{/if}
	{#each groups as group, g}
		{@const labelId = group.label ? `${uid}-group-${g}` : undefined}
		{#if group.label}
			<ListGroupLabel label={group.label} id={labelId} />
		{/if}
		<ul
			class={["flex flex-col", !group.label && "pt-2"]}
			aria-labelledby={labelId}
		>
			{#each group.items as item (item.key)}
				{@const selected = !item.disabled && item.key === value}
				{@const twoLine = !!item.description}
				<!-- A flex column so a <button> row stretches like a link row
				     does (a button never fills a block parent by itself). -->
				<li class="flex flex-col">
					{#if item.href && !item.disabled}
						<a
							href={item.href}
							aria-current={selected ? "page" : undefined}
							class={rowClass(selected, false, twoLine)}
							onclick={(e) => select(e, item)}
						>
							{@render rowContent(item, selected)}
						</a>
					{:else if item.href}
						<!-- A disabled link has no href, so it is not
						     focusable and not followed; `aria-disabled` keeps
						     it announced as a link that is unavailable. -->
						<a
							role="link"
							aria-disabled="true"
							class={rowClass(false, true, twoLine)}
						>
							{@render rowContent(item, false)}
						</a>
					{:else}
						<button
							type="button"
							aria-current={selected ? "page" : undefined}
							disabled={item.disabled}
							class={rowClass(selected, !!item.disabled, twoLine)}
							onclick={(e) => select(e, item)}
						>
							{@render rowContent(item, selected)}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/each}
	{#if foot}
		<div class="mt-auto flex shrink-0 flex-col gap-2 px-2 pt-4">
			{@render foot()}
		</div>
	{/if}
</nav>
