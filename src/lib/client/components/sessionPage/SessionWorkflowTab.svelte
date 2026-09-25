<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { compareDates } from "$lib/shared/lorebooks/storyDate"
	import {
		HISTORY_TYPE_ID,
		type LorebookEntry
	} from "$lib/shared/entries/types"

	type History = LorebookEntry<typeof HISTORY_TYPE_ID>

	interface Props {
		lorebookId: number
		sceneList: Sockets.Scenes.List.SceneWithEntry[]
		onOpenEntry: (lorebookId: number, historyEntryId: number) => void
		onEnterSummarizationMode?: () => void
	}

	let {
		lorebookId,
		sceneList,
		onOpenEntry,
		onEnterSummarizationMode
	}: Props = $props()

	const socket = useTypedSocket()
	let historyEntryList = $state<History[]>([])
	let isCreatingEntry = $state(false)

	// ⚠ There was a LOCAL copy of the packed `year*10000 + month*100 + day`
	// encoding here — a second comparator for one calendar, carrying the same
	// radix-100 collision as the original. Deleted 2026-09-24; the shared
	// `compareDates` is the ordering everywhere.

	function formatDate(e: History): string {
		let s = `Yr. ${e.year}`
		if (e.month != null) s += ` Mo. ${e.month}`
		if (e.day != null) s += ` Day ${e.day}`
		return s
	}

	let sortedEntries = $derived(
		[...historyEntryList].sort((a, b) => compareDates(b, a))
	)

	let latestEntry = $derived(sortedEntries[0])

	let sceneCountByEntry = $derived.by(() => {
		const counts: Record<number, number> = {}
		for (const scene of sceneList) {
			if (scene.historyEntryId != null) {
				counts[scene.historyEntryId] =
					(counts[scene.historyEntryId] ?? 0) + 1
			}
		}
		return counts
	})

	let ungraphedSceneCount = $derived(
		sceneList.filter((s) => !s.graphed).length
	)

	function handleNewEntry() {
		if (!latestEntry || isCreatingEntry) return
		isCreatingEntry = true
		socket.emit("entries:iterateNext", {
			id: latestEntry.id,
			typeId: HISTORY_TYPE_ID
		} satisfies Sockets.Entries.IterateNext.Params)
	}

	/**
	 * The four entry events this tab reads, every one SCOPED to its book —
	 * `entries:list` on the reply's own `lorebookId`, the other three on
	 * `entry.lorebookId` (see `SCOPED_EVENTS`). Never on the type: one
	 * namespace serves every entry type, so each handler's
	 * `typeId !== HISTORY_TYPE_ID` check stays what separates History from the
	 * lore tabs.
	 *
	 * Effects rather than `useInterest` because the key moves: `lorebookId` is
	 * a prop, and `useInterest` keeps the key it was first given. Declared
	 * above the request below so the keys are held before it goes out —
	 * effects run in creation order, and both re-run together when the book
	 * changes.
	 *
	 * ⚠ `handleIterateNext` has no id check of its own; the scope IS its
	 * filter, which is why that key is on `entry.lorebookId`.
	 */
	$effect(() => {
		// Guarded like the request below: `interestKey` with no scope yields
		// the BARE key, which would quietly hold every book's entries.
		if (!lorebookId) return
		const releases = [
			declareInterest<"entries:list">(
				interestKey("entries:list", lorebookId),
				handleHistoryEntriesList
			),
			declareInterest<"entries:iterateNext">(
				interestKey("entries:iterateNext", lorebookId),
				handleIterateNext
			),
			declareInterest<"entries:create">(
				interestKey("entries:create", lorebookId),
				handleHistoryEntryCreate
			),
			declareInterest<"entries:update">(
				interestKey("entries:update", lorebookId),
				handleHistoryEntryUpdate
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	$effect(() => {
		if (lorebookId) {
			socket.emit("entries:list", {
				lorebookId,
				typeId: HISTORY_TYPE_ID
			} satisfies Sockets.Entries.List.Params)
		}
	})

	// One namespace now, so a list for some *other* tab's type arrives here
	// too — the type filter is what makes that harmless.
	function handleHistoryEntriesList(msg: Sockets.Entries.List.Response) {
		if (msg.lorebookId === lorebookId && msg.typeId === HISTORY_TYPE_ID)
			historyEntryList = msg.entryList as History[]
	}

	function handleIterateNext(msg: Sockets.Entries.IterateNext.Response) {
		isCreatingEntry = false
		const entry = msg.entry as History | undefined
		if (entry) {
			const exists = historyEntryList.some((e) => e.id === entry.id)
			if (!exists) historyEntryList = [...historyEntryList, entry]
			onOpenEntry(lorebookId, entry.id)
		}
	}

	function handleHistoryEntryCreate(msg: Sockets.Entries.Create.Response) {
		if (
			msg.entry?.lorebookId !== lorebookId ||
			msg.entry?.typeId !== HISTORY_TYPE_ID
		)
			return
		const entry = msg.entry as History
		if (!historyEntryList.some((e) => e.id === entry.id))
			historyEntryList = [...historyEntryList, entry]
	}

	function handleHistoryEntryUpdate(msg: Sockets.Entries.Update.Response) {
		if (msg.entry?.typeId !== HISTORY_TYPE_ID) return
		const entry = msg.entry as History
		historyEntryList = historyEntryList.map((e) =>
			e.id === entry.id ? entry : e
		)
	}
</script>

<div class="mb-[0.5em] flex flex-col gap-3 py-1">
	<!-- Current (latest) history entry -->
	{#if latestEntry}
		<div class="flex items-center gap-2">
			<div
				class="bg-surface-200-800 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2"
			>
				<Icons.BookOpen size={13} class="text-surface-400 shrink-0" />
				<div class="min-w-0 flex-1">
					<p class="text-xs font-semibold">
						{formatDate(latestEntry)}
					</p>
					<p class="text-surface-700-300 text-xs">
						{sceneCountByEntry[latestEntry.id] ?? 0} scene{(sceneCountByEntry[
							latestEntry.id
						] ?? 0) === 1
							? ""
							: "s"}
					</p>
				</div>
			</div>
			<button
				class="btn btn-sm preset-filled-surface-400-600"
				title="Open in lorebook"
				onclick={() => onOpenEntry(lorebookId, latestEntry.id)}
			>
				<Icons.ExternalLink size={13} />
			</button>
			<button
				class="btn btn-sm preset-filled-surface-400-600"
				title="Start new history entry"
				disabled={isCreatingEntry}
				onclick={handleNewEntry}
			>
				{#if isCreatingEntry}
					<Icons.Loader2 size={13} class="animate-spin" />
				{:else}
					<Icons.Plus size={13} />
				{/if}
			</button>
		</div>
	{:else if historyEntryList.length === 0}
		<p class="text-surface-700-300 text-xs">
			No history entries yet. Open the lorebook to create one.
		</p>
	{/if}

	<!-- Pipeline action buttons -->
	{#if onEnterSummarizationMode || ungraphedSceneCount > 0}
		<div class="flex flex-wrap gap-2">
			{#if onEnterSummarizationMode}
				<button
					class="btn btn-sm preset-tonal-secondary"
					onclick={onEnterSummarizationMode}
				>
					<Icons.Film size={13} />
					Summarize Scene
				</button>
			{/if}
			{#if ungraphedSceneCount > 0}
				<button
					class="btn btn-sm preset-tonal-warning"
					title="Extend graph with {ungraphedSceneCount} ungraphed scene{ungraphedSceneCount ===
					1
						? ''
						: 's'}"
					onclick={() => {
						if (latestEntry) onOpenEntry(lorebookId, latestEntry.id)
					}}
				>
					<Icons.Network size={13} />
					Extend Graph ({ungraphedSceneCount})
				</button>
			{/if}
		</div>
	{/if}

	<!-- Recent entries list -->
	{#if sortedEntries.length > 1}
		<div class="space-y-1">
			<p
				class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
			>
				Recent Entries
			</p>
			<div class="flex flex-col gap-1">
				{#each sortedEntries.slice(1, 6) as entry (entry.id)}
					<button
						class="bg-surface-100-900 hover:bg-surface-200-800 border-surface-300-700 flex items-center gap-2 rounded-lg border-l-2 py-1.5 pr-3 pl-2.5 text-left transition"
						onclick={() => onOpenEntry(lorebookId, entry.id)}
					>
						<span class="min-w-0 flex-1 truncate text-xs">
							{formatDate(entry)}
						</span>
						<span class="text-surface-700-300 shrink-0 text-xs">
							{sceneCountByEntry[entry.id] ?? 0} scene{(sceneCountByEntry[
								entry.id
							] ?? 0) === 1
								? ""
								: "s"}
						</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
