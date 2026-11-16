<script lang="ts">
	/**
	 * 🚧 **Could exist here**: the group at the end of an entries list for the
	 * entries of lines forked from the one being read. Each row is muted (full
	 * on hover and on keyboard focus), says why it is not read here, and carries
	 * **Move down the tree…**. Nothing in it is editable from this line. Rows
	 * that begin later stay in the list body, where they gain their cause line
	 * and **Read from ‹date›**. The caller computes the list; this only draws it.
	 */
	import { SvelteSet } from "svelte/reactivity"
	import ListGroupLabel from "$lib/client/components/panels/ListGroupLabel.svelte"
	import type { BindingWithRelations } from "$lib/client/components/lorebookForms/entryManager"
	import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
	import { bookTimeline, getBookData } from "./bookData.svelte"
	import { couldExistWhy, moveHereProblem } from "./couldExistHere"
	import { formatDate } from "./sections/historyDates"
	import type { PoolItem } from "./poolFilter"
	import type { PoolSource, SectionDescriptor } from "./sections/types"
	import MoveDownTheTreeDialog from "./time/MoveDownTheTreeDialog.svelte"
	import { openBookTime } from "./time/bookTime.svelte"
	import { treeRowsOf } from "./time/moveDownTheTree"

	interface Props {
		/** Rows of lines forked from the line being read, already filtered and sorted by the caller. */
		forked: PoolItem[]
		/** The wire row behind a row (a forked row: its stored row). */
		sourceOf: (item: PoolItem) => PoolSource | undefined
		descriptorOf: (item: PoolItem) => SectionDescriptor
		bindings: BindingWithRelations[]
		vectorizationEnabled: boolean
		/** The line being read; null = main. */
		line: number | null
		/** Bulk edit is on: forked rows carry a checkbox (they take Move down the tree… only). */
		bulk: boolean
		isChecked: (item: PoolItem) => boolean
		onCheck: (item: PoolItem, checked: boolean) => void
	}

	let {
		forked,
		sourceOf,
		descriptorOf,
		bindings,
		vectorizationEnabled,
		line,
		bulk,
		isChecked,
		onCheck
	}: Props = $props()

	const book = getBookData()
	const timeline = bookTimeline()
	const uid = `couldExist${Math.random().toString(36).slice(2, 8)}`

	const words = $derived({
		lineName: (id: number | null) => openBookTime.lineName(id),
		date: (d: StoryDate) => formatDate(d),
		timeline: timeline.value
	})
	const rows = $derived(treeRowsOf(book.rawRows))

	const open = new SvelteSet<string>()
	let moving = $state<PoolItem | null>(null)

	function toggle(item: PoolItem) {
		if (open.has(item.key)) open.delete(item.key)
		else open.add(item.key)
	}

	function problemOf(item: PoolItem): string | null {
		return moveHereProblem({
			id: item.id,
			rows,
			target: line,
			branches: openBookTime.branches,
			words
		})
	}

	/** Enter and Space act only on the pick part itself, never on a control that bubbled. */
	function activate(event: KeyboardEvent, act: () => void) {
		if (event.target !== event.currentTarget) return
		if (event.key !== "Enter" && event.key !== " ") return
		event.preventDefault()
		act()
	}

	const rowClass =
		"preset-filled-surface-100-900 hover:bg-surface-200-800 flex items-start gap-2 rounded-lg opacity-50 transition-colors focus-within:opacity-100 hover:opacity-100"
	const pickClass =
		"focus-visible:outline-primary-500 min-w-0 flex-1 cursor-pointer self-stretch rounded-lg py-3 pl-3 focus-visible:outline-2 focus-visible:outline-offset-2"
	const buttonClass =
		"btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
</script>

{#if forked.length}
	<section
		aria-labelledby="{uid}-label"
		data-could-exist-here
		class="flex flex-col gap-2"
	>
		<ListGroupLabel
			id="{uid}-label"
			label="Could exist here"
			trailing={String(forked.length)}
		/>

		{#each forked as item, i (item.key)}
			{@const source = sourceOf(item)}
			{#if source}
				{@const Row = descriptorOf(item).row}
				{@const problem = problemOf(item)}
				{@const rid = `${uid}-${i}`}
				<div>
					<div
						class={rowClass}
						data-could-exist-row
						data-entry-key={item.key}
					>
						{#if bulk}
							<input
								type="checkbox"
								class="checkbox mt-4 ml-3 shrink-0 pointer-coarse:size-6"
								aria-label="Select {item.name}"
								checked={isChecked(item)}
								onchange={(e) =>
									onCheck(item, e.currentTarget.checked)}
							/>
						{/if}
						<div
							role="button"
							tabindex="0"
							data-entry-pick
							aria-expanded={open.has(item.key)}
							aria-controls="{rid}-readout"
							class={pickClass}
							onclick={() => toggle(item)}
							onkeydown={(e) => activate(e, () => toggle(item))}
						>
							<Row
								{item}
								{source}
								{bindings}
								{vectorizationEnabled}
							/>
							<p
								class="text-surface-700-300 mt-1 text-xs"
								data-could-exist-why
							>
								{couldExistWhy(
									{ kind: "line", branchId: source.branchId },
									words
								)}
							</p>
						</div>
						<div class="flex shrink-0 items-start py-3 pr-3">
							<button
								type="button"
								class={buttonClass}
								data-could-exist-move
								disabled={problem != null}
								aria-describedby={problem
									? `${rid}-why`
									: undefined}
								onclick={() => (moving = item)}
							>
								Move down the tree…
							</button>
						</div>
					</div>
					{#if problem}
						<p
							id="{rid}-why"
							class="text-surface-700-300 px-3 pt-1 text-xs"
						>
							{problem}
						</p>
					{/if}
					<div id="{rid}-readout" hidden={!open.has(item.key)}>
						{#if open.has(item.key)}
							<p
								class="px-3 py-2 text-sm whitespace-pre-wrap"
								data-could-exist-readout
							>
								{item.content}
							</p>
						{/if}
					</div>
				</div>
			{/if}
		{/each}
	</section>

	{#if moving && book.lorebookId != null}
		<MoveDownTheTreeDialog
			open
			lorebookId={book.lorebookId}
			entryIds={[moving.id]}
			prefer={{ branchId: line }}
			dirty={false}
			onClose={() => (moving = null)}
		/>
	{/if}
{/if}
