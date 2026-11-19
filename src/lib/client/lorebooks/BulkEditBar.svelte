<script lang="ts">
	/**
	 * 🚧 **Bulk edit's action bar** (owner, 2026-11-13/14): the toolbar under a
	 * lorebook's entries list while its bulk edit toggle is on. It counts the
	 * selection, offers select-all and the actions, runs each action as the
	 * existing per-entry request, one after another, and says in place how many
	 * entries changed and, for each left as it was, its name and why. The caller
	 * owns the selection and mounts the bar for the lorebook's owner only.
	 */
	import { tick } from "svelte"
	import { v4 as uuid } from "uuid"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import { interestKey } from "$lib/shared/sockets/interest"
	import {
		FILEABLE_ENTRY_TYPE_IDS,
		isFileableEntryType,
		type EntryTypeId
	} from "$lib/shared/entries/types"
	import DeleteLorebookEntryConfirmModal from "$lib/client/components/modals/DeleteLorebookEntryConfirmModal.svelte"
	import { getBookKnowledge } from "./knowledge/bookKnowledge.svelte"
	import KnowledgeMarkConfirm from "./knowledge/KnowledgeMarkConfirm.svelte"
	import { bookTimeline, getBookData } from "./bookData.svelte"
	import {
		BULK_LABELS,
		bulkDeleteCopy,
		bulkMoveCount,
		bulkMoveProblem,
		bulkNotCommonCopy,
		bulkReport,
		filedUnderCount,
		planBulk,
		runBulk,
		toggleActions,
		withParentOutcome,
		type BulkAction,
		type BulkNote,
		type BulkPlan,
		type BulkRow
	} from "./bulkEdit"
	import BulkTimeDialog from "./BulkTimeDialog.svelte"
	import { markHeldLine } from "./editor/teachMarks"
	import { loreRoute } from "./loreRoute.svelte"
	import { formatDate } from "./sections/historyDates"
	import { openBookTime } from "./time/bookTime.svelte"
	import MoveDownTheTreeDialog from "./time/MoveDownTheTreeDialog.svelte"
	import { treeRowsOf } from "./time/moveDownTheTree"

	interface Props {
		lorebookId: number
		/** The selected entries, as listed (rows of another line come with `listed: false`). */
		selected: BulkRow[]
		/** How many listed rows carry a checkbox: select-all's figure. */
		selectableCount: number
		/** Every listed row with a checkbox is selected. */
		allSelected: boolean
		onSelectAll: (next: boolean) => void
		/** The line being read; null = main. */
		line: number | null
		/** The entry open in the editor, or null: a move waits for its unsaved changes; deleting it closes it. */
		openEntryId: number | null
		/** After an action: the ids to keep selected (the entries left as they were). */
		onDone: (keep: number[]) => void
	}

	let {
		lorebookId,
		selected,
		selectableCount,
		allSelected,
		onSelectAll,
		line,
		openEntryId,
		onDone
	}: Props = $props()

	const data = getBookData()
	const timeline = bookTimeline()
	const socket = useTypedSocket()
	const uid = `bulkBar${Math.random().toString(36).slice(2, 8)}`

	const lineName = (id: number | null) => openBookTime.lineName(id)
	const none = $derived(selected.length === 0)
	const knowledge = getBookKnowledge()
	/** The rows with their common-knowledge mark: for the knowledge action only. */
	const markedRows = $derived(
		selected.map((r) => ({
			...r,
			notCommon: knowledge?.isMarked(r.id) ?? false
		}))
	)
	const toggles = $derived(toggleActions(markedRows))
	const ids = $derived(selected.map((r) => r.id))

	let busy = $state(false)
	let progress = $state({ done: 0, total: 0 })
	let report = $state.raw<{ headline: string; lines: string[] } | null>(null)
	let timeAsk = $state.raw<{
		mode: "beginning" | "decay"
		plan: BulkPlan
	} | null>(null)
	let deleteAsk = $state.raw<{ plan: BulkPlan } | null>(null)
	let markAsk = $state.raw<{ plan: BulkPlan } | null>(null)
	let moveAsk = $state.raw<{ count: number } | null>(null)

	const words = $derived({
		lineName,
		date: (d: Parameters<typeof formatDate>[0]) => formatDate(d),
		timeline: timeline.value
	})
	const moveProblem = $derived(
		bulkMoveProblem(
			ids,
			treeRowsOf(data.rawRows),
			openBookTime.branches,
			words
		)
	)

	let asked = 0
	const tokenFor = () =>
		`bulk-${Math.random().toString(36).slice(2, 10)}-${++asked}`

	const update = (row: BulkRow, patch: Record<string, unknown>) => {
		const requestId = uuid()
		return awaitReply({
			socket,
			event: "entries:update",
			params: {
				entry: { id: row.id, typeId: row.typeId, ...patch },
				requestId
			} as never,
			replyKey: interestKey("entries:update", lorebookId),
			errorEvent: "entries:update:error",
			fallbackError: "The entry could not be changed.",
			match: (d: any) => d?.requestId === requestId,
			matchError: (d: any) => d?.requestId === requestId
		}).then(() => null)
	}

	const mark = (
		row: BulkRow,
		patch: { pinned: boolean } | { off: boolean }
	) => {
		const request = tokenFor()
		return awaitReply({
			socket,
			event: "entries:setMarks",
			params: { entryId: row.id, ...patch, request } as never,
			errorEvent: "entries:setMarks:error",
			fallbackError: "The entry's marks could not be saved.",
			match: (d: any) => d?.request === request && !d?.error,
			matchError: (d: any) => d?.request === request
		}).then((res: any) => markHeldLine(res?.heldBy, null))
	}

	const del = (row: BulkRow) => {
		const requestId = uuid()
		return awaitReply({
			socket,
			event: "entries:delete",
			params: {
				id: row.id,
				typeId: row.typeId as EntryTypeId,
				requestId
			},
			replyKey: interestKey("entries:delete", lorebookId),
			errorEvent: "entries:delete:error",
			fallbackError: "The entry could not be deleted.",
			match: (d: any) => d?.requestId === requestId,
			matchError: (d: any) => d?.requestId === requestId
		}).then(() => null)
	}

	function say(
		changed: number,
		skipped: BulkNote[],
		refused: BulkNote[],
		notes: BulkNote[]
	) {
		report = bulkReport({ changed, refused, skipped, notes })
		onDone([...skipped, ...refused].map((n) => n.id))
	}

	async function run(
		plan: BulkPlan,
		send: (row: BulkRow) => Promise<string | null>
	) {
		busy = true
		progress = { done: 0, total: plan.send.length }
		report = null
		try {
			const res = await runBulk(plan.send, send, (done) => {
				progress = { done, total: plan.send.length }
			})
			return res
		} finally {
			busy = false
		}
	}

	async function toggle(
		action: Exclude<
			BulkAction,
			"beginning" | "decay" | "delete" | "notCommon" | "common"
		>
	) {
		const plan = planBulk(action, selected, { lineName })
		const patch =
			action === "pin" || action === "unpin"
				? { pinned: action === "pin" }
				: action === "off" || action === "on"
					? { off: action === "off" }
					: { archived: action === "archive" }
		const send =
			action === "archive" || action === "unarchive"
				? (row: BulkRow) => update(row, patch)
				: (row: BulkRow) => mark(row, patch as { pinned: boolean })
		const res = await run(plan, send)
		say(res.changed, plan.skip, res.refused, res.notes)
	}

	function askTime(mode: "beginning" | "decay") {
		const plan = planBulk(mode, selected, { lineName })
		if (plan.send.length === 0) {
			report = null
			say(0, plan.skip, [], [])
			return
		}
		timeAsk = { mode, plan }
	}

	async function applyTime(plan: BulkPlan, patch: Record<string, unknown>) {
		const res = await run(plan, (row) => update(row, patch))
		say(res.changed, plan.skip, res.refused, res.notes)
	}

	function askDelete() {
		const plan = planBulk("delete", selected, { lineName, parents })
		if (plan.send.length === 0 && plan.withParent.length === 0) {
			say(0, plan.skip, [], [])
			return
		}
		deleteAsk = { plan }
	}

	/** One request for the whole selection; the server's write is all or nothing. */
	async function sendMark(plan: BulkPlan, notCommonKnowledge: boolean) {
		if (!knowledge) return
		busy = true
		progress = { done: 0, total: plan.send.length }
		report = null
		try {
			await knowledge.setMark(
				plan.send.map((r) => r.id),
				notCommonKnowledge
			)
			progress = { done: plan.send.length, total: plan.send.length }
			say(plan.send.length, plan.skip, [], [])
		} catch (err) {
			const reason =
				err instanceof Error && err.message
					? err.message
					: "The entries could not be marked."
			say(
				0,
				plan.skip,
				plan.send.map((r) => ({ id: r.id, name: r.name, reason })),
				[]
			)
		} finally {
			busy = false
		}
	}

	function knowledgeAction() {
		const action = toggles.knowledge
		const plan = planBulk(action, markedRows, { lineName })
		if (plan.send.length === 0) {
			report = null
			say(0, plan.skip, [], [])
			return
		}
		if (action === "common") void sendMark(plan, false)
		else markAsk = { plan }
	}

	function confirmMark() {
		if (!markAsk) return
		const { plan } = markAsk
		markAsk = null
		void sendMark(plan, true)
	}

	const markCopy = $derived(
		markAsk
			? bulkNotCommonCopy(markAsk.plan.send.length)
			: { title: "", message: "" }
	)

	const parents = $derived.by(() => {
		const map = new Map<number, number | null>()
		for (const rows of Object.values(data.rawRows))
			for (const r of rows) map.set(r.id, r.anchorEntryId ?? null)
		return map
	})

	/** The filed-under count is complete only when every entry type that can be filed under another is loaded. */
	const filedUnderKnown = $derived(
		[...FILEABLE_ENTRY_TYPE_IDS, ...data.rulesLists.map((l) => l.typeId)]
			.filter(isFileableEntryType)
			.every((t) => data.loaded(t))
	)

	const deleteCopy = $derived(
		deleteAsk
			? bulkDeleteCopy({
					count:
						deleteAsk.plan.send.length +
						deleteAsk.plan.withParent.length,
					filedUnder: filedUnderKnown
						? filedUnderCount(
								deleteAsk.plan.send.map((r) => r.id),
								new Set(ids),
								parents
							)
						: null,
					lines: openBookTime.branches.length > 0
				})
			: { title: "", message: "" }
	)

	async function confirmDelete() {
		if (!deleteAsk) return
		const { plan } = deleteAsk
		deleteAsk = null
		const res = await run(plan, del)
		const refusedIds = new Set(res.refused.map((n) => n.id))
		const { went, notes } = withParentOutcome({
			send: plan.send,
			withParent: plan.withParent,
			selected,
			refusedIds,
			parents
		})
		const openGone =
			openEntryId != null &&
			((plan.send.some((r) => r.id === openEntryId) &&
				!refusedIds.has(openEntryId)) ||
				went.some((r) => r.id === openEntryId))
		say(
			res.changed + went.length,
			plan.skip,
			[...res.refused, ...notes],
			res.notes
		)
		if (openGone) void loreRoute.navigate({ type: "back" })
	}

	const movePrefer = $derived(
		selected.length > 0 && (selected[0].branchId ?? null) !== line
			? { branchId: line }
			: undefined
	)
	const moveDirty = $derived(
		openEntryId != null &&
			ids.includes(openEntryId) &&
			loreRoute.hasUnsavedChanges()
	)

	function moved() {
		const n = moveAsk?.count ?? selected.length
		report = bulkReport({ changed: n, refused: [], skipped: [], notes: [] })
		onDone([])
	}

	// One tab stop; arrows move focus between the enabled controls.
	let bar: HTMLElement | undefined = $state()
	let selectAll: HTMLInputElement | undefined = $state()
	let stop: Element | null = null
	const controls = () =>
		bar
			? [
					...bar.querySelectorAll<HTMLElement>(
						"input:not([disabled]), button:not([disabled])"
					)
				]
			: []
	function syncStops() {
		const all = controls()
		if (!stop || !all.includes(stop as HTMLElement)) stop = all[0] ?? null
		for (const c of all) c.tabIndex = c === stop ? 0 : -1
	}
	$effect(() => {
		void [
			busy,
			selected.length,
			selectableCount,
			timeline.value,
			moveProblem
		]
		void tick().then(syncStops)
	})
	$effect(() => {
		if (selectAll)
			selectAll.indeterminate = !allSelected && selected.length > 0
	})
	function onkeydown(e: KeyboardEvent) {
		const keys = ["ArrowRight", "ArrowLeft", "Home", "End"]
		if (!keys.includes(e.key)) return
		const all = controls()
		const at = all.indexOf(e.target as HTMLElement)
		if (at < 0 || all.length === 0) return
		const next =
			e.key === "Home"
				? 0
				: e.key === "End"
					? all.length - 1
					: (at + (e.key === "ArrowRight" ? 1 : -1) + all.length) %
						all.length
		e.preventDefault()
		stop = all[next]
		syncStops()
		all[next].focus()
	}
	function onfocusin(e: FocusEvent) {
		if (controls().includes(e.target as HTMLElement)) {
			stop = e.target as Element
			syncStops()
		}
	}

	const btn = "btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
