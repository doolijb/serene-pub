<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onDestroy, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { toaster } from "$lib/client/utils/toaster"
	import {
		absorbCastMember,
		notAbsorbedTitle,
		undoMergeToast
	} from "./castSave"

	/**
	 * Two people who are one person, and the way back from saying so.
	 *
	 * Absorbing is reversible while the survivor is still there, so the log of
	 * recent absorbs sits beside the proposals rather than somewhere else: the
	 * decision and its undo are on one screen.
	 */
	interface Props {
		lorebookId: number
	}

	let { lorebookId }: Props = $props()

	const socket = useTypedSocket()

	let candidates = $state<
		Sockets.NarrativeGraph.DuplicateCandidates.Candidate[]
	>([])
	let mergeLogs = $state<
		Sockets.NarrativeGraph.ListMergeLogs.MergeLogEntry[]
	>([])
	let showLogs = $state(false)

	function fetchAll() {
		socket.emit("narrativeGraph:duplicateCandidates", {
			lorebookId
		} satisfies Sockets.NarrativeGraph.DuplicateCandidates.Params)
		socket.emit("narrativeGraph:listMergeLogs", {
			lorebookId
		} satisfies Sockets.NarrativeGraph.ListMergeLogs.Params)
	}

	function handleCandidates(
		msg: Sockets.NarrativeGraph.DuplicateCandidates.Response
	) {
		if (msg.lorebookId === lorebookId) candidates = msg.candidates
	}

	function handleMergeLogs(
		msg: Sockets.NarrativeGraph.ListMergeLogs.Response
	) {
		if (msg.lorebookId === lorebookId) mergeLogs = msg.mergeLogs
	}

	/**
	 * A merge anywhere in THIS book moves both lists; another book's does
	 * not. No toast here: the absorb this panel sent says how it went
	 * (`absorb`), and a merge from the graph, another tab or a session is not
	 * this panel's news (plan B8).
	 */
	function handleMergeNode(msg: Sockets.NarrativeGraph.MergeNode.Response) {
		if (msg.survivorNode?.lorebookId !== lorebookId) return
		fetchAll()
	}

	/** The undos this panel sent, by merge record, until each is answered. */
	const undoing = new Set<number>()

	/**
	 * An undo says who is back, and — when the server could not put
	 * everything back — how many relationships and dated rows stayed lost,
	 * because an end, a line or a session was deleted since the merge.
	 * Said only for an undo pressed here (by its merge record); any undo in
	 * this book re-reads the lists.
	 */
	function handleUndoMerge(msg: Sockets.NarrativeGraph.UndoMerge.Response) {
		if (msg.lorebookId !== lorebookId) return
		if (undoing.delete(msg.mergeLogId)) {
			const toast = undoMergeToast(msg)
			const shown = { title: toast.title, description: toast.description }
			if (toast.kind === "warning") toaster.warning(shown)
			else toaster.success(shown)
		}
		fetchAll()
	}

	function undo(mergeLogId: number) {
		undoing.add(mergeLogId)
		socket.emit("narrativeGraph:undoMerge", {
			mergeLogId
		} satisfies Sockets.NarrativeGraph.UndoMerge.Params)
	}

	let gone = false
	onDestroy(() => {
		gone = true
	})

	/**
	 * Its refusal is said here, as a toast — Layout leaves
	 * `narrativeGraph:mergeNode:error` to the surface that asked — and only
	 * the refusal naming this pair (`absorbCastMember`): the absorb window's
	 * is the window's to say. The list is read again so the pair comes back.
	 */
	function absorb(
		candidate: Sockets.NarrativeGraph.DuplicateCandidates.Candidate
	) {
		absorbCastMember(socket, {
			nodeId: candidate.bindingIdA,
			parentNodeId: candidate.bindingIdB
		}).then((res) => {
			toaster.success({
				title: "Absorbed",
				description: `Merged into "${res.survivorNode.name}". Undo from Recent merges if this was a mistake.`
			})
		}, (err: unknown) => {
			toaster.error({
				title: notAbsorbedTitle(candidate.nameA),
				description: err instanceof Error ? err.message : undefined
			})
			if (!gone) fetchAll()
		})
		// Optimistic: the server re-emits its own candidate list after the
		// merge and corrects this if anything is off.
		candidates = candidates.filter((c) => c !== candidate)
	}

	function dismiss(
		candidate: Sockets.NarrativeGraph.DuplicateCandidates.Candidate
	) {
		socket.emit("narrativeGraph:dismissDuplicate", {
			lorebookId,
			bindingIdA: candidate.bindingIdA,
			bindingIdB: candidate.bindingIdB
		} satisfies Sockets.NarrativeGraph.DismissDuplicate.Params)
		candidates = candidates.filter((c) => c !== candidate)
	}

	/**
	 * The two reads are about this book, so they are scoped to it; the two
	 * writes answer with a survivor/restored node and carry no book, so they
	 * stay BARE — neither has an entry in `SCOPED_EVENTS`, and a scoped key for
	 * an unscoped event would match nothing at all.
	 *
	 * Effects rather than `useInterest` for the pair whose key moves with the
	 * `lorebookId` prop; declared above `onMount` so both exist before
	 * `fetchAll` asks.
	 */
	$effect(() =>
		declareInterest<"narrativeGraph:duplicateCandidates">(
			interestKey("narrativeGraph:duplicateCandidates", lorebookId),
			handleCandidates
		)
	)
	$effect(() =>
		declareInterest<"narrativeGraph:listMergeLogs">(
			interestKey("narrativeGraph:listMergeLogs", lorebookId),
			handleMergeLogs
		)
	)
	useInterest<"narrativeGraph:mergeNode">(
		"narrativeGraph:mergeNode",
		handleMergeNode
	)
	useInterest<"narrativeGraph:undoMerge">(
		"narrativeGraph:undoMerge",
		handleUndoMerge
	)

	onMount(() => {
		fetchAll()
	})
