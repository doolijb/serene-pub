<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import GraphBuildModal from "$lib/client/components/modals/GraphBuildModal.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import {
		compareDates,
		formatDate as spellDate,
		readStoryCalendar
	} from "$lib/shared/lorebooks/storyDate"
	import {
		HISTORY_TYPE_ID,
		type LorebookEntry
	} from "$lib/shared/entries/types"
	import { lineOf, rowsReadingOnLine } from "$lib/shared/lorebooks/lineReading"

	type History = LorebookEntry<typeof HISTORY_TYPE_ID>

	interface Props {
		lorebookId: number
		/**
		 * The line of that book the session reads (null = main). "Start new
		 * history entry" writes on it, and the latest entry is the latest
		 * this line reads — not another line's.
		 */
		branchId?: number | null
		sceneList: Sockets.Scenes.List.SceneWithEntry[]
		onOpenEntry: (lorebookId: number, historyEntryId: number) => void
		onEnterSummarizationMode?: () => void
	}

	let {
		lorebookId,
		branchId = null,
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

	/** The book's calendar, or null for free-form (`lorebooks:storyTime`). */
	let calendar = $state<ReturnType<typeof readStoryCalendar>>(null)

	$effect(() => {
		const id = lorebookId
		if (!id) return
		const release = declareInterest<"lorebooks:storyTime">(
			interestKey("lorebooks:storyTime", id),
			(res) => {
				if (res.lorebookId !== id) return
				calendar = readStoryCalendar(res.calendar ?? null)
			}
		)
		socket.emit("lorebooks:storyTime", { lorebookId: id })
		return release
	})

	/** Spelled through the book's calendar, like every other dated heading. */
	function formatDate(e: History): string {
		return spellDate(e, calendar)
	}

	/**
	 * The book's lines, for reading the session's one — its ancestor chain
	 * and fork cuts (ruling 5). Asked for only when the session is on a
	 * branch: main needs no chain, and this tab is the owner's alone.
	 */
	let branches = $state<Sockets.Amendments.Branch[]>([])
	$effect(() => {
		const id = lorebookId
		if (!id || branchId == null) return
		const release = declareInterest<"amendments:list">(
			interestKey("amendments:list", id),
			(res) => {
				if (res.lorebookId !== id) return
				branches = res.branches ?? []
			}
		)
		socket.emit("amendments:list", { lorebookId: id })
		return release
	})

	/** The history this session's line reads, fork cut included. */
	let lineHistory = $derived(
		rowsReadingOnLine(
			historyEntryList as (History & { branchId?: number | null })[],
			lineOf(branchId, branches),
			(e) => (typeof e.year === "number" ? e : null)
		)
	)

	let sortedEntries = $derived(
		[...lineHistory].sort((a, b) => compareDates(b, a))
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

	/**
	 * "Extend Graph" reads THIS session's scenes only (#51): the scenes here
	 * are the session's own, so their session is the scope.
	 */
	let sessionId = $derived(
		sceneList.find((s) => s.sessionId != null)?.sessionId ?? null
	)
	let readyToGraph = $derived(
		sceneList.filter((s) => !s.graphed && !!s.summary?.trim()).length
	)
	let showGraphBuild = $state(false)

	function handleNewEntry() {
		if (!latestEntry || isCreatingEntry) return
		isCreatingEntry = true
		socket.emit("entries:iterateNext", {
			id: latestEntry.id,
			typeId: HISTORY_TYPE_ID,
			// The session's line, not the source entry's: a session on a
			// branch continuing from a shared entry writes the next one on
			// its branch.
			branchId
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
					title="Graph this session's {ungraphedSceneCount} ungraphed scene{ungraphedSceneCount ===
					1
						? ''
						: 's'} into the lorebook's graph"
					onclick={() => (showGraphBuild = true)}
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

<GraphBuildModal
	open={showGraphBuild}
	onOpenChange={(e) => (showGraphBuild = e.open)}
	{lorebookId}
	mode="extend"
	{sessionId}
	readySceneCount={readyToGraph}
	skippedSceneCount={ungraphedSceneCount - readyToGraph}
	ungraphedHistoryEntryCount={0}
	onApplied={() => {
		// The scenes it read are graphed now; ask for the list again so the
		// count on the button follows.
		if (sessionId != null) socket.emit("scenes:list", { sessionId })
	}}
/>
