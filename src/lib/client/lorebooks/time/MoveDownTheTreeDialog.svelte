<script lang="ts">
	/**
	 * 🚧 **Move down the tree**: moves the asked entries, for good, to a line
	 * their line was forked from. It cannot be undone, so it is an `alertdialog` in a
	 * `Portal` (STYLE-GUIDE §6.6), answered and never dismissed by a click
	 * outside.
	 *
	 * The rule is `shared/lorebooks/moveDownTheTree`, the server's too: a line
	 * the move cannot reach is shown with its reason, and entries filed under one
	 * another move together, named in the one confirm.
	 */
	import * as Icons from "@lucide/svelte"
	import { untrack } from "svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import { interestKey } from "$lib/shared/sockets/interest"
	import {
		linesBelow,
		linesStartingToRead,
		moveDownProblems,
		moveDownSentence,
		takenAlong
	} from "$lib/shared/lorebooks/moveDownTheTree"
	import { bookTimeline, getBookData } from "../bookData.svelte"
	import { formatDate } from "../sections/historyDates"
	import { openBookTime } from "./bookTime.svelte"
	import { consequenceSentences, treeRowsOf } from "./moveDownTheTree"

	interface Props {
		open: boolean
		lorebookId: number
		/** The one asked entry. */
		entryId?: number
		/** Several asked entries (on one line); wins over `entryId`. */
		entryIds?: readonly number[]
		/** The line to check on open when it is offered and has no reason. */
		prefer?: { branchId: number | null }
		/** The form has unsaved changes: the move waits for them. */
		dirty: boolean
		onClose: () => void
		onMoved?: (target: number | null) => void
	}

	let {
		open,
		lorebookId,
		entryId,
		entryIds,
		prefer,
		dirty,
		onClose,
		onMoved
	}: Props = $props()

	const data = getBookData()
	const timeline = bookTimeline()
	const socket = useTypedSocket()
	const uid = `moveDown${Math.random().toString(36).slice(2, 8)}`

	const rows = $derived(treeRowsOf(data.rawRows))
	const asked = $derived(entryIds ?? (entryId != null ? [entryId] : []))
	const entry = $derived(rows.find((r) => r.id === asked[0]) ?? null)
	const source = $derived(entry?.branchId ?? null)
	const along = $derived(
		source == null ? [] : takenAlong(asked, rows, source)
	)
	const ids = $derived([
		...new Set([...asked, ...along.map((a) => a.row.id)])
	])
	const movingRows = $derived(rows.filter((r) => ids.includes(r.id)))
	const words = $derived({
		lineName: (id: number | null) => openBookTime.lineName(id),
		date: (d: Parameters<typeof formatDate>[0]) => formatDate(d),
		timeline: timeline.value
	})

	/** Each line on offer, current first, main last, with why it cannot be reached. */
	const options = $derived(
		source == null
			? []
			: [source, ...linesBelow(source, openBookTime.branches)].map(
					(target) => {
						const problem =
							target === source
								? null
								: moveDownProblems({
										ids,
										rows,
										target,
										branches: openBookTime.branches
									})[0]
						return {
							target,
							here: target === source,
							reason: problem
								? moveDownSentence(problem, words)
								: null
						}
					}
				)
	)

	let chosen = $state.raw<{ target: number | null } | null>(null)
	let busy = $state(false)
	let refusal = $state<string | null>(null)

	$effect(() => {
		if (!open) return
		untrack(() => {
			const preferred = prefer
				? options.find(
						(o) =>
							o.target === prefer.branchId && !o.here && !o.reason
					)
				: undefined
			const first = preferred ?? options.find((o) => !o.here && !o.reason)
			chosen = first ? { target: first.target } : null
			refusal = null
			busy = false
		})
	})

	const choose = (target: number | null) => {
		chosen = { target }
		refusal = null
	}

	const sentences = $derived.by(() => {
		if (!chosen || source == null) return []
		return consequenceSentences({
			along: along.map((a) => a.row.name),
			reading: linesStartingToRead(
				movingRows,
				source,
				chosen.target,
				openBookTime.branches
			).map((id) => openBookTime.lineName(id)),
			source: openBookTime.lineName(source)
		})
	})

	const confirmLabel = $derived(
		chosen
			? ids.length > 1
				? `Move ${ids.length} entries to ${openBookTime.lineName(chosen.target)}`
				: `Move to ${openBookTime.lineName(chosen.target)}`
			: "Move"
	)
	const canConfirm = $derived(chosen !== null && !dirty && !busy)

	async function confirm() {
		if (!chosen || !canConfirm) return
		const target = chosen.target
		busy = true
		refusal = null
		try {
			await awaitReply({
				socket,
				event: "amendments:moveDownTheTree",
				params: { lorebookId, entryIds: ids, branchId: target },
				replyKey: interestKey("amendments:moveDownTheTree", lorebookId),
				errorEvent: "amendments:moveDownTheTree:error",
				fallbackError: "The entry could not be moved.",
				match: (d) =>
					d.lorebookId === lorebookId && d.entryIds.includes(asked[0])
			})
		} catch (err) {
			busy = false
			refusal =
				err instanceof Error
					? err.message
					: "The entry could not be moved."
			return
		}
		busy = false
		onMoved?.(target)
		onClose()
	}
