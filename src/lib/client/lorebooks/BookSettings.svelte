<script lang="ts">
	import { getContext, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import EditLorebookForm from "$lib/client/components/lorebookForms/EditLorebookForm.svelte"
	import {
		CHARACTER_LORE_TYPE_ID,
		HISTORY_TYPE_ID,
		WORLD_LORE_TYPE_ID,
		type EntryTypeId
	} from "$lib/shared/entries/types"
	import { bookReadout, nestingOf, READOUT_NOTE } from "./bookReadout"
	import { formatDate } from "./sections/historyDates"

	/**
	 * Book settings: a readout of what the book holds, and the few behaviours
	 * it chooses.
	 *
	 * There are no feature switches here and there is nothing to turn on: every
	 * capability is available in every lorebook, and what the workspace offers
	 * follows what the book actually holds. So this page counts, and the
	 * counting is the point.
	 */
	interface Props {
		lorebookId: number
		bookName: string
		/** The server's figures for this book, shared with the rail. */
		counts: Record<string, number> | null
		/** What the open session is called, when one reads this book. */
		readingInto: string | null
		canChangeReading: boolean
		hasUnsavedChanges: boolean
		onClose: () => void
		onChangeReading: () => void
		onImport: () => void
		onExport: () => void
		/** Asks for a copy of this book; the prompt names it. */
		onDuplicate: () => void
		onDelete: () => void
	}

	let {
		lorebookId,
		bookName,
		counts,
		readingInto,
		canChangeReading,
		hasUnsavedChanges = $bindable(false),
		onClose,
		onChangeReading,
		onImport,
		onExport,
		onDuplicate,
		onDelete
	}: Props = $props()

	const socket = useTypedSocket()

	const TYPES: EntryTypeId[] = [
		WORLD_LORE_TYPE_ID,
		CHARACTER_LORE_TYPE_ID,
		HISTORY_TYPE_ID
	]

	let rowsByType = $state<Record<string, any[]>>({})
	let scenes = $state<Sockets.Scenes.SceneWithMeta[]>([])
	let relationships = $state<number>(0)

	let allRows = $derived(TYPES.flatMap((t) => rowsByType[t] ?? []))
	let nesting = $derived(nestingOf(allRows))

	let castWithLore = $derived(
		new Set(
			(rowsByType[CHARACTER_LORE_TYPE_ID] ?? [])
				.map((row) => row.lorebookBindingId)
				.filter((id) => id != null)
		).size
	)

	let dated = $derived.by(() => {
		const rows = rowsByType[HISTORY_TYPE_ID] ?? []
		if (!rows.length) return undefined
		const sorted = [...rows].sort(
			(a, b) =>
				a.year - b.year ||
				(a.month ?? 0) - (b.month ?? 0) ||
				(a.day ?? 0) - (b.day ?? 0)
		)
		return {
			earliest: formatDate(sorted[0]),
			latest: formatDate(sorted[sorted.length - 1])
		}
	})

	/** A scene whose history entry nobody has compiled yet. */
	let scenesWaiting = $derived.by(() => {
		const done = new Set(
			(rowsByType[HISTORY_TYPE_ID] ?? [])
				.filter((row) => row.isCompleted)
				.map((row) => row.id)
		)
		return scenes.filter((s) => !done.has(s.historyEntryId)).length
	})

	let capturedFrom = $derived.by(() => {
		const names = new Set(
			scenes.map((s) => s.sessionName).filter((n): n is string => !!n)
		)
		if (names.size === 0) return null
		if (names.size === 1) return [...names][0]
		return `${names.size} sessions`
	})

	let lines = $derived(
		bookReadout({
			counts,
			castWithLore,
			relationships,
			dated,
			scenesWaiting,
			capturedFrom,
			nested: nesting.nested,
			depth: nesting.depth,
			branches: ["main"]
		})
	)

	function handleEntriesList(msg: Sockets.Entries.List.Response) {
		if (msg.lorebookId !== lorebookId) return
		rowsByType = { ...rowsByType, [msg.typeId]: msg.entryList as any[] }
	}

	function handleScenes(msg: Sockets.Scenes.ListByLorebook.Response) {
		scenes = msg.sceneList
	}

	// One book is open at a time, and the interest key already names it, so
	// there is nothing left here to filter on.
	function handleGraph(msg: Sockets.NarrativeGraph.List.Response) {
		// The scope the gate reads; checked here too, so a stale book's
		// reply arriving after a switch cannot paint this one.
		if (msg.lorebookId !== lorebookId) return
		relationships = msg.relationships.length
	}

	/**
	 * Three reads, all about the one book this page is counting.
	 *
	 * Effects rather than `useInterest` because the key moves: `lorebookId` is
	 * a prop, and `useInterest` keeps the key it was first given. Declared
	 * above `onMount` so the interest exists before the requests below go out
	 * (effects run in creation order, and `onMount` is one of them).
	 */
	$effect(() =>
		declareInterest<"entries:list">(
			interestKey("entries:list", lorebookId),
			handleEntriesList
		)
	)
	$effect(() =>
		declareInterest<"scenes:listByLorebook">(
			interestKey("scenes:listByLorebook", lorebookId),
			handleScenes
		)
	)
	$effect(() =>
		declareInterest<"narrativeGraph:list">(
			interestKey("narrativeGraph:list", lorebookId),
			handleGraph
		)
	)

	onMount(() => {
		for (const typeId of TYPES)
			socket.emit("entries:list", { lorebookId, typeId })
		socket.emit("scenes:listByLorebook", { lorebookId })
		socket.emit("narrativeGraph:list", { lorebookId })
	})
</script>

{#snippet behaviour(
	label: string,
	value: string,
	explain: string,
	action?: { label: string; run: () => void; disabled?: boolean }
)}
	<div class="flex flex-wrap items-baseline gap-2">
		<span class="font-semibold">{label}</span>
		<span class="text-surface-700-300 text-sm">{value}</span>
		{#if action}
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				disabled={action.disabled}
				onclick={action.run}
			>
				{action.label}
			</button>
		{/if}
		<p class="text-surface-700-300 w-full text-sm">{explain}</p>
	</div>
{/snippet}

<div
	class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
	data-lore-book-settings
>
	<div class="flex flex-wrap items-center gap-2">
		<button
			class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
			type="button"
			onclick={onClose}
			title="Back to the entries"
			aria-label="Back to the entries"
		>
			<Icons.ChevronLeft size={16} aria-hidden="true" />
		</button>
		<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">
			Book settings · {bookName}
		</h2>
	</div>

	<EditLorebookForm {lorebookId} bind:hasUnsavedChanges />

	<section class="card preset-filled-surface-100-900 space-y-3 p-3">
		<p
			class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
		>
			<Icons.ListChecks size={13} aria-hidden="true" />
			What this book holds
		</p>
		<ul class="flex flex-col gap-2">
			{#each lines as line (line.id)}
				<li class="flex flex-wrap items-baseline gap-2">
					<span class="font-semibold">{line.label}</span>
					<span class="badge preset-tonal-surface">{line.count}</span>
					<span class="text-surface-700-300 text-sm">
						{line.detail.join(", ")}
					</span>
				</li>
			{/each}
		</ul>
		<p class="text-surface-700-300 text-sm">{READOUT_NOTE}</p>
	</section>

	<section class="card preset-filled-surface-100-900 space-y-3 p-3">
		{@render behaviour(
			"Reading into a session",
			readingInto ?? "no session",
			"The session this book is read into as it plays.",
			{
				label: "Change",
				run: onChangeReading,
				disabled: !canChangeReading
			}
		)}
		{@render behaviour(
			"Token ceiling",
			"set by the session's pipeline",
			"Highest-ranked entries fill the budget; the rest are cut. The figure lives in the pipeline's retrieval config."
		)}
		{@render behaviour(
			"Relationship ceiling",
			"set by the session's pipeline",
			"How many relationships one cast member may send to the model. The figure lives in the pipeline's retrieval config."
		)}
		{@render behaviour(
			"Capture scenes from this session",
			"on request",
			"Summarize to Lorebook on the session page captures a run of messages as a scene."
		)}
	</section>

	<section class="card preset-filled-surface-100-900 space-y-3 p-3">
		<p
			class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
		>
			<Icons.Book size={13} aria-hidden="true" />
			This book
		</p>
		<div class="flex flex-wrap gap-2">
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				onclick={onImport}
			>
				<Icons.Upload size={14} aria-hidden="true" /> Import
			</button>
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				onclick={onExport}
			>
				<Icons.Download size={14} aria-hidden="true" /> Export
			</button>
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				title="Copy this book, entries, cast and all"
				onclick={onDuplicate}
			>
				<Icons.Copy size={14} aria-hidden="true" /> Duplicate
			</button>
			<button
				class="btn btn-sm preset-filled-error-500"
				type="button"
				onclick={onDelete}
			>
				<Icons.Trash2 size={14} aria-hidden="true" />
				Delete “{bookName}”
			</button>
		</div>
	</section>
</div>
