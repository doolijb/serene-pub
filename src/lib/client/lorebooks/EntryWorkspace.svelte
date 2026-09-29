<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { embeddingsStarred } from "$lib/shared/constants/embeddings"
	import { getContext, onDestroy, onMount } from "svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { rowsOnLine } from "$lib/shared/lorebooks/amendments"
	import { toaster } from "$lib/client/utils/toaster"
	import CompileHistoryEntryModal from "$lib/client/components/modals/CompileHistoryEntryModal.svelte"
	import DeleteLorebookEntryConfirmModal from "$lib/client/components/modals/DeleteLorebookEntryConfirmModal.svelte"
	import ProcessSceneModal from "$lib/client/components/modals/ProcessSceneModal.svelte"
	import {
		entryChannel,
		type BindingWithRelations
	} from "$lib/client/components/lorebookForms/entryManager"
	import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
	import EntryPool from "./EntryPool.svelte"
	import ReadInLine from "./editor/ReadInLine.svelte"
	import {
		canFileUnder,
		deleteWarning,
		descendantCount
	} from "./editor/partOf"
	import {
		fileEntryAmendments,
		lineName,
		maskedBaseWarning,
		maskedFields,
		maskingAmendment
	} from "./editor/entrySave"
	import { awaitReply, isReplyTimeout } from "$lib/client/utils/awaitReply"
	import type { RefLink } from "./editor/refs"
	import { retrievalReadout } from "./editor/retrievalReadout.svelte"
	import { loreRoute } from "./loreRoute.svelte"
	import { compactStep, type LoreLens } from "$lib/shared/lorebooks/loreRoute"
	import {
		comparePoolBy,
		filterPool,
		SCENE_KIND,
		type PoolFilters,
		type PoolItem
	} from "./poolFilter"
	import {
		CAST_KIND,
		DEFAULT_POOL_SORT,
		facetCounts,
		poolSummary
	} from "./scopes"
	import {
		descriptorForKind,
		doorForKey,
		draftStale,
		editorPlaceholder
	} from "./sections"
	import EntryInspector from "./sections/EntryInspector.svelte"
	import { kindLabel } from "./sections/kinds"
	import { setLorePoolCtx } from "./sections/poolContext"
	import type { EntryDecisions } from "./markers"
	import type { PoolSource, SectionDescriptor } from "./sections/types"
	import { compareDates, dateValue } from "./sections/historyDates"
	import { formatDate } from "./sections/historyDates"
	import { parseMoment } from "./time/moment"
	import AmendmentList from "./time/AmendmentList.svelte"
	import {
		changedFields,
		offWindowAmendments,
		offWindowProblem
	} from "$lib/shared/lorebooks/amendments"
	import { timelineCursor } from "./timelineCursor.svelte"
	import { keysAfter, orderByMoment } from "./timelineStrip"

	/**
	 * One list, one editor, one guard — for every door.
	 *
	 * The section decides what the pool is preset to and which curated row and
	 * editor each row gets; everything else exists once here: the socket
	 * conversation, the draft, the delete flow, the modals the scene and
	 * compile flows open, and the single answer to "are there unsaved
	 * changes?". Which layout is drawn comes from the frame's measured width,
	 * never from a fullscreen flag.
	 */
	interface Props {
		lorebookId: number
		/** The door the route is at. */
		descriptor: SectionDescriptor
		/** Every door the pool draws, for the chips. */
		doors: SectionDescriptor[]
		/**
		 * Every row the BOOK holds, which is a different list from the one on
		 * screen.
		 *
		 * ⚠ Filing crosses kinds and the open scope does not: a parent, a
		 * reference and a delete's cascade are facts about the book, so each is
		 * resolved against this and never against the narrowed pool the reader
		 * happens to be standing in.
		 */
		bookPool: PoolItem[]
		/**
		 * The book's dated overlays, as a function over rows.
		 *
		 * This scope keeps its own copy of the rows, so it cannot read the
		 * workspace's resolved ones — it is handed the resolver instead. The
		 * moment and the branch are decided there, once.
		 */
		resolve?: (rows: readonly PoolSource[]) => PoolSource[]
		/** This book's overlays, sliced to one entry. Empty until A3b lands one. */
		amendmentsFor?: (entryId: number) => Sockets.Amendments.EntryRow[]
		/**
		 * The book's typed edges, which are the half of the Refs board no text
		 * scan can find. Empty until the graph read lands, never guessed at.
		 */
		bookLinks: RefLink[]
		mode: "desk" | "compact"
		hasUnsavedChanges: boolean
		/** Which of the three reading lenses draws the list. */
		lens: LoreLens
		/** What the scope this list is of is called. */
		scopeTitle: string
		/** The facets in force, held by the frame so the rail can set them. */
		filters: PoolFilters
		/**
		 * What the attached session's newest run read in, by pool key. Null
		 * when no session reads this book, which is a different fact from a
		 * run that read nothing.
		 */
		readInKeys: ReadonlySet<string> | null
		/** The same run's decisions, for the marks on the rows. */
		decisions: EntryDecisions | null
		onFilters: (filters: PoolFilters) => void
		onNavigateToGraph?: () => void
	}

	let {
		lorebookId,
		descriptor,
		doors,
		bookPool,
		resolve,
		amendmentsFor,
		bookLinks,
		mode,
		hasUnsavedChanges = $bindable(false),
		lens,
		scopeTitle,
		filters,
		readInKeys,
		decisions,
		onFilters,
		onNavigateToGraph
	}: Props = $props()

	const socket = useTypedSocket()
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	const openSessionCtx: OpenSessionCtx = getContext("openSessionCtx")
	const sceneSummarizesCtx: SceneSummarizesCtx =
		getContext("sceneSummarizesCtx")
	const compileEntriesCtx: CompileEntriesCtx = getContext("compileEntriesCtx")
	const userCtxForReadout: UserCtx | undefined = getContext("userCtx")

	// The star is the switch: embeddings are on when something is registered
	// for `text->embedding`.
	let vectorizationEnabled = $derived(
		embeddingsStarred(systemSettingsCtx.capabilityDefaults)
	)

	/**
	 * The doors whose rows this list holds. A door with a kind of its own
	 * presets the pool to it; the pool door holds every other door's kind,
	 * which is what makes "All entries" the same list with nothing narrowed.
	 */
	let poolDoors = $derived(
		descriptor.kind ? [descriptor] : doors.filter((d) => d.kind)
	)
	let entryDoors = $derived(poolDoors.filter((d) => d.store === "entries"))
	let scenesInScope = $derived(poolDoors.some((d) => d.store === "scenes"))

	let rowsByKind = $state<Record<string, PoolSource[]>>({})
	let sceneList = $state<Sockets.Scenes.SceneWithMeta[]>([])
	let scenesLoaded = $state(false)
	let bindings = $state<BindingWithRelations[]>([])
	let loading = $state(true)

	/** Null is the pool's own default, which differs from a choice. */
	let chosenOrder = $state<string | null>(null)

	let creatingDoor = $state<SectionDescriptor | null>(null)
	let draft = $state<Record<string, any> | null>(null)
	/** Which row the draft belongs to, so a re-render does not discard edits. */
	let draftKey = $state<string | null>(null)
	/**
	 * The draft as it was BUILT, so a save can say what the author changed.
	 *
	 * Kept beside the draft rather than re-derived from the source, because
	 * the source moves underneath an open editor — an amendment landing, or
	 * the moment being dragged — and the diff must be against what was on
	 * screen when the editing started.
	 */
	let pristineDraft = $state<Record<string, any> | null>(null)
	/**
	 * The row a write of ours is in flight for.
	 *
	 * The server normalizes what it stores — keywords come back re-joined — so
	 * a saved draft is only settled once the saved row arrives. Keyed so a
	 * write from another tab re-renders the list without overwriting what is
	 * being typed here.
	 */
	let awaitingSave = $state<string | null>(null)

	let deleteTarget = $state<PoolItem | null>(null)

	let compileTarget = $state<PoolSource | null>(null)
	let compileActivityId = $state<string | null>(null)
	let compilePendingResult = $state<{ content: string } | null>(null)
	let compileInitialStep = $state<"review" | "running" | undefined>(undefined)
	let compileOpen = $state(false)

	let processSceneId = $state<number | null>(null)
	let processActivityId = $state<string | null>(null)
	let processPendingResult = $state<
		SceneSummarizeState["pendingResult"] | null
	>(null)
	let processOpen = $state(false)

	let newMenuOpen = $state(false)
	/** The open row's own menu, which holds what is not a field. */
	let editorMenuOpen = $state(false)
	/** The save control's second half, offered only while reading as-of. */
	let saveMenuOpen = $state(false)

	let orderBy = $derived(chosenOrder ?? DEFAULT_POOL_SORT)

	let route = $derived(loreRoute.route)
	/**
	 * The scenes on the line being read — shared ones plus this branch's own,
	 * the rule `entries:counts` counts by. `scenes:listByLorebook` answers with
	 * every line (its reply reaches every view of the book), so the pool and
	 * the count agree only if the pool keeps to its line.
	 */
	let scenesOnLine = $derived(rowsOnLine(sceneList, route.branch ?? null))
	/** An empty set is "read nothing"; no set at all is "nobody is reading". */
	let readIn = $derived(readInKeys ?? new Set<string>())

	/**
	 * The conversation reading this book, which is the one the marks and the
	 * Read in line are about. A session reading another book decided nothing
	 * about these rows.
	 */
	let readingSessionId = $derived(
		openSessionCtx?.lorebookId === lorebookId
			? openSessionCtx.sessionId
			: null
	)
	let readingSessionName = $derived(
		readingSessionId === null
			? null
			: (openSessionCtx.sessionName ?? "the open session")
	)

	/**
	 * This scope's rows as they READ at the moment being read.
	 *
	 * The list and the editor both draw from this, so the reader edits what
	 * they were shown. What makes that safe is that a save writes only the
	 * DIFF (`changedFields`) — see `sourceByKey` and `save`.
	 */
	let resolvedByKind = $derived.by(() => {
		if (!resolve) return rowsByKind
		const out: Record<string, PoolSource[]> = {}
		for (const [kind, rows] of Object.entries(rowsByKind))
			out[kind] = resolve(rows)
		return out
	})

	let poolItems = $derived.by(() => {
		const out: PoolItem[] = []
		for (const door of poolDoors) {
			const rows =
				door.store === "scenes"
					? scenesOnLine
					: (resolvedByKind[door.kind!] ?? [])
			for (const row of rows) out.push(door.toPoolItem(row))
		}
		return out
	})

	/**
	 * The row behind each key, as it READS at the moment.
	 *
	 * The editor draws from this, so what is edited is what was on screen. That
	 * is only safe because neither save action writes the draft whole: both
	 * write `changedFields(draft, pristineDraft)`, so a value this resolved
	 * from an amendment is never folded into wherever the save lands.
	 */
	let sourceByKey = $derived.by(() => {
		const map = new Map<string, PoolSource>()
		for (const door of poolDoors) {
			const rows =
				door.store === "scenes"
					? scenesOnLine
					: (resolvedByKind[door.kind!] ?? [])
			for (const row of rows) map.set(door.toPoolItem(row).key, row)
		}
		return map
	})

	/**
	 * What the timeline cursor says is not true yet at the moment being read.
	 *
	 * Only dated rows can be later than a date, so the question is asked of
	 * History alone; every other kind orders by position and would answer it
	 * with a number that means something else entirely.
	 *
	 * ⚠ The cursor's KEY and each row's own date, by `compareDates` — never
	 * the packed `position`, which is placement only and collides.
	 */
	let dimmedKeys = $derived.by(() => {
		const at = parseMoment(
			timelineCursor.position != null ? timelineCursor.key : null
		)
		return new Set(
			keysAfter(
				poolItems
					.filter((i) => i.kind === HISTORY_TYPE_ID)
					.map((i) => {
						const row = sourceByKey.get(i.key) as any
						return {
							key: i.key,
							date:
								typeof row?.year === "number"
									? {
											year: row.year,
											month: row.month ?? null,
											day: row.day ?? null
										}
									: null
						}
					}),
				at
			)
		)
	})

	// The moment's rows come first and the later ones fall to the end; the
	// toolbar's ordering is the reader's choice and holds inside each half.
	let visibleItems = $derived(
		orderByMoment(
			filterPool(poolItems, filters, readIn).sort(comparePoolBy(orderBy)),
			dimmedKeys
		)
	)
	let facets = $derived(facetCounts(poolItems, readIn))
	let summary = $derived(
		poolSummary(
			visibleItems.length,
			readInKeys
				? visibleItems.filter((i) => readInKeys.has(i.key)).length
				: null
		)
	)

	let selectedKey = $derived(
		route.sceneId != null
			? `scene#${route.sceneId}`
			: route.entryId != null
				? `entry#${route.entryId}`
				: null
	)
	let selectedItem = $derived(
		selectedKey ? poolItems.find((i) => i.key === selectedKey) : undefined
	)
	let selectedSource = $derived(
		selectedKey ? sourceByKey.get(selectedKey) : undefined
	)
	/** The door that owns whatever the editor is showing. */
	let activeDoor = $derived(
		creatingDoor ?? doorForKey(selectedKey, poolItems, descriptor)
	)
	/**
	 * The rows an edit is checked against — a history entry's date bounds,
	 * a name's uniqueness.
	 *
	 * ⚠ The rows ON THE LINE being read, as they read, never the raw list: a
	 * sibling line's entry is not a neighbour of this one, and a date bound
	 * taken from it refuses a date this line has free.
	 */
	let siblings = $derived(
		activeDoor.store === "scenes"
			? scenesOnLine
			: (resolvedByKind[activeDoor.kind ?? ""] ?? [])
	)
	let isNew = $derived(creatingDoor !== null)
	/**
	 * One column, walked as three steps: list, editor, inspector.
	 *
	 * The address is what says which one, never what has arrived — a row that
	 * is addressed is a step to be on before the list holding it has landed, so
	 * a deep link is not answered with the list it did not ask for. The
	 * inspector is a step after the editor rather than under it, because one
	 * column cannot hold two levels at once.
	 */
	let step = $derived(
		compactStep(route, { hasSelection: selectedKey !== null, isNew })
	)
	/**
	 * Whether every door in the pool has answered with its first list. A row
	 * the address names is only missing once it has: before that it is late.
	 */
	let poolReady = $derived(
		entryDoors.every((d) => rowsByKind[d.kind!] !== undefined) &&
			(!scenesInScope || scenesLoaded)
	)
	/** An address that names a row this pool does not hold. */
	let selectionMissing = $derived(
		!isNew && !!selectedKey && !selectedSource && poolReady
	)

	let creatableDoors = $derived(
		descriptor.kind
			? descriptor.creatable
				? [descriptor]
				: []
			: doors.filter((d) => d.creatable && d.kind)
	)

	/**
	 * Whether the AUTHOR has changed anything.
	 *
	 * ⚠ Measured against the draft as it was built, not against the row as it
	 * reads now. Those were the same thing until entries could be amended;
	 * since then the row moves under an open editor on its own — an amendment
	 * lands, or the moment is dragged — and calling that "unsaved changes"
	 * told the reader they had edits they had never made.
	 */
	let dirty = $derived.by(() => {
		if (!draft) return false
		if (isNew)
			return (
				!!draft.name?.trim() ||
				!!draft.content?.trim() ||
				!!draft.summary?.trim()
			)
		if (!pristineDraft) return false
		return (
			JSON.stringify(pristineDraft) !==
			JSON.stringify($state.snapshot(draft))
		)
	})

	/** Whether the row has moved under the editor since the draft was built. */
	let sourceMoved = $derived.by(() => {
		if (!draft || isNew || !selectedSource || !pristineDraft) return false
		return (
			JSON.stringify(activeDoor.toDraft(selectedSource)) !==
			JSON.stringify(pristineDraft)
		)
	})

	let latestHistoryId = $derived.by(() => {
		// The current date is the newest on the line being read.
		const rows = resolvedByKind[HISTORY_TYPE_ID] ?? []
		let best: PoolSource | null = null
		for (const row of rows)
			if (!best || compareDates(row as any, best as any) > 0) best = row
		return best?.id ?? null
	})

	let scenesByEntryId = $derived.by(() => {
		const map = new Map<number, Sockets.Scenes.SceneWithMeta[]>()
		for (const scene of scenesOnLine) {
			const list = map.get(scene.historyEntryId) ?? []
			list.push(scene)
			map.set(scene.historyEntryId, list)
		}
		return map
	})

	let bindingNameById = $derived.by(() => {
		const map = new Map<number, string>()
		for (const b of bindings) map.set(b.id, b.name || b.binding)
		return map
	})

	/**
	 * The name each `{{char:N}}` slot stands for.
	 *
	 * Keyed on the token the column stores, and read the way the content
	 * preview reads it — a nickname before a name — so the editor and the
	 * preview never name the same slot two different things.
	 */
	let bindingNameByTag = $derived.by(() => {
		const map = new Map<string, string>()
		for (const b of bindings)
			map.set(
				b.binding,
				b.character?.nickname ||
					b.character?.name ||
					b.name ||
					b.binding
			)
		return map
	})

	/**
	 * Files one row under another, or at the top level.
	 *
	 * The refusal is the same one the picker makes and the same one the server
	 * makes, asked of the WHOLE BOOK rather than of the visible rows: a
	 * descendant a facet or a scope is hiding is still a descendant, and a ring
	 * made through one would be a tree nothing can draw.
	 */
	function reparent(childKey: string, parentKey: string | null) {
		const child = bookPool.find((item) => item.key === childKey)
		if (!child || child.kind === SCENE_KIND) return
		if (!canFileUnder(childKey, parentKey, bookPool, route.branch ?? null))
			return
		const door = descriptorForKind(child.kind)
		if (!door?.kind || door.store !== "entries") return
		channels.get(door.kind)?.update({
			id: child.id,
			anchorEntryId: parentKey
				? Number(parentKey.slice("entry#".length))
				: null
		})
	}

	setLorePoolCtx({
		get pool() {
			return bookPool
		},
		get links() {
			return bookLinks
		},
		get newRowBranchId() {
			return route.branch ?? null
		},
		get reading() {
			return {
				sessionId: readingSessionId,
				sessionName: readingSessionName
			}
		},
		reparent,
		scenesOf: (id) => scenesByEntryId.get(id) ?? [],
		isCurrentDate: (id) => latestHistoryId === id,
		bindingName: (id) => bindingNameById.get(id) ?? `#${id}`,
		bindingForTag: (tag) => bindingNameByTag.get(tag) ?? null,
		openCompile: (entry) => openCompile(entry),
		openProcess: (sceneId, activityId) => openProcess(sceneId, activityId),
		refreshScenes: () => fetchScenes(),
		get onNavigateToGraph() {
			return onNavigateToGraph
		}
	})

	function fetchScenes() {
		socket.emit("scenes:listByLorebook", {
			lorebookId
		} satisfies Sockets.Scenes.ListByLorebook.Params)
	}

	function openCompile(entry: PoolSource) {
		const activity = compileEntriesCtx?.activities?.find(
			(a) => a.historyEntryId === entry.id
		)
		compileTarget = entry
		compileActivityId = activity?.activityId ?? null
		compilePendingResult = activity?.pendingResult ?? null
		compileInitialStep =
			activity?.status === "review"
				? "review"
				: activity?.status === "running"
					? "running"
					: undefined
		compileOpen = true
	}

	function openProcess(sceneId: number, activityId?: string | null) {
		const activity = activityId
			? sceneSummarizesCtx?.activities?.find(
					(a) => a.activityId === activityId
				)
			: undefined
		processSceneId = sceneId
		processActivityId = activityId ?? null
		processPendingResult = activity?.pendingResult ?? null
		processOpen = true
	}

	/**
	 * Drops the draft and the guard together.
	 *
	 * The guard is written here rather than left to the effect that mirrors
	 * `dirty`, because the very next line is usually a transition and a
	 * transition must not be asked about changes already thrown away.
	 */
	function discardDraft() {
		creatingDoor = null
		draft = null
		draftKey = null
		pristineDraft = null
		hasUnsavedChanges = false
	}

	async function select(item: PoolItem, inspector?: string) {
		if (creatingDoor) {
			if (!(await loreRoute.confirmLeave())) return
			discardDraft()
		}
		// A cast member is not in this pool and never will be — the Refs
		// board lists one when an edge joins it to the open entry, and the
		// place it is edited is the Cast board.
		if (item.kind === CAST_KIND) {
			void loreRoute.navigate({
				type: "openCastMember",
				scope: "cast",
				castId: item.id
			})
			return
		}
		void loreRoute.navigate({
			type: "openEntry",
			entryId:
				item.kind === "scene"
					? (sourceByKey.get(item.key)?.historyEntryId ?? item.id)
					: item.id,
			sceneId: item.kind === "scene" ? item.id : undefined,
			inspector
		})
	}

	async function startCreate(door: SectionDescriptor) {
		newMenuOpen = false
		if (!(await loreRoute.confirmLeave())) return
		discardDraft()
		creatingDoor = door
		draftKey = "new"
		draft = door.newDraft(lorebookId)
		pristineDraft = { ...$state.snapshot(draft) }
	}

	async function closeEditor() {
		if (!(await loreRoute.confirmLeave())) return
		const wasCreating = creatingDoor !== null
		discardDraft()
		if (!wasCreating) void loreRoute.navigate({ type: "back" })
	}

	/**
	 * The date being read, when one is being read. `null` is now.
	 *
	 * Now is not a moment the author can amend AT, so at now there is one
	 * button and it writes the base. ⚠ That is NOT the same as "from now on":
	 * every dated amendment still applies at now, so a base write to a field
	 * an amendment also sets does not show. The save still happens (warn
	 * only, ruled 2026-09-28) and its toast names the amendment that wins —
	 * see `baseSaveWarning`.
	 */
	let momentDate = $derived(parseMoment(route.moment))

	/**
	 * Whether this save is a choice.
	 *
	 * Only an existing ENTRY read at a moment can be amended: a scene has no
	 * amendment table, and a row that does not exist yet has no base to leave
	 * alone.
	 */
	let canAmend = $derived(
		momentDate !== null &&
			!isNew &&
			activeDoor.store === "entries" &&
			selectedSource != null
	)

	/** What the author changed, which is all either action writes. */
	function pendingFields(): Record<string, unknown> | null {
		if (!draft) return null
		if (!activeDoor.validate(draft, siblings, true)) return null
		const fields = changedFields(
			$state.snapshot(draft) as Record<string, unknown>,
			pristineDraft ?? {}
		)
		if (!Object.keys(fields).length) {
			toaster.error({ title: "Nothing has changed" })
			return null
		}
		return fields
	}

	/**
	 * A write of ours is on its way and has not been answered. The save
	 * controls stand down meanwhile, so one draft is never sent twice.
	 */
	let saving = $state(false)

	/** Every overlay id this editor has seen for an entry, for `isOurAmendment`. */
	function knownAmendmentIds(entryId: number): number[] {
		return (amendmentsFor?.(entryId) ?? []).map((a) => a.id)
	}

	/**
	 * A refusal Layout's `:error` catch-all has already toasted is not toasted
	 * again; a reply that never came is said here, because nothing else will.
	 */
	function reportUnanswered(err: unknown, title: string) {
		if (isReplyTimeout(err))
			toaster.error({
				title,
				description:
					"The server did not answer in time. Your changes are still here."
			})
	}

	/**
	 * After our own write lands: the draft that was sent is dropped so the
	 * editor re-reads the row, but typing done while waiting is kept — the
	 * sent text becomes the new "as built", so only the later typing is dirty.
	 */
	function settleDraft(key: string, sent: Record<string, unknown>) {
		if (draftKey !== key || !draft) return
		if (JSON.stringify($state.snapshot(draft)) === JSON.stringify(sent))
			discardDraft()
		else pristineDraft = { ...sent }
	}

	/**
	 * File the change as a dated overlay, on the line being read. The base is
	 * left alone.
	 *
	 * ⚠ The draft is kept until the server has the row: a refusal or a lost
	 * reply must not throw the author's text away. Once it lands the draft is
	 * dropped and rebuilt, because the resolved row changed under the editor
	 * and a draft built before that is a copy of the old reading.
	 */
	async function saveAsAmendment() {
		if (!momentDate || !selectedSource || saving) return
		const fields = pendingFields()
		if (!fields) return
		const entryId = selectedSource.id
		const branchId = route.branch ?? null
		const date = momentDate
		const key = `entry#${entryId}`
		const sent = $state.snapshot(draft) as Record<string, unknown>
		saving = true
		let reply: Sockets.Amendments.List.Response | null
		try {
			reply = await fileEntryAmendments(
				socket,
				{ lorebookId, entryId, branchId },
				[{ ...date, fields }],
				knownAmendmentIds(entryId)
			)
		} catch (err) {
			saving = false
			reportUnanswered(err, "The amendment was not saved")
			return
		}
		saving = false
		const line = lineName(reply, branchId)
		toaster.success({
			title: `Amended as of ${formatDate(date)}${line ? ` on ${line}` : ""}`
		})
		settleDraft(key, sent)
	}

	/**
	 * "Off from D1 until D2" — one gesture, two amendments.
	 *
	 * An amendment sets a value from a date forward, so a PERIOD is two step
	 * changes: off at the start, on again at the end. The author should not
	 * have to think that way, and before this the only way to say "the harbour
	 * is closed for three years" was to work out both halves and file them
	 * separately, in the right order, with the right fields.
	 *
	 * ⚠ The composition itself lives in `offWindowAmendments` so the two halves
	 * cannot drift apart, and so the "until is exclusive" reading is written
	 * down once and tested rather than living in this form.
	 */
	let offWindowOpen = $state(false)
	let offFrom = $state({ year: "", month: "", day: "" })
	let offUntil = $state({ year: "", month: "", day: "" })

	const partsToDate = (p: { year: string; month: string; day: string }) =>
		p.year.trim() === ""
			? null
			: {
					year: Number(p.year),
					month: p.month.trim() === "" ? null : Number(p.month),
					day: p.day.trim() === "" ? null : Number(p.day)
				}

	let offProblem = $derived(
		offWindowProblem(partsToDate(offFrom), partsToDate(offUntil))
	)

	function resetOffWindow() {
		offWindowOpen = false
		offFrom = { year: "", month: "", day: "" }
		offUntil = { year: "", month: "", day: "" }
	}

	async function fileOffWindow() {
		const from = partsToDate(offFrom)
		if (!from || offProblem || !selectedSource || saving) return
		const until = partsToDate(offUntil)
		const entryId = selectedSource.id
		// ⚠ On the line being read: "off for a while" on a fork is the
		// line-only way out that the delete confirmation points to.
		const branchId = route.branch ?? null
		saving = true
		let reply: Sockets.Amendments.List.Response | null
		try {
			reply = await fileEntryAmendments(
				socket,
				{ lorebookId, entryId, branchId },
				offWindowAmendments(from, until),
				knownAmendmentIds(entryId)
			)
		} catch (err) {
			saving = false
			reportUnanswered(err, "The entry was not switched off")
			return
		}
		saving = false
		const line = lineName(reply, branchId)
		toaster.success({
			title:
				(until
					? "Switched off for that period"
					: "Switched off from then on") + (line ? ` on ${line}` : "")
		})
		resetOffWindow()
		editorMenuOpen = false
	}

	/**
	 * The warning a base save earns when an amendment still overrides part
	 * of it, or null. Asked of the SAME resolver the list reads through: the
	 * base as it will be after this write, resolved at the moment being read —
	 * any field that still comes out different is one the author will not
	 * see change.
	 */
	function baseSaveWarning(
		kind: string,
		entryId: number,
		fields: Record<string, unknown>
	) {
		if (!resolve) return null
		const base = (rowsByKind[kind] ?? []).find((r) => r.id === entryId)
		if (!base) return null
		const [resolved] = resolve([{ ...base, ...fields } as PoolSource])
		if (!resolved) return null
		const masked = maskedFields(fields, resolved as Record<string, unknown>)
		if (!masked.length) return null
		const overlays = amendmentsFor?.(entryId) ?? []
		return maskedBaseWarning(
			masked.map((field) => ({
				field,
				amendment: maskingAmendment(
					field,
					(resolved as Record<string, unknown>)[field],
					overlays,
					route.branch ?? null,
					// The moment being read: an overlay dated after it is not
					// the one masking the save here.
					parseMoment(route.moment)
				)
			}))
		)
	}

	/** A create's reply is ours when it is this row, as the server stores it. */
	const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "")

	async function save() {
		if (!draft || saving) return
		if (!activeDoor.validate(draft, siblings, true)) return
		const payload = $state.snapshot(draft) as Record<string, any>
		if (activeDoor.store === "scenes") {
			// The toast waits for the reply: see `handleSceneUpdate`.
			awaitingSave = `scene#${payload.id}`
			socket.emit("scenes:update", {
				scene: {
					id: payload.id,
					name: (payload.name as string)?.trim() || null,
					summary: (payload.summary as string)?.trim() || null,
					participantCharacters: payload.participantCharacters,
					mentionedCharacters: payload.mentionedCharacters
				}
			} satisfies Sockets.Scenes.Update.Params)
			return
		}
		const door = activeDoor
		const kind = door.kind!
		if (!channels.has(kind)) return
		if (isNew) {
			// ⚠ An entry created while reading a line belongs to that line.
			// Anything else would put a fork's new entry on main, where it
			// would read as something that was always true of both stories.
			if (route.branch != null) payload.branchId = route.branch
			const pendingKey = `new:${kind}`
			awaitingSave = pendingKey
			saving = true
			// ⚠ The draft stays until the row exists. `entries:create` is
			// broadcast to every tab of this user, so the reply is claimed
			// only when it is this row.
			let created: Sockets.Entries.Create.Response
			try {
				created = await awaitReply({
					socket,
					event: "entries:create",
					params: {
						entry: { ...payload, typeId: kind, lorebookId } as any
					},
					replyKey: interestKey("entries:create", lorebookId),
					errorEvent: "entries:create:error",
					fallbackError: "The entry could not be created.",
					match: (data) =>
						data.entry?.lorebookId === lorebookId &&
						data.entry.typeId === kind &&
						trimmed(data.entry.name) === trimmed(payload.name) &&
						trimmed(data.entry.content) === trimmed(payload.content)
				})
			} catch (err) {
				saving = false
				if (awaitingSave === pendingKey) awaitingSave = null
				reportUnanswered(err, `${door.label} was not created`)
				return
			}
			saving = false
			toaster.success({ title: `${door.label} created` })
			// Still the create the author sent? Then open what it became. An
			// author who has since closed it or started another is left be.
			if (awaitingSave !== pendingKey) return
			awaitingSave = null
			if (creatingDoor !== door || draftKey !== "new") return
			discardDraft()
			void loreRoute.navigate({
				type: "openEntry",
				entryId: created.entry.id
			})
		} else {
			// ⚠ The DIFF, never the whole draft. The editor draws the entry as
			// it reads at the moment, so the draft holds other amendments'
			// values too — writing it whole would bake them into the base.
			const fields = pendingFields()
			if (!fields) return
			const id = payload.id as number
			const key = `entry#${id}`
			const warning = baseSaveWarning(kind, id, fields)
			awaitingSave = key
			saving = true
			try {
				await awaitReply({
					socket,
					event: "entries:update",
					params: { entry: { ...fields, id, typeId: kind } as any },
					replyKey: interestKey("entries:update", lorebookId),
					errorEvent: "entries:update:error",
					fallbackError: "The entry could not be saved.",
					match: (data) => data.entry?.id === id
				})
			} catch (err) {
				saving = false
				if (awaitingSave === key) awaitingSave = null
				reportUnanswered(err, `${door.label} was not saved`)
				return
			}
			saving = false
			// The draft itself is settled by the channel's `onUpdated`, which
			// hears the same reply; this only says how it went.
			if (warning) toaster.warning(warning)
			else toaster.success({ title: `${door.label} saved` })
		}
	}

	/**
	 * Out of the way, and kept — a different fact from the Off switch.
	 *
	 * Written to the row rather than to the draft alone, and mirrored onto the
	 * draft so a Save of edits in flight does not carry the old value back over
	 * it.
	 */
	function setArchived(next: boolean) {
		editorMenuOpen = false
		if (!selectedSource || activeDoor.store !== "entries") return
		// Mirrored onto BOTH halves of the dirty check: the draft, so a Save
		// in flight does not write the old value back, and the "as built"
		// copy, so a clean editor stays clean — archiving is not an edit.
		if (draft) draft.archived = next
		if (pristineDraft) pristineDraft.archived = next
		channels
			.get(activeDoor.kind!)
			?.update({ id: selectedSource.id, archived: next })
	}

	/**
	 * Whether the delete being asked about reaches past the line being read.
	 *
	 * A delete is global. Reading a fork, an entry with no branch of its own
	 * is shared by every line, so the confirmation says it goes from all of
	 * them and points at the line-only way out (ruled default 2026-09-28).
	 */
	let deleteIsEveryLine = $derived.by(() => {
		if (!deleteTarget || route.branch == null) return false
		if (deleteTarget.kind === SCENE_KIND) return false
		const source = sourceByKey.get(deleteTarget.key) as
			| { branchId?: number | null }
			| undefined
		return (source?.branchId ?? null) === null
	})

	function confirmDelete() {
		const target = deleteTarget
		deleteTarget = null
		if (!target) return
		const door = descriptorForKind(target.kind) ?? descriptor
		if (door.store === "scenes") {
			socket.emit("scenes:delete", {
				id: target.id
			} satisfies Sockets.Scenes.Delete.Params)
		} else {
			channels.get(door.kind!)?.remove(target.id)
		}
		if (selectedKey === target.key)
			void loreRoute.navigate({ type: "back" })
	}

	function reorder(items: PoolItem[]) {
		const kind = descriptor.kind
		if (!kind) return
		channels
			.get(kind)
			?.reorder(items.map((it, i) => ({ id: it.id, position: i + 1 })))
	}

	// The draft follows the address, and `draftStale` is the whole of when it
	// is rebuilt. The source is read on every run rather than behind the
	// guard, so the arrival of the addressed row is a dependency of this
	// effect and not something it has stopped listening for.
	/**
	 * A clean draft follows the row it is showing.
	 *
	 * The row moves without the address moving: an amendment is filed or
	 * removed, or the Moment bar is dragged, and what this entry SAYS changes
	 * while the entry stays the same row. `draftStale` cannot see that — it
	 * watches the key — so an editor left open would keep drawing an older
	 * reading.
	 *
	 * ⚠ Only while clean. Edits in flight are never discarded to follow a
	 * reading; the save writes a diff against what was on screen when the
	 * typing started, so a draft left behind still cannot write a value the
	 * author did not enter.
	 */
	$effect(() => {
		if (!sourceMoved || dirty || !selectedSource) return
		draft = activeDoor.toDraft(selectedSource)
		pristineDraft = { ...$state.snapshot(draft) }
	})

	$effect(() => {
		const key = creatingDoor ? "new" : selectedKey
		const source = !creatingDoor && key ? sourceByKey.get(key) : undefined
		if (
			!draftStale({
				key,
				draftKey,
				hasDraft: draft !== null,
				hasSource: !!source
			})
		)
			return
		draftKey = key
		if (creatingDoor) return
		draft = source
			? doorForKey(key, poolItems, descriptor).toDraft(source)
			: null
		pristineDraft = draft ? { ...$state.snapshot(draft) } : null
	})

	$effect(() => {
		hasUnsavedChanges = dirty
	})

	// The activity sidebar asks for a review by naming the row, not the panel,
	// so the workspace is what answers — and only for rows it actually holds.
	$effect(() => {
		const id = compileEntriesCtx?.reviewHistoryEntryId
		if (!id) return
		// As it READS on this line, so the compile's diff is against what the
		// author sees; the raw row only when the line does not show it.
		const entry =
			(resolvedByKind[HISTORY_TYPE_ID] ?? []).find((e) => e.id === id) ??
			(rowsByKind[HISTORY_TYPE_ID] ?? []).find((e) => e.id === id)
		compileEntriesCtx.setReviewHistoryEntryId(null)
		if (entry) openCompile(entry)
	})

	$effect(() => {
		const id = sceneSummarizesCtx?.reviewSceneId
		if (!id) return
		if (!sceneList.some((s) => s.id === id)) return
		const activity = sceneSummarizesCtx.activities.find(
			(a) =>
				a.sceneId === id &&
				(a.status === "review" || a.status === "running")
		)
		if (!activity) return
		sceneSummarizesCtx.setReviewSceneId(null)
		openProcess(id, activity.activityId)
	})

	const channels = new Map<string, ReturnType<typeof entryChannel>>()

	/**
	 * The interest releases this workspace holds, dropped together on destroy.
	 *
	 * Declared imperatively in `onMount` rather than through `useInterest` or
	 * an effect, because the scene half of them is CONDITIONAL — only a scope
	 * that shows scenes listens for them — and because the workspace is
	 * rendered inside a `{#key book.id}` block, so `lorebookId` never moves
	 * under a key that was already taken.
	 *
	 * A plain array, not `$state`: nothing renders from it.
	 */
	let releases: Array<() => void> = []

	function handleBindingList(msg: Sockets.Lorebooks.BindingList.Response) {
		if (msg.lorebookId !== lorebookId) return
		bindings = msg.lorebookBindingList as BindingWithRelations[]
	}

	function handleScenesList(msg: Sockets.Scenes.ListByLorebook.Response) {
		if (msg.lorebookId !== lorebookId) return
		// Every line's scenes, kept whole — `scenesOnLine` is what is shown.
		sceneList = msg.sceneList
		scenesLoaded = true
		loading = false
	}

	function handleSceneUpdate(msg: Sockets.Scenes.Update.Response) {
		if (!msg.scene) return
		sceneList = sceneList.map((s) =>
			s.id === msg.scene.id ? { ...s, ...msg.scene } : s
		)
		const key = `scene#${msg.scene.id}`
		if (awaitingSave !== key) return
		awaitingSave = null
		// Said once the scene is saved, never before.
		toaster.success({ title: "Scene updated" })
		if (draftKey === key)
			draft = (descriptorForKind(SCENE_KIND) ?? descriptor).toDraft(
				sceneList.find((s) => s.id === msg.scene.id) ?? msg.scene
			)
	}

	function handleSceneWritten(
		msg: Sockets.Scenes.Create.Response | Sockets.Scenes.Delete.Response
	) {
		// Both are bare, so another book's writes arrive here too.
		const bookId =
			"scene" in msg ? msg.scene?.lorebookId : msg?.lorebookId
		if (bookId !== undefined && bookId !== lorebookId) return
		fetchScenes()
	}

	function handleSceneProcessError(
		msg: Sockets.Scenes.Process.ErrorResponse
	) {
		toaster.error({
			title: "Scene processing failed",
			description: msg.error
		})
	}

	// The run behind the marks is read once for the whole editor, and re-read
	// only when the book or the conversation changes.
	$effect(() => {
		retrievalReadout.ask(lorebookId, readingSessionId)
	})

	onMount(() => {
		retrievalReadout.open(socket, {
			isAdmin: !!userCtxForReadout?.user?.isAdmin
		})
		for (const door of entryDoors) {
			const kind = door.kind!
			channels.set(
				kind,
				entryChannel(socket, {
					lorebookId,
					typeId: kind as any,
					vectorSource: door.vectorSource ?? kind,
					handlers: {
						onList(entries) {
							rowsByKind = {
								...rowsByKind,
								[kind]: entries as PoolSource[]
							}
							loading = false
						},
						// The vectorization queue writes `embeddingModel`
						// straight to the row, so without this the badge only
						// refreshes on the next explicit write.
						onVectorized(id, embeddingModel) {
							rowsByKind = {
								...rowsByKind,
								[kind]: (rowsByKind[kind] ?? []).map((e) =>
									e.id === id ? { ...e, embeddingModel } : e
								)
							}
						},
						// A create of ours is answered in `save`, which waits
						// for it; one from anywhere else only moves the list,
						// so it is not toasted here.
						onUpdated(entry) {
							// No toast: `save` says how its own write went, and
							// a mark set from a session, another tab or an
							// archive is not this editor's news.
							const key = `entry#${entry.id}`
							if (awaitingSave === key) {
								awaitingSave = null
								// The saved row is what is being edited now:
								// the server re-joins keywords, so the draft
								// and the row are only the same text once it
								// comes back.
								if (draftKey === key) {
									draft = door.toDraft(entry)
									pristineDraft = {
										...$state.snapshot(draft)
									}
								}
								return
							}
							// A write from somewhere else about the row that is
							// open — a Teach it lever, an archive, another tab.
							// A draft nobody has touched follows it; one being
							// typed is left alone.
							if (draftKey === key && !dirty) {
								draft = door.toDraft(entry)
								pristineDraft = { ...$state.snapshot(draft) }
							}
						},
						// Only the delete this workspace asked for is news here.
						onDeleted: (_id, askedHere) => {
							if (askedHere)
								toaster.success({ title: `${door.label} deleted` })
						},
						onReordered: () =>
							toaster.success({ title: "Entries reordered" })
					}
				})
			)
		}
		for (const channel of channels.values()) channel.open()
		// The cast is needed by every door: it resolves `{{char:N}}` in a
		// preview, names a scene's cast, and fills the character lore picker.
		// An entry channel asks for it on open, so only a door with no channel
		// of its own (Scenes) has to ask.
		// A STANDING key, not a one-shot: every entry channel's write cascades
		// a fresh cast list, so the workspace holds it whether or not it is the
		// one asking below.
		releases.push(
			declareInterest<"lorebooks:bindingList">(
				interestKey("lorebooks:bindingList", lorebookId),
				handleBindingList
			)
		)
		if (entryDoors.length === 0)
			socket.emit("lorebooks:bindingList", { lorebookId })
		if (entryDoors.length === 0 && !scenesInScope) loading = false

		if (
			scenesInScope ||
			poolDoors.some((d) => d.kind === HISTORY_TYPE_ID)
		) {
			// Only the list names a book. The three writes answer with the
			// scene alone and `scenes:process:error` names one this workspace
			// has never heard of, so all four are BARE — none has an entry in
			// `SCOPED_EVENTS`, and a scoped key for an unscoped event matches
			// nothing at all. `scenes:delete` names its book, and
			// `handleSceneWritten` drops another book's.
			releases.push(
				declareInterest<"scenes:listByLorebook">(
					interestKey("scenes:listByLorebook", lorebookId),
					handleScenesList
				),
				declareInterest<"scenes:update">(
					"scenes:update",
					handleSceneUpdate
				),
				declareInterest<"scenes:delete">(
					"scenes:delete",
					handleSceneWritten
				),
				declareInterest<"scenes:create">(
					"scenes:create",
					handleSceneWritten
				),
				declareInterest<"scenes:process:error">(
					"scenes:process:error",
					handleSceneProcessError
				)
			)
			fetchScenes()
		}
	})

	onDestroy(() => {
		hasUnsavedChanges = false
		retrievalReadout.close(socket)
		for (const channel of channels.values()) channel.close()
		for (const release of releases) release()
		releases = []
	})
