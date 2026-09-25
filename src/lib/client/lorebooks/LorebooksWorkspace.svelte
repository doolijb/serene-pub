<script lang="ts">
	import { getContext, onDestroy, onMount, untrack } from "svelte"
	import { SvelteMap } from "svelte/reactivity"
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
	import ReadingInto from "./ReadingInto.svelte"
	import MomentBanner from "./time/MomentBanner.svelte"
	import MomentBar from "./time/MomentBar.svelte"
	import CompareLines from "./time/CompareLines.svelte"
	import LivesLens from "./time/LivesLens.svelte"
	import WorldBar from "./time/WorldBar.svelte"
	import { worldRoster } from "./time/worldRoster"
	import { appearancesOf } from "$lib/shared/lorebooks/presence"
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
	import { momentAxisRows } from "./timelineStrip"
	import { momentValue, notYetKeys, parseMoment } from "./time/moment"
	import {
		castAsOf,
		compareLines,
		entryAsOf,
		groupAmendments,
		rowsOnLine
	} from "$lib/shared/lorebooks/amendments"
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
	/** Dated overlays on this book's entries. See `resolvedRows` below. */
	let entryAmendments = $state<Sockets.Amendments.EntryRow[]>([])
	/** Overlays on the CAST — the people, card included. Ruled 2026-09-23. */
	let castAmendments = $state<Sockets.Amendments.CastRow[]>([])
	/** Where each member stands in their own life, and when. */
	let presences = $state<Sockets.Amendments.Presence[]>([])
	/** The book's cast members, for the comparison. The Cast board keeps its own. */
	let castRows = $state<any[]>([])
	/** The book's lines. `main` is implicit and never in here. */
	let branches = $state<Sockets.Amendments.Branch[]>([])
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

	/**
	 * The book's rows as they read AT THE MOMENT, on the line being read.
	 *
	 * The one place amendments are applied. Everything downstream — the pool,
	 * the tree, the time lanes — derives from this rather than from `bookRows`,
	 * so a dated change cannot be visible on one screen and missing from
	 * another.
	 *
	 * ⚠ `EntryWorkspace` keeps its OWN copy of the rows (its scope is its own
	 * socket conversation), so it cannot read this one — it is handed the
	 * FUNCTION instead, as the `resolve` prop, and applies it to its own rows.
	 * One resolver, two call sites; never two rules.
	 *
	 * ⚠ This runs at `now` too, not only while the Moment bar is moved. An
	 * amendment dated in the past is in effect now; that is what makes it an
	 * amendment rather than a note about the future.
	 *
	 * ⚠ Untouched when the book has no overlays, which is every book until
	 * somebody makes one — `bookRows` is handed straight back, so the common
	 * case costs one `length` check rather than a rebuild of every row.
	 */
	let resolveRows = $derived.by(() => {
		const branchId = route.branch ?? null
		const at = amendmentsAt
		// ⚠ The short circuit is "this book has never forked and has no
		// overlays", NOT "we are reading main". Main is not the unfiltered
		// reading — a fork's own entries are rows main does not have, and
		// skipping the filter there put them on both lines.
		if (!entryAmendments.length && !branches.length)
			return (rows: readonly PoolSource[]) => rows as PoolSource[]
		const byEntry = groupAmendments(entryAmendments, "entryId")
		return (rows: readonly PoolSource[]) =>
			// ⚠ Filter FIRST. Resolving a row this line cannot see would spend
			// the work and then drop it, and — worse — a sibling line's entry
			// would be counted by anything reading the length.
			rowsOnLine(rows as any[], branchId).map((row: any) => {
				const overlays = byEntry.get(row.id)
				return overlays
					? (entryAsOf(row, overlays as any, at) as PoolSource)
					: (row as PoolSource)
			})
	})

	/**
	 * When, and on which line, everything in this book is being read.
	 *
	 * One object, shared by every resolver, so an entry and a cast member can
	 * never disagree about the moment they are being read from.
	 *
	 * ⚠ **RULED 2026-09-23: a branch reads its own amendments and everything on
	 * main BEFORE the fork — nothing main went on to do afterwards.** The cut
	 * is by STORY DATE, not by when the change was written. A line with no fork
	 * date was never cut off from anything and keeps following main.
	 *
	 * ⚠ A fork off another fork passes ITS OWN fork date, not its parent's: the
	 * cut is where THIS line left, and the parent's cut is already baked into
	 * what the parent carried away.
	 */
	let amendmentsAt = $derived.by(() => {
		const branchId = route.branch ?? null
		const line = branchId
			? (branches.find((b) => b.id === branchId) ?? null)
			: null
		return {
			moment: parseMoment(route.moment),
			branchId,
			forkedAt:
				line && line.forkYear != null
					? {
							year: line.forkYear,
							month: line.forkMonth,
							day: line.forkDay
						}
					: null
		}
	})

	/**
	 * A cast member as they read at this moment, on this line.
	 *
	 * The same `at` the entries use, so a member and their lore can never
	 * disagree about when they are being read from. Which CARD represents them
	 * resolves through here too — `characterId` is an ordinary column.
	 */
	let resolveCast = $derived.by(() => {
		if (!castAmendments.length)
			return <T extends { id: number }>(rows: readonly T[]) => rows as T[]
		const byMember = groupAmendments(castAmendments, "castId")
		return <T extends { id: number }>(rows: readonly T[]) =>
			rows.map((row) => {
				const overlays = byMember.get(row.id)
				return overlays
					? (castAsOf(row, overlays as any, amendmentsAt) as T)
					: row
			})
	})

	/** This member's overlays, for their own account of them. */
	let castAmendmentsFor = $derived.by(() => {
		const byMember = groupAmendments(castAmendments, "castId")
		return (castId: number) => byMember.get(castId) ?? []
	})

	/**
	 * This entry's overlays, for the entry's own account of them.
	 *
	 * The same grouped map the resolver uses — asked a second question, never
	 * grouped a second time.
	 */
	let amendmentsFor = $derived.by(() => {
		const byEntry = groupAmendments(entryAmendments, "entryId")
		return (entryId: number) => byEntry.get(entryId) ?? []
	})

	/**
	 * Card names, for the one comparison where an id means nothing.
	 *
	 * ⚠ Asked for only while the comparison is open. Every other screen draws
	 * a card through the row it is joined to, so the whole list would be a
	 * fetch nobody reads — and this book may feature three of a hundred cards.
	 */
	let cardNames = $state(new SvelteMap<number, string>())

	function handleCharactersList(msg: Sockets.Characters.List.Response) {
		const next = new SvelteMap<number, string>()
		for (const c of msg.characterList ?? []) {
			// A card with no id is not a card this book can point at.
			if (c.id == null) continue
			next.set(
				c.id,
				(c.nickname || c.name || "").trim() || `card #${c.id}`
			)
		}
		cardNames = next
	}

	// BARE: the whole of this user's cards, not one book's — the same key the
	// Cast board uses, and the reason this is a fetch and not a join.
	useInterest<"characters:list">("characters:list", handleCharactersList)

	$effect(() => {
		// ⚠ Asked for on any open book, not only while comparing: the World
		// bar's roster names a carded member BY their card, so without this a
		// card swapped by an amendment is invisible in the one place meant to
		// show who is in the room.
		if (route.lorebookId === null) return
		socket.emit("characters:list", {})
	})

	/**
	 * Everyone this world holds at the moment being read, on this line.
	 *
	 * Drawn from the cast rows resolved through `resolveCast`, so a member
	 * whose card or state was amended reads as they are *here* — and a member
	 * present twice is two entries, which is the whole point of the list.
	 */
	let inhabitants = $derived.by(() => {
		const at = {
			moment: amendmentsAt.moment,
			branchId: amendmentsAt.branchId
		}
		const onThisLine = rowsOnLine(castRows, at.branchId) as any[]
		// ⚠ Each member becomes one row PER APPEARANCE. A member the book has
		// never placed has exactly one, which is every member in every book
		// today — the doubling only appears once somebody says where in their
		// life they are standing.
		const expanded = onThisLine.flatMap((row) => {
			const here = appearancesOf(row.id, presences as any, at)
			return here.map((a) => ({
				...row,
				personalPosition: a.personalPosition
			}))
		})
		return worldRoster(resolveCast(expanded) as any, (id) =>
			cardNames.get(id)
		)
	})

	/**
	 * The cast, named as the rest of the workspace names them.
	 *
	 * ⚠ Resolved, and named by the RESOLVED card. Reading the raw row here put
	 * "Verity, novice" on the lane while the roster two inches above said
	 * "Verity, keeper" — one screen disagreeing with itself about who somebody
	 * is, which is the exact failure the one-resolver rule exists to stop.
	 */
	let livesMembers = $derived(
		(resolveCast(rowsOnLine(castRows, route.branch ?? null)) as any[]).map(
			(r) => ({
				id: r.id,
				name:
					(r.characterId != null
						? (cardNames.get(r.characterId) ?? r.name)
						: r.name) || "Unnamed"
			})
		)
	)

	/** The reader's words for a column, where a column has one. */
	const FIELD_WORDS: Record<string, string> = {
		name: "name",
		content: "content",
		keys: "triggers",
		secondaryKeys: "secondary keys",
		enabled: "on or off",
		constant: "always on",
		priority: "priority",
		summary: "summary",
		aliases: "aliases",
		nodeState: "state",
		nodeVisibility: "who can see them",
		characterId: "which card",
		spriteSet: "sprite set"
	}

	/**
	 * What this line has that main does not, and what the two read differently.
	 *
	 * Entries and cast members in one list: an author comparing two stories
	 * wants the whole of the difference, not two screens of half of it.
	 *
	 * ⚠ Computed from the UNRESOLVED rows on purpose — `compareLines` resolves
	 * each one twice itself, once per line, which is the only way to have both
	 * readings at the same time. `resolvedRows` holds one of them.
	 */
	let lineDifferences = $derived.by(() => {
		const branchId = route.branch ?? null
		if (branchId === null) return []
		const at = {
			moment: amendmentsAt.moment,
			forkedAt: amendmentsAt.forkedAt
		}
		const byEntry = groupAmendments(entryAmendments, "entryId")
		const byMember = groupAmendments(castAmendments, "castId")
		// ⚠ The key is what tells the two apart downstream: an entry and a
		// cast member are separate id spaces and collide at the same number.
		const entries = compareLines(
			Object.values(bookRows).flat() as any[],
			(id) => (byEntry.get(id) ?? []) as any,
			branchId,
			at
		).map((d) => ({
			...d,
			key: `entry#${d.id}`,
			subject: "entry" as const
		}))
		const cast = compareLines(
			castRows as any[],
			(id) => (byMember.get(id) ?? []) as any,
			branchId,
			at
		).map((d) => ({ ...d, key: `cast#${d.id}`, subject: "cast" as const }))
		return [...entries, ...cast]
	})

	/** The book's own rows, read through that function. */
	let resolvedRows = $derived.by(() => {
		if (!entryAmendments.length) return bookRows
		const out: Record<string, PoolSource[]> = {}
		for (const [typeId, rows] of Object.entries(bookRows))
			out[typeId] = resolveRows(rows)
		return out
	})

	/** Every row in the book, as the pool reads them. */
	let bookPool = $derived(bookPoolItems(resolvedRows, sceneRows))

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
	let timeEntries = $derived(
		Object.values(resolvedRows).flat() as TimeEntryRow[]
	)
	/**
	 * The session reading this book, for the rail's block.
	 *
	 * Gated on `lorebookId` as well as `sessionId`: a session is open in the
	 * shell whatever book is on screen, and a session reading a DIFFERENT book
	 * has nothing to say about this one.
	 */
	let railSession = $derived(
		book &&
			openSessionCtx.lorebookId === book.id &&
			openSessionCtx.sessionId !== null
			? {
					id: openSessionCtx.sessionId,
					name: openSessionCtx.sessionName ?? "the open session",
					branchId: openSessionCtx.lorebookBranchId ?? null
				}
			: null
	)

	/**
	 * Stand where the session stands: its line, and now.
	 *
	 * Both at once and in one step, because "what the model sees" is the pair
	 * — a reader on the right line at the wrong date is still not looking at
	 * what was sent.
	 */
	function matchSession() {
		if (!railSession) return
		loreRoute.navigate({ type: "setMoment", moment: undefined })
		loreRoute.navigate({
			type: "setBranch",
			branch: railSession.branchId ?? undefined
		})
	}

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
			lorebookId: id,
			// The figures are of what this line can see, so they move with it.
			branchId: route.branch ?? null
		} satisfies Sockets.Entries.Counts.Params)
	}

	/**
	 * The rail's figures follow the line being read.
	 *
	 * The counts are the server's, so switching line has to ask again — the
	 * pool filters itself, but a figure computed elsewhere cannot.
	 */
	$effect(() => {
		void route.branch
		refreshCounts()
	})

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
		socket.emit("amendments:list", { lorebookId: id })
		// ⚠ The cast is REQUESTED on open, for the World bar's roster. As a
		// cascade of somebody else's write it would not arrive at all until
		// something touched a binding, and the world would read as empty.
		socket.emit("lorebooks:bindingList", {
			lorebookId: id
		} satisfies Sockets.Lorebooks.BindingList.Params)
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
	 * Every dated overlay in the book, and the lines it has.
	 *
	 * One message for the whole book (see `sockets/amendments.ts`): the pool
	 * resolves every row it draws, so a call per entry would be a call per row.
	 */
	function handleAmendmentsList(msg: Sockets.Amendments.List.Response) {
		if (msg.lorebookId !== route.lorebookId) return
		entryAmendments = msg.entries
		castAmendments = msg.cast
		presences = msg.presences ?? []
		branches = msg.branches
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
		// The scope the gate reads; checked here too, so a stale book's
		// reply arriving after a switch cannot paint this one.
		if (msg.lorebookId !== route.lorebookId) return
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
		// Kept, not just counted: comparing two lines needs the cast rows as
		// well as the entries, and this list is already on the wire.
		castRows = msg.lorebookBindingList as any[]
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
			momentAxisRows(
				(bookRows[HISTORY_TYPE_ID] ?? []) as any[],
				[
					...entryAmendments,
					// A cast overlay dates the story exactly as an entry's does:
					// the year a member changed card is a moment worth standing at.
					...castAmendments
				] as any[]
			)
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
			declareInterest<"amendments:list">(
				interestKey("amendments:list", id),
				handleAmendmentsList
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

{#snippet worldBar()}
	<!-- Where you are in this story, as one control. Line and moment were two
	     corners of the screen before; they are one question. -->
	{#if book}
		<WorldBar
			lorebookId={book.id}
			{branches}
			branchId={route.branch ?? null}
			moment={route.moment}
			{inhabitants}
			comparing={!!route.compare}
			onBranch={(next) =>
				loreRoute.navigate({ type: "setBranch", branch: next })}
			onMoment={(next) =>
				loreRoute.navigate({ type: "setMoment", moment: next })}
			onCompare={() =>
				loreRoute.navigate({ type: "setCompare", compare: true })}
			onOpenMember={(castId) =>
				loreRoute.navigate({
					type: "openCastMember",
					scope: "cast",
					castId
				})}
		/>
	{/if}
{/snippet}

{#snippet workspace()}
	{#if !book}
		<div class="flex items-center justify-center py-8">
			<Icons.Loader2 size={20} class="text-surface-400 animate-spin" />
		</div>
	{:else if route.compare && route.branch != null}
		<!-- Drawn in place of the pool, not beside it: comparing is a different
		     question from reading, and a split screen would answer neither. -->
		<CompareLines
			lineName={branches.find((b) => b.id === route.branch)?.name ??
				"this line"}
			differences={lineDifferences}
			titleOf={(row) =>
				(row?.name || row?.title || "").toString().trim() || "Untitled"}
			labelOf={(field) => FIELD_WORDS[field] ?? field}
			valueOf={(field, value) =>
				field === "characterId"
					? value == null
						? "no card"
						: (cardNames.get(Number(value)) ?? `card #${value}`)
					: null}
			onOpen={(d) =>
				loreRoute.navigate(
					(d as any).subject === "cast"
						? {
								type: "openCastMember",
								scope: "cast",
								castId: d.id
							}
						: { type: "openEntry", entryId: d.id }
				)}
			onClose={() =>
				loreRoute.navigate({ type: "setCompare", compare: false })}
		/>
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
	{:else if lens === "lives"}
		<!-- Who was in the world, and when. Time draws what happened; this
		     draws who was there for it. -->
		{#key book.id}
			<LivesLens
				members={livesMembers}
				presences={presences as any}
				pins={(bookRows[HISTORY_TYPE_ID] ?? []) as any}
				moment={amendmentsAt.moment}
				branchId={amendmentsAt.branchId}
				onOpenMember={(castId) =>
					loreRoute.navigate({
						type: "openCastMember",
						scope: "cast",
						castId
					})}
			/>
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
				{resolveCast}
				{castAmendmentsFor}
				moment={route.moment}
				presences={presences as any}
				branchId={route.branch ?? null}
				branchName={route.branch
					? (branches.find((b) => b.id === route.branch)?.name ?? null)
					: null}
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
				resolve={resolveRows}
				{amendmentsFor}
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
		<div class="mb-3">
			{@render worldBar()}
		</div>
		<div class="flex min-h-0 flex-1 gap-4">
			<LoreRail
				{branches}
				branchId={route.branch ?? null}
				moment={route.moment}
				session={railSession}
				onMatchSession={matchSession}
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
		<div class="mb-2">
			{@render worldBar()}
		</div>
		{#if railSession}
			<!-- The rail is a desk thing; the session reading this book is not,
			     so the block is mounted in both layouts rather than living
			     inside `LoreRail`. -->
			<div class="mb-2">
				<ReadingInto
					sessionId={railSession.id}
					sessionName={railSession.name}
					reached={readInKeys ? readInKeys.size : null}
					sessionBranchId={railSession.branchId}
					branchId={route.branch ?? null}
					{moment}
					{branches}
					onMatch={matchSession}
				/>
			</div>
		{/if}
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
