<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { SvelteMap, SvelteSet } from "svelte/reactivity"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import { rowDrag } from "../editor/rowDrag"
	import { kindLabel } from "../sections/kinds"
	import KnowledgeSwitch from "./KnowledgeSwitch.svelte"
	import { knownByWords } from "./knownByWords"
	import {
		otherEntries,
		tiedRows,
		UNTITLED,
		type PoolEntry
	} from "./knowsPool"

	/**
	 * 🚧 The Knows tab's body: the entries tied to one cast member (each with
	 * the three-way switch and the words that say what the member does with it)
	 * and, under them, every other entry, to press or drag in.
	 *
	 * Presentational: the rows, the entries and the write come in as props, so
	 * it is testable without a socket. It keeps only each row's pending flag and
	 * refusal, and says a refusal in place, never as a toast. Every drag has a
	 * button path: Tied's switch, Other's two buttons.
	 */
	type Hand = Sockets.EntryKnowledge.Hand
	type Moment = Sockets.EntryKnowledge.Moment

	interface Props {
		memberName: string
		/** The member's rows. */
		rows: Sockets.EntryKnowledge.Row[]
		loaded: boolean
		error: string | null
		/** The book's entries. */
		entries: PoolEntry[]
		isMarked: (entryId: number) => boolean
		formatDate: (m: Moment) => string
		onSet: (entryId: number, hand: Hand | null) => Promise<unknown>
	}

	let {
		memberName,
		rows,
		loaded,
		error,
		entries,
		isMarked,
		formatDate,
		onSet
	}: Props = $props()

	const uid = $props.id()
	const pending = new SvelteSet<number>()
	const refusals = new SvelteMap<number, string>()

	let filter = $state("")
	/** The zone the drag in flight started in, or none. */
	let dragFrom = $state<"tied" | "other" | null>(null)

	const tied = $derived(tiedRows(rows, entries))
	const allOther = $derived(otherEntries(rows, entries, isMarked, ""))
	const other = $derived(otherEntries(rows, entries, isMarked, filter))
	const otherMarked = $derived(other.filter((o) => o.marked))
	const otherCommon = $derived(other.filter((o) => !o.marked))

	async function press(entryId: number, hand: Hand | null) {
		refusals.delete(entryId)
		pending.add(entryId)
		try {
			await onSet(entryId, hand)
		} catch (err) {
			refusals.set(
				entryId,
				err instanceof Error && err.message
					? err.message
					: "Who knows this entry could not be saved."
			)
		} finally {
			pending.delete(entryId)
		}
	}

	const idOf = (key: string) => Number(key.slice(key.indexOf(":") + 1))

	const rowOptions = (key: string, draggable: boolean) => ({
		key,
		draggable,
		canDrop: () => false,
		onDrop: () => {}
	})
	const tiedZone = $derived({
		key: "zone:tied",
		draggable: false,
		canDrop: (from: string) => from.startsWith("other:"),
		onDrop: (from: string) => {
			dragFrom = null
			void press(idOf(from), "knows")
		}
	})
	const otherZone = $derived({
		key: "zone:other",
		draggable: false,
		canDrop: (from: string) => from.startsWith("tied:"),
		onDrop: (from: string) => {
			dragFrom = null
			void press(idOf(from), null)
		}
	})

	function onDragStart(event: DragEvent) {
		const key = (event.target as Element | null)
			?.closest?.("[data-knows-key]")
			?.getAttribute("data-knows-key")
		dragFrom = key?.startsWith("tied:")
			? "tied"
			: key?.startsWith("other:")
				? "other"
				: null
	}
</script>