</script>

{#snippet newButton()}
	{#if creatableDoors.length === 1}
		<button
			class="btn btn-sm preset-filled-primary-500 shrink-0"
			type="button"
			onclick={() => startCreate(creatableDoors[0])}
		>
			<Icons.Plus size={14} />
			<span class="hidden @lg/view:inline">New</span>
		</button>
	{:else if creatableDoors.length > 1}
		<Popover
			open={newMenuOpen}
			onOpenChange={(e) => (newMenuOpen = e.open)}
			positioning={{ placement: "bottom-end" }}
		>
			<Popover.Trigger
				class="btn btn-sm preset-filled-primary-500 shrink-0 gap-1"
				title="New"
			>
				<Icons.Plus size={14} aria-hidden="true" />
				<span class="hidden @lg/view:inline">New</span>
				<Icons.ChevronDown size={14} aria-hidden="true" />
			</Popover.Trigger>
			<Portal>
				<Popover.Positioner class="z-[1000]!">
					<Popover.Content
						class="card bg-surface-100-900 flex min-w-44 flex-col gap-1 p-2 shadow-xl"
					>
						{#each creatableDoors as door (door.id)}
							{@const Icon = door.icon}
							<button
								class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
								type="button"
								onclick={() => startCreate(door)}
							>
								<Icon size={14} aria-hidden="true" />
								{door.newLabel}
							</button>
						{/each}
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover>
	{/if}
{/snippet}

{#snippet list()}
	<EntryPool
		items={visibleItems}
		sourceOf={(item) => sourceByKey.get(item.key)}
		descriptorOf={(item) => descriptorForKind(item.kind) ?? descriptor}
		{descriptor}
		{bindings}
		{vectorizationEnabled}
		{selectedKey}
		{lens}
		{filters}
		{facets}
		{scopeTitle}
		{summary}
		{orderBy}
		{mode}
		{loading}
		{dimmedKeys}
		{decisions}
		onSelect={select}
		onMarker={(item) => select(item, "fires")}
		onDelete={(item) => (deleteTarget = item)}
		onNew={creatableDoors.length
			? () => startCreate(creatableDoors[0])
			: undefined}
		{onFilters}
		onOrderBy={(next) => (chosenOrder = next)}
		onReorder={reorder}
	>
		{#snippet newControl()}
			{@render newButton()}
		{/snippet}
		{#snippet toolbarExtra()}
			{#if descriptor.listActions}
				{@const Actions = descriptor.listActions}
				<Actions sources={rowsByKind[descriptor.kind ?? ""] ?? []} />
			{/if}
		{/snippet}
	</EntryPool>
{/snippet}

{#snippet editorBack()}
	<!-- The way out of this step. In compact that is the step back to the
	     list; at desk the list never left, so it closes the editor column. -->
	{@const label = mode === "compact" ? "Back to the list" : "Close"}
	<button
		class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
		type="button"
		onclick={closeEditor}
		title={label}
		aria-label={label}
	>
		{#if mode === "compact"}
			<Icons.ChevronLeft size={16} aria-hidden="true" />
		{:else}
			<Icons.X size={16} aria-hidden="true" />
		{/if}
	</button>
{/snippet}

{#snippet offWindowForm()}
	<!-- A period, in the author's words. What the book stores is two dated
	     changes; `offWindowAmendments` is the one place that translation
	     happens, and it is tested. -->
	<div class="flex flex-col gap-1">
		<span class="text-sm font-semibold">Off for a while</span>
		<p class="text-surface-700-300 text-xs leading-relaxed">
			The entry stops being read from the first date, and starts again at
			the second. Leave the second blank and it stays off.
		</p>
	</div>

	{#each [{ label: "From", parts: offFrom }, { label: "Until", parts: offUntil }] as row (row.label)}
		<div class="flex items-center gap-1">
			<span class="text-surface-600-400 w-12 shrink-0 text-xs">
				{row.label}
			</span>
			<input
				class="input input-sm w-16 shrink-0"
				bind:value={row.parts.year}
				placeholder="Year"
				aria-label="{row.label} year"
			/>
			<input
				class="input input-sm w-14 shrink-0"
				bind:value={row.parts.month}
				placeholder="Mo."
				aria-label="{row.label} month, optional"
			/>
			<input
				class="input input-sm w-14 shrink-0"
				bind:value={row.parts.day}
				placeholder="Day"
				disabled={row.parts.month.trim() === ""}
				title={row.parts.month.trim() === ""
					? "A day needs a month: the calendar narrows left to right"
					: "Day"}
				aria-label="{row.label} day, optional"
			/>
		</div>
	{/each}

	{#if offProblem && offFrom.year.trim() !== ""}
		<p class="text-warning-700-300 text-xs leading-relaxed">
			{offProblem}
		</p>
	{/if}

	<div class="flex gap-1">
		<button
			class="btn btn-sm preset-filled-primary-500 flex-1"
			type="button"
			onclick={fileOffWindow}
			disabled={!!offProblem || saving}
			title={offProblem ?? "File it as dated changes"}
		>
			Switch it off
		</button>
		<button
			class="btn btn-sm preset-filled-surface-400-600"
			type="button"
			onclick={resetOffWindow}
		>
			Cancel
		</button>
	</div>
{/snippet}

{#snippet editorMenu()}
	<!-- What is not a field: archiving is a state the row is put into rather
	     than a value the editor holds, and it is written straight through. -->
	<Popover
		open={editorMenuOpen}
		onOpenChange={(e) => (editorMenuOpen = e.open)}
		positioning={{ placement: "bottom-end" }}
	>
		<Popover.Trigger
			class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
			title="More options"
			aria-label="More options for this entry"
		>
			<Icons.Ellipsis size={16} aria-hidden="true" />
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-surface-100-900 flex w-[min(90vw,300px)] flex-col gap-2 p-3 shadow-xl"
				>
					{#if offWindowOpen}
						{@render offWindowForm()}
					{:else}
						{#if selectedSource?.archived}
							<button
								class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
								type="button"
								onclick={() => setArchived(false)}
							>
								<Icons.ArchiveRestore size={14} /> Unarchive
							</button>
						{:else}
							<button
								class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
								type="button"
								onclick={() => setArchived(true)}
							>
								<Icons.Archive size={14} /> Archive
							</button>
						{/if}
						<button
							class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
							type="button"
							onclick={() => (offWindowOpen = true)}
						>
							<Icons.CalendarOff size={14} /> Off for a while…
						</button>
					{/if}
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
{/snippet}

{#snippet amendSave()}
	<!--
	  Two actions, because at a moment they are two different things: one says
	  "from this date", the other says "always". Ruled 2026-09-23.

	  The destructive one is in the menu and never the primary (style 6.1), and
	  it carries the whole warning in the item itself — a toast afterwards would
	  arrive after the base was already rewritten.
	-->
	{@const dated = formatDate(momentDate!)}
	<div class="flex shrink-0 items-center">
		<button
			class="btn btn-sm preset-filled-primary-500 rounded-r-none"
			type="button"
			onclick={saveAsAmendment}
			disabled={saving || !activeDoor.validate(draft!, siblings)}
			title="File this change as an amendment dated {dated}"
		>
			<Icons.Save size={16} aria-hidden="true" />
			<span>Save as of {dated}</span>
		</button>
		<Popover
			open={saveMenuOpen}
			onOpenChange={(e) => (saveMenuOpen = e.open)}
			positioning={{ placement: "bottom-end" }}
		>
			<Popover.Trigger
				class="btn btn-sm preset-filled-primary-500 rounded-l-none border-l border-white/25 p-2"
				title="Other ways to save this change"
				aria-label="Other ways to save this change"
			>
				<Icons.ChevronDown size={16} aria-hidden="true" />
			</Popover.Trigger>
			<Portal>
				<Popover.Positioner class="z-[1000]!">
					<Popover.Content
						class="card bg-surface-100-900 flex w-[min(90vw,320px)] flex-col gap-3 p-4 shadow-xl"
					>
						<div class="flex flex-col gap-1">
							<span class="text-sm font-semibold">
								Save as of {dated}
							</span>
							<p
								class="text-surface-700-300 text-xs leading-relaxed"
							>
								The entry is left as it is. The change begins at
								{dated} and reads from then on.
							</p>
						</div>
						<hr class="border-surface-300-700" />
						<div class="flex flex-col gap-2">
							<p
								class="text-surface-700-300 text-xs leading-relaxed"
							>
								Or change the entry itself: it reads this way
								<strong>everywhere</strong>
								, on every line and at every moment — including before
								{dated}, where it is what was always true.
							</p>
							<button
								class="btn btn-sm preset-tonal-warning w-full justify-start"
								type="button"
								onclick={() => {
									saveMenuOpen = false
									save()
								}}
								disabled={saving ||
									!activeDoor.validate(draft!, siblings)}
							>
								<Icons.PenLine size={14} aria-hidden="true" />
								Change the base
							</button>
						</div>
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover>
	</div>
{/snippet}

{#snippet editor()}
	{#if draft}
		{@const Editor = activeDoor.editor}
		<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
			<div class="flex flex-wrap items-center gap-2">
				{@render editorBack()}
				<span
					class="text-surface-600-400 shrink-0 text-xs"
				>
					{kindLabel(selectedItem?.kind ?? activeDoor.kind ?? "")}
				</span>
				<h3 class="min-w-0 flex-1 truncate text-sm font-semibold">
					{isNew
						? activeDoor.newLabel
						: selectedSource
							? activeDoor.title(selectedSource)
							: ""}
				</h3>
				<!-- The state, said in a word: a reader wants to know the book
				     holds what is on screen, not to infer it from a button. -->
				<span
					class="text-surface-600-400 shrink-0 text-xs"
					data-lore-save-state
				>
					{isNew
						? "Not saved yet"
						: dirty
							? "Unsaved changes"
							: "Saved"}
				</span>
				{#if canAmend}
					{@render amendSave()}
				{:else}
					<button
						class="btn btn-sm preset-filled-primary-500 shrink-0"
						type="button"
						onclick={save}
						disabled={saving || !activeDoor.validate(draft, siblings)}
					>
						<Icons.Save size={16} aria-hidden="true" />
						<span>{isNew ? "Create" : "Save"}</span>
					</button>
				{/if}
				{#if !isNew && selectedSource && activeDoor.store === "entries"}
					{@render editorMenu()}
				{/if}
			</div>
			<div class="flex flex-col gap-4">
				<Editor
					bind:draft
					source={selectedSource ?? null}
					{isNew}
					bind:bindings
					{vectorizationEnabled}
					{lorebookId}
					{siblings}
					{onNavigateToGraph}
				/>
			</div>
			<!-- What the newest run did with this row, under the fields and
			     above the account of why. A row nothing has saved has no run to
			     report on. -->
			{#if !isNew && selectedItem && activeDoor.store === "entries"}
				<AmendmentList
					{lorebookId}
					amendments={amendmentsFor?.(selectedItem.id) ?? []}
					moment={route.moment}
				/>
				<ReadInLine
					{lorebookId}
					sessionId={readingSessionId}
					sessionName={readingSessionName}
					entryId={selectedItem.id}
					decision={decisions?.[selectedItem.id] ?? null}
					short={mode === "compact"}
				/>
			{/if}
			<!-- Level two, and the last one. A row being created has no
			     inspector: every tab of it reports on a stored row, so a
			     verdict about text nothing has saved would be about nothing. -->
			{#if !isNew && selectedItem && selectedSource}
				<EntryInspector
					{lorebookId}
					item={selectedItem}
					source={selectedSource}
					door={activeDoor}
					pool={bookPool}
					links={bookLinks}
					showBody={mode === "desk"}
					onOpenItem={select}
				/>
			{/if}
		</div>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col gap-4">
			{#if selectedKey}
				<div class="flex flex-wrap items-center gap-2">
					{@render editorBack()}
				</div>
			{/if}
			<div
				class="text-surface-700-300 flex flex-1 items-center justify-center p-6 text-center text-sm italic"
			>
				{#if selectedKey && !poolReady}
					<Icons.Loader2
						size={20}
						class="text-surface-600-400 animate-spin"
					/>
				{:else if selectionMissing}
					That entry is not in this list any more.
				{:else}
					<!-- Empty copy is about an empty book, so a pool with rows
					     in it is told what to do instead. -->
					{editorPlaceholder({
						descriptor,
						poolEmpty: poolItems.length === 0,
						canCreate: creatableDoors.length > 0
					})}
				{/if}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet inspectorPane()}
	<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
		<!-- Drawn before the row is: the step back has to be there whatever
		     the list has answered with. -->
		<div class="flex flex-wrap items-center gap-2">
			<button
				class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
				type="button"
				onclick={() => loreRoute.openInspector(undefined)}
				title="Back to the entry"
				aria-label="Back to the entry"
			>
				<Icons.ChevronLeft size={16} aria-hidden="true" />
			</button>
			<h3 class="min-w-0 flex-1 truncate text-sm font-semibold">
				{selectedSource ? activeDoor.title(selectedSource) : ""}
			</h3>
		</div>
		{#if selectedItem && selectedSource}
			<EntryInspector
				{lorebookId}
				item={selectedItem}
				source={selectedSource}
				door={activeDoor}
				pool={bookPool}
				links={bookLinks}
				onOpenItem={select}
			/>
		{:else if !poolReady}
			<div class="flex items-center justify-center py-8">
				<Icons.Loader2
					size={20}
					class="text-surface-600-400 animate-spin"
				/>
			</div>
		{:else}
			<p class="text-surface-700-300 p-6 text-center text-sm italic">
				That entry is not in this list any more.
			</p>
		{/if}
	</div>
{/snippet}

<div
	class="flex min-h-0 flex-1 flex-col"
	data-lore-scope={descriptor.id}
	data-lore-lens={lens}
>
	{#if mode === "desk"}
		<div class="flex min-h-0 flex-1 gap-4">
			<div class="flex min-h-0 min-w-0 flex-1 flex-col">
				{@render list()}
			</div>
			<div
				class="border-border flex min-h-0 w-[420px] shrink-0 flex-col border-l pl-4"
				data-lore-editor
			>
				{@render editor()}
			</div>
		</div>
	{:else if step === "inspector"}
		<div class="flex min-h-0 flex-1 flex-col" data-lore-inspector-step>
			{@render inspectorPane()}
		</div>
	{:else if step === "editor"}
		<div class="flex min-h-0 flex-1 flex-col" data-lore-editor>
			{@render editor()}
		</div>
	{:else}
		{@render list()}
	{/if}
</div>

<!-- The cascade, stated before the question: what is filed under a row goes
     with it, and a reader must not discover that afterwards.

     ⚠ Counted over the whole book, never over the open scope, and at every
     depth: the anchor cascade walks the whole subtree, and a child of another
     kind is deleted with its parent whether or not this list can see it. A
     warning that leaves either out promises the wrong thing. -->
<DeleteLorebookEntryConfirmModal
	open={deleteTarget !== null}
	message={deleteWarning(
		deleteTarget ? descendantCount(deleteTarget.key, bookPool) : 0,
		{ everyLine: deleteIsEveryLine }
	)}
	onOpenChange={(e) => {
		if (!e.open) deleteTarget = null
	}}
	onConfirm={confirmDelete}
	onCancel={() => (deleteTarget = null)}
/>

{#if compileTarget}
	<CompileHistoryEntryModal
		open={compileOpen}
		onOpenChange={(e) => {
			compileOpen = e.open
			if (!e.open) compileTarget = null
		}}
		historyEntry={compileTarget as any}
		activityId={compileActivityId}
		pendingResult={compilePendingResult}
		initialStep={compileInitialStep}
		moment={momentDate}
		branchId={route.branch ?? null}
		knownAmendmentIds={knownAmendmentIds(compileTarget.id)}
		onDiscarded={(activityId) => compileEntriesCtx?.dismiss(activityId)}
	/>
{/if}

{#if processOpen && processSceneId !== null}
	<ProcessSceneModal
		open={processOpen}
		onOpenChange={(e) => (processOpen = e.open)}
		sceneId={processSceneId}
		activityId={processActivityId}
		pendingResult={processPendingResult ?? null}
		{lorebookId}
		lorebookBindingList={bindings}
		onApplied={() => (processOpen = false)}
		onDiscarded={() => (processOpen = false)}
	/>
{/if}
