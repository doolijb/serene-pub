<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onDestroy, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { toaster } from "$lib/client/utils/toaster"
	import CompileHistoryEntryModal from "$lib/client/components/modals/CompileHistoryEntryModal.svelte"
	import type { BindingWithRelations } from "$lib/client/components/lorebookForms/entryManager"
	import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
	import { castMembers } from "../castPool"
	import { loreRoute } from "../loreRoute.svelte"
	import { descriptorForKind, draftStale } from "../sections"
	import {
		dateValue,
		formatDate,
		type StoryDate
	} from "../sections/historyDates"
	import type { PoolSource } from "../sections/types"
	import { buildTicks, ratioOf } from "../timelineStrip"
	import DatedEntryPanel from "./DatedEntryPanel.svelte"
	import { dateAtRatio } from "./moment"
	import { findGaps } from "./timeGaps"
	import {
		buildLanes,
		dropOffer,
		isDated,
		storyItems,
		timeHeaderLine,
		undatedEntries,
		undatedLine,
		type TimeEntryRow,
		type TimeItem,
		type TimeSceneRow,
		type TimeSessionRow
	} from "./storyTime"
	import type { EntryDecisions } from "../markers"

	/**
	 * The time lens: the book on story time.
	 *
	 * One line, and a lane for the story, for each person standing on it and
	 * for the world. What sits where is `storyTime`'s arithmetic; this draws
	 * it, and owns the one editor the line has — a dated entry, which is the
	 * only kind of row with date fields to write.
	 *
	 * ⚠ Reading as of a moment is the bar's, not this lens's: the line always
	 * draws the whole story, because a line that hides its own end is not a
	 * line.
	 */
	interface Props {
		lorebookId: number
		/** What the scope this line is of is called. */
		scopeTitle: string
		mode: "desk" | "compact"
		/** Every entry the book holds, whatever kind. */
		entries: TimeEntryRow[]
		scenes: TimeSceneRow[]
		/** The session reading this book, which stands at now. */
		session: TimeSessionRow | null
		/** The newest run's decisions, for the entry's Read in line. */
		decisions: EntryDecisions | null
		hasUnsavedChanges: boolean
	}

	let {
		lorebookId,
		scopeTitle,
		mode,
		entries,
		scenes,
		session,
		decisions,
		hasUnsavedChanges = $bindable(false)
	}: Props = $props()

	const socket = useTypedSocket()
	const descriptor = descriptorForKind(HISTORY_TYPE_ID)!

	let bindings = $state<BindingWithRelations[]>([])
	let creating = $state(false)
	let draft = $state<Record<string, any> | null>(null)
	/** Which row the draft belongs to, so a re-render does not discard edits. */
	let draftKey = $state<string | null>(null)
	/** A date a drop asked for, held until there is a draft to write it to. */
	let pendingDate = $state<StoryDate | null>(null)
	let compileTarget = $state<PoolSource | null>(null)
	let compileOpen = $state(false)
	let showAllUndated = $state(false)
	/** The undated row being dragged, so the line knows what it is offered. */
	let dragged = $state<TimeEntryRow | null>(null)
	/** Whether a create of ours is in flight, so another one is not ours. */
	let awaitingCreate = $state(false)

	let route = $derived(loreRoute.route)

	let dated = $derived(entries.filter(isDated))
	let datedRows = $derived(
		dated.map((row) => ({
			id: row.id,
			year: row.year as number,
			month: row.month ?? null,
			day: row.day ?? null
		}))
	)
	let ticks = $derived(buildTicks(datedRows))
	let items = $derived(storyItems({ entries, scenes, session }))
	let cast = $derived(
		castMembers(bindings as any).map((m) => ({ id: m.id, name: m.name }))
	)
	let lanes = $derived(buildLanes(items, cast))
	let gaps = $derived(findGaps(datedRows))
	let scenesOnLine = $derived(items.filter((i) => i.kind === "scene").length)
	let headerLine = $derived(
		timeHeaderLine({
			dated: dated.length,
			scenes: scenesOnLine,
			gaps: gaps.length
		})
	)
	let undated = $derived(undatedEntries(entries))
	let shownUndated = $derived(showAllUndated ? undated : undated.slice(0, 15))

	let scenesByEntry = $derived.by(() => {
		const map = new Map<number, TimeSceneRow[]>()
		for (const scene of scenes) {
			const list = map.get(scene.historyEntryId) ?? []
			list.push(scene)
			map.set(scene.historyEntryId, list)
		}
		return map
	})

	let bindingNameById = $derived.by(() => {
		const map = new Map<number, string>()
		for (const member of castMembers(bindings as any))
			map.set(member.id, member.name)
		return map
	})

	/** The dated entry the address names, when it names one. */
	let selected = $derived(
		route.entryId != null
			? (dated.find((row) => row.id === route.entryId) ?? null)
			: null
	)
	let selectedKey = $derived(
		creating ? "new" : selected ? `entry#${selected.id}` : null
	)
	let selectedItem = $derived(
		selected ? items.find((i) => i.key === `entry#${selected.id}`) : null
	)

	let dirty = $derived.by(() => {
		if (!draft) return false
		if (creating) return !!draft.content?.trim()
		if (!selected) return false
		return (
			JSON.stringify(descriptor.toDraft(selected as PoolSource)) !==
			JSON.stringify($state.snapshot(draft))
		)
	})

	/** The dated entries newest first, which is the order a run reaches them in. */
	let byRecency = $derived(
		[...dated].sort(
			(a, b) => dateValue(b as StoryDate) - dateValue(a as StoryDate)
		)
	)

	function readInOf(id: number): { rank: number; total: number } | null {
		if (decisions?.[id] !== "fired") return null
		const rank = byRecency.findIndex((row) => row.id === id) + 1
		return rank ? { rank, total: dated.length } : null
	}

	function laneRatio(item: TimeItem): number {
		return ratioOf(ticks, item.value)
	}

	function kindLabelOf(item: TimeItem): string {
		switch (item.kind) {
			case "history":
				return "History"
			case "scene":
				return "Scene"
			case "world":
				return "World"
			case "session":
				return "Session"
		}
	}

	function dateLabelOf(item: TimeItem): string {
		return item.date ? formatDate(item.date) : "now"
	}

	async function openItem(item: TimeItem) {
		if (item.kind === "session") return
		if (!(await loreRoute.confirmLeave())) return
		discardDraft()
		if (item.kind === "scene") {
			const scene = scenes.find((s) => s.id === item.id)
			if (!scene) return
			void loreRoute.navigate({
				type: "openEntry",
				entryId: scene.historyEntryId,
				sceneId: scene.id
			})
			return
		}
		void loreRoute.navigate({ type: "openEntry", entryId: item.id })
	}

	function discardDraft() {
		creating = false
		awaitingCreate = false
		draft = null
		draftKey = null
		pendingDate = null
		hasUnsavedChanges = false
	}

	async function startCreate(date?: StoryDate, content = "") {
		if (!(await loreRoute.confirmLeave())) return
		discardDraft()
		creating = true
		draftKey = "new"
		draft = {
			...descriptor.newDraft(lorebookId),
			...(date ?? {}),
			content
		}
	}

	async function closePanel() {
		if (!(await loreRoute.confirmLeave())) return
		const wasCreating = creating
		discardDraft()
		if (!wasCreating) void loreRoute.navigate({ type: "back" })
	}

	function save() {
		if (!draft) return
		if (!descriptor.validate(draft, dated as PoolSource[], true)) return
		const payload = $state.snapshot(draft) as Record<string, any>
		if (creating) {
			socket.emit("entries:create", {
				entry: {
					...payload,
					typeId: HISTORY_TYPE_ID,
					lorebookId
				} as any
			})
			toaster.success({ title: "History created" })
			discardDraft()
			// Set after the draft is dropped, because dropping it is what
			// clears the last create this lens was waiting on.
			awaitingCreate = true
			return
		}
		socket.emit("entries:update", {
			entry: { ...payload, typeId: HISTORY_TYPE_ID } as any
		})
		toaster.success({ title: "History updated" })
	}

	/** Where along the line a pointer is, as a fraction of the track. */
	function ratioFromEvent(
		event: { clientX: number },
		el: HTMLElement
	): number | null {
		const rect = el.getBoundingClientRect()
		if (rect.width === 0) return null
		return (event.clientX - rect.left) / rect.width
	}

	async function dropOnLine(event: DragEvent) {
		event.preventDefault()
		const row = dragged
		dragged = null
		if (!row) return
		const ratio = ratioFromEvent(event, event.currentTarget as HTMLElement)
		const date = ratio === null ? null : dateAtRatio(ticks, ratio)
		if (!date) {
			toaster.error({
				title: "Nothing is dated yet",
				description:
					"Date an entry first, and the line has somewhere to drop onto."
			})
			return
		}
		await offerDate(row, date)
	}

	/**
	 * What a drop does with the row it was handed.
	 *
	 * A kind with date fields is dated; every other kind is offered a dated
	 * entry about it, because dating a row whose kind carries no date would be
	 * writing a field that does not exist.
	 */
	async function offerDate(row: TimeEntryRow, date: StoryDate) {
		if (dropOffer(row) === "date") {
			pendingDate = date
			if (!(await loreRoute.confirmLeave())) return
			if (route.entryId === row.id) applyPendingDate()
			else void loreRoute.navigate({ type: "openEntry", entryId: row.id })
			return
		}
		await startCreate(date, (row.name ?? "").trim())
	}

	/** The end of the line, which is where a keyboard drop lands. */
	function lastDate(): StoryDate | null {
		return ticks.length ? dateAtRatio(ticks, 1) : null
	}

	function applyPendingDate() {
		if (!pendingDate || !draft) return
		draft.year = pendingDate.year
		draft.month = pendingDate.month ?? null
		draft.day = pendingDate.day ?? null
		pendingDate = null
	}

	function recompile() {
		if (!selected) return
		compileTarget = selected as PoolSource
		compileOpen = true
	}

	function openScene(sceneId: number) {
		if (!selected) return
		void loreRoute.navigate({
			type: "openEntry",
			scope: "scenes",
			entryId: selected.id,
			sceneId
		})
	}

	// The draft follows the address, and `draftStale` is the whole of when it
	// is rebuilt. A date a drop asked for is written once there is a draft to
	// write it to, which is what makes a drop onto another row's position work.
	$effect(() => {
		const key = selectedKey
		const source = creating ? undefined : (selected ?? undefined)
		if (
			draftStale({
				key,
				draftKey,
				hasDraft: draft !== null,
				hasSource: !!source
			})
		) {
			draftKey = key
			if (!creating)
				draft = source ? descriptor.toDraft(source as PoolSource) : null
		}
		if (pendingDate && draft) applyPendingDate()
	})

	$effect(() => {
		hasUnsavedChanges = dirty
	})

	// Named so `off` can name them too: a bare off() removes every listener for
	// the event, including any other open lorebooks UI.
	function handleBindingList(msg: Sockets.Lorebooks.BindingList.Response) {
		if (msg.lorebookId !== lorebookId) return
		bindings = msg.lorebookBindingList as BindingWithRelations[]
	}

	/** A dated entry this lens wrote opens where it landed on the line. */
	function handleEntryCreated(msg: Sockets.Entries.Create.Response) {
		const entry = msg.entry
		if (
			!awaitingCreate ||
			!entry ||
			entry.lorebookId !== lorebookId ||
			entry.typeId !== HISTORY_TYPE_ID
		)
			return
		awaitingCreate = false
		void loreRoute.navigate({ type: "openEntry", entryId: entry.id })
	}

	onMount(() => {
		socket.on("lorebooks:bindingList", handleBindingList)
		socket.on("entries:create", handleEntryCreated)
		socket.emit("lorebooks:bindingList", { lorebookId })
	})

	onDestroy(() => {
		hasUnsavedChanges = false
		socket.off("lorebooks:bindingList", handleBindingList)
		socket.off("entries:create", handleEntryCreated)
	})