</script>

<div class="flex flex-col gap-3">
	{#if candidates.length === 0}
		<p class="text-surface-700-300 text-sm italic">
			Nothing looks like a duplicate right now. Pairs show up here after a
			graph build or an import introduces a name close to one already in
			the cast.
		</p>
	{:else}
		<div class="flex flex-col gap-1.5">
			{#each candidates as candidate (candidate.bindingIdA + "-" + candidate.bindingIdB)}
				<div
					class="bg-surface-100-900 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs"
				>
					<span class="min-w-0">
						"{candidate.nameA}" and "{candidate.nameB}": same
						person?
					</span>
					<div class="flex shrink-0 gap-2">
						<button
							class="btn btn-sm preset-tonal-surface"
							type="button"
							onclick={() => absorb(candidate)}
						>
							<Icons.GitMerge size={12} aria-hidden="true" /> Yes,
							absorb
						</button>
						<button
							class="text-surface-600-400 hover:underline"
							type="button"
							onclick={() => dismiss(candidate)}
						>
							No, different people
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if mergeLogs.length > 0}
		<div>
			<button
				type="button"
				class="text-surface-600-400 flex items-center gap-1 text-xs hover:underline"
				aria-expanded={showLogs}
				onclick={() => (showLogs = !showLogs)}
			>
				<Icons.ChevronRight
					size={12}
					class="transition-transform {showLogs ? 'rotate-90' : ''}"
					aria-hidden="true"
				/>
				Recent merges ({mergeLogs.length})
			</button>
			{#if showLogs}
				<div class="mt-2 flex flex-col gap-1.5">
					{#each mergeLogs as log (log.id)}
						<div
							class="panel-edge flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
						>
							<span class="text-surface-600-400 min-w-0">
								"{log.absorbedName}" absorbed into "{log.survivorName ??
									"(deleted)"}"
							</span>
							<button
								class="text-primary-500 shrink-0 hover:underline disabled:opacity-40"
								type="button"
								disabled={log.survivorId === null}
								title={log.survivorId === null
									? "Cannot be undone: the surviving member has since been absorbed elsewhere or deleted."
									: "Undo this merge"}
								onclick={() => undo(log.id)}
							>
								Undo
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