</script>

<div class="space-y-2">
	<div
		bind:this={bar}
		role="toolbar"
		tabindex="-1"
		aria-label="Bulk edit"
		data-bulk-bar
		class="border-surface-200-800 flex flex-wrap items-center gap-2 border-t pt-2"
		{onkeydown}
		{onfocusin}
	>
		<label class="flex items-center gap-2 text-sm pointer-coarse:min-h-11">
			<input
				bind:this={selectAll}
				type="checkbox"
				class="checkbox"
				checked={allSelected}
				disabled={selectableCount === 0 || busy}
				onchange={() => onSelectAll(!allSelected)}
			/>
			Select all {selectableCount}
		</label>
		<span aria-live="polite" class="text-sm" data-bulk-count>
			{busy
				? `Changing ${progress.done} of ${progress.total}…`
				: `${selected.length} selected`}
		</span>
		{#if data.timelineEnabled}
			<button
				type="button"
				class={btn}
				disabled={none || busy}
				onclick={() => askTime("beginning")}
			>
				Beginning…
			</button>
		{/if}
		<button
			type="button"
			class={btn}
			disabled={none || busy}
			onclick={() => askTime("decay")}
		>
			Decay…
		</button>
		<button
			type="button"
			class={btn}
			disabled={none || busy || moveProblem != null}
			title={moveProblem ?? undefined}
			aria-describedby={moveProblem ? `${uid}Why` : undefined}
			onclick={() =>
				(moveAsk = {
					count: bulkMoveCount(ids, treeRowsOf(data.rawRows))
				})}
		>
			Move down the tree…
		</button>
		{#if moveProblem}
			<span id="{uid}Why" class="sr-only">{moveProblem}</span>
		{/if}
		<button
			type="button"
			class={btn}
			disabled={none || busy}
			onclick={() => toggle(toggles.pin)}
		>
			{BULK_LABELS[toggles.pin]}
		</button>
		<button
			type="button"
			class={btn}
			disabled={none || busy}
			onclick={() => toggle(toggles.off)}
		>
			{BULK_LABELS[toggles.off]}
		</button>
		<button
			type="button"
			class={btn}
			disabled={none || busy}
			onclick={() => toggle(toggles.archive)}
		>
			{BULK_LABELS[toggles.archive]}
		</button>
		{#if knowledge?.loaded}
			<button
				type="button"
				class={btn}
				disabled={none || busy}
				onclick={knowledgeAction}
			>
				{BULK_LABELS[toggles.knowledge]}
			</button>
		{/if}
		<button
			type="button"
			class="btn btn-sm preset-tonal-error pointer-coarse:min-h-11"
			disabled={none || busy}
			onclick={askDelete}
		>
			Delete…
		</button>
	</div>
	<div role="status" data-bulk-report>
		{#if report}
			<p class="text-[13px]">{report.headline}</p>
			{#if report.lines.length > 0}
				<ul class="text-surface-700-300 list-disc pl-5 text-xs">
					{#each report.lines as l (l)}
						<li>{l}</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</div>

{#if timeAsk}
	<BulkTimeDialog
		open={true}
		mode={timeAsk.mode}
		count={timeAsk.plan.send.length}
		onApply={(patch) => timeAsk && void applyTime(timeAsk.plan, patch)}
		onClose={() => (timeAsk = null)}
	/>
{/if}

{#if deleteAsk}
	<DeleteLorebookEntryConfirmModal
		open={true}
		title={deleteCopy.title}
		message={deleteCopy.message}
		onOpenChange={(e) => {
			if (!e.open) deleteAsk = null
		}}
		onConfirm={() => void confirmDelete()}
		onCancel={() => (deleteAsk = null)}
	/>
{/if}

{#if markAsk}
	<KnowledgeMarkConfirm
		open={true}
		title={markCopy.title}
		message={markCopy.message}
		onOpenChange={(e) => {
			if (!e.open) markAsk = null
		}}
		onConfirm={confirmMark}
		onCancel={() => (markAsk = null)}
	/>
{/if}

{#if moveAsk}
	<MoveDownTheTreeDialog
		open={true}
		{lorebookId}
		entryIds={ids}
		prefer={movePrefer}
		dirty={moveDirty}
		onClose={() => (moveAsk = null)}
		onMoved={moved}
	/>
{/if}