</script>

{#snippet itemRow(item: TimeItem)}
	<button
		type="button"
		class="hover:preset-tonal-surface flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm {selectedKey ===
		item.key
			? 'preset-tonal-primary'
			: ''}"
		disabled={item.kind === "session"}
		data-lore-time-item={item.key}
		onclick={() => openItem(item)}
	>
		<span
			class="text-surface-700-300 w-16 shrink-0 text-[10px] tracking-wide uppercase"
		>
			{kindLabelOf(item)}
		</span>
		<span class="min-w-0 flex-1 truncate">{item.label}</span>
		{#if item.note}
			<span class="text-surface-700-300 shrink-0 text-xs">
				{item.note}
			</span>
		{/if}
		<span class="text-surface-600-400 shrink-0 text-xs">
			{dateLabelOf(item)}
		</span>
	</button>
{/snippet}

{#snippet line()}
	<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
		<div class="flex flex-wrap items-center gap-2">
			<h2 class="min-w-0 flex-1 text-sm font-semibold">
				{scopeTitle}, on story time
			</h2>
			<span
				class="chip preset-tonal-surface shrink-0 text-xs"
				title="The line is always in story order"
			>
				Story order
			</span>
			<button
				type="button"
				class="btn btn-sm preset-filled-success-500 shrink-0"
				title="A new entry on the line carries a date"
				onclick={() => startCreate()}
			>
				<Icons.Plus size={14} aria-hidden="true" />
				New entry
			</button>
		</div>
		<p class="text-surface-700-300 text-xs" data-lore-time-summary>
			{headerLine}
		</p>

		{#if ticks.length === 0}
			<p class="text-surface-700-300 p-6 text-center text-sm italic">
				Nothing is dated yet. Add a dated entry and it becomes a point
				on this line.
			</p>
		{:else}
			<!-- The axis, which is also where a drop lands. -->
			<div class="flex items-center gap-2">
				<span
					class="text-surface-700-300 w-20 shrink-0 text-xs"
					id="loreTimeAxisLabel"
				>
					Story line
				</span>
				<div
					class="bg-surface-200-800 relative h-8 min-w-0 flex-1 rounded-lg"
					role="group"
					aria-labelledby="loreTimeAxisLabel"
					data-lore-time-axis
					ondragover={(e) => e.preventDefault()}
					ondrop={dropOnLine}
				>
					<div
						class="bg-surface-400-600 absolute top-1/2 right-2 left-2 h-px"
						aria-hidden="true"
					></div>
					{#each ticks as tick (tick.id)}
						<span
							class="bg-surface-500 absolute top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2"
							style="left: calc(0.5rem + {tick.ratio} * (100% - 1rem))"
							title={tick.label}
							aria-hidden="true"
						></span>
					{/each}
				</div>
				<span class="text-surface-700-300 shrink-0 text-xs">now</span>
			</div>

			<ul class="flex flex-col gap-1" data-lore-time-lanes>
				{#each lanes as lane (lane.id)}
					<li class="flex items-center gap-2">
						<span
							class="text-surface-700-300 w-20 shrink-0 truncate text-xs"
							title={lane.label}
						>
							{lane.label}
						</span>
						<div
							class="border-border relative h-6 min-w-0 flex-1 rounded border-b"
							data-lore-time-lane={lane.id}
						>
							{#each lane.items as item (item.key)}
								<button
									type="button"
									class="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full {item.kind ===
									'scene'
										? 'bg-secondary-500'
										: item.kind === 'session'
											? 'bg-tertiary-500'
											: 'bg-primary-500'}"
									style="left: calc(0.5rem + {laneRatio(
										item
									)} * (100% - 1rem))"
									title="{kindLabelOf(
										item
									)} · {item.label} · {dateLabelOf(item)}"
									aria-label="{kindLabelOf(
										item
									)} · {item.label} · {dateLabelOf(item)}"
									onclick={() => openItem(item)}
								></button>
							{/each}
							{#if lane.items.length === 0}
								<span
									class="text-surface-700-300 absolute top-1/2 left-2 -translate-y-1/2 text-[10px] italic"
								>
									Nothing dated on this lane yet
								</span>
							{/if}
						</div>
					</li>
				{/each}
			</ul>

			{#each gaps as gap (gap.sentence)}
				<div
					class="border-border flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs"
					data-lore-time-gap
				>
					<Icons.MoveHorizontal
						size={14}
						class="text-surface-600-400 shrink-0"
						aria-hidden="true"
					/>
					<span class="min-w-0 flex-1">{gap.sentence}</span>
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface shrink-0"
						disabled
						title="Marking a gap as intentional is not built yet"
					>
						Mark the gap as intentional
					</button>
				</div>
			{/each}

			<ul class="flex flex-col gap-0.5" data-lore-time-list>
				{#each items as item (item.key)}
					<li>{@render itemRow(item)}</li>
				{/each}
			</ul>
		{/if}

		{#if undated.length > 0}
			<div class="border-border flex flex-col gap-2 border-t pt-3">
				<span class="text-sm font-semibold">Not on the line</span>
				<p class="text-surface-700-300 text-xs">
					{undatedLine(undated.length)}
				</p>
				<ul class="flex flex-wrap gap-1">
					{#each shownUndated as row (row.id)}
						{@const label = row.name || "Untitled"}
						{@const offer =
							dropOffer(row) === "date"
								? `Drag ${label} onto the line, or press to date it at the end of it`
								: `Drag ${label} onto the line, or press to add a dated history entry about this`}
						<li>
							<!-- The chip is the control and the handle at once: a
							     drag is the gesture, and pressing it does the same
							     thing at the end of the line for a reader who has
							     no pointer. -->
							<button
								type="button"
								class="chip preset-tonal-surface flex items-center gap-1 text-xs"
								draggable="true"
								title={offer}
								aria-label={offer}
								data-lore-undated={row.id}
								ondragstart={() => (dragged = row)}
								ondragend={() => (dragged = null)}
								onclick={() => {
									const date = lastDate()
									if (!date) {
										void startCreate(
											undefined,
											(row.name ?? "").trim()
										)
										return
									}
									void offerDate(row, date)
								}}
							>
								<Icons.GripVertical
									size={11}
									class="text-surface-600-400 shrink-0"
									aria-hidden="true"
								/>
								<span class="max-w-40 truncate">{label}</span>
								<Icons.CalendarPlus
									size={12}
									class="shrink-0"
									aria-hidden="true"
								/>
							</button>
						</li>
					{/each}
				</ul>
				{#if undated.length > shownUndated.length}
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface self-start"
						onclick={() => (showAllUndated = true)}
					>
						+ {undated.length - shownUndated.length} more
					</button>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet panel()}
	{#if draft}
		<DatedEntryPanel
			source={(selected as PoolSource) ?? null}
			isNew={creating}
			bind:draft
			bind:bindings
			siblings={dated as PoolSource[]}
			scenes={selected ? (scenesByEntry.get(selected.id) ?? []) : []}
			present={selectedItem?.present ?? []}
			castName={(id) => bindingNameById.get(id) ?? `#${id}`}
			title={selectedItem?.label ??
				(selected ? formatDate(selected as StoryDate) : "")}
			readIn={selected ? readInOf(selected.id) : null}
			{dirty}
			canSave={descriptor.validate(draft, dated as PoolSource[])}
			onSave={save}
			onClose={closePanel}
			onRecompile={recompile}
			onOpenScene={openScene}
		/>
	{:else}
		<p
			class="text-surface-700-300 flex flex-1 items-center justify-center p-6 text-center text-sm italic"
		>
			Pick a dated entry to edit it, or press New entry.
		</p>
	{/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col" data-lore-lens="time">
	{#if mode === "desk"}
		<div class="flex min-h-0 flex-1 gap-4">
			<div class="flex min-h-0 min-w-0 flex-1 flex-col">
				{@render line()}
			</div>
			<div
				class="border-border flex min-h-0 w-[420px] shrink-0 flex-col border-l pl-4"
				data-lore-editor
			>
				{@render panel()}
			</div>
		</div>
	{:else if draft}
		<div class="flex min-h-0 flex-1 flex-col" data-lore-editor>
			{@render panel()}
		</div>
	{:else}
		{@render line()}
	{/if}
</div>

{#if compileTarget}
	<CompileHistoryEntryModal
		open={compileOpen}
		onOpenChange={(e) => {
			compileOpen = e.open
			if (!e.open) compileTarget = null
		}}
		historyEntry={compileTarget as any}
		onSaved={() => (compileOpen = false)}
	/>
{/if}
