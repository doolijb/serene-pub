<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import ResizableSplit from "$lib/client/components/panels/ResizableSplit.svelte"
	import { LORE_SPLIT_KEY } from "./layoutMode"
	import { memberShownName } from "$lib/shared/lorebooks/memberIdentity"
	import { embeddingsStarred } from "$lib/shared/constants/embeddings"
	import { getContext, onDestroy, onMount, tick, untrack } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import KeywordChips from "./editor/KeywordChips.svelte"
	import PartOfField from "./editor/PartOfField.svelte"
	import BeginningDecayRow from "./time/BeginningDecayRow.svelte"
	import {
		readsAsRegex,
		runawayPatternOf
	} from "$lib/shared/entries/runawayPattern"
	import { keyList } from "$lib/shared/entries/keyList"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import {
		rowsReadingOnLine,
		type Line
	} from "$lib/shared/lorebooks/lineReading"
	import { notify } from "$lib/client/utils/notify"
	import CompileHistoryEntryModal from "$lib/client/components/modals/CompileHistoryEntryModal.svelte"
	import DeleteLorebookEntryConfirmModal from "$lib/client/components/modals/DeleteLorebookEntryConfirmModal.svelte"
	import ProcessSceneModal from "$lib/client/components/modals/ProcessSceneModal.svelte"
	import {
		entryChannel,
		type BindingWithRelations
	} from "$lib/client/components/lorebookForms/entryManager"
	import {
		HISTORY_TYPE_ID,
		LOCATION_TYPE_ID,
		isFileableEntryType
	} from "$lib/shared/entries/types"
	import EntryPool from "./EntryPool.svelte"
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	import InlineError from "$lib/client/components/InlineError.svelte"
	import LooseEndsQueue from "./LooseEndsQueue.svelte"
	import type { ChoreField, LooseEnd } from "./looseEnds"
	import ReadInLine from "./editor/ReadInLine.svelte"
	import EntryEarmarkNotice from "./editor/EntryEarmarkNotice.svelte"
	import { askEntryEarmark } from "./editor/entryEarmark"
	import {
		canFileUnder,
		deleteWarning,
		descendantCount
	} from "./editor/partOf"
	import { deleteEntryTitle } from "./deleteCopy"
	import {
		amendmentDateToast,
		fileEntryAmendments,
		lineName,
		maskedBaseWarning,
		maskedFields,
		maskingAmendment,
		deleteEntryAmendment,
		updateEntryAmendment
	} from "./editor/entrySave"
	import { compileActivityAt } from "./editor/compileSave"
	import { awaitReply, isReplyTimeout } from "$lib/client/utils/awaitReply"
	import { v4 as uuid } from "uuid"
	import { toastUnsaved } from "$lib/client/utils/toastUnsaved"
	import type { RefLink } from "./editor/refs"
	import { retrievalReadout } from "./editor/retrievalReadout.svelte"
	import { loreRoute } from "./loreRoute.svelte"
	import {
		compactStep,
		momentKey,
		reduce,
		sameLineAndMoment,
		type LoreLens
	} from "$lib/shared/lorebooks/loreRoute"
	import {
		comparePoolBy,
		filterPool,
		libraryKey,
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
		editorPlaceholder,
		newHistoryDate
	} from "./sections"
	import EntryInspector from "./sections/EntryInspector.svelte"
	import CastPoolRow from "./sections/CastPoolRow.svelte"
	import LibraryPoolRow from "./sections/LibraryPoolRow.svelte"
	import {
		heldLibraryPieces,
		libraryOffered,
		libraryPoolItem,
		libraryRowsFor,
		librarySource,
		librarySourceLine
	} from "./libraryRows"
	import type { CastPoolItem } from "./castPool"
	import { newPlaceEntry } from "./places/placeGraph"
	import { kindLabel } from "./sections/kinds"
	import { setLorePoolCtx } from "./sections/poolContext"
	import { getBookData } from "./bookData.svelte"
	import type { EntryDecisions } from "./markers"
	import type { PoolSource, SectionDescriptor } from "./sections/types"
	import { compareDates, dateValue } from "./sections/historyDates"
	import { formatDate } from "./sections/historyDates"
	import { parseMoment } from "./time/moment"
	import {
		BookKnowledge,
		setBookKnowledge,
		socketKnowledgeApi
	} from "./knowledge/bookKnowledge.svelte"
	import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
	import AmendmentList from "./time/AmendmentList.svelte"
	import VersionRail from "./time/VersionRail.svelte"
	import VersionDateDialog from "./time/VersionDateDialog.svelte"
	import MoveDownTheTreeDialog from "./time/MoveDownTheTreeDialog.svelte"
	import { openBookTime } from "./time/bookTime.svelte"
	import {
		versionDateBounds,
		carriedFields,
		entryVersions,
		momentOfVersion,
		splitNewVersion,
		splitVersionSave,
		takenVersion,
		versionAt,
		zoneOf,
		blockedSentence,
		editsToVersionLabel,
		otherLinesRead,
		sameEverywherePlan,
		versionRedlineIds,
		ZONE_FIELDS,
		type EntryVersion,
		type ZoneField
	} from "./time/entryVersions"
	import {
		setVersionZones
	} from "./time/versionZones"
	import EditHistory from "./editHistory/EditHistory.svelte"
	import { CLEAR_ACTION_LABEL } from "./editHistory/editHistoryCopy"
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
		 * The cast on the line being read, as rows of Everything (note 12):
		 * All lists every kind the book holds, the people included. Drawn only
		 * by the door with no kind of its own; choosing one opens the Cast
		 * board.
		 */
		castItems?: CastPoolItem[]
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
		/**
		 * Every history entry the book holds, on every line — what dates a
		 * relationship, for a place's Links list.
		 */
		historyEntries?: PoolSource[]
		/**
		 * The line being read, with its ancestor chain and fork cuts — the
		 * shell's (`lineOf`), so this scope reads exactly the rows the rest of
		 * the workspace does. Required: a mount that forgot it would read main
		 * while the reader is on a branch.
		 */
		line: Line
		mode: "desk" | "compact"
		hasUnsavedChanges: boolean
		/** Which of the three reading lenses draws the list. */
		lens: LoreLens
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
		/**
		 * The Loose ends queue, when it is open (note 5): drawn in place of
		 * the list, and Save in the editor moves on to its next row.
		 */
		queue?: {
			rows: LooseEnd[]
			currentId: string | null
			onOpen: (row: LooseEnd) => void
			onNext: () => void
			onLeave: () => void
		} | null
		/**
		 * The field to focus once this entry's editor is drawn — the one a
		 * loose end's fix is. `n` makes a second press of the same row a new
		 * request.
		 */
		focusField?: { entryId: number; field: ChoreField; n: number } | null
		/** An entry was saved from the editor (the queue's Save → Next). */
		onSaved?: (entryId: number) => void
	}

	let {
		lorebookId,
		descriptor,
		doors,
		bookPool,
		castItems = [],
		resolve,
		amendmentsFor,
		bookLinks,
		historyEntries = [],
		line,
		mode,
		hasUnsavedChanges = $bindable(false),
		lens,
		filters,
		readInKeys,
		decisions,
		onFilters,
		onNavigateToGraph,
		queue = null,
		focusField = null,
		onSaved
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
	 * which is what makes "Everything" the same list with nothing narrowed.
	 */
	let poolDoors = $derived(
		descriptor.kind ? [descriptor] : doors.filter((d) => d.kind)
	)
	let entryDoors = $derived(poolDoors.filter((d) => d.store === "entries"))
	let scenesInScope = $derived(poolDoors.some((d) => d.store === "scenes"))

	/**
	 * The book, as the workspace holds it (plan B4): this scope asks for
	 * nothing on mount and keeps no copy of its own — every door's rows, the
	 * scenes and the cast are the workspace's, which already asked for the
	 * whole book and hears every cascade about it. A scope switch re-lists
	 * nothing.
	 */
	const book = getBookData()
	/** 🚧 The book's Timeline switch: every time control here reads this one value. */
	let timelineOn = $derived(book.timelineEnabled)
	/** The doors' rows as stored; a kind absent has not arrived yet. */
	let rowsByKind = $derived.by(() => {
		const out: Record<string, PoolSource[]> = {}
		for (const door of entryDoors) {
			const rows = book.rawRows[door.kind!]
			if (rows !== undefined) out[door.kind!] = rows
		}
		return out
	})
	let sceneList = $derived(
		book.allScenes as unknown as Sockets.Scenes.SceneWithMeta[]
	)
	let scenesLoaded = $derived(book.loaded("scenes"))
	/**
	 * The cast, held as state so the editor's binding picker can add to it,
	 * and following the workspace's whenever that moves.
	 */
	let bindings = $state<BindingWithRelations[]>([])
	$effect(() => {
		bindings = [...book.cast] as BindingWithRelations[]
	})

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
	/**
	 * The reading a compile runs and saves at, fixed when its modal opens:
	 * a resumed compile's is the line and moment it was ASKED at, which its
	 * activity holds; a fresh one's is the route's at the click. Never
	 * wherever this workspace stands later — Back or Forward on the hash
	 * moves the route under an open dialog.
	 */
	let compileReading = $state<{
		branchId: number | null
		moment: StoryDate | null
	}>({ branchId: null, moment: null })
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
	let moveDownOpen = $state(false)
	/** The open entry's Edit history, as its fold reports it (for the ⋯ item). */
	let editHistoryState = $state<{
		entryId: number
		count: number
		canClear: boolean
	} | null>(null)
	let clearHistoryOpen = $state(false)
	/** The save control's second half, offered only while reading as-of. */
	let saveMenuOpen = $state(false)

	// 🚧 No timeline: the Scenes list opens in the order played.
	let orderBy = $derived(
		chosenOrder ??
			(!timelineOn && descriptor.id === "scenes"
				? "position-asc"
				: DEFAULT_POOL_SORT)
	)

	// 🚧 No timeline: the route as the pool reads it. No moment is read, and a
	// route naming a history entry (and no scene) selects nothing, as the shell
	// draws it. The route itself is never written back.
	let route = $derived.by(() => {
		const r = loreRoute.route
		if (timelineOn) return r
		const namesHistory =
			r.entryId != null &&
			r.sceneId == null &&
			(rowsByKind[HISTORY_TYPE_ID] ?? []).some((h) => h.id === r.entryId)
		return {
			...r,
			moment: undefined,
			...(namesHistory ? { entryId: undefined } : {})
		}
	})
	/**
	 * The scenes on the line being read — shared ones, this branch's own and
	 * each ancestor line's (the chain, never a sibling's): the rule
	 * `entries:counts` counts by (`onLineSql`). `scenes:listByLorebook` answers with
	 * every line (its reply reaches every view of the book), so the pool and
	 * the count agree only if the pool keeps to its line.
	 */
	let scenesOnLine = $derived(rowsReadingOnLine(sceneList, line))
	/** An empty set is "read nothing"; no set at all is "nobody is reading". */
	let readIn = $derived(readInKeys ?? new Set<string>())

	/**
	 * The conversation reading this book, which is the one the marks and the
	 * Read in line are about: the open session when it reads the book (its
	 * lorebook, or its own notes), else the newest session in the book's
	 * `readBy`. A session reading another book decided nothing about these
	 * rows; a book nothing reads has none.
	 */
	let openReads = $derived(
		openSessionCtx?.lorebookId === lorebookId ||
			(openSessionCtx?.sessionId != null &&
				book.sessionId === openSessionCtx.sessionId)
	)
	let readingSessionId = $derived(
		openReads ? openSessionCtx.sessionId : (book.readBy[0]?.id ?? null)
	)
	let readingSessionName = $derived(
		readingSessionId === null
			? null
			: openReads
				? (openSessionCtx.sessionName ?? "the open session")
				: (book.readBy[0]?.name ?? "a session")
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

	/** How All draws a cast member's row: their face, and no entry menu. */
	let castRowDoor = $derived<SectionDescriptor>({
		...descriptor,
		row: CastPoolRow,
		rowMenu: undefined
	})

	/**
	 * 🚧 The book's rules library under this list (§C, ruling 10): the
	 * pieces of the list's kinds the book holds no copy of on the line being
	 * read (a copy stands in its piece's place). Always in the pool, listed
	 * only while the ‹Rules› library chip is on (`filterPool`), and never
	 * the book's: not counted, filed, queued or jumped to (`bookPool` never
	 * holds them).
	 */
	let library = $derived(book.library)
	let libraryKinds = $derived(new Set(entryDoors.map((d) => d.kind!)))
	let libraryRows = $derived(
		libraryRowsFor(library, libraryKinds, heldLibraryPieces(resolvedByKind))
	)
	/** The chip's word ("Vis Itineris library"), or null where nothing is offered. */
	let libraryName = $derived(
		libraryOffered(library, libraryKinds) ? library!.name : null
	)

	/** How a library piece's row is drawn: its badge, and no row menu. */
	let libraryRowDoor = (door: SectionDescriptor): SectionDescriptor => ({
		...door,
		row: LibraryPoolRow,
		rowMenu: undefined
	})

	/**
	 * 🚧 No timeline: the scenes in the order they were played — by the first
	 * message each holds (message ids only grow, across sessions), then by
	 * capture. No scene is filed under a dated entry here, so no date
	 * orders them.
	 */
	let playedRank = $derived.by(() => {
		const rank = new Map<number, number>()
		const first = (s: PoolSource) => {
			const ids = (s.selectedMessageIds ?? []) as number[]
			return ids.length ? Math.min(...ids) : Infinity
		}
		;[...scenesOnLine]
			.sort((a, b) => first(a) - first(b) || a.id - b.id)
			.forEach((scene, i) => rank.set(scene.id, i))
		return rank
	})

	/** 🚧 The History divider's figure: the book's history entries on the line, archived ones not counted. */
	let historyDividerCount = $derived(
		(book.rows[HISTORY_TYPE_ID] ?? []).filter((r) => !r.archived).length
	)

	let poolItems = $derived.by(() => {
		const out: PoolItem[] = []
		for (const door of poolDoors) {
			// 🚧 No timeline: history entries stay in the book but are not listed.
			if (!timelineOn && door.kind === HISTORY_TYPE_ID) continue
			const rows =
				door.store === "scenes"
					? scenesOnLine
					: (resolvedByKind[door.kind!] ?? [])
			for (const row of rows) {
				const item = door.toPoolItem(row)
				if (!timelineOn && door.store === "scenes") {
					const at = playedRank.get(row.id) ?? row.id
					item.order = at
					item.position = at
				}
				out.push(item)
			}
		}
		// Everything is every kind, the people too (note 12).
		if (!descriptor.kind) out.push(...castItems)
		for (const row of libraryRows) out.push(libraryPoolItem(row))
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
		// A cast row's source is the row itself: it lists, and opens Cast.
		if (!descriptor.kind)
			for (const item of castItems) map.set(item.key, { ...item })
		// A library piece's source reads as the entry a copy of it would be.
		for (const row of libraryRows)
			map.set(
				libraryKey(row.typeId, row.id),
				librarySource(row, lorebookId)
			)
		return map
	})

	/**
	 * What the timeline cursor says is not true yet at the moment being read.
	 *
	 * Only dated rows can be later than a date, so the question is asked of
	 * every entry row with a numeric `year`: a history entry's date, or
	 * another entry's Beginning. Scenes, cast and library pieces are not
	 * asked; they order by position and would answer with a number that means
	 * something else entirely.
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
					.filter(
						(i) =>
							i.kind !== SCENE_KIND &&
							i.kind !== CAST_KIND &&
							!i.fromLibrary
					)
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
	/** What the list can list: the book's rows, and the library's while its chip is on. */
	let listedCount = $derived(
		facets.total + (filters.library ? facets.library : 0)
	)
	let summary = $derived.by(() => {
		// The book's rows and the library's pieces are counted apart: a
		// piece is listed here, never held.
		const shown = visibleItems.filter((i) => !i.fromLibrary).length
		const pieces = visibleItems.length - shown
		return poolSummary(
			shown,
			readInKeys
				? visibleItems.filter((i) => readInKeys.has(i.key)).length
				: null,
			pieces && library?.name
				? { count: pieces, name: library.name }
				: null
		)
	})

	/**
	 * 🚧 The library piece open in the editor, read only, by its key. Not an
	 * address: a piece is the rules', and the route names the book's rows.
	 * Any row the route opens takes its place.
	 */
	let libraryOpenKey = $state<string | null>(null)
	$effect(() => {
		if (route.entryId != null || route.sceneId != null || !filters.library)
			untrack(() => {
				if (libraryOpenKey !== null) libraryOpenKey = null
			})
	})

	let selectedKey = $derived(
		route.sceneId != null
			? `scene#${route.sceneId}`
			: route.entryId != null
				? `entry#${route.entryId}`
				: libraryOpenKey
	)
	let selectedItem = $derived(
		selectedKey ? poolItems.find((i) => i.key === selectedKey) : undefined
	)
	let selectedSource = $derived(
		selectedKey ? sourceByKey.get(selectedKey) : undefined
	)
	/** The library piece the editor is reading, when it is reading one. */
	let libraryOpenRow = $derived(
		selectedItem?.fromLibrary
			? libraryRows.find(
					(r) => libraryKey(r.typeId, r.id) === selectedItem!.key
				)
			: undefined
	)
	let libraryOpen = $derived(!!libraryOpenRow)
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
	/** The list says it is loading until its doors have answered. */
	let loading = $derived(!poolReady)
	/** An address that names a row this pool does not hold. */
	let selectionMissing = $derived(
		!isNew && !!selectedKey && !selectedSource && poolReady
	)

	/**
	 * A shared book is read-only (PLAN-private-messages §6.7): nothing is
	 * created, saved, archived, amended, filed or deleted; a row opens to
	 * read, its fields disabled.
	 */
	let readOnly = $derived(book.readOnly)

	// 🚧 No timeline: a history entry is not offered as a new entry.
	let creatableDoors = $derived(
		readOnly
			? []
			: descriptor.kind
				? descriptor.creatable &&
					(timelineOn || descriptor.kind !== HISTORY_TYPE_ID)
					? [descriptor]
					: []
				: doors.filter(
						(d) =>
							d.creatable &&
							d.kind &&
							(timelineOn || d.kind !== HISTORY_TYPE_ID)
					)
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
	/** Zone fields made to differ by version in this draft; cleared with it. */
	const promoted = new SvelteSet<ZoneField>()

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
			promoted.size > 0 ||
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
			// A scene not yet compiled has no entry to sit under (0142).
			if (scene.historyEntryId === null) continue
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
				memberShownName(b, b.character) || b.name || b.binding
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
		compileActivityOf: (id) =>
			compileActivityAt(compileEntriesCtx?.activities, id, {
				branchId: route.branch ?? null,
				moment: momentDate
			}),
		openProcess: (sceneId, activityId) => openProcess(sceneId, activityId),
		refreshScenes: () => fetchScenes(),
		get onNavigateToGraph() {
			return onNavigateToGraph
		},
		get historyEntries() {
			return historyEntries as any
		},
		createPlace
	})

	/**
	 * A new place with this name, on the line being read — **New place…** at
	 * the far end of a place's link. The entry's own create, answered the
	 * same way: `entries:create` is broadcast to every tab of this user, so
	 * the reply is claimed only when it is this row.
	 */
	async function createPlace(
		name: string
	): Promise<{ id: number; name: string }> {
		const wanted = name.trim()
		if (!wanted) throw new Error("A new place needs a name.")
		const created = await awaitReply({
			socket,
			event: "entries:create",
			// The one way a place is made on the spot (the canvas's too).
			params: newPlaceEntry(lorebookId, wanted, route.branch ?? null),
			replyKey: interestKey("entries:create", lorebookId),
			errorEvent: "entries:create:error",
			fallbackError: "The place could not be created.",
			match: (data) =>
				data.entry?.lorebookId === lorebookId &&
				data.entry.typeId === LOCATION_TYPE_ID &&
				trimmed(data.entry.name) === wanted
		})
		notify.success({ title: `Place created: ${wanted}` })
		return { id: created.entry.id, name: created.entry.name ?? wanted }
	}

	/** The scenes, asked for again through the workspace (it holds the list). */
	function fetchScenes() {
		book.refreshScenes()
	}

	/**
	 * The compile modal for a history entry: on `activity` when the Activity
	 * card named one, else on the compile asked at the reading being read —
	 * never another line's compile of the same entry, whose review saves
	 * somewhere else.
	 */
	function openCompile(entry: PoolSource, named?: CompileEntryState) {
		const here = { branchId: route.branch ?? null, moment: momentDate }
		const activity =
			named ??
			compileActivityAt(compileEntriesCtx?.activities, entry.id, here)
		compileTarget = entry
		compileActivityId = activity?.activityId ?? null
		compilePendingResult = activity?.pendingResult ?? null
		compileInitialStep =
			activity?.status === "review"
				? "review"
				: activity?.status === "running"
					? "running"
					: undefined
		compileReading = compileInitialStep
			? { branchId: activity!.branchId, moment: activity!.moment }
			: here
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
		promoted.clear()
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
		// A library piece opens to read, beside the route: the row the
		// route held closes first (its guard asks about unsaved changes).
		if (item.fromLibrary) {
			if (route.entryId != null || route.sceneId != null) {
				await loreRoute.navigate({ type: "back" })
				const now = loreRoute.route
				if (now.entryId != null || now.sceneId != null) return
			}
			libraryOpenKey = item.key
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
		libraryOpenKey = null
		creatingDoor = door
		draftKey = "new"
		draft = {
			...door.newDraft(lorebookId),
			...(door.kind === HISTORY_TYPE_ID
				? (newHistoryDate(openBookTime, route.branch ?? null) ?? {})
				: {})
		}
		pristineDraft = { ...$state.snapshot(draft) }
	}

	async function closeEditor() {
		if (!(await loreRoute.confirmLeave())) return
		const wasCreating = creatingDoor !== null
		const wasLibrary = libraryOpen
		discardDraft()
		if (wasLibrary) libraryOpenKey = null
		else if (!wasCreating) void loreRoute.navigate({ type: "back" })
	}

	/** Whether **Edit a copy** is on its way to the server. */
	let copying = $state(false)

	/**
	 * 🚧 **Edit a copy** (§C, ruling 10: "On edit, they are imported"): the
	 * server copies the open library piece into the book, on the line being
	 * read, as an entry of its list (`entries:copyFromLibrary`, which answers
	 * with the copy the line already holds when there is one), and the
	 * editor moves to the copy — the book's own from then on. A refusal is
	 * said by Layout's `:error` catch-all; a reply that never came, here.
	 */
	async function editACopy() {
		const row = libraryOpenRow
		if (!row || readOnly || copying) return
		copying = true
		try {
			const res = await awaitReply({
				socket,
				event: "entries:copyFromLibrary",
				params: {
					lorebookId,
					branchId: route.branch ?? null,
					typeId: row.typeId,
					pieceId: row.id
				},
				replyKey: interestKey("entries:copyFromLibrary", lorebookId),
				errorEvent: "entries:copyFromLibrary:error",
				fallbackError: "The copy could not be made.",
				match: (data) =>
					data.entry?.lorebookId === lorebookId &&
					data.entry.typeId === row.typeId &&
					data.entry.derivedFrom?.piece === row.id
			})
			libraryOpenKey = null
			discardDraft()
			await loreRoute.navigate({
				type: "openEntry",
				entryId: res.entry.id
			})
		} catch (err) {
			reportUnanswered(err, "The copy could not be made")
		} finally {
			copying = false
		}
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
	 * The moment the draft is being typed at, which is where its save files
	 * (plan B7). A clean draft follows the reading — it is rebuilt from the
	 * row as it reads — so its moment does too; once the author has typed,
	 * it keeps the moment the typing began at. Text typed at A and saved
	 * after the bar moved to B files at A, never at B (and text typed at now
	 * is never filed as an amendment because the bar moved off now).
	 */
	let draftMoment = $state<StoryDate | null>(null)
	$effect(() => {
		const at = momentDate
		if (!dirty) draftMoment = at
	})

	/**
	 * 🚧 The rail is drawn for a stored entry (not a history entry) while the
	 * book keeps a timeline: the form shows one entry with its versions, and
	 * the rail's selection is the version in force at the moment.
	 */
	/**
	 * The entry's and its dated changes' save times: a save of a version alone
	 * moves only the latter, and the edit history asks again on either.
	 */
	let editsToken = $derived(
		selectedSource
			? [
					selectedSource.updatedAt ?? "",
					...(amendmentsFor?.(selectedSource.id) ?? []).map(
						(a) => `${a.id}:${a.updatedAt ?? ""}`
					)
				].join("|")
			: null
	)
	let railed = $derived(
		timelineOn &&
			!isNew &&
			!libraryOpen &&
			activeDoor.store === "entries" &&
			activeDoor.kind !== HISTORY_TYPE_ID &&
			selectedSource != null
	)
	let rail = $derived(
		railed && selectedSource
			? entryVersions({
					entry: selectedSource as any,
					amendments: amendmentsFor?.(selectedSource.id) ?? [],
					line
				})
			: null
	)
	let shownVersion = $derived(
		rail ? versionAt(rail.versions, momentDate) : null
	)
	let carried = $derived(
		rail ? carriedFields(rail.versions) : new Set<string>()
	)
	/** The entry version the draft is being typed on; follows the shown one while the draft is clean. */
	let draftVersionKey = $state<string | null>(null)
	let draftVersion = $derived(
		rail
			? (rail.versions.find((v) => v.key === draftVersionKey) ??
					shownVersion)
			: null
	)
	/** Only an own entry version, or the beginning of an entry this line owns, is written in place. */
	let saveOff = $derived(!!draftVersion && !draftVersion.own)

	setVersionZones({
		get railed() {
			return railed
		},
		zoneOf: (field) => zoneOf(field, carried, promoted),
		sameEverywhere,
		get entryZoneRow() {
			return entryZoneRow
		}
	})

	/**
	 * The entry area writes the entry's own stored values, so it is editable
	 * only where *From the beginning* is: on the line that owns the entry.
	 */
	let entryEditable = $derived(!readOnly && !!rail && rail.versions[0].own)
	let entryOwnerLine = $derived(
		openBookTime.lineName(selectedSource?.branchId ?? null)
	)
	let entryBelongsSentence = $derived(
		`The entry belongs to ${entryOwnerLine}; open it there to change it.`
	)
	/** A field of the four can move into the dated version being edited. */
	let canPromote = $derived(
		!readOnly && draftVersion?.kind === "dated" && draftVersion.own
	)

	/** The form draws the entry zone's row; History, scenes and the cast keep their own forms. */
	let entryZoneRow = $derived(
		!!draft &&
			activeDoor.store === "entries" &&
			activeDoor.kind !== HISTORY_TYPE_ID &&
			draft.typeId !== HISTORY_TYPE_ID
	)
	/** The row as the person left it for one entry; not remembered across entries. */
	let rowOpenFor = $state<{ key: string | null; open: boolean } | null>(null)
	/** A form that cannot write the row opens it. */
	let entryRowDisabled = $derived(
		railed ? !entryEditable : readOnly || libraryOpen
	)
	/**
	 * 🚧 Not common knowledge: the book's one store holds the mark and writes it
	 * at once (never part of the draft). Provided so the pool's bulk bar and the
	 * inspector's Known by tab find the same copy.
	 */
	const knowledge = new BookKnowledge(socketKnowledgeApi(socket))
	setBookKnowledge(knowledge)
	/** The owner's (their marks read succeeded), on a stored entry the form lets them change. */
	let knowledgeToggleShown = $derived(
		knowledge.loaded &&
			!libraryOpen &&
			!isNew &&
			!!selectedSource &&
			activeDoor.store === "entries" &&
			!entryRowDisabled
	)
	$effect(() => {
		if (readOnly) return
		return knowledge.open(lorebookId)
	})
	$effect(() => {
		const id =
			knowledge.loaded &&
			!isNew &&
			!libraryOpen &&
			activeDoor.store === "entries" &&
			selectedSource
				? selectedSource.id
				: null
		const at = momentDate
		knowledge.showEntry(id, {
			branchId: route.branch ?? null,
			moment: at
				? {
						year: at.year,
						month: at.month ?? null,
						day: at.day ?? null
					}
				: null
		})
	})
	let markBusy = $state(false)
	let markError = $state<string | null>(null)
	// A refusal belongs to the entry it was said under.
	$effect(() => {
		void selectedSource?.id
		markError = null
	})
	async function toggleNotCommon() {
		if (!selectedSource || markBusy) return
		markError = null
		markBusy = true
		try {
			await knowledge.setMark(
				[selectedSource.id],
				!knowledge.isMarked(selectedSource.id)
			)
		} catch (err) {
			markError =
				err instanceof Error && err.message
					? err.message
					: "The entries could not be marked."
		} finally {
			markBusy = false
		}
	}
	/**
	 * 🚧 The lock on the open row (an entry or a scene): sessions and their
	 * routines leave it as it is. One value, never dated, never part of the
	 * draft, written at once. Offered to whoever may edit the row; a reader who
	 * cannot edit it is only told when it is on.
	 */
	let lockOn = $derived(
		!!selectedSource &&
			(activeDoor.store === "scenes"
				? selectedSource.sceneLock === true
				: selectedSource.entryLock === true)
	)
	let lockStored = $derived(
		!isNew &&
			!libraryOpen &&
			!!selectedSource &&
			(activeDoor.store === "scenes" || activeDoor.store === "entries") &&
			typeof selectedSource.id === "number"
	)
	let lockBusy = $state(false)
	let lockError = $state<string | null>(null)
	// A refusal belongs to the row it was said under.
	$effect(() => {
		void selectedKey
		lockError = null
	})
	async function toggleLock() {
		const row = selectedSource
		if (!row || lockBusy || readOnly) return
		const locked = !lockOn
		lockError = null
		lockBusy = true
		try {
			if (activeDoor.store === "scenes") {
				const requestId = uuid()
				await awaitReply({
					socket,
					event: "scenes:update",
					params: { scene: { id: row.id, sceneLock: locked }, requestId },
					errorEvent: "scenes:update:error",
					fallbackError: "The lock could not be saved.",
					match: (reply) => reply.requestId === requestId,
					matchError: (reply) =>
						(reply as { requestId?: unknown } | null)?.requestId === requestId
				})
			} else {
				const request = `lock:${uuid()}`
				await awaitReply({
					socket,
					event: "entries:setMarks",
					params: { entryId: row.id, locked, request },
					errorEvent: "entries:setMarks:error",
					fallbackError: "The lock could not be saved.",
					match: (reply) => reply.request === request && !reply.error,
					matchError: (reply) =>
						(reply as { request?: unknown } | null)?.request === request
				})
			}
		} catch (err) {
			lockError =
				err instanceof Error && err.message
					? err.message
					: "The lock could not be saved."
		} finally {
			lockBusy = false
		}
	}
	let entryRowOpen = $derived(
		rowOpenFor && rowOpenFor.key === draftKey
			? rowOpenFor.open
			: entryRowDisabled
	)
	function setEntryRowOpen(open: boolean) {
		rowOpenFor = { key: draftKey, open }
	}
	// A keyword the server will refuse says so inside the row: the row opens.
	$effect(() => {
		const keys = draft?.keys
		const bad =
			!!draft &&
			heldFields.includes("keys") &&
			readsAsRegex(draft) &&
			(Array.isArray(keys) ? keys : keyList(keys)).some(
				(k: string) => runawayPatternOf(k) !== null
			)
		if (bad) untrack(() => setEntryRowOpen(true))
	})
	let heldFields = $derived(
		ZONE_FIELDS.filter((f) => zoneOf(f, carried, promoted) === "entry")
	)
	let parentName = $derived.by(() => {
		const id = draft?.anchorEntryId
		if (id == null) return null
		return (
			bookPool.find((item) => item.key === `entry#${id}`)?.name || `#${id}`
		)
	})
	let promotable = $derived(
		canPromote
			? ([
					{ field: "keys", name: "Keywords" },
					{ field: "anchorEntryId", name: "Part of" },
					{ field: "constant", name: "Pinned" },
					{ field: "enabled", name: "Off" }
				] as const).filter(
					(z) =>
						heldFields.includes(z.field) &&
						!(
							z.field === "anchorEntryId" &&
							typeof draft?.typeId === "string" &&
							!isFileableEntryType(draft.typeId)
						)
				)
			: []
	)

	/** Whether the pending Save would write the entry where other lines read it. */
	let writesSharedEntry = $derived.by(() => {
		if (!railed || !draft || !draftVersion || !selectedSource) return false
		if (!pristineDraft) return false
		if (!otherLinesRead(selectedSource as any, openBookTime.branches))
			return false
		const snap = $state.snapshot(draft) as Record<string, unknown>
		return (
			splitVersionSave({
				diff: changedFields(snap, pristineDraft),
				draft: snap,
				selected: draftVersion,
				carried,
				promoted
			}).entryPatch !== null
		)
	})

	/** What **Make it the same everywhere** does to a field that differs by version. */
	function sameEverywhere(
		field: ZoneField
	): { count: number; run: () => void } | { blocked: string } {
		if (!rail || !draft) return { blocked: "" }
		const snap = $state.snapshot(draft) as Record<string, unknown>
		const others = Object.keys(
			changedFields(snap, pristineDraft ?? {})
		).filter((k) => k !== field)
		if (others.length || [...promoted].some((f) => f !== field))
			return { blocked: "Save or discard your changes first." }
		if (promoted.has(field) && !carried.has(field))
			return { count: 0, run: () => promoted.delete(field) }
		const plan = sameEverywherePlan(field, rail.versions, snap[field])
		if (plan.blockedBy)
			return {
				blocked: blockedSentence(
					plan.blockedBy,
					openBookTime.lineName(plan.blockedBy.branchId)
				)
			}
		if (!entryEditable) return { blocked: entryBelongsSentence }
		return {
			count: plan.versionsChanged,
			run: () => void runSameEverywhere(field, plan, snap)
		}
	}

	async function runSameEverywhere(
		field: ZoneField,
		plan: ReturnType<typeof sameEverywherePlan>,
		snap: Record<string, unknown>
	) {
		if (!selectedSource || saving) return
		const id = selectedSource.id
		const door = activeDoor
		saving = true
		try {
			for (const row of plan.rewrites)
				await updateEntryAmendment(socket, {
					lorebookId,
					id: row.id,
					subject: "entry",
					fields: row.fields
				} as Sockets.Amendments.Update.Params)
		} catch (err) {
			saving = false
			reportUnanswered(err, `${door.label} was not saved`)
			return
		}
		if (!(await writeEntryFields(plan.entryPatch, false))) {
			saving = false
			return
		}
		saving = false
		settleDraft(`entry#${id}`, snap)
		promoted.delete(field)
	}

	$effect(() => {
		void selectedKey
		untrack(() => promoted.clear())
	})

	/** The moment the draft's entry version was last in force at. */
	let momentOfDraft: string | undefined
	let askingMoment = false
	// One selection: the moment bar and the rail. A moment that changes the
	// entry version under unsaved edits is asked about once.
	$effect(() => {
		const key = shownVersion?.key ?? null
		const moment = route.moment
		const isDirty = dirty
		const isRailed = railed
		untrack(() => {
			if (!isRailed || !isDirty || key === draftVersionKey) {
				if (!isDirty) draftVersionKey = key
				momentOfDraft = moment
				return
			}
			// A save in flight is what changed the version (a new version
			// lands before the draft settles): the draft goes with it, unasked.
			if (saving) {
				draftVersionKey = key
				momentOfDraft = moment
				return
			}
			if (askingMoment) return
			askingMoment = true
			const back = momentOfDraft
			void loreRoute.confirmLeave().then((leave) => {
				askingMoment = false
				if (leave) discardDraft()
				else
					loreRoute.set(
						reduce(loreRoute.route, {
							type: "setMoment",
							moment: back
						})
					)
			})
		})
	})

	/** The rail's re-date: the edited row of a version, or an Elsewhere row. */
	function redateEntryVersion(
		target:
			| { version: EntryVersion }
			| { row: Sockets.Amendments.EntryRow },
		date: StoryDate
	) {
		return updateEntryAmendment(socket, {
			lorebookId,
			id:
				"version" in target
					? target.version.editRow!.id
					: target.row.id,
			subject: "entry",
			year: date.year,
			month: date.month,
			day: date.day
		})
	}

	/** The rail's delete: every row of a version in id order, or one Elsewhere row. */
	async function deleteEntryVersion(
		target: { version: EntryVersion } | { row: Sockets.Amendments.EntryRow }
	) {
		const rows = "version" in target ? target.version.rows : [target.row]
		for (const r of [...rows].sort((x, y) => x.id - y.id))
			await deleteEntryAmendment(socket, {
				lorebookId,
				id: r.id,
				subject: "entry"
			})
	}

	async function selectVersion(v: EntryVersion) {
		if (!rail || v.key === shownVersion?.key) return
		const at = momentOfVersion(rail.versions, v)
		if (!at) return
		if (dirty) {
			if (!(await loreRoute.confirmLeave())) return
			discardDraft()
		}
		loreRoute.set(
			reduce(loreRoute.route, {
				type: "setMoment",
				moment: momentKey(at)
			})
		)
	}

	async function openVersionOnLine(
		branchId: number | null,
		date: StoryDate | null
	) {
		if (dirty) {
			if (!(await loreRoute.confirmLeave())) return
			discardDraft()
		}
		loreRoute.set(
			reduce(
				reduce(loreRoute.route, {
					type: "setBranch",
					branch: branchId ?? undefined
				}),
				{
					type: "setMoment",
					moment: date ? momentKey(date) : undefined
				}
			)
		)
	}

	let newVersionOpen = $state(false)

	/**
	 * Whether this save is a choice.
	 *
	 * Only an existing ENTRY read at a moment can be amended: a scene has no
	 * amendment table, and a row that does not exist yet has no base to leave
	 * alone.
	 */
	let canAmend = $derived(
		// 🚧 No timeline: nothing dated is written, so a save is only a save.
		timelineOn &&
			draftMoment !== null &&
			!isNew &&
			activeDoor.kind === HISTORY_TYPE_ID &&
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
			notify.error({ title: "Nothing has changed" })
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
			notify.error({
				title,
				description:
					"The server did not answer in time. Your changes are still here."
			})
	}

	/**
	 * The sentence that says why Save is off: a run in progress was shown this
	 * entry and may still replace its text. Asked when an entry opens, on Check
	 * again, and once after a refused save; never polled. An answer that comes
	 * back after the editor has moved on is dropped.
	 */
	let earmarkNotice = $state<string | null>(null)
	let earmarkChecking = $state(false)
	let earmarkTicket = 0

	async function checkEarmark(entryId: number, onlySentence = false) {
		const ticket = ++earmarkTicket
		earmarkChecking = true
		const notice = await askEntryEarmark(socket, lorebookId, entryId)
		if (ticket !== earmarkTicket || draftKey !== `entry#${entryId}`) return
		earmarkChecking = false
		if (notice !== null || !onlySentence) earmarkNotice = notice
	}

	/** After a refused save: ask once, unless nobody answered the save. */
	function askAfterRefusal(err: unknown, entryId: number) {
		if (isReplyTimeout(err)) return
		void checkEarmark(entryId, true)
	}

	$effect(() => {
		const key = draftKey
		const mayAsk =
			!isNew &&
			!readOnly &&
			!libraryOpen &&
			activeDoor.store === "entries" &&
			!!key?.startsWith("entry#")
		untrack(() => {
			earmarkTicket++
			earmarkNotice = null
			earmarkChecking = false
			if (mayAsk) void checkEarmark(Number(key!.slice("entry#".length)))
		})
	})

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
		if (!draftMoment || !selectedSource || saving) return
		const fields = pendingFields()
		if (!fields) return
		const dated = amendmentDateToast(fields)
		if (dated) {
			notify.error(dated)
			return
		}
		const entryId = selectedSource.id
		const branchId = route.branch ?? null
		// The draft's moment, not the bar's (see `draftMoment`).
		const date = draftMoment
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
			askAfterRefusal(err, entryId)
			return
		}
		saving = false
		const line = lineName(reply, branchId)
		notify.success({
			title: `Amended as of ${formatDate(date)}${line ? ` on ${line}` : ""}`
		})
		settleDraft(key, sent)
		await savedThen(entryId)
	}

	/**
	 * Tells the frame an entry was saved — the Loose ends queue's Save → Next.
	 * After a tick, so the draft the reply settled is settled before anything
	 * navigates (a move asked while it still looked dirty would be guarded).
	 */
	async function savedThen(entryId: number) {
		if (!onSaved) return
		await tick()
		onSaved(entryId)
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
		notify.success({
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
					line,
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
				toastUnsaved(err, `${door.label} was not created`)
				return
			}
			saving = false
			notify.success({ title: `${door.label} created` })
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
			if (railed) {
				await saveVersion()
				return
			}
			const fields = pendingFields()
			// Nothing to write. In the queue, Save still moves on: the row
			// stays a loose end and the reader has chosen to pass it.
			if (!fields) {
				await savedThen(payload.id as number)
				return
			}
			const id = payload.id as number
			saving = true
			const ok = await writeEntryFields(fields, true)
			saving = false
			if (ok) await savedThen(id)
		}
	}

	/**
	 * Writes entry fields to the entry itself and says how it went. The draft
	 * is settled by the channel's `onUpdated` when `settles` (a plain save);
	 * a railed save settles its own draft, because the entry's reply is the
	 * entry, not the version being read. Returns whether the server took it.
	 */
	async function writeEntryFields(
		fields: Record<string, unknown>,
		settles: boolean,
		toast = true
	): Promise<boolean> {
		const door = activeDoor
		const kind = door.kind!
		const id = selectedSource!.id
		const key = `entry#${id}`
		const warning = baseSaveWarning(kind, id, fields)
		if (settles) awaitingSave = key
		const requestId = uuid()
		try {
			await awaitReply({
				socket,
				event: "entries:update",
				params: {
					entry: { ...fields, id, typeId: kind } as any,
					requestId
				},
				replyKey: interestKey("entries:update", lorebookId),
				errorEvent: "entries:update:error",
				fallbackError: "The entry could not be saved.",
				match: (data) => data?.requestId === requestId,
				matchError: (data) =>
					(data as { requestId?: string } | undefined)?.requestId ===
					requestId
			})
		} catch (err) {
			if (awaitingSave === key) awaitingSave = null
			reportUnanswered(err, `${door.label} was not saved`)
			// Layout leaves a refusal that names its asker to the asker.
			if (!isReplyTimeout(err))
				notify.error({
					title: `${door.label} was not saved`,
					description:
						(err instanceof Error && err.message) ||
						"The entry could not be saved."
				})
			askAfterRefusal(err, id)
			return false
		}
		if (toast) {
			if (warning) notify.warning(warning)
			else notify.success({ title: `${door.label} saved` })
		}
		return true
	}

	/**
	 * Save on a railed entry: the entry's own fields go to the entry, the
	 * rest to the entry version being edited, both from one diff. The draft
	 * is kept until the server has it; focus stays where it was.
	 */
	async function saveVersion() {
		if (!draft || !selectedSource || !railed || saving) return
		const version = draftVersion
		if (!version || !version.own) return
		const snap = $state.snapshot(draft) as Record<string, unknown>
		const diff = changedFields(snap, pristineDraft ?? {})
		const id = selectedSource.id
		if (!Object.keys(diff).length && promoted.size === 0) {
			notify.error({ title: "Nothing has changed" })
			await savedThen(id)
			return
		}
		const { entryPatch, versionFields } = splitVersionSave({
			diff,
			draft: snap,
			selected: version,
			carried,
			promoted
		})
		const door = activeDoor
		saving = true
		if (versionFields && version.editRow) {
			try {
				await updateEntryAmendment(socket, {
					lorebookId,
					id: version.editRow.id,
					subject: "entry",
					fields: versionFields
				} as Sockets.Amendments.Update.Params)
			} catch (err) {
				saving = false
				reportUnanswered(err, `${door.label} was not saved`)
				askAfterRefusal(err, id)
				return
			}
		}
		if (entryPatch && !(await writeEntryFields(entryPatch, false))) {
			saving = false
			return
		}
		saving = false
		if (!entryPatch) notify.success({ title: `${door.label} saved` })
		settleDraft(`entry#${id}`, snap)
		promoted.clear()
		await savedThen(id)
	}

	/**
	 * Save as a new version: what changed starts at `date` on the line being
	 * read; the version shown stays as it is. A date the line already has a
	 * version at takes the change into that version (a merge).
	 */
	async function createVersionAt(date: StoryDate) {
		if (!draft || !selectedSource || !railed || !rail || readOnly || saving)
			return
		if (!activeDoor.validate(draft, siblings, true)) return
		const snap = $state.snapshot(draft) as Record<string, unknown>
		const diff = changedFields(snap, pristineDraft ?? {})
		const { entryPatch, fields } = splitNewVersion({
			diff,
			draft: snap,
			carried,
			promoted
		})
		const entryId = selectedSource.id
		const branchId = line.branchId
		const taken = takenVersion(rail.versions, date, branchId)
		const writesVersion = !(taken && !Object.keys(fields).length)
		let reply: Sockets.Amendments.List.Response | null = null
		saving = true
		if (writesVersion) {
			try {
				reply = await fileEntryAmendments(
					socket,
					{ lorebookId, entryId, branchId },
					[{ ...date, fields }],
					knownAmendmentIds(entryId)
				)
			} catch (err) {
				saving = false
				reportUnanswered(err, "The version was not saved")
				askAfterRefusal(err, entryId)
				return
			}
		}
		if (entryPatch && !(await writeEntryFields(entryPatch, false, false))) {
			saving = false
			return
		}
		saving = false
		if (writesVersion) {
			const name = lineName(reply, branchId)
			notify.success({
				title: `Saved as a new version at ${formatDate(date)}${name ? ` on ${name}` : ""}`
			})
		}
		settleDraft(`entry#${entryId}`, snap)
		promoted.clear()
		loreRoute.set(
			reduce(loreRoute.route, {
				type: "setMoment",
				moment: momentKey(date)
			})
		)
		await savedThen(entryId)
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

	/**
	 * A loose end opens with the field that fixes it focused (note 5): once
	 * the asked-for entry's editor is drawn, the first control inside its
	 * `data-lore-field` takes focus. Each request is honoured once.
	 */
	let focusedRequest = 0
	$effect(() => {
		const want = focusField
		if (!want || want.n === focusedRequest) return
		if (!draft || draftKey !== `entry#${want.entryId}`) return
		focusedRequest = want.n
		if (
			want.field === "keywords" &&
			untrack(
				() =>
					entryZoneRow &&
					zoneOf("keys", carried, promoted) === "entry"
			)
		)
			setEntryRowOpen(true)
		void tick().then(() => {
			const field = document.querySelector<HTMLElement>(
				`[data-lore-editor] [data-lore-field="${want.field}"]`
			)
			const control = field?.querySelector<HTMLElement>(
				'[contenteditable="true"], input:not([type="hidden"]):not([disabled]), textarea, select'
			)
			control?.focus()
			field?.scrollIntoView?.({ block: "nearest" })
		})
	})

	$effect(() => {
		hasUnsavedChanges = dirty && !readOnly && !libraryOpen
	})

	// The activity sidebar asks for a review by naming the compile, not the
	// panel, so the workspace is what answers — and only for rows it actually
	// holds. The sidebar also moves the route to the compile's reading; the
	// modal opens once the workspace reads there, so the entry it is diffed
	// against is the entry as that line and moment read it.
	$effect(() => {
		const activityId = compileEntriesCtx?.reviewActivityId
		if (!activityId) return
		const activity = compileEntriesCtx.activities.find(
			(a) => a.activityId === activityId
		)
		if (
			activity &&
			!sameLineAndMoment(activity, {
				branchId: route.branch ?? null,
				moment: momentDate
			})
		)
			return
		const id = activity?.historyEntryId
		// As it READS on this line, so the compile's diff is against what the
		// author sees; the raw row only when the line does not show it.
		const entry =
			(resolvedByKind[HISTORY_TYPE_ID] ?? []).find((e) => e.id === id) ??
			(rowsByKind[HISTORY_TYPE_ID] ?? []).find((e) => e.id === id)
		compileEntriesCtx.setReviewActivityId(null)
		if (entry && activity) openCompile(entry, activity)
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

	/**
	 * A scene save of OURS settles here: said once it lands, and the draft
	 * re-read from the saved row. The row itself is patched into the list by
	 * the workspace (plan B4), which may hear the save before or after this,
	 * so the saved fields are laid over whatever the list holds.
	 */
	function handleSceneUpdate(msg: Sockets.Scenes.Update.Response) {
		if (!msg.scene) return
		const key = `scene#${msg.scene.id}`
		if (awaitingSave !== key) return
		awaitingSave = null
		// Said once the scene is saved, never before.
		notify.success({ title: "Scene updated" })
		if (draftKey === key) {
			const held = sceneList.find((s) => s.id === msg.scene.id)
			draft = (descriptorForKind(SCENE_KIND) ?? descriptor).toDraft(
				(held ? { ...held, ...msg.scene } : msg.scene) as any
			)
			pristineDraft = { ...$state.snapshot(draft) }
		}
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
						// The rows themselves (and their embedding badges)
						// are the workspace's (plan B4): the channel is this
						// door's WRITES, and what their replies settle.
						onList() {},
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
								notify.success({
									title: `${door.label} deleted`
								})
						},
						onReordered: () =>
							notify.success({ title: "Entries reordered" })
					}
				})
			)
		}
		// Writes only: the lists, the cast and the badges are the
		// workspace's, already asked for when the book opened (plan B4).
		for (const channel of channels.values()) channel.open({ read: false })

		if (
			scenesInScope ||
			poolDoors.some((d) => d.kind === HISTORY_TYPE_ID)
		) {
			// A scene save of ours settles on its reply (BARE — not in
			// `SCOPED_EVENTS`; `handleSceneUpdate` checks it is the one it is
			// waiting on). The list, its creates and deletes are the
			// workspace's. A failed summarize run is not heard here: the
			// Process scene window says it, or Layout does once the window is
			// closed (`sceneRunShown.ts`).
			releases.push(
				declareInterest<"scenes:update">(
					"scenes:update",
					handleSceneUpdate
				)
			)
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
								class="btn btn-sm preset-tonal-surface w-full justify-start"
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
	{#if queue}
		<LooseEndsQueue
			rows={queue.rows}
			currentId={queue.currentId}
			onOpen={queue.onOpen}
			onNext={queue.onNext}
			onLeave={queue.onLeave}
		/>
	{:else}
		<EntryPool
			items={visibleItems}
			sourceOf={(item) => sourceByKey.get(item.key)}
			descriptorOf={(item) =>
				item.kind === CAST_KIND
					? castRowDoor
					: item.fromLibrary
						? libraryRowDoor(
								descriptorForKind(item.kind) ?? descriptor
							)
						: (descriptorForKind(item.kind) ?? descriptor)}
			{descriptor}
			{libraryName}
			historyCount={descriptor.id === "scenes" && timelineOn
				? historyDividerCount
				: null}
			{bindings}
			{vectorizationEnabled}
			{selectedKey}
			{lens}
			{filters}
			{facets}
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
			{#snippet listHead()}
				{#if descriptor.listHead}
					{@const Head = descriptor.listHead}
					<Head sources={rowsByKind[descriptor.kind ?? ""] ?? []} />
				{/if}
			{/snippet}
			{#snippet toolbarExtra()}
				{#if descriptor.listActions && !readOnly}
					{@const Actions = descriptor.listActions}
					<Actions
						sources={rowsByKind[descriptor.kind ?? ""] ?? []}
					/>
				{/if}
			{/snippet}
		</EntryPool>
	{/if}
{/snippet}

{#snippet editorBack()}
	<!-- The way out of this step. In compact that is the step back to the
	     list; at desk the list never left, so it closes the editor column. -->
	{@const label = mode === "compact" ? "Back to the list" : "Close"}
	<button
		class="btn btn-sm preset-tonal-surface shrink-0 p-2"
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
			class="btn btn-sm preset-tonal-surface"
			type="button"
			onclick={resetOffWindow}
		>
			Cancel
		</button>
	</div>
{/snippet}

{#snippet markToggle(
	on: boolean,
	Icon: typeof Icons.Pin,
	label: string,
	hint: string,
	mark: string,
	toggle: () => void
)}
	<!-- An entry mark as a toggle: `preset-pressed` with `aria-pressed` while
	     ON (STYLE-GUIDE §2.4), the check saying it without colour. -->
	<button
		class="btn btn-sm w-full justify-start {on
			? 'preset-pressed'
			: 'preset-tonal-surface'}"
		type="button"
		aria-pressed={on}
		data-lore-mark={mark}
		onclick={toggle}
	>
		<Icon size={14} aria-hidden="true" />
		<span>{label}</span>
		<span class="text-meta ml-auto font-normal opacity-75">{hint}</span>
		<Icons.Check
			size={14}
			class="shrink-0 {on ? '' : 'invisible'}"
			aria-hidden="true"
		/>
	</button>
{/snippet}

{#snippet notCommonToggle(where: string)}
	<!-- 🚧 Not common knowledge: one value per entry, never dated, written at
	     once through the knowledge door — not a field of the draft. -->
	{#if knowledgeToggleShown && selectedSource}
		{@const on = knowledge.isMarked(selectedSource.id)}
		<div class="flex flex-col gap-1">
			<button
				class="btn btn-sm w-full justify-start {on
					? 'preset-pressed'
					: 'preset-tonal-surface'}"
				type="button"
				aria-pressed={on}
				aria-describedby="not-common-help-{where}"
				data-lore-mark="not-common"
				disabled={markBusy}
				onclick={toggleNotCommon}
			>
				<Icons.EyeOff size={14} aria-hidden="true" />
				<span>Not common knowledge</span>
				<Icons.Check
					size={14}
					class="ml-auto shrink-0 {on ? '' : 'invisible'}"
					aria-hidden="true"
				/>
			</button>
			<p
				id="not-common-help-{where}"
				class="text-meta text-surface-600-400"
			>
				Only the cast members you name under Known by read this entry
				when they speak.
			</p>
			{#if markError}
				<p role="alert" class="text-error-700-300 text-xs">
					{markError}
				</p>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet lockToggle()}
	<!-- 🚧 The lock: one value per row, never dated, written at once — not a
	     field of the draft. -->
	<div class="flex flex-col gap-1">
		<button
			class="btn btn-sm w-full justify-start sm:w-auto {lockOn
				? 'preset-pressed'
				: 'preset-tonal-surface'}"
			type="button"
			aria-pressed={lockOn}
			aria-describedby="lock-help"
			data-lore-lock
			disabled={lockBusy}
			onclick={toggleLock}
		>
			<Icons.Lock size={14} aria-hidden="true" />
			<!-- 🚧 Provisional copy: the owner has not seen this label. -->
			<span>Locked</span>
			<Icons.Check
				size={14}
				class="ml-auto shrink-0 {lockOn ? '' : 'invisible'}"
				aria-hidden="true"
			/>
		</button>
		<!-- 🚧 Provisional copy: the owner has not seen this sentence. -->
		<FieldHelp id="lock-help">
			{activeDoor.store === "scenes"
				? "Sessions and their routines leave this scene's summary, notes and cast as they are; you can still edit it."
				: "Sessions and their routines leave this entry as it is; you can still edit it."}
		</FieldHelp>
		{#if lockError}
			<InlineError>{lockError}</InlineError>
		{/if}
	</div>
{/snippet}

{#snippet editorMenu()}
	<!-- The entry's state, not its fields. Pinned and Off are marks on the
	     draft, saved with it (and dated with it when reading at a moment);
	     archiving is written straight through; Off for a while files dated
	     changes. A row being created has only the marks: the rest act on a
	     stored row. -->
	<Popover
		open={editorMenuOpen}
		onOpenChange={(e) => (editorMenuOpen = e.open)}
		positioning={{ placement: "bottom-end" }}
	>
		<Popover.Trigger
			class="btn btn-sm preset-tonal-surface shrink-0 p-2"
			title="More actions"
			aria-label="More actions for this entry"
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
						{#if draft && !railed}
							{@render markToggle(
								!!draft.constant,
								Icons.Pin,
								"Pinned",
								"Always in the prompt",
								"pinned",
								() => (draft!.constant = !draft!.constant)
							)}
							{@render markToggle(
								draft.enabled === false,
								Icons.Ghost,
								"Off",
								"Out of every prompt",
								"off",
								() =>
									(draft!.enabled = draft!.enabled === false)
							)}
						{/if}
						{#if !railed}
							{@render notCommonToggle("menu")}
						{/if}
						{#if draft && !railed}
							{#if !readOnly && !isNew && selectedSource && selectedSource.branchId != null && (selectedSource.branchId ?? null) === (route.branch ?? null) && activeDoor.kind !== HISTORY_TYPE_ID}
								<button
									class="btn btn-sm preset-tonal-surface w-full justify-start"
									type="button"
									data-lore-move-down-tree
									onclick={() => {
										editorMenuOpen = false
										moveDownOpen = true
									}}
								>
									<Icons.GitBranch size={14} aria-hidden="true" /> Move down the tree…
								</button>
							{/if}
						{/if}
						{#if !isNew && selectedSource}
							{#if selectedSource.archived}
								<button
									class="btn btn-sm preset-tonal-surface w-full justify-start"
									type="button"
									onclick={() => setArchived(false)}
								>
									<Icons.ArchiveRestore size={14} /> Unarchive
								</button>
							{:else}
								<button
									class="btn btn-sm preset-tonal-surface w-full justify-start"
									type="button"
									onclick={() => setArchived(true)}
								>
									<Icons.Archive size={14} /> Archive
								</button>
							{/if}
							<!-- 🚧 No timeline: a period off is two dated changes. -->
							{#if timelineOn}
								<button
									class="btn btn-sm preset-tonal-surface w-full justify-start"
									type="button"
									onclick={() => (offWindowOpen = true)}
								>
									<Icons.CalendarOff size={14} /> Off for a while…
								</button>
							{/if}
							{#if editHistoryState && editHistoryState.entryId === selectedSource.id && editHistoryState.canClear && editHistoryState.count > 0}
								<button
									class="btn btn-sm preset-tonal-surface text-error-600-400 w-full justify-start"
									type="button"
									onclick={() => {
										editorMenuOpen = false
										clearHistoryOpen = true
									}}
								>
									<Icons.History size={14} />
									{CLEAR_ACTION_LABEL}
								</button>
							{/if}
						{/if}
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
	{@const dated = formatDate(draftMoment!)}
	<div class="flex shrink-0 items-center">
		<button
			class="btn btn-sm preset-filled-primary-500 rounded-r-none"
			type="button"
			onclick={saveAsAmendment}
			disabled={saving ||
				earmarkNotice !== null ||
				!activeDoor.validate(draft!, siblings)}
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
						<hr class="border-surface-200-800" />
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
									earmarkNotice !== null ||
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

{#snippet entryZone()}
	<!-- The entry's own values, in one row that opens on demand: Beginning,
	     Decay, and each of Keywords, Part of, Pinned and Off until a dated
	     change carries it. -->
	<section
		aria-label="The entry"
		class="flex flex-col gap-2"
		data-lore-entry-zone
	>
		{#if draft}
			<BeginningDecayRow
				bind:draft
				idPrefix="entryZone"
				lineWords={railed
					? `On ${openBookTime.lineName(selectedSource?.branchId ?? null)}`
					: undefined}
				bind:open={() => entryRowOpen, setEntryRowOpen}
				disabled={entryRowDisabled}
				held={heldFields}
				{parentName}
				{promotable}
				onPromote={(f) => promoted.add(f)}
			>
				{#snippet lineAction()}
					{#if entryEditable && selectedSource && selectedSource.branchId != null && !isNew}
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface min-h-11"
							data-lore-move-down-tree
							onclick={() => (moveDownOpen = true)}
						>
							<Icons.GitBranch size={14} aria-hidden="true" />
							Move down the tree…
						</button>
					{/if}
				{/snippet}
				{#snippet children()}
					{#if draft}
						{#if zoneOf("keys", carried, promoted) === "entry"}
							<div data-lore-field="keywords">
								<KeywordChips
									bind:keys={draft.keys}
									idPrefix="entryZone"
									regex={readsAsRegex(draft)}
									semantic={vectorizationEnabled}
								/>
							</div>
						{/if}
						{#if zoneOf("anchorEntryId", carried, promoted) === "entry"}
							<PartOfField
								bind:draft
								pool={bookPool}
								newRowBranchId={route.branch ?? null}
								idPrefix="entryZone"
							/>
						{/if}
						{#if zoneOf("constant", carried, promoted) === "entry"}
							{@render markToggle(
								!!draft.constant,
								Icons.Pin,
								"Pinned",
								"Always in the prompt",
								"pinned",
								() => (draft!.constant = !draft!.constant)
							)}
						{/if}
						{#if zoneOf("enabled", carried, promoted) === "entry"}
							{@render markToggle(
								draft.enabled === false,
								Icons.Ghost,
								"Off",
								"Out of every prompt",
								"off",
								() => (draft!.enabled = draft!.enabled === false)
							)}
						{/if}
						{@render notCommonToggle("zone")}
					{/if}
				{/snippet}
			</BeginningDecayRow>
		{/if}
		{#if railed && !entryEditable && !readOnly}
			<div
				class="text-surface-700-300 flex flex-wrap items-center gap-2 text-xs"
			>
				<span>{entryBelongsSentence}</span>
				<button
					type="button"
					class="text-surface-700-300 min-h-11 underline"
					onclick={() =>
						void openVersionOnLine(
							selectedSource?.branchId ?? null,
							null
						)}
				>
					Open on {entryOwnerLine}
				</button>
			</div>
		{/if}
	</section>
{/snippet}

{#snippet editor()}
	{#if draft}
		{@const Editor = activeDoor.editor}
		<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
			<div class="flex flex-wrap items-center gap-2">
				{@render editorBack()}
				<span class="text-surface-600-400 shrink-0 text-xs">
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
					{libraryOpen
						? (library?.name ?? "Read only")
						: readOnly
							? "Read only"
							: isNew
								? "Not saved yet"
								: dirty
									? "Unsaved changes"
									: "Saved"}
				</span>
				{#if libraryOpen}
					<!-- A library piece reads; its one action makes it the
					     book's own (ruling 10). A reader of a shared book
					     reads it with no action. -->
					{#if !readOnly}
						<button
							class="btn btn-sm preset-filled-primary-500 shrink-0"
							type="button"
							data-library-edit-copy
							onclick={editACopy}
							disabled={copying}
						>
							<Icons.CopyPlus size={16} aria-hidden="true" />
							<span>Edit a copy</span>
						</button>
					{/if}
				{:else if readOnly}
					<!-- Shared with the reader: no save, no marks. -->
				{:else if canAmend}
					{@render amendSave()}
				{:else}
					<button
						class="btn btn-sm preset-filled-primary-500 shrink-0"
						type="button"
						onclick={save}
						disabled={saving ||
							saveOff ||
							earmarkNotice !== null ||
							!activeDoor.validate(draft, siblings)}
						title={saveOff && draftVersion
							? `This is ${openBookTime.lineName(draftVersion.branchId)}'s version: open it there to change it, or save it as a new version.`
							: undefined}
					>
						<Icons.Save size={16} aria-hidden="true" />
						<span>
							{isNew ? "Create" : queue ? "Save & next" : "Save"}
						</span>
					</button>
					{#if railed}
						<button
							class="btn btn-sm preset-tonal-surface shrink-0"
							type="button"
							onclick={() => (newVersionOpen = true)}
							disabled={saving ||
								earmarkNotice !== null ||
								!activeDoor.validate(draft, siblings)}
						>
							<Icons.CalendarPlus size={16} aria-hidden="true" />
							<span>Save as a new version…</span>
						</button>
					{/if}
				{/if}
				{#if !readOnly && !libraryOpen && activeDoor.store === "entries" && (isNew || selectedSource)}
					{@render editorMenu()}
				{/if}
				{#if queue && !isNew && mode === "compact"}
					<!-- The queue's own Next, for the compact step where the
					     queue list is not on screen beside the editor. -->
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface shrink-0 gap-1"
						data-loose-ends-next
						onclick={queue.onNext}
					>
						<span>Next loose end</span>
						<Icons.ArrowRight size={14} aria-hidden="true" />
					</button>
				{/if}
			</div>
			{#if writesSharedEntry}
				<p class="text-warning-700-300 text-xs" data-lore-whole-warning>
					Saving changes the entry itself: it reads this way
					everywhere, on every line and at every moment, until a later
					version changes it.
				</p>
			{/if}
			{#if earmarkNotice !== null && !isNew && !readOnly && !libraryOpen}
				<EntryEarmarkNotice
					notice={earmarkNotice}
					checking={earmarkChecking}
					onCheck={() => {
						const id = selectedSource?.id
						if (id != null) void checkEarmark(id)
					}}
				/>
			{/if}
			{#if lockStored && !readOnly}
				{@render lockToggle()}
			{:else if lockStored && lockOn}
				<!-- 🚧 Provisional copy: the owner has not seen this sentence. -->
				<p class="text-surface-600-400 text-chip" data-lore-lock-note>
					Locked: sessions and their routines leave it as it is.
				</p>
			{/if}
			<!-- A shared book's fields read, never write: one `disabled`
			     fieldset stills every control the editor draws. -->
			{#if libraryOpen && libraryOpenRow}
				{@const sourceLine = librarySourceLine(libraryOpenRow, library)}
				<!-- Where the piece comes from, and what Edit a copy does:
				     said once, above the fields it is about. -->
				<div
					class="text-surface-600-400 flex flex-col gap-1 text-xs"
					data-library-reading
				>
					<p>
						{readOnly
							? `From the ${library?.name ?? "rules library"}.`
							: `From the ${library?.name ?? "rules library"}. Edit a copy to make it this book's own entry; the library keeps its original.`}
					</p>
					{#if sourceLine}
						<p data-library-source>{sourceLine}</p>
					{/if}
				</div>
			{/if}
			{#snippet railEdits(ids: readonly (number | null)[])}
				{#if selectedItem && !readOnly}
					<EditHistory
						{lorebookId}
						entryId={selectedItem.id}
						amendmentIds={ids}
						variant="rows"
						updatedAt={selectedSource?.updatedAt ?? null}
					/>
				{/if}
			{/snippet}
			{#snippet fields()}
				<fieldset
					class="flex min-w-0 flex-col gap-4"
					disabled={readOnly || libraryOpen}
					data-lore-read-only={readOnly || libraryOpen
						? ""
						: undefined}
				>
					{#if draft}
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
					{/if}
				</fieldset>
			{/snippet}
			{#if railed && rail && shownVersion}
				<VersionRail
					versions={rail.versions}
					elsewhere={rail.elsewhere}
					selectedKey={shownVersion.key}
					lineBranchId={line.branchId}
					{readOnly}
					lineName={(id) => openBookTime.lineName(id)}
					onSelect={selectVersion}
					onRedate={redateEntryVersion}
					onDelete={deleteEntryVersion}
					onAdd={(date) => void createVersionAt(date)}
					onOpenOnLine={openVersionOnLine}
					onRedated={(v, date) => {
						if (v.key === shownVersion?.key)
							loreRoute.set(
								reduce(loreRoute.route, {
									type: "setMoment",
									moment: momentKey(date)
								})
							)
					}}
					onDeleted={(v) => {
						if (v.key === draftVersionKey) discardDraft()
					}}
					edits={railEdits}
				>
					{@render fields()}
					<!-- The wide rail shows each version's edits itself; this fold
					     is the narrow layout's, scoped to the version shown. -->
					{#if selectedItem && !readOnly}
						<div class="@min-[36rem]/versions:hidden">
							<EditHistory
								{lorebookId}
								entryId={selectedItem.id}
								updatedAt={editsToken}
								amendmentIds={versionRedlineIds(shownVersion)}
								foldLabel={editsToVersionLabel}
								bind:clearOpen={clearHistoryOpen}
								onState={(s) => (editHistoryState = s)}
							/>
						</div>
					{/if}
				</VersionRail>
				<!-- A reader saves nothing: no dialog, open or closed. -->
				{#if !readOnly}
				<VersionDateDialog
					open={newVersionOpen}
					title="Save as a new version"
					description="What you changed starts at this date; the version shown stays as it is."
					initial={momentDate}
					bounds={versionDateBounds(rail.versions)}
					taken={(d) =>
						takenVersion(rail?.versions ?? [], d, line.branchId)}
					takenMode="merge"
					confirmLabel="Save"
					busy={saving}
					onConfirm={(date) => {
						newVersionOpen = false
						void createVersionAt(date)
					}}
					onCancel={() => (newVersionOpen = false)}
				/>
				{/if}
			{:else}
				{@render fields()}
			{/if}
			{#if entryZoneRow}
				{@render entryZone()}
			{/if}
			<!-- Not inside the rail: ⋯ opens it with the Timeline off too. -->
			{#if !readOnly && selectedSource}
				<MoveDownTheTreeDialog
					open={moveDownOpen}
					{lorebookId}
					entryId={selectedSource.id}
					dirty={hasUnsavedChanges}
					onClose={() => (moveDownOpen = false)}
					onMoved={async () => {
						await tick()
						const next =
							document.querySelector<HTMLElement>(
								"[data-lore-entry-zone] [data-lore-beginning-decay] > div > button:not(:disabled)"
							) ??
							document.querySelector<HTMLElement>(
								'[aria-label="More actions for this entry"]'
							)
						next?.focus()
					}}
				/>
			{/if}
			<!-- What the newest run did with this row, under the fields and
			     above the account of why. A row nothing has saved has no run to
			     report on. -->
			{#if !isNew && selectedItem && !libraryOpen && activeDoor.store === "entries"}
				<!-- 🚧 No timeline: dated changes are not shown. A railed entry
				     has its versions on the rail; a history entry keeps its list. -->
				{#if timelineOn && activeDoor.kind === HISTORY_TYPE_ID}
					<AmendmentList
						{lorebookId}
						amendments={amendmentsFor?.(selectedItem.id) ?? []}
						moment={route.moment}
					/>
				{/if}
				{#if !(railed && rail && shownVersion) && !readOnly}
					<EditHistory
						{lorebookId}
						entryId={selectedItem.id}
						updatedAt={selectedSource?.updatedAt ?? null}
						bind:clearOpen={clearHistoryOpen}
						onState={(s) => (editHistoryState = s)}
					/>
				{/if}
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
			{#if !isNew && selectedItem && selectedSource && !libraryOpen}
				<EntryInspector
					{lorebookId}
					item={selectedItem}
					source={selectedSource}
					door={activeDoor}
					pool={bookPool}
					links={bookLinks}
					showBody={mode === "desk"}
					mayEdit={!readOnly}
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
					{readOnly && listedCount > 0
						? "Pick an entry to read it."
						: editorPlaceholder({
								descriptor,
								poolEmpty: listedCount === 0,
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
				class="btn btn-sm preset-tonal-surface shrink-0 p-2"
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
				mayEdit={!readOnly}
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
		<!-- The reader sets the split (owner, 2026-10-02): a divider between
		     list and editor, dragged or stepped with the arrow keys, and
		     remembered on this device — one share for Entries, Time and Cast,
		     so changing lens never moves it. -->
		<ResizableSplit storageKey={LORE_SPLIT_KEY} firstId="loreSplitList">
			{#snippet first()}
				{@render list()}
			{/snippet}
			{#snippet second()}
				<div
					class="panel-card flex min-h-0 min-w-0 flex-1 flex-col p-3"
					data-lore-editor
				>
					{@render editor()}
				</div>
			{/snippet}
		</ResizableSplit>
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
	title={deleteEntryTitle(deleteTarget?.name)}
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
		moment={compileReading.moment}
		branchId={compileReading.branchId}
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
