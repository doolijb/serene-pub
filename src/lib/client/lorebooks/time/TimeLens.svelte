<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import ResizableSplit from "$lib/client/components/panels/ResizableSplit.svelte"
	import { LORE_SPLIT_KEY } from "../layoutMode"
	import { onDestroy } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { toaster } from "$lib/client/utils/toaster"
	import { awaitReply, isReplyTimeout } from "$lib/client/utils/awaitReply"
	import { toastUnsaved } from "$lib/client/utils/toastUnsaved"
	import { changedFields } from "$lib/shared/lorebooks/amendments"
	import CompileHistoryEntryModal from "$lib/client/components/modals/CompileHistoryEntryModal.svelte"
	import type { BindingWithRelations } from "$lib/client/components/lorebookForms/entryManager"
	import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
	import { castMembers } from "../castPool"
	import { loreRoute } from "../loreRoute.svelte"
	import { getBookData } from "../bookData.svelte"
	import { lensEmptyMessage } from "../lenses/registry"
	import { descriptorForKind, draftStale } from "../sections"
	import {
		compareDates,
		dateValue,
		formatDate,
		type StoryDate
	} from "../sections/historyDates"
	import type { PoolSource } from "../sections/types"
	import {
		buildTicks,
		ratioAlongTrack,
		ratioOf,
		trackInsetPx
	} from "../timelineStrip"
	import DatedEntryPanel from "./DatedEntryPanel.svelte"
	import { dateAtRatio, parseMoment } from "./moment"
	import { findGaps } from "./timeGaps"
	import {
		buildLanes,
		dropOffer,
		isDatable,
		isDated,
		storyItems,
		timeListGroups,
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
		/**
		 * The scope's entries on the line being read (#88): World lore under
		 * World, Location entries under Places, every pool kind under All.
		 * Search and the pool's facet chips narrow the pool, not the line.
		 */
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

	/**
	 * The book's cast — the workspace's copy (plan B4: this lens asked for
	 * its own on mount). Held as state so the entry panel's binding picker
	 * can write to it, and re-read whenever the workspace's moves.
	 */
	const book = getBookData()
	let bindings = $state<BindingWithRelations[]>([])
	$effect(() => {
		bindings = [...book.cast]
	})
	let creating = $state(false)
	let draft = $state<Record<string, any> | null>(null)
	/** Which row the draft belongs to, so a re-render does not discard edits. */
	let draftKey = $state<string | null>(null)
	/**
	 * A date a drop asked for, and the entry it was dropped FOR — held until
	 * that entry's draft exists, and written to no other (plan B7: a bare
	 * date was written to whatever draft was open, and a stale one re-dated
	 * the next entry opened).
	 */
	let pendingDate = $state<{ entryId: number; date: StoryDate } | null>(null)
	let compileTarget = $state<PoolSource | null>(null)
	let compileOpen = $state(false)
	let showAllUndated = $state(false)
	/** The undated row being dragged, so the line knows what it is offered. */
	let dragged = $state<TimeEntryRow | null>(null)
	/**
	 * The draft as it was BUILT, which is what a save diffs against.
	 *
	 * ⚠ The line draws rows as they READ — amendments resolved in — so the
	 * draft holds amended values too. Writing it whole baked every one of
	 * them into the base; a save writes `changedFields(draft, pristineDraft)`.
	 */
	let pristineDraft = $state<Record<string, any> | null>(null)
	/** A write of ours is in flight; Save stands down until it is answered. */
	let saving = $state(false)

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
	let listGroups = $derived(timeListGroups(items))
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

	/**
	 * The entry the address names, when it names one this lens can edit: a
	 * row of a kind with date fields, dated or not yet — an undated row
	 * dropped onto the line opens here to take its date (plan B7).
	 */
	let selected = $derived(
		route.entryId != null
			? (entries.find(
					(row) => row.id === route.entryId && isDatable(row)
				) ?? null)
			: null
	)
	let selectedKey = $derived(
		creating ? "new" : selected ? `entry#${selected.id}` : null
	)
	let selectedItem = $derived(
		selected ? items.find((i) => i.key === `entry#${selected.id}`) : null
	)

	/**
	 * Whether the AUTHOR changed anything — against the draft as built, not
	 * the row as it reads now, which moves on its own when an amendment lands
	 * or the moment is dragged.
	 */
	let dirty = $derived.by(() => {
		if (!draft) return false
		if (creating) return !!draft.content?.trim()
		if (!selected || !pristineDraft) return false
		return (
			JSON.stringify(pristineDraft) !==
			JSON.stringify($state.snapshot(draft))
		)
	})

	/** The dated entries newest first, which is the order a run reaches them in. */
	let byRecency = $derived(
		[...dated].sort((a, b) => compareDates(b as StoryDate, a as StoryDate))
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
		draft = null
		draftKey = null
		pristineDraft = null
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
		pristineDraft = { ...$state.snapshot(draft) }
	}

	async function closePanel() {
		if (!(await loreRoute.confirmLeave())) return
		const wasCreating = creating
		discardDraft()
		if (!wasCreating) void loreRoute.navigate({ type: "back" })
	}

	/** A reply that never came is said here; a refusal Layout already toasts. */
	function reportUnanswered(err: unknown, title: string) {
		if (isReplyTimeout(err))
			toaster.error({
				title,
				description:
					"The server did not answer in time. Your changes are still here."
			})
	}

	const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "")

	async function save() {
		if (!draft || saving) return
		if (!descriptor.validate(draft, dated as PoolSource[], true)) return
		const payload = $state.snapshot(draft) as Record<string, any>
		if (creating) {
			// ⚠ An entry created while reading a line belongs to that line,
			// as the entry editor's create does.
			if (route.branch != null) payload.branchId = route.branch
			saving = true
			// The draft stays until the row exists: a refusal must not throw
			// the author's text away.
			let created: Sockets.Entries.Create.Response
			try {
				created = await awaitReply({
					socket,
					event: "entries:create",
					params: {
						entry: {
							...payload,
							typeId: HISTORY_TYPE_ID,
							lorebookId
						} as any
					},
					replyKey: interestKey("entries:create", lorebookId),
					errorEvent: "entries:create:error",
					fallbackError: "The history entry could not be created.",
					match: (data) =>
						data.entry?.lorebookId === lorebookId &&
						data.entry.typeId === HISTORY_TYPE_ID &&
						trimmed(data.entry.content) === trimmed(payload.content)
				})
			} catch (err) {
				saving = false
				toastUnsaved(err, "History was not created")
				return
			}
			saving = false
			toaster.success({ title: "History created" })
			// Opened where it landed on the line — unless the author has
			// since moved on to something else.
			if (!creating || draftKey !== "new") return
			discardDraft()
			void loreRoute.navigate({
				type: "openEntry",
				entryId: created.entry.id
			})
			return
		}
		// ⚠ The DIFF, never the whole draft (see `pristineDraft`).
		const fields = changedFields(payload, pristineDraft ?? {})
		if (!Object.keys(fields).length) {
			toaster.error({ title: "Nothing has changed" })
			return
		}
		const id = payload.id as number
		saving = true
		let saved: Sockets.Entries.Update.Response
		try {
			saved = await awaitReply({
				socket,
				event: "entries:update",
				params: {
					entry: { ...fields, id, typeId: HISTORY_TYPE_ID } as any
				},
				replyKey: interestKey("entries:update", lorebookId),
				errorEvent: "entries:update:error",
				fallbackError: "The history entry could not be saved.",
				match: (data) => data.entry?.id === id
			})
		} catch (err) {
			saving = false
			reportUnanswered(err, "History was not saved")
			return
		}
		saving = false
		toaster.success({ title: "History updated" })
		// Settle the draft on what was sent — the saved text is now "as
		// built" — keeping anything typed while the save was in flight.
		if (draftKey === `entry#${id}` && draft) {
			if (
				JSON.stringify($state.snapshot(draft)) ===
				JSON.stringify(payload)
			) {
				draft = descriptor.toDraft(saved.entry as PoolSource)
				pristineDraft = { ...$state.snapshot(draft) }
			} else pristineDraft = { ...payload }
		}
	}

	/**
	 * Where along the line a pointer is, as a fraction of the part the ticks
	 * are drawn on — inset half a rem each side, as the ticks are (plan B7).
	 */
	function ratioFromEvent(
		event: { clientX: number },
		el: HTMLElement
	): number | null {
		return ratioAlongTrack(
			event.clientX,
			el.getBoundingClientRect(),
			trackInsetPx()
		)
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
			// Dropped onto the entry already open: its own draft takes the
			// date, and nothing is left to ask about.
			if (draft && !creating && draftKey === `entry#${row.id}`) {
				writeDate(draft, date)
				return
			}
			// ⚠ Ask FIRST, and only then hold the date: held before the
			// answer, the draft effect wrote it into the draft being left —
			// even when the answer was Cancel.
			if (!(await loreRoute.confirmLeave())) return
			discardDraft()
			pendingDate = { entryId: row.id, date }
			void loreRoute.navigate({ type: "openEntry", entryId: row.id })
			return
		}
		await startCreate(date, (row.name ?? "").trim())
	}

	/** The end of the line, which is where a keyboard drop lands. */
	function lastDate(): StoryDate | null {
		return ticks.length ? dateAtRatio(ticks, 1) : null
	}

	function writeDate(target: Record<string, any>, date: StoryDate) {
		target.year = date.year
		target.month = date.month ?? null
		target.day = date.day ?? null
	}

	/** The held date, into the draft of the entry it was dropped for only. */
	function applyPendingDate() {
		const held = pendingDate
		if (!held || !draft || draftKey !== `entry#${held.entryId}`) return
		writeDate(draft, held.date)
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
			if (!creating) {
				draft = source ? descriptor.toDraft(source as PoolSource) : null
				pristineDraft = draft ? { ...$state.snapshot(draft) } : null
			}
		}
		// Only into the dropped entry's own draft (`applyPendingDate`); any
		// other move clears it (`discardDraft`).
		if (pendingDate && draft) applyPendingDate()
	})

	/**
	 * A clean draft follows the row it shows when the row moves under it —
	 * an amendment lands, the moment is dragged. Edits in flight are never
	 * discarded to follow a reading.
	 */
	$effect(() => {
		if (creating || !selected || !draft || !pristineDraft || dirty) return
		const fresh = descriptor.toDraft(selected as PoolSource)
		if (JSON.stringify(fresh) === JSON.stringify(pristineDraft)) return
		draft = fresh
		pristineDraft = { ...$state.snapshot(fresh) }
	})

	$effect(() => {
		hasUnsavedChanges = dirty
	})

	onDestroy(() => {
		hasUnsavedChanges = false
	})