{#snippet kind(typeId: string | null)}
	{#if typeId}
		<span class="text-surface-600-400 text-meta">{kindLabel(typeId)}</span>
	{/if}
{/snippet}

{#snippet refusal(entryId: number)}
	{#if refusals.has(entryId)}
		<p role="alert" class="text-error-700-300 text-xs">
			{refusals.get(entryId)}
		</p>
	{/if}
{/snippet}

{#snippet otherRow(entry: PoolEntry)}
	{@const busy = pending.has(entry.id)}
	<li
		class="flex flex-col gap-1"
		data-knows-row={entry.id}
		data-knows-key="other:{entry.id}"
		use:rowDrag={rowOptions(`other:${entry.id}`, true)}
	>
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<span class="min-w-0 flex-1 text-sm font-medium break-words">
				<span id="{uid}-o-{entry.id}">{entry.name || UNTITLED}</span>
				{@render kind(entry.typeId)}
			</span>
			<div
				role="group"
				aria-labelledby="{uid}-o-{entry.id}"
				class="flex flex-wrap gap-1"
			>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
					disabled={busy}
					data-knows-add="knows"
					onclick={() => press(entry.id, "knows")}
				>
					Knows
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
					disabled={busy}
					data-knows-add="kept_from"
					onclick={() => press(entry.id, "kept_from")}
				>
					Kept from
				</button>
			</div>
		</div>
		{@render refusal(entry.id)}
	</li>
{/snippet}

<div
	class="flex flex-col gap-4"
	data-lore-knows
	ondragstart={onDragStart}
	ondragend={() => (dragFrom = null)}
	role="presentation"
>
	<p class="text-surface-600-400 text-meta">
		These are this lorebook's ties; a session's notes can hold newer ones,
		which win in that session unless a tie is set here by hand and the session's notes hold no hand tie of their own.
	</p>
	{#if error}
		<p role="alert" class="text-error-700-300 text-xs">{error}</p>
	{:else if !loaded}
		<p class="text-surface-600-400 text-meta">
			Reading what {memberName} knows…
		</p>
	{:else}
		<section
			aria-labelledby="{uid}-tied"
			class="data-[drop-target]:ring-primary-500 rounded-container relative flex flex-col gap-2 data-[drop-target]:ring-2"
			data-knows-zone="tied"
			use:rowDrag={tiedZone}
		>
			<h4 id="{uid}-tied" class="text-sm font-semibold">
				Tied to {memberName}
			</h4>
			{#if tied.length === 0}
				<EmptyState
					icon={Icons.BookKey}
					message="Nothing is tied to {memberName} yet. Drag an entry here, or press Knows beside it."
				/>
			{:else}
				<ul class="flex flex-col gap-3">
					{#each tied as item (item.row.entryId)}
						{@const row = item.row}
						{@const words = knownByWords(
							row,
							isMarked(row.entryId),
							formatDate
						)}
						<li
							class="flex flex-col gap-1"
							data-knows-row={row.entryId}
							data-knows-key="tied:{row.entryId}"
							use:rowDrag={rowOptions(
								`tied:${row.entryId}`,
								row.hand !== null
							)}
						>
							<div
								class="flex flex-wrap items-center gap-x-3 gap-y-1"
							>
								<span
									class="min-w-0 flex-1 text-sm font-medium break-words"
								>
									<span id="{uid}-t-{row.entryId}">
										{item.name}
									</span>
									{@render kind(item.typeId)}
								</span>
								<KnowledgeSwitch
									labelledBy="{uid}-t-{row.entryId}"
									hand={row.hand}
									busy={pending.has(row.entryId)}
									onPress={(hand) => press(row.entryId, hand)}
								/>
							</div>
							<div
								aria-live="polite"
								class="flex flex-col gap-0.5"
							>
								<p class="text-surface-600-400 text-meta">
									{words.result}
								</p>
								{#if words.note}
									<p class="text-surface-600-400 text-meta">
										{words.note}
									</p>
								{/if}
							</div>
							{@render refusal(row.entryId)}
						</li>
					{/each}
				</ul>
			{/if}
			{#if dragFrom === "other"}
				<div
					aria-hidden="true"
					data-knows-hint="tied"
					class="border-primary-500/70 bg-surface-50-950/80 rounded-container pointer-events-none absolute inset-0 grid place-items-center border-2 border-dashed text-sm"
				>
					Drop to set Knows
				</div>
			{/if}
		</section>

		{#if allOther.length > 0 || dragFrom === "tied"}
			<section
				aria-labelledby="{uid}-other"
				class="data-[drop-target]:ring-primary-500 rounded-container relative flex flex-col gap-2 data-[drop-target]:ring-2"
				data-knows-zone="other"
				use:rowDrag={otherZone}
			>
				<h4 id="{uid}-other" class="text-sm font-semibold">
					Other entries
				</h4>
				<PanelFilterInput
					bind:value={filter}
					placeholder="entries"
					singular="entry"
					count={allOther.length}
				/>
				{#if otherMarked.length > 0}
					<h5 class="text-surface-600-400 text-meta font-semibold">
						Not common knowledge
					</h5>
					<ul class="flex flex-col gap-3">
						{#each otherMarked as o (o.entry.id)}
							{@render otherRow(o.entry)}
						{/each}
					</ul>
				{/if}
				{#if otherCommon.length > 0}
					<h5 class="text-surface-600-400 text-meta font-semibold">
						Common knowledge
					</h5>
					<ul class="flex flex-col gap-3">
						{#each otherCommon as o (o.entry.id)}
							{@render otherRow(o.entry)}
						{/each}
					</ul>
				{/if}
				{#if dragFrom === "tied"}
					<div
						aria-hidden="true"
						data-knows-hint="other"
						class="border-primary-500/70 bg-surface-50-950/80 rounded-container pointer-events-none absolute inset-0 grid place-items-center border-2 border-dashed text-sm"
					>
						Drop to set Default
					</div>
				{/if}
			</section>
		{/if}
	{/if}
</div>
