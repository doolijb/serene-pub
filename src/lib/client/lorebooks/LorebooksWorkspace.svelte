<script lang="ts">
	import { getContext, onDestroy, onMount, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { toaster } from "$lib/client/utils/toaster"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import LorebookListItem from "$lib/client/components/listItems/LorebookListItem.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import LorebookUnsavedChangesModal from "$lib/client/components/modals/LorebookUnsavedChangesModal.svelte"
	import {
		CHARACTER_LORE_TYPE_ID,
		HISTORY_TYPE_ID,
		WORLD_LORE_TYPE_ID,
		type EntryTypeId
	} from "$lib/shared/entries/types"
	import BookMenu from "./BookMenu.svelte"
	import BookSettings from "./BookSettings.svelte"
	import CastWorkspace from "./CastWorkspace.svelte"
	import DayOne from "./DayOne.svelte"
	import EntryWorkspace from "./EntryWorkspace.svelte"
	import GraphsWorkspace from "./GraphsWorkspace.svelte"
	import LensRow from "./LensRow.svelte"
	import LorebookActions from "./LorebookActions.svelte"
	import LoreRail from "./LoreRail.svelte"
	import MomentBanner from "./time/MomentBanner.svelte"
	import MomentBar from "./time/MomentBar.svelte"
	import TimeLens from "./time/TimeLens.svelte"
	import { refLinksFrom, type RefLink } from "./editor/refs"
	import { drawingForLens } from "./graphs"
	import { layoutModeFor } from "./layoutMode"
	import { loreRoute } from "./loreRoute.svelte"
	import { JUMP_CONTEXT, type JumpCtx } from "$lib/client/shell/jump.svelte"
	import {
		DEFAULT_LENS,
		describeRoute,
		emptyRoute,
		reduce,
		routeFromDigest,
		SCOPE_LABELS,
		type LoreLens,
		type LoreScope
	} from "./loreRoute"
	import {
		emptyFilters,
		filterPool,
		SCENE_KIND,
		type PoolFilters
	} from "./poolFilter"
	import {
		bookIsEmpty,
		CAST_KIND,
		mergeCastCount,
		railScopes,
		SAVED_SCOPES,
		savedScopeCount,
		savedScopeFilters,
		type SavedScopeId
	} from "./scopes"
	import {
		bookPoolItems,
		descriptorFor,
		descriptorForKind,
		SECTION_DESCRIPTORS
	} from "./sections"
	import type { EntryDecisions } from "./markers"
	import type { PoolSource } from "./sections/types"
	import { timelineCursor } from "./timelineCursor.svelte"
	import { momentValue, notYetKeys } from "./time/moment"
	import {
		castArrivals,
		storyItems,
		type TimeEntryRow,
		type TimeSceneRow
	} from "./time/storyTime"

	/**
	 * The lorebook workspace: one pool, three controls, two layouts.
	 *
	 * Scope is what is in the set, lens is how it is drawn, moment is when it
	 * is read from, and every combination of the three is a place the reader
	 * can be. Which layout is drawn comes from this element's own width, never
	 * from the panel's fullscreen flag — a wide dock and a fullscreen panel are
	 * the same room, and must land in the same place.
	 */
	const socket = useTypedSocket()
	const panelsCtx: PanelsCtx = getContext("panelsCtx")
	const openSessionCtx: OpenSessionCtx = getContext("openSessionCtx")

	const POOL_TYPES: EntryTypeId[] = [
		WORLD_LORE_TYPE_ID,
		CHARACTER_LORE_TYPE_ID,
		HISTORY_TYPE_ID
	]

	let lorebookList: any[] = $state([])
	let isLoading: boolean = $state(true)
	/** The search over the list of books, which is a different list. */
	let bookSearch: string = $state("")
	let widthPx: number = $state(0)
	let menuOpen: boolean = $state(false)
	let tabHasUnsavedChanges: boolean = $state(false)

	let creating: boolean = $state(false)
	let importing: boolean = $state(false)
	let exportingId: number | null = $state(null)
	let deletingId: number | null = $state(null)
	/** The book being copied, and what it is called, for the naming prompt. */
	let duplicating: { id: number; name: string } | null = $state(null)
	/** The book's own readout, which is a screen rather than a scope. */
	let settingsOpen: boolean = $state(false)

	/** The book's figures, counted by the server. Null while on their way. */
	let counts = $state<Record<string, number> | null>(null)
	/** Every row the book holds, so the rail can report on the whole of it. */
	let bookRows = $state<Record<string, PoolSource[]>>({})
	let sceneRows = $state<PoolSource[]>([])
	/**
	 * The book's typed edges, and the cast rows they name.
	 *
	 * ⚠ Read here rather than in the graph lens: an edge is what the Refs
	 * board calls a direct reference, and the editor must not have to have
	 * the canvas open to know a road exists.
	 */
	let graphNodes = $state<Sockets.NarrativeGraph.NarrativeNode[]>([])
	let graphRelationships = $state<
		Sockets.NarrativeGraph.NarrativeRelationship[]
	>([])
	let decisions = $state<EntryDecisions | null>(null)
	/** What the same run did with the graph, for the graph lens's ceiling. */
	let runRelationships = $state<
		Sockets.Entries.RecentDecisions.Response["relationships"] | null
	>(null)
	/** The conversation the decisions on screen are about. */
	let decisionsFor: number | null | undefined = undefined

	let search: string = $state("")
	let poolFacets: PoolFilters = $state(emptyFilters())
	let saved: SavedScopeId | null = $state(null)

	let route = $derived(loreRoute.route)
	let mode = $derived(layoutModeFor(widthPx))
	let book = $derived(lorebookList.find((l) => l.id === route.lorebookId))
	let lens = $derived<LoreLens>(route.lens ?? DEFAULT_LENS)
	let drawing = $derived(drawingForLens(lens))

	// Guests can view a shared session but can't reconfigure it — the server
	// rejects sessions:setLorebook for non-owners anyway, this just avoids
	// showing an action that would fail with an error toast.
	let hasOpenSession = $derived(
		openSessionCtx.sessionId !== null && openSessionCtx.isOwner
	)
	let openSessionHasLorebook = $derived(openSessionCtx.lorebookId !== null)
	let canOfferAttachToSession = $derived(
		hasOpenSession && !openSessionHasLorebook
	)
	/** What the session reading this book is called, or nothing. */
	let readingInto = $derived(
		book && openSessionCtx.lorebookId === book.id
			? (openSessionCtx.sessionName ?? "the open session")
			: null
	)

	/**
	 * The conversation whose decisions these rows may carry a mark from.
	 *
	 * The panel's host is what knows it: a mark says what happened in the
	 * session the reader has open, so a book nothing is reading gets no marks
	 * rather than marks from somebody else's turn.
	 */
	let markedSessionId = $derived(
		book && openSessionCtx.lorebookId === book.id
			? openSessionCtx.sessionId
			: null
	)

	/** What the newest run read in, by pool key. Null when nobody is reading. */
	let readInKeys = $derived.by(() => {
		if (markedSessionId === null) return null
		const keys = new Set<string>()
		for (const [id, decision] of Object.entries(decisions ?? {}))
			if (decision === "fired") keys.add(`entry#${id}`)
		return keys
	})

	/** Every row in the book, as the pool reads them. */
	let bookPool = $derived(bookPoolItems(bookRows, sceneRows))

	/** What a cast endpoint is called, so an edge can name who it names. */
	let castNames = $derived(
		new Map(graphNodes.map((node) => [node.id, node.name]))
	)
	let bookLinks = $derived<RefLink[]>(
		refLinksFrom(graphRelationships, castNames)
	)

	let pinnedItems = $derived(
		bookPool.filter((item) => item.pinned && !item.archived)
	)

	/** Every entry the book holds, whatever kind, as the line reads them. */
	let timeEntries = $derived(Object.values(bookRows).flat() as TimeEntryRow[])
	/** The session reading this book, which stands at now on the line. */
	let timeSession = $derived(
		book &&
			openSessionCtx.lorebookId === book.id &&
			openSessionCtx.sessionId !== null
			? {
					id: openSessionCtx.sessionId,
					name: openSessionCtx.sessionName ?? "the open session"
				}
			: null
	)
	/** The moment being read from. Absent is now, which is the default. */
	let moment = $derived(route.moment)
	let momentAt = $derived(momentValue(moment))

	/**
	 * The pool and the cast at the moment being read.
	 *
	 * Only history carries a date, so only history can be later than one; a
	 * row of any other kind is in the story at every moment and is counted in
	 * the total rather than against it. Null at now, where the question does
	 * not arise.
	 */
	let poolAsOf = $derived.by(() => {
		if (momentAt == null) return null
		const dated = bookPool
			.filter((item) => item.kind === HISTORY_TYPE_ID)
			.map((item) => ({ key: item.key, value: item.order }))
		return {
			total: bookPool.length,
			notYet: notYetKeys(dated, momentAt).length
		}
	})

	let castAsOfCounts = $derived.by(() => {
		if (momentAt == null) return null
		const arrivals = castArrivals(
			storyItems({
				entries: timeEntries,
				scenes: sceneRows as TimeSceneRow[]
			})
		)
		const notYet = [...arrivals.values()].filter(
			(value) => value > momentAt
		).length
		return { notYet, total: counts?.[CAST_KIND] ?? arrivals.size }
	})

	let savedCounts = $derived(
		Object.fromEntries(
			SAVED_SCOPES.map((s) => [
				s.id,
				savedScopeCount(s.id, bookPool, readInKeys ?? new Set())
			])
		) as Record<SavedScopeId, number>
	)

	/** The address said out loud, which is what the book chip's hover says. */
	let crumbs = $derived(describeRoute(route, { book: book?.name }))

	let scopes = $derived(railScopes(counts))
	let descriptor = $derived(descriptorFor(route.scope))
	/** Every door the pool draws, which is what "All entries" holds. */
	let doors = $derived(SECTION_DESCRIPTORS.filter((d) => d.id !== "all"))

	/**
	 * A book with nothing in it at all, which is the one book day one is for.
	 *
	 * The question is the rail's arithmetic rather than this screen's, so it is
	 * asked of the same figures the chips are drawn from.
	 */
	let bookEmpty = $derived(bookIsEmpty(counts))

	/**
	 * The facets in force. A saved scope answers the same question the count
	 * beside it answered, so it wins over the chips it overlaps while it is on.
	 */
	let filters = $derived<PoolFilters>(
		saved
			? { ...poolFacets, search, ...savedScopeFilters(saved) }
			: { ...poolFacets, search }
	)

	/** One book's figure for the menu, from what the list payload joins. */
	function bookCount(l: any): number {
		return (
			(l.worldLoreEntries?.length ?? 0) +
			(l.characterLoreEntries?.length ?? 0) +
			(l.historyEntries?.length ?? 0)
		)
	}

	let bookChoices = $derived(
		[...lorebookList]
			.sort((a, b) => a.id - b.id)
			.map((l) => ({ id: l.id, name: l.name, count: bookCount(l) }))
	)

	let filteredLorebooks = $derived.by(() => {
		let list = [...lorebookList]
		list.sort((a, b) => a.id - b.id)
		if (!bookSearch) return list
		const needle = bookSearch.toLowerCase()
		return list.filter(
			(l) =>
				l.name.toLowerCase().includes(needle) ||
				(l.description && l.description.toLowerCase().includes(needle))
		)
	})

	/**
	 * A section is drawn unless the book is gone, and only a drawn section can
	 * have unsaved changes to guard.
	 */
	let managerMounted = $derived(!!book)

	/**
	 * The guard's answer, mirrored into plain state.
	 *
	 * The route store holds the callback below and can call it after this
	 * component is gone — a panel that is being closed is asked whether it may
	 * be. A `$derived` read outside the effect that owns it is inert, so what
	 * the closure reads is state, written by an effect that only runs while
	 * the workspace is drawn.
	 */
	let guardedChanges = $state(false)

	function openBook(lorebookId: number | null, scope?: LoreScope) {
		settingsOpen = false
		void loreRoute.navigate({ type: "openBook", lorebookId, scope })
	}

	function openScope(scope: LoreScope) {
		menuOpen = false
		settingsOpen = false
		// The kind chips narrow one scope's pool; carrying them into another
		// one would empty a list the reader had not narrowed.
		poolFacets = { ...poolFacets, kinds: [] }
		void loreRoute.navigate({ type: "openScope", scope })
	}

	function openLens(next: LoreLens) {
		menuOpen = false
		settingsOpen = false
		void loreRoute.navigate({ type: "setLens", lens: next })
	}

	/**
	 * Reads the book as of a date.
	 *
	 * Set rather than navigated: a moment is a way of reading the screen that
	 * is open rather than a screen being left, so there is no draft to ask
	 * about — the same rule the inspector's tabs follow.
	 */
	function setMoment(next?: string) {
		loreRoute.set(reduce(route, { type: "setMoment", moment: next }))
	}

	function applyFilters(next: PoolFilters) {
		poolFacets = { ...next }
		search = next.search
		saved = null
	}

	function handleAttachToSession(lorebookId: number) {
		if (openSessionCtx.sessionId === null) return
		socket.emit("sessions:setLorebook", {
			sessionId: openSessionCtx.sessionId,
			lorebookId
		})
	}

	function handleDetachFromSession() {
		if (openSessionCtx.sessionId === null) return
		socket.emit("sessions:setLorebook", {
			sessionId: openSessionCtx.sessionId,
			lorebookId: null
		})
	}

	/** Reads this book into the open session, or stops reading it into one. */
	function changeReading() {
		menuOpen = false
		if (!book || openSessionCtx.sessionId === null) return
		if (openSessionCtx.lorebookId === book.id) handleDetachFromSession()
		else handleAttachToSession(book.id)
	}

	/** The figures, which are the server's rather than ours to add up. */
	function refreshCounts() {
		const id = route.lorebookId
		if (id === null) return
		socket.emit("entries:counts", {
			lorebookId: id
		} satisfies Sockets.Entries.Counts.Params)
	}

	/**
	 * Jump, scoped to this view.
	 *
	 * ⚠ This view has TWO search boxes, never both at once: the list of books
	 * (`bookSearch`) before one is open, and the one inside a book (`search`,
	 * the `[data-lore-search]` input) after. The registration branches on the
	 * same `book` the layout does, so the overlay is always bound to the box
	 * that is actually on screen and scoped to the list behind it — which is
	 * what replaced this workspace's own ⌘K (see `onDestroy`).
	 *
	 * `label` and `placeholder` are getters, not strings, because the answer
	 * changes as you open a book.
	 */
	const jumpCtx = getContext<JumpCtx | undefined>(JUMP_CONTEXT)
	$effect(() =>
		jumpCtx?.registerScope("lorebooks", {
			get label() {
				return book ? book.name : "Lorebooks"
			},
			get placeholder() {
				return book ? "Search this book" : "Filter lorebooks"
			},
			getQuery: () => (book ? search : bookSearch),
			setQuery: (next) => {
				if (book) search = next
				else bookSearch = next
			},
			getHits: () => {
				if (!book)
					return filteredLorebooks.map((l) => ({
						kind: "lorebook" as const,
						id: l.id,
						title: l.name,
						subtitle: l.description || undefined
					}))
				// The same arithmetic the sections below run, over the same
				// pool and the same filters — a second rule here would be a
				// second answer to "what is this book showing".
				return filterPool(bookPool, filters, readInKeys ?? new Set())
					.filter((item) => item.kind !== SCENE_KIND)
					.map((item) => ({
						kind: "entry" as const,
						id: item.id,
						title: item.name,
						subtitle: descriptorForKind(item.kind)?.label,
						parentId: book!.id
					}))
			},
			onPick: (hit) => {
				if (hit.kind === "entry")
					void loreRoute.navigate({
						type: "openEntry",
						entryId: Number(hit.id)
					})
				else openBook(Number(hit.id))
			}
		})
	)

	function refreshBook() {
		const id = route.lorebookId
		if (id === null) return
		for (const typeId of POOL_TYPES)
			socket.emit("entries:list", { lorebookId: id, typeId })
		socket.emit("scenes:listByLorebook", { lorebookId: id })
		socket.emit("narrativeGraph:list", { lorebookId: id })
		refreshCounts()
	}

	function handleLorebooksList(msg: Sockets.Lorebooks.List.Response) {
		if (msg.lorebookList) {
			lorebookList = msg.lorebookList
		}
		isLoading = false
	}

	// The generic **:error listener in Layout.svelte already toasts this —
	// this just stops the spinner from spinning forever if the initial
	// fetch fails, so it settles into the (accurate enough) empty state.
	function handleLorebooksListError() {
		isLoading = false
	}

	function handleEntriesList(msg: Sockets.Entries.List.Response) {
		if (msg.lorebookId !== route.lorebookId) return
		bookRows = { ...bookRows, [msg.typeId]: msg.entryList as PoolSource[] }
	}

	/**
	 * A row this book gained, folded into the rail's copy of the pool.
	 *
	 * Patched rather than re-listed, because the rail is reporting on the same
	 * rows the open scope is editing and a re-list would blink every figure on
	 * screen for a write of one row. The figures themselves are the server's,
	 * so a create or a delete asks for them again.
	 */
	function handleEntryCreated(msg: Sockets.Entries.Create.Response) {
		const entry = msg.entry
		if (!entry || entry.lorebookId !== route.lorebookId) return
		bookRows = {
			...bookRows,
			[entry.typeId]: [
				...(bookRows[entry.typeId] ?? []),
				entry as PoolSource
			]
		}
		refreshCounts()
	}

	function handleEntryUpdated(msg: Sockets.Entries.Update.Response) {
		const entry = msg.entry
		if (!entry || entry.lorebookId !== route.lorebookId) return
		bookRows = {
			...bookRows,
			[entry.typeId]: (bookRows[entry.typeId] ?? []).map((row) =>
				row.id === entry.id ? (entry as PoolSource) : row
			)
		}
	}

	// A delete answers with neither the row nor its type, so which list lost a
	// row is the server's to say again.
	function handleEntryDeleted() {
		refreshBook()
	}

	// One book is open at a time, and the interest key already names it, so
	// there is nothing left here to filter on.
	function handleGraphList(msg: Sockets.NarrativeGraph.List.Response) {
		graphNodes = msg.nodes
		graphRelationships = msg.relationships
	}

	function handleScenesList(msg: Sockets.Scenes.ListByLorebook.Response) {
		sceneRows = msg.sceneList as PoolSource[]
	}

	function handleSceneWritten() {
		const id = route.lorebookId
		if (id === null) return
		socket.emit("scenes:listByLorebook", { lorebookId: id })
		refreshCounts()
	}

	function handleEntryCounts(msg: Sockets.Entries.Counts.Response) {
		if (msg.lorebookId !== route.lorebookId) return
		counts = msg.counts
	}

	/**
	 * The book's cast, as the server has just listed it.
	 *
	 * The rail reports on the whole book, so a binding minted anywhere moves
	 * its figures: a session reading this book in mints one per member, and
	 * the Cast board mints them by hand. The list is the cast figure itself,
	 * and the nodes the graph names are the same rows, so those are asked for
	 * again.
	 */
	function handleBindingList(msg: Sockets.Lorebooks.BindingList.Response) {
		const id = route.lorebookId
		if (id === null || msg.lorebookId !== id) return
		const merged = mergeCastCount(counts, msg.lorebookBindingList)
		// A figure that has not arrived cannot be merged into, and the answer
		// on its way was counted before these rows existed.
		if (merged) counts = merged
		else refreshCounts()
		socket.emit("narrativeGraph:list", { lorebookId: id })
	}

	function handleRecentDecisions(
		msg: Sockets.Entries.RecentDecisions.Response
	) {
		if (
			msg.lorebookId !== route.lorebookId ||
			msg.sessionId !== markedSessionId
		)
			return
		decisions = msg.decisions
		runRelationships = msg.relationships ?? null
	}

	/**
	 * A reply that has stopped generating is a run that has finished, which is
	 * the only thing that can change what the newest run decided. Asked again
	 * rather than patched: the decisions belong to a run, and a run is the
	 * server's to project.
	 */
	function handleSessionMessage(msg: Sockets.SessionMessage.Response) {
		const message = msg.sessionMessage
		if (!message || markedSessionId == null || route.lorebookId === null)
			return
		if (message.sessionId !== markedSessionId || message.isGenerating)
			return
		socket.emit("entries:recentDecisions", {
			lorebookId: route.lorebookId,
			sessionId: markedSessionId
		} satisfies Sockets.Entries.RecentDecisions.Params)
	}

	function handleSessionsSetLorebook(
		msg: Sockets.Sessions.SetLorebook.Response
	) {
		if (
			!msg.session ||
			openSessionCtx.sessionId === null ||
			msg.session.id !== openSessionCtx.sessionId
		)
			return
		toaster.success({
			title: msg.session.lorebookId
				? "Lorebook Attached"
				: "Lorebook Detached"
		})
		// The ack says what the session reads, so the open-session context
		// follows it here rather than waiting on the session's own reload: the
		// reading line and the run's marks both hang off this one field.
		openSessionCtx.lorebookId = msg.session.lorebookId ?? null
		// Full reload of the open session, not just a field patch — lore-bound
		// content (RAG notices, etc.) can depend on the session's lorebook.
		socket.emit("sessions:get", {
			id: openSessionCtx.sessionId,
			limit: 25
		})
	}

	/**
	 * A deep link arrives as `digest.lore`, and this is its only reader: it
	 * takes the address with it, so no second consumer can act on the same
	 * link.
	 */
	$effect(() => {
		if (isLoading) return
		const next = routeFromDigest(panelsCtx.digest)
		if (!next) return
		delete panelsCtx.digest.lore
		// Capture the target before deleting it from the digest, and only
		// apply it once discard is actually confirmed.
		loreRoute.confirmLeave().then((leave) => {
			if (leave) loreRoute.set(next)
		})
	})

	// A book that stops existing leaves the workspace at its list of books
	// rather than at a screen for a row that is gone.
	$effect(() => {
		if (isLoading || route.lorebookId === null) return
		if (!lorebookList.some((l) => l.id === route.lorebookId))
			loreRoute.set(emptyRoute())
	})

	// The strip runs under every scope, so its axis is read here once rather
	// than by whichever scope happens to be open.
	$effect(() => {
		timelineCursor.setAxis(
			route.lorebookId,
			(bookRows[HISTORY_TYPE_ID] ?? []) as any[]
		)
	})

	/**
	 * The moment is the address, and the cursor is what every drawing under it
	 * reads, so the address is the one thing that sets it.
	 *
	 * Re-applied whenever the axis is rebuilt: a book's rows arriving resets
	 * the cursor, and a book with no axis at all has no moment to be at.
	 */
	$effect(() => {
		const at = momentValue(route.moment)
		const hasAxis = timelineCursor.ticks.length > 0
		untrack(() => {
			const next = hasAxis ? at : null
			if (timelineCursor.position !== next)
				timelineCursor.setPosition(next)
		})
	})

	$effect(() => {
		guardedChanges = managerMounted && tabHasUnsavedChanges
	})

	/**
	 * Everything this workspace reads about the OPEN BOOK, scoped to it.
	 *
	 * One effect rather than nine, because all nine keys share one scope and
	 * one lifetime: they are taken together when a book opens and dropped
	 * together when the reader leaves it or opens another. With no book open
	 * — the list of books — none of them is held at all, which is also what
	 * every one of these handlers already did by returning early.
	 *
	 * An effect rather than `useInterest` for the same reason the
	 * `sessionMessage` one above is: the key moves, and `useInterest` keeps
	 * the key it was first given.
	 *
	 * The three entry writes are scoped on the book the written row belongs to
	 * (`payload.entry.lorebookId`), which is the id their handlers already
	 * refuse anything else on; `entries:delete` answers with neither the row
	 * nor its type, so the server names the book beside it.
	 */
	$effect(() => {
		const id = route.lorebookId
		if (id === null) return
		const releases = [
			declareInterest<"entries:list">(
				interestKey("entries:list", id),
				handleEntriesList
			),
			declareInterest<"entries:create">(
				interestKey("entries:create", id),
				handleEntryCreated
			),
			declareInterest<"entries:update">(
				interestKey("entries:update", id),
				handleEntryUpdated
			),
			declareInterest<"entries:delete">(
				interestKey("entries:delete", id),
				handleEntryDeleted
			),
			declareInterest<"entries:counts">(
				interestKey("entries:counts", id),
				handleEntryCounts
			),
			declareInterest<"entries:recentDecisions">(
				interestKey("entries:recentDecisions", id),
				handleRecentDecisions
			),
			declareInterest<"lorebooks:bindingList">(
				interestKey("lorebooks:bindingList", id),
				handleBindingList
			),
			declareInterest<"scenes:listByLorebook">(
				interestKey("scenes:listByLorebook", id),
				handleScenesList
			),
			declareInterest<"narrativeGraph:list">(
				interestKey("narrativeGraph:list", id),
				handleGraphList
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	// The whole book, re-read whenever the book changes: the rail reports on
	// every row rather than on the scope that happens to be open.
	$effect(() => {
		const id = route.lorebookId
		bookRows = {}
		sceneRows = []
		graphNodes = []
		graphRelationships = []
		counts = null
		if (id === null) return
		refreshBook()
	})

	/**
	 * ⚠ Emitted from an effect, and answered on a key the book-scoped effect
	 * ABOVE takes. That order is the contract, not a coincidence: effects run
	 * in creation order, so the key naming this book is already held — and
	 * already synced, since the typed `emit` flushes the sync ahead of every
	 * request — before this asks anything.
	 */
	$effect(() => {
		const sessionId = markedSessionId
		const id = route.lorebookId
		if (decisionsFor === sessionId) return
		decisionsFor = sessionId
		decisions = null
		runRelationships = null
		if (sessionId != null && id !== null)
			socket.emit("entries:recentDecisions", {
				lorebookId: id,
				sessionId
			} satisfies Sockets.Entries.RecentDecisions.Params)
	})

	/**
	 * A finished reply in the session that is READING this book — nothing else.
	 *
	 * The scope is `markedSessionId`, which is already the only session this
	 * panel's handler acts on: the marks it re-reads say what happened in the
	 * conversation the reader has open, so a book nothing is reading declares
	 * nothing at all and a run in some other session leaves this workspace
	 * alone. (`sessionMessage` is gated, so a declaration here is also what
	 * makes the server broadcast to this tab in the first place.)
	 *
	 * An effect rather than `useInterest` because the key moves — a different
	 * book, or the reader opening another session, changes the scope, and
	 * `useInterest` would keep the key it was first given.
	 */
	$effect(() => {
		const sessionId = markedSessionId
		if (sessionId == null) return
		return declareInterest<"sessionMessage">(
			interestKey("sessionMessage", sessionId),
			handleSessionMessage
		)
	})

	/**
	 * The lorebook attach/detach ack. BARE, not scoped: `sessions:setLorebook`
	 * has no entry in `SCOPED_EVENTS`, so the handler's own
	 * `msg.session.id !== openSessionCtx.sessionId` check stays the filter.
	 */
	useInterest<"sessions:setLorebook">(
		"sessions:setLorebook",
		handleSessionsSetLorebook
	)

	/**
	 * The four BARE keys. The list of books is not about one book; the two
	 * scene writes answer with the scene alone and name none; and an `:error`
	 * is never gated (plan ruling 2) but still goes through the registry,
	 * which is the only listener path. `scenes:delete` has no emitter
	 * anywhere; the listener stays so that gaining one is not also gaining a
	 * bug.
	 */
	useInterest<"lorebooks:list">("lorebooks:list", handleLorebooksList)
	useInterest<"lorebooks:list:error">(
		"lorebooks:list:error",
		handleLorebooksListError
	)
	useInterest<"scenes:create">("scenes:create", handleSceneWritten)
	useInterest<"scenes:delete">("scenes:delete", handleSceneWritten)

	onMount(() => {
		socket.emit("lorebooks:list", {})
		const detachHash = loreRoute.attachHash()
		const unregister = loreRoute.registerUnsavedChanges(
			() => guardedChanges
		)
		return () => {
			detachHash()
			// Answered before the seam is released, so a registration this
			// teardown does not own cannot be left claiming a draft that went
			// with this component.
			guardedChanges = false
			unregister()
		}
	})

	onDestroy(() => {
		// Nothing to tear down: every listener this workspace holds is an
		// interest key, and the registry releases them as its effects are
		// destroyed. The shell's Jump overlay owns the ⌘K chord and, scoped to
		// this view, drives the same `[data-lore-search]` cursor state (see
		// the registration below), so the box fills as you type.
	})
</script>

{#snippet bookChip()}
	<Popover
		open={menuOpen}
		onOpenChange={(e) => (menuOpen = e.open)}
		positioning={{ placement: "bottom-start" }}
	>
		<!-- The book's name IS the button's accessible name; an aria-label
		     here would replace it with words the user cannot see. -->
		<Popover.Trigger
			class="btn btn-sm hover:preset-tonal-surface min-w-0 flex-1 justify-start gap-1"
			title={crumbs.join(" › ")}
		>
			<Icons.Book size={14} aria-hidden="true" />
			<span class="min-w-0 truncate">{book?.name ?? "Lorebook"}</span>
			<Icons.ChevronDown size={14} aria-hidden="true" />
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-surface-100-900 flex w-[min(90vw,300px)] flex-col gap-3 p-4 shadow-xl"
				>
					<BookMenu
						books={bookChoices}
						openId={route.lorebookId}
						{readingInto}
						canChangeReading={hasOpenSession}
						onOpen={(id) => {
							menuOpen = false
							openBook(id, route.scope)
						}}
						onNew={() => {
							menuOpen = false
							creating = true
						}}
						onImport={() => {
							menuOpen = false
							importing = true
						}}
						onSettings={() => {
							menuOpen = false
							settingsOpen = true
						}}
						onDuplicate={() => {
							menuOpen = false
							duplicating = book
								? { id: book.id, name: book.name }
								: null
						}}
						onExport={() => {
							menuOpen = false
							exportingId = book?.id ?? null
						}}
						onChangeReading={changeReading}
						onDelete={() => {
							menuOpen = false
							deletingId = book?.id ?? null
						}}
					/>
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
{/snippet}

{#snippet scopeChips()}
	<div class="flex flex-wrap gap-1" role="group" aria-label="Views">
		{#each scopes as facet (facet.id)}
			<button
				type="button"
				class="chip gap-1 {route.scope === facet.id
					? 'preset-filled-primary-500'
					: 'preset-tonal-surface'}"
				class:opacity-60={facet.empty && route.scope !== facet.id}
				aria-pressed={route.scope === facet.id}
				data-lore-scope={facet.id}
				onclick={() => openScope(facet.id)}
			>
				<span>{facet.label}</span>
				{#if facet.count !== undefined}
					<span class="text-xs opacity-80">{facet.count}</span>
				{/if}
			</button>
		{/each}
	</div>
{/snippet}

{#snippet workspace()}
	{#if !book}
		<div class="flex items-center justify-center py-8">
			<Icons.Loader2 size={20} class="text-surface-400 animate-spin" />
		</div>
	{:else if settingsOpen}
		{#key book.id}
			<BookSettings
				lorebookId={book.id}
				bookName={book.name}
				{counts}
				{readingInto}
				canChangeReading={hasOpenSession}
				bind:hasUnsavedChanges={tabHasUnsavedChanges}
				onClose={() => (settingsOpen = false)}
				onChangeReading={changeReading}
				onImport={() => (importing = true)}
				onExport={() => (exportingId = book.id)}
				onDuplicate={() =>
					(duplicating = { id: book.id, name: book.name })}
				onDelete={() => (deletingId = book.id)}
			/>
		{/key}
	{:else if bookEmpty}
		{#key book.id}
			<DayOne lorebookId={book.id} onImport={() => (importing = true)} />
		{/key}
	{:else if lens === "time"}
		<!-- The line is its own drawing: the graph canvas draws relationships,
		     and a timeline is not one. -->
		{#key book.id}
			<TimeLens
				lorebookId={book.id}
				{mode}
				scopeTitle={SCOPE_LABELS[route.scope]}
				entries={timeEntries}
				scenes={sceneRows as TimeSceneRow[]}
				session={timeSession}
				{decisions}
				bind:hasUnsavedChanges={tabHasUnsavedChanges}
			/>
		{/key}
	{:else if drawing}
		{#key book.id}
			<GraphsWorkspace
				lorebookId={book.id}
				{mode}
				{drawing}
				relationships={runRelationships}
				bind:hasUnsavedChanges={tabHasUnsavedChanges}
				onEditMember={(castId) =>
					loreRoute.navigate({
						type: "openCastMember",
						scope: "cast",
						castId
					})}
			/>
		{/key}
	{:else if route.scope === "cast"}
		{#key book.id}
			<CastWorkspace
				lorebookId={book.id}
				{mode}
				{decisions}
				bind:hasUnsavedChanges={tabHasUnsavedChanges}
				onViewRelationships={async (castId) => {
					await loreRoute.navigate({
						type: "openCastMember",
						castId
					})
					openLens("graph")
				}}
			/>
		{/key}
	{:else if descriptor}
		<!-- One pool, narrowed by the scope the route is at. `#key` rebuilds
		     the socket conversation when the book or the scope changes, so one
		     scope never renders another one's rows. -->
		{#key `${book.id}:${descriptor.id}`}
			<EntryWorkspace
				lorebookId={book.id}
				{descriptor}
				{doors}
				{bookPool}
				{bookLinks}
				{mode}
				{lens}
				{filters}
				{readInKeys}
				{decisions}
				scopeTitle={SCOPE_LABELS[route.scope]}
				bind:hasUnsavedChanges={tabHasUnsavedChanges}
				onFilters={applyFilters}
				onNavigateToGraph={() => openLens("graph")}
			/>
		{/key}
	{:else}
		<!-- Places has no kind of its own yet, so the pool it would narrow to
		     is empty until one is declared. -->
		<EmptyState
			icon={Icons.Map}
			message="Nothing mapped yet. Link two places or put one inside another and this fills in."
		/>
	{/if}
{/snippet}

<!-- `bind:clientWidth` is a ResizeObserver on this element, so the layout
     follows the container it is actually given rather than the viewport. -->
<div
	class="flex h-full min-h-0 flex-col p-4"
	bind:clientWidth={widthPx}
	data-lore-layout={mode}
>
	{#if route.lorebookId === null}
		<div class="mb-2 flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={() => (creating = true)}
				title="Create New Lorebook"
			>
				<Icons.Plus size={16} />
				New
			</button>
			<button
				class="btn btn-sm preset-tonal-primary"
				title="Import Lorebook"
				onclick={() => (importing = true)}
			>
				<Icons.Upload size={16} />
				Import
			</button>
		</div>
		<div class="mb-4">
			<PanelFilterInput
				bind:value={bookSearch}
				placeholder="lorebooks"
				count={lorebookList.length}
				aria-label="Search lorebooks"
			/>
		</div>
		<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
			{#if isLoading}
				<div class="flex items-center justify-center py-8">
					<Icons.Loader2
						size={20}
						class="text-surface-400 animate-spin"
					/>
				</div>
			{:else if filteredLorebooks.length === 0}
				<EmptyState
					icon={Icons.Book}
					message={bookSearch
						? `No lorebooks found matching "${bookSearch}".`
						: "No lorebooks yet. Create one to get started."}
					ctaLabel={bookSearch ? undefined : "New Lorebook"}
					onCta={bookSearch ? undefined : () => (creating = true)}
				/>
			{:else}
				{#each filteredLorebooks as l (l.id)}
					<LorebookListItem
						lorebook={l}
						onclick={(lorebook) => openBook(lorebook.id)}
						onDelete={(id) => (deletingId = id)}
						onExport={(id) => (exportingId = id)}
						bindingsCount={l.lorebookBindings?.length || 0}
						worldEntriesCount={l.worldLoreEntries?.length || 0}
						characterEntriesCount={l.characterLoreEntries?.length ||
							0}
						historyEntriesCount={l.historyEntries?.length || 0}
						{hasOpenSession}
						{openSessionHasLorebook}
						isOpenSessionLorebook={openSessionCtx.lorebookId ===
							l.id}
						onAttachToSession={handleAttachToSession}
						onDetachFromSession={handleDetachFromSession}
					/>
				{/each}
			{/if}
		</div>
	{:else if mode === "desk"}
		<div class="flex min-h-0 flex-1 gap-4">
			<LoreRail
				branch="main"
				{scopes}
				scope={route.scope}
				{lens}
				{search}
				{savedCounts}
				{saved}
				pinned={pinnedItems}
				{readingInto}
				reached={readInKeys ? readInKeys.size : null}
				bookMenu={bookChip}
				onScope={openScope}
				onLens={openLens}
				onSaved={(next) => (saved = next)}
				onSearch={(next) => (search = next)}
				onOpenEntry={(item) =>
					loreRoute.navigate({
						type: "openEntry",
						entryId: item.id
					})}
			/>
			<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
				{#if moment}
					<MomentBanner
						{moment}
						pool={poolAsOf}
						onReturnToNow={() => setMoment(undefined)}
					/>
				{/if}
				<div class="flex min-h-0 min-w-0 flex-1 flex-col">
					{@render workspace()}
				</div>
				<!-- One line under every lens: the story axis, and the moment
				     being read. Never inside a lens, because moving between
				     them must not move the moment. -->
				<MomentBar
					{moment}
					castNotYet={castAsOfCounts}
					onMoment={setMoment}
					onOpenTimeline={lens === "time"
						? undefined
						: () => openLens("time")}
				/>
			</div>
		</div>
	{:else}
		<div class="mb-2 flex min-w-0 items-center gap-2">
			<button
				type="button"
				class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
				onclick={() => loreRoute.navigate({ type: "back" })}
				title="Back"
				aria-label="Back"
			>
				<Icons.ChevronLeft size={16} aria-hidden="true" />
			</button>
			{@render bookChip()}
		</div>
		<div class="mb-2 flex flex-col gap-2">
			<PanelFilterInput
				bind:value={search}
				data-lore-search
				placeholder="Search this book"
			/>
			{@render scopeChips()}
		</div>
		{#if moment}
			<MomentBanner
				{moment}
				pool={poolAsOf}
				onReturnToNow={() => setMoment(undefined)}
			/>
		{/if}
		<div class="mt-2 flex min-h-0 flex-1 flex-col">
			{@render workspace()}
		</div>
		<div class="mt-2">
			<MomentBar
				{moment}
				castNotYet={castAsOfCounts}
				onMoment={setMoment}
				onOpenTimeline={lens === "time"
					? undefined
					: () => openLens("time")}
			/>
		</div>
		<!-- The lens row moves to the bottom, where a thumb reaches it. -->
		<div class="border-border mt-2 border-t pt-2">
			<LensRow {lens} compact onLens={openLens} />
		</div>
	{/if}
</div>

<LorebookActions
	bind:creating
	bind:importing
	bind:exportingId
	bind:deletingId
	bind:duplicating
	{canOfferAttachToSession}
	onDeleted={(id) => {
		if (route.lorebookId === id) loreRoute.set(emptyRoute())
	}}
	onDuplicated={(id) => openBook(id)}
/>

<LorebookUnsavedChangesModal
	open={loreRoute.confirming}
	onOpenChange={(e) => {
		if (!e.open) loreRoute.resolveConfirm(false)
	}}
	onConfirm={() => loreRoute.resolveConfirm(true)}
	onCancel={() => loreRoute.resolveConfirm(false)}
/>