</script>

{#snippet itemRow(item: TimeItem)}
	{#if item.kind === "session"}
		<!-- The session sits at now and opens nothing here, so it reads as a
		     static row: no button, no hover, no pointer (note 4). -->
		<div
			class="text-surface-700-300 flex w-full items-center gap-2 px-2 py-1 text-sm"
			data-lore-time-item={item.key}
		>
			<span class="text-surface-600-400 w-16 shrink-0 text-xs">
				{kindLabelOf(item)}
			</span>
			<span class="min-w-0 flex-1 truncate italic">{item.label}</span>
			{#if item.note}
				<span class="shrink-0 text-xs">{item.note}</span>
			{/if}
			<span class="text-surface-600-400 shrink-0 text-xs">
				{dateLabelOf(item)}
			</span>
		</div>
	{:else}
		<button
			type="button"
			class="hover:bg-surface-200-800 focus-visible:ring-primary-500 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none {selectedKey ===
			item.key
				? 'preset-tonal-primary'
				: ''}"
			aria-current={selectedKey === item.key ? "true" : undefined}
			data-lore-time-item={item.key}
			onclick={() => openItem(item)}
		>
			<span class="text-surface-600-400 w-16 shrink-0 text-xs">
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
			<Icons.ChevronRight
				size={14}
				class="text-surface-600-400 shrink-0"
				aria-hidden="true"
			/>
		</button>
	{/if}
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
				class="btn btn-sm preset-filled-primary-500 shrink-0"
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
				{lensEmptyMessage("time")}
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
							class="panel-edge relative h-6 min-w-0 flex-1 rounded border-b"
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
									class="text-surface-700-300 absolute top-1/2 left-2 -translate-y-1/2 text-[11px] italic"
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
					class="panel-edge flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs"
					data-lore-time-gap
				>
					<Icons.MoveHorizontal
						size={14}
						class="text-surface-600-400 shrink-0"
						aria-hidden="true"
					/>
					<!-- No "mark as intentional" control until a book can keep a
					     dismissed-gap list: a button that can never be pressed is a
					     promise the lens cannot keep. -->
					<span class="min-w-0 flex-1">{gap.sentence}</span>
				</div>
			{/each}

			<!-- A history entry's scenes nest under it, tabbed in on a guide,
			     rather than standing between it and the next row (note 4). -->
			<ul class="flex flex-col gap-0.5" data-lore-time-list>
				{#each listGroups as group (group.item.key)}
					<li>
						{@render itemRow(group.item)}
						{#if group.children.length}
							<ul
								class="panel-edge mt-0.5 ml-5 flex flex-col gap-0.5 border-l pl-2"
								aria-label="Scenes in {group.item.label}"
								data-lore-time-scenes={group.item.key}
							>
								{#each group.children as child (child.key)}
									<li>{@render itemRow(child)}</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if undated.length > 0}
			<div class="panel-inset flex flex-col gap-2">
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
				(selected && isDated(selected)
					? formatDate(selected as StoryDate)
					: (selected?.name ?? "").trim() || "Not dated yet")}
			readIn={selected ? readInOf(selected.id) : null}
			{dirty}
			canSave={!saving &&
				descriptor.validate(draft, dated as PoolSource[])}
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
		<!-- The same divider and the same remembered share as Entries. -->
		<ResizableSplit storageKey={LORE_SPLIT_KEY} firstId="loreSplitTime">
			{#snippet first()}
				{@render line()}
			{/snippet}
			{#snippet second()}
				<div
					class="panel-card flex min-h-0 min-w-0 flex-1 flex-col p-3"
					data-lore-editor
				>
					{@render panel()}
				</div>
			{/snippet}
		</ResizableSplit>
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
		moment={parseMoment(route.moment)}
		branchId={route.branch ?? null}
	/>
{/if}