</script>

<Dialog
	{open}
	role="alertdialog"
	closeOnInteractOutside={false}
	onOpenChange={(e: { open: boolean }) => {
		if (!e.open) onClose()
	}}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50" />
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
				data-testid="move-down-tree-dialog"
			>
				<header class="flex items-start justify-between gap-2">
					<div class="space-y-1">
						<Dialog.Title class="h4">
							{asked.length > 1
								? `Move ${asked.length} entries down the tree`
								: `Move ${entry?.name ?? "Untitled"} down the tree`}
						</Dialog.Title>
						<Dialog.Description
							class="text-surface-700-300 text-sm"
						>
							Pick a line {openBookTime.lineName(source)} was forked
							from. {asked.length > 1
								? "The entries move"
								: "The entry moves"}
							there for good.
						</Dialog.Description>
					</div>
					<Dialog.CloseTrigger
						class="btn-icon hover:preset-tonal min-h-11 min-w-11"
						aria-label="Close"
					>
						<Icons.X size={16} aria-hidden="true" />
					</Dialog.CloseTrigger>
				</header>
				<fieldset class="flex flex-col gap-1">
					<legend class="text-sm font-semibold">Move to</legend>
					{#each options as option (option.target ?? "main")}
						{@const reasonId = `${uid}Why${option.target ?? "main"}`}
						<div class="flex flex-col">
							<label class="flex min-h-11 items-center gap-2">
								<input
									type="radio"
									name="{uid}Line"
									value={option.target ?? "main"}
									checked={chosen?.target === option.target &&
										!option.here}
									disabled={option.here || !!option.reason}
									aria-describedby={option.reason
										? reasonId
										: undefined}
									onchange={() => choose(option.target)}
								/>
								{openBookTime.lineName(option.target)}
								{#if option.here}
									<span class="chip preset-tonal text-xs">
										Here now
									</span>
								{/if}
							</label>
							{#if option.reason}
								<p
									id={reasonId}
									class="text-surface-700-300 pl-6 text-xs"
									data-move-down-reason
								>
									{option.reason}
								</p>
							{/if}
						</div>
					{/each}
				</fieldset>
				<div class="flex flex-col gap-1 text-sm" aria-live="polite">
					{#each sentences as sentence (sentence)}
						<p data-move-down-consequence>{sentence}</p>
					{/each}
				</div>
				{#if dirty}
					<p class="text-sm" data-move-down-dirty>
						Save or discard your changes first.
					</p>
				{/if}
				{#if refusal}
					<p class="text-error-600-400 text-sm" role="alert">
						{refusal}
					</p>
				{/if}
				<footer class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal min-h-11"
						onclick={onClose}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500 min-h-11"
						disabled={!canConfirm}
						onclick={() => void confirm()}
					>
						{confirmLabel}
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
