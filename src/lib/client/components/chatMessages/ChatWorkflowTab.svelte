<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { onMount, onDestroy } from "svelte"

	interface Props {
		lorebookId: number
		sceneList: Sockets.Scenes.List.SceneWithEntry[]
		onOpenEntry: (lorebookId: number, historyEntryId: number) => void
		onEnterSummarizationMode?: () => void
	}

	let { lorebookId, sceneList, onOpenEntry, onEnterSummarizationMode }: Props = $props()

	const socket = useTypedSocket()
	let historyEntryList = $state<SelectHistoryEntry[]>([])
	let isCreatingEntry = $state(false)

	function dateValue(e: SelectHistoryEntry): number {
		return e.year * 10000 + (e.month ?? 0) * 100 + (e.day ?? 0)
	}

	function formatDate(e: SelectHistoryEntry): string {
		let s = `Yr. ${e.year}`
		if (e.month != null) s += ` Mo. ${e.month}`
		if (e.day != null) s += ` Day ${e.day}`
		return s
	}

	let sortedEntries = $derived(
		[...historyEntryList].sort((a, b) => dateValue(b) - dateValue(a))
	)

	let latestEntry = $derived(sortedEntries[0])

	let sceneCountByEntry = $derived.by(() => {
		const counts: Record<number, number> = {}
		for (const scene of sceneList) {
			if (scene.historyEntryId != null) {
				counts[scene.historyEntryId] = (counts[scene.historyEntryId] ?? 0) + 1
			}
		}
		return counts
	})

	let ungraphedSceneCount = $derived(sceneList.filter((s) => !s.graphed).length)

	function handleNewEntry() {
		if (!latestEntry || isCreatingEntry) return
		isCreatingEntry = true
		socket.emit(
			"historyEntries:iterateNext",
			{ id: latestEntry.id } satisfies Sockets.HistoryEntries.IterateNext.Params
		)
	}

	$effect(() => {
		if (lorebookId) {
			socket.emit(
				"historyEntries:list",
				{ lorebookId } satisfies Sockets.HistoryEntries.List.Params
			)
		}
	})

	onMount(() => {
		socket.on("historyEntries:list", (msg: Sockets.HistoryEntries.List.Response) => {
			historyEntryList = msg.historyEntryList
		})

		socket.on(
			"historyEntries:iterateNext",
			(msg: Sockets.HistoryEntries.IterateNext.Response) => {
				isCreatingEntry = false
				if (msg.historyEntry) {
					const exists = historyEntryList.some((e) => e.id === msg.historyEntry.id)
					if (!exists) historyEntryList = [...historyEntryList, msg.historyEntry]
					onOpenEntry(lorebookId, msg.historyEntry.id)
				}
			}
		)

		socket.on("historyEntries:create", (msg: Sockets.HistoryEntries.Create.Response) => {
			if (msg.historyEntry?.lorebookId === lorebookId) {
				const exists = historyEntryList.some((e) => e.id === msg.historyEntry.id)
				if (!exists) historyEntryList = [...historyEntryList, msg.historyEntry]
			}
		})

		socket.on("historyEntries:update", (msg: Sockets.HistoryEntries.Update.Response) => {
			if (msg.historyEntry) {
				historyEntryList = historyEntryList.map((e) =>
					e.id === msg.historyEntry.id ? msg.historyEntry : e
				)
			}
		})
	})

	onDestroy(() => {
		socket.off("historyEntries:list")
		socket.off("historyEntries:iterateNext")
		socket.off("historyEntries:create")
		socket.off("historyEntries:update")
	})
</script>

<div class="flex flex-col gap-3 py-1 mb-[0.5em]">
	<!-- Current (latest) history entry -->
	{#if latestEntry}
		<div class="flex items-center gap-2">
			<div class="bg-surface-200-800 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2">
				<Icons.BookOpen size={13} class="text-surface-400 shrink-0" />
				<div class="min-w-0 flex-1">
					<p class="text-xs font-semibold">{formatDate(latestEntry)}</p>
					<p class="text-surface-700-300 text-xs">
						{sceneCountByEntry[latestEntry.id] ?? 0} scene{(sceneCountByEntry[latestEntry.id] ??
							0) === 1
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
					title="Extend graph with {ungraphedSceneCount} ungraphed scene{ungraphedSceneCount === 1 ? '' : 's'}"
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
			<p class="text-surface-700-300 text-xs font-semibold uppercase tracking-wide">
				Recent Entries
			</p>
			<div class="flex flex-col gap-1">
				{#each sortedEntries.slice(1, 6) as entry (entry.id)}
					<button
						class="bg-surface-100-900 hover:bg-surface-200-800 border-surface-300-700 flex items-center gap-2 rounded-lg border-l-2 py-1.5 pl-2.5 pr-3 text-left transition"
						onclick={() => onOpenEntry(lorebookId, entry.id)}
					>
						<span class="min-w-0 flex-1 truncate text-xs">{formatDate(entry)}</span>
						<span class="text-surface-700-300 shrink-0 text-xs">
							{sceneCountByEntry[entry.id] ?? 0} scene{(sceneCountByEntry[entry.id] ?? 0) === 1
								? ""
								: "s"}
						</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
