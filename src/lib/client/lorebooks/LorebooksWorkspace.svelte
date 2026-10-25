<script lang="ts">
	import Badge from "$lib/client/components/Badge.svelte"
	import { getContext, onDestroy, onMount, untrack } from "svelte"
	import { SvelteMap } from "svelte/reactivity"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { sessionStore } from "$lib/client/sessions/store/sessionStore.svelte"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { toaster } from "$lib/client/utils/toaster"
	import { warnBeforeUnload } from "$lib/client/forms/unsavedEdits.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import LorebookListItem from "$lib/client/components/listItems/LorebookListItem.svelte"
	import ListGroupLabel from "$lib/client/components/panels/ListGroupLabel.svelte"
	import SharePeopleModal from "$lib/client/components/sharing/SharePeopleModal.svelte"
	import SharedWithLine from "$lib/client/components/sharing/SharedWithLine.svelte"
	import { splitSharedRows } from "$lib/shared/utils/sharedRows"
	import type { ConversationPerson } from "$lib/shared/sockets/conversations"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import ViewToolbar from "$lib/client/components/panels/ViewToolbar.svelte"
	import PanelSplit from "$lib/client/components/panels/PanelSplit.svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import { toolbarButtonClass } from "$lib/client/components/panels/toolbarButton"
	import LorebookUnsavedChangesModal from "$lib/client/components/modals/LorebookUnsavedChangesModal.svelte"
	import {
		CHARACTER_LORE_TYPE_ID,
		HISTORY_TYPE_ID
	} from "$lib/shared/entries/types"
	import { attachLorebookToSession } from "$lib/client/utils/attachLorebookToSession"
	import type { RowMenuEntries } from "$lib/client/components/menus/RowMenu.svelte"
	import ActionConfirm from "$lib/client/components/sessionPage/ActionConfirm.svelte"
	import { askingOf } from "$lib/client/components/sessionPage/actionConfirmAsking"
	import {
		SESSION_NOTES_LABEL,
		SHARE_LABELS,
		SHARE_CONFIRMS
	} from "$lib/shared/lorebooks/sessionNotes"
	import { LOREBOOK_EXPORT_PAUSED } from "$lib/shared/lorebooks/exportPaused"
	import BookReadBy from "./BookReadBy.svelte"
	import BookSettings from "./BookSettings.svelte"
	import { isStarterKit } from "./starterKitCards"
	import DayOne from "./DayOne.svelte"
	import LensTrack from "./LensTrack.svelte"
	import LorebookActions from "./LorebookActions.svelte"
	import LoreRail from "./LoreRail.svelte"
	import ReplaceReadingModal from "./ReplaceReadingModal.svelte"
	import ScopePopout from "./ScopePopout.svelte"
	import MomentBar from "./time/MomentBar.svelte"
	import CompareLines from "./time/CompareLines.svelte"
	import RosterPopover from "./time/RosterPopover.svelte"
	import { worldRoster } from "./time/worldRoster"
	import { formatDate } from "./sections/historyDates"
	import { appearancesOf } from "$lib/shared/lorebooks/presence"
	import { refLinksFrom, type RefLink } from "./editor/refs"
	import { whenBookOpens } from "./bookOpens.svelte"
	import { setBookData, type BookAccess } from "./bookData.svelte"
	import type { BookLibrary } from "./libraryRows"
	import {
		castSignature,
		dropDeletedEntry,
		patchEmbedding,
		patchScene
	} from "./bookPatches"
	import { lensDescriptor, lensForKey, QUEUE_LENS } from "./lenses/registry"
	import { mountFor } from "./lenses/mounts"
	import type { LensBench } from "./lenses/types"
	import { edgesOnLine } from "./graphs/asOf"
	import { endpointKey } from "./graphs/graphModel"
	import {
		looseEnds,
		liveQueue,
		membersWithLore,
		nextLooseEnd,
		choreOf,
		type ChoreField,
		type LooseEnd
	} from "./looseEnds"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import { loreRoute } from "./loreRoute.svelte"
	import {
		BookRelationships,
		setBookRelationships
	} from "./relationships.svelte"
	import { JUMP_CONTEXT, type JumpCtx } from "$lib/client/shell/jump.svelte"
	import {
		DEFAULT_LENS,
		describeRoute,
		emptyRoute,
		reduce,
		routeFromDigest,
		type LoreLens,
		type LoreScope
	} from "$lib/shared/lorebooks/loreRoute"
	import {
		emptyFilters,
		filterPool,
		SCENE_KIND,
		type PoolFilters
	} from "./poolFilter"
	import {
		BOOK_ENTRY_TYPES,
		bookIsEmpty,
		CAST_KIND,
		drawnRulesLists as drawnListsOf,
		rulesListFacets,
		scopeTitle,
		type RulesList,
		matchSessionRoute,
		mergeCastCount,
		railScopes,
		READ_INTO_SESSION,
		SAVED_SCOPES,
		savedScopeCounts,
		savedScopeFilters,
		savedScopeRoute,
		scopeChipLabel,
		scopeRoute,
		sessionMomentKey,
		STOP_READING,
		type SavedScopeId
	} from "./scopes"
	import {
		bookPoolItems,
		descriptorForKind,
		rulesListDoor
	} from "./sections"
	import { rememberRulesLists } from "./sections/derivedPiece"
	import { castPoolItem } from "./castPool"
	import { avatarSrc, lorebookCoverSrc } from "$lib/client/utils/media"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import { memberFaceSrc } from "./cast/memberFace"
	import type { EntryDecisions } from "./markers"
	import type { PoolSource } from "./sections/types"
	import { timelineCursor } from "./timelineCursor.svelte"
	import { openBookTime } from "./time/bookTime.svelte"
	import { compareDates } from "$lib/shared/lorebooks/storyDate"
	import { momentAxisRows } from "./timelineStrip"
	import {
		castArrivalDates,
		momentValue,
		notYetKeys,
		parseMoment
	} from "./time/moment"
	import {
		amendmentsForAppearance,
		castAsOf,
		compareLines,
		entryAsOf,
		groupAmendments
	} from "$lib/shared/lorebooks/amendments"
	import {
		amendmentsOnLine,
		lineOf,
		rowsReadingOnLine,
		survivingLineOf
	} from "$lib/shared/lorebooks/lineReading"
	import {
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
	/**
	 * The open book's relationships, and the cast rows they name — ONE copy,
	 * which the graph lens reads too (plan places-graph B3). Turned to the
	 * book in the book-scoped interest effect below.
	 */
	const relationships = new BookRelationships(socket)
	setBookRelationships(relationships)
	/**
	 * The open book's data, read by every lens (plan B4) — the shell's own
	 * state, through getters. Set below, once the state it reads exists.
	 */
	const panelsCtx: PanelsCtx = getContext("panelsCtx")
	const openSessionCtx: OpenSessionCtx = getContext("openSessionCtx")
	const systemSettingsCtx: SystemSettingsCtx | undefined =
		getContext("systemSettingsCtx")
	const userCtx: { user?: SelectUser | null } | undefined =
		getContext("userCtx")
	/** 🚧 Admins make starter lorebooks (PLAN-lorebook-kinds ruling 5). */
	let isAdmin = $derived(!!userCtx?.user?.isAdmin)
	/** `LorebookActions`' own verbs: Save as starter lorebook, a book from a kit. */
	let actions: ReturnType<typeof LorebookActions> | undefined = $state()

	let lorebookList: any[] = $state([])
	let sessionNotes = $state<Sockets.Lorebooks.SessionNotes.Response["books"]>([])
	let sessionNotesLoaded = $state(false)
	/** 🚧 pr-6 (R-f): the lists a book can be opened from. */
	let knownBooks = $derived<any[]>([...lorebookList, ...sessionNotes])
	let isLoading: boolean = $state(true)
	/** The search over the list of books, which is a different list. */
	let bookSearch: string = $state("")
	/**
	 * Measures the view, as every sidebar view does (STYLE-GUIDE §5.2): desk
	 * at 900px and up (`layoutMode`'s floor, stated once in `viewMode`).
	 */
	const vm = new ViewModeTracker()
	/** The workspace's own element: a lens shortcut is heard only inside it. */
	let workspaceEl: HTMLDivElement | undefined = $state()
	let tabHasUnsavedChanges: boolean = $state(false)

	let creating: boolean = $state(false)
	let importing: boolean = $state(false)
	/** Kept for `LorebookActions`' binding; Export is paused and nothing sets it. */
	let exportingId: number | null = $state(null)
	let deletingId: number | null = $state(null)
	/** The book being copied, and what it is called, for the naming prompt. */
	let duplicating: { id: number; name: string } | null = $state(null)

	/** The book's figures, counted by the server. Null while on their way. */
	let counts = $state<Record<string, number> | null>(null)
	/** Every row the book holds, so the rail can report on the whole of it. */
	let bookRows = $state<Record<string, PoolSource[]>>({})
	/**
	 * 🚧 The book's rules lists (`entries:types`, PLAN-lorebook-kinds §C):
	 * every entryable list its rules declare. Which of them the book DRAWS is
	 * `drawnRulesLists` below (ruled 2026-10-21).
	 */
	let rulesLists = $state<RulesList[]>([])
	/** Which rules the lists above were read for, so a change of Rules asks again. */
	let rulesListsFor: string | null = null
	/**
	 * 🚧 The book's rules library (`lorebooks:library`, §C ruling 10): the
	 * pieces the ‹Rules› library chip shows under the book, read only. Null
	 * until it arrives; asked for with the lists, so a change of Rules asks
	 * again.
	 */
	let library = $state<BookLibrary | null>(null)
	/** Dated overlays on this book's entries. See `resolvedRows` below. */
	let entryAmendments = $state<Sockets.Amendments.EntryRow[]>([])
	/** Overlays on the CAST — the people, card included. Ruled 2026-09-23. */
	let castAmendments = $state<Sockets.Amendments.CastRow[]>([])
	/** Where each member stands in their own life, and when. */
	let presences = $state<Sockets.Amendments.Presence[]>([])
	/**
	 * The book's cast, as the server lists it — every lens's copy (plan B4:
	 * the Cast board, Entries and the Time lens each kept one of their own).
	 */
	let castRows = $state<any[]>([])
	/** Whether the cast and the scenes have arrived for the open book. */
	let castLoaded = $state(false)
	let scenesLoaded = $state(false)
	/** The book's lines. `main` is implicit and never in here. */
	let branches = $state<Sockets.Amendments.Branch[]>([])
	let sceneRows = $state<PoolSource[]>([])
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
	/**
	 * The open book's id, as a primitive: it passes on only when the book
	 * changes. `route` is a new object on every navigation, so an effect that
	 * reads `route.lorebookId` re-runs on a node click; one keyed on this does
	 * not.
	 */
	let openBookId = $derived(route.lorebookId)
	let mode = $derived(vm.mode)
	let book = $derived(knownBooks.find((l) => l.id === route.lorebookId))
	let bookIsSessionNotes = $derived(book?.sessionId != null)
	/**
	 * A book another person shared with the reader opens **read-only**
	 * (PLAN-private-messages §6.7, ruled Q4): every lens renders, every
	 * write verb is hidden or disabled. The list row's `bookAccess` (lane
	 * A3) when the wire carries it, else its `isSharedWithMe` mark; the
	 * server refuses a non-owner's write regardless.
	 */
	let bookAccess = $derived<BookAccess>(
		(book?.bookAccess as BookAccess | undefined) ??
			(book?.isSharedWithMe ? "shared" : "owner")
	)
	let readOnly = $derived(bookAccess !== "owner")
	/**
	 * 🚧 The open book is a starter lorebook (PLAN-lorebook-kinds §B): edited in
	 * place by the admin who made it, never read into a session, never
	 * written by one — so it has no reading verb, no write mode and no Share.
	 */
	let bookIsKit = $derived(isStarterKit(book))

	/**
	 * Sharing (PLAN-private-messages §6.7): the owner's **Share…** while
	 * accounts are on, and the **Shared with** faces under the header. Who it
	 * is shared with is on `lorebooks:get` only (owner), held for the open
	 * book while the owner could share it.
	 */
	let canShare = $derived(
		!!book &&
			!readOnly &&
			!bookIsKit &&
			!!systemSettingsCtx?.settings?.isAccountsEnabled
	)
	let sharing = $state(false)
	let sharedWith = $state<ConversationPerson[]>([])
	/**
	 * The book being shared, as a primitive: `book` is a new object on every
	 * `lorebooks:list` push, so an effect reading it re-asked `lorebooks:get`
	 * after every save and blanked the line meanwhile (audit 2026-10-21).
	 */
	let shareBookId = $derived(canShare ? (book?.id ?? null) : null)
	$effect(() => {
		const id = shareBookId
		sharedWith = []
		if (id === null) return
		const release = declareInterest<"lorebooks:get">(
			interestKey("lorebooks:get", id),
			(msg) => {
				if (msg.lorebookId === id)
					sharedWith = msg.lorebook?.sharedWith ?? []
			}
		)
		const releaseShare = declareInterest<"lorebooks:share">(
			"lorebooks:share",
			(msg) => {
				if (msg.lorebookId === id) sharedWith = msg.sharedWith
			}
		)
		socket.emit("lorebooks:get", { id })
		return () => {
			release()
			releaseShare()
		}
	})

	/** Book settings, from its rail row, the view picker or the ⋯ menu. */
	function openSettings() {
		void loreRoute.navigate({ type: "openSettings" })
	}

	/** A book's settings straight from the list: one transition, one guard. */
	function openBookSettings(lorebookId: number) {
		void loreRoute.navigateTo(
			reduce(reduce(route, { type: "openBook", lorebookId }), {
				type: "openSettings"
			})
		)
	}

	function handleShareConfirm(userIds: number[]) {
		if (!book) return
		socket.emit("lorebooks:share", { lorebookId: book.id, userIds })
	}
	let lens = $derived<LoreLens>(route.lens ?? DEFAULT_LENS)
	/** The lens's descriptor — what draws it, and how it treats day one. */
	let activeLens = $derived(lensDescriptor(lens))

	// Guests can view a shared session but can't reconfigure it — the server
	// rejects sessions:setLorebook for non-owners anyway, this just avoids
	// showing an action that would fail with an error toast.
	let hasOpenSession = $derived(
		openSessionCtx.sessionId !== null && openSessionCtx.isOwner
	)
	let openSessionHasLorebook = $derived(openSessionCtx.lorebookId !== null)
	let canOfferAttachToSession = $derived(
		hasOpenSession &&
			!openSessionHasLorebook &&
			// The book lock: a story underway keeps its own notes.
			!openSessionCtx.lorebookFixed
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
	 * ⚠ Never short-circuited: even a book with no overlays is filtered to
	 * the line being read (see `resolveRows` below).
	 */
	/**
	 * The story's present on the line being read (DESIGN-story-time §3): the
	 * line's stored clock, else its newest history entry — the same rule the
	 * server's `storyNowOf` follows, so the bar and the prompt agree.
	 */
	let storyPresent = $derived.by(() => {
		const branchId = route.branch ?? null
		const clock = openBookTime.clockOn(branchId)
		if (clock) return { date: clock, from: "clock" as const }
		const dated = rowsReadingOnLine(
			(bookRows[HISTORY_TYPE_ID] ?? []) as any[],
			line,
			rowDate
		).filter((row: any) => typeof row.year === "number")
		if (!dated.length) return null
		const newest = dated.reduce((a: any, b: any) =>
			compareDates(b, a) > 0 ? b : a
		)
		return {
			date: { year: newest.year, month: newest.month, day: newest.day },
			from: "history" as const
		}
	})

	/** Stores (or clears) the clock on the line being read. */
	function setStoryClock(clock: Sockets.Lorebooks.StoryClock | null) {
		if (!book) return
		socket.emit("lorebooks:setClock", {
			lorebookId: book.id,
			branchId: route.branch ?? null,
			clock
		})
	}

	/**
	 * A row's own story date, or null when it carries none (only History
	 * does). What the fork cut is measured against.
	 */
	function rowDate(row: any) {
		return typeof row?.year === "number"
			? { year: row.year, month: row.month ?? null, day: row.day ?? null }
			: null
	}

	/**
	 * The line being read: the branch and its ANCESTOR CHAIN down to main,
	 * each step with its fork cut (owner ruling 5, 2026-09-28). The one rule
	 * (`$lib/shared/lorebooks/lineReading.ts`) the server reads by too.
	 */
	let line = $derived(lineOf(route.branch ?? null, branches))

	let resolveRows = $derived.by(() => {
		const at = amendmentsAt
		const onLine = line
		// ⚠ NO short circuit on "no overlays, no branches". Main is not the
		// unfiltered reading — a fork's own entries are rows main does not
		// have — and every early return here has failed open once (#80,
		// three times over). `groupAmendments` of nothing is an empty map.
		const byEntry = groupAmendments(entryAmendments, "entryId")
		return (rows: readonly PoolSource[]) =>
			// ⚠ Filter FIRST. Resolving a row this line cannot see would spend
			// the work and then drop it, and — worse — a sibling line's entry
			// would be counted by anything reading the length. A shared row
			// dated after the fork is CUT from the branch, as the server's
			// counts and readings cut it.
			rowsReadingOnLine(rows as any[], onLine, rowDate).map(
				(row: any) => {
					const overlays = byEntry.get(row.id)
					return overlays
						? (entryAsOf(row, overlays as any, at) as PoolSource)
						: (row as PoolSource)
				}
			)
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
	 * ⚠ A fork off another fork reads THROUGH its parent (ruling 5): the
	 * parent's amendments up to this line's fork date, the grandparent's up
	 * to the earlier of the two cuts — `line` carries the whole chain.
	 */
	let amendmentsAt = $derived({ moment: parseMoment(route.moment), line })

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
			line
		}
		const onThisLine = rowsReadingOnLine(castRows, line) as any[]
		const byMember = groupAmendments(castAmendments, "castId")
		// ⚠ Each member becomes one row PER APPEARANCE. A member the book has
		// never placed has exactly one, which is every member in every book
		// today — the doubling only appears once somebody says where in their
		// life they are standing.
		//
		// ⚠ And each appearance resolves at ITS point of her life: a change
		// dated against her life reaches only appearances at or past it
		// (`amendmentsForAppearance`, the filter `cardMemberAt` uses on the
		// server), so the thirty-four-year-old is not handed the scar the
		// fifty-year-old got at forty.
		const expanded = onThisLine.flatMap((row) => {
			const here = appearancesOf(row.id, presences as any, at)
			const overlays = byMember.get(row.id) ?? []
			return here.map((a) => {
				const appearance = {
					...row,
					personalPosition: a.personalPosition
				}
				return overlays.length
					? castAsOf(
							appearance,
							amendmentsForAppearance(
								overlays,
								a.personalPosition
							) as any,
							amendmentsAt
						)
					: appearance
			})
		})
		return worldRoster(expanded as any, (id) => cardNames.get(id))
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
		(resolveCast(rowsReadingOnLine(castRows, line)) as any[]).map((r) => ({
			id: r.id,
			name:
				(r.characterId != null
					? (cardNames.get(r.characterId) ?? r.name)
					: r.name) || "Unnamed"
		}))
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
	 *
	 * ⚠ Entries are handed their date (`rowDate`): a history entry past this
	 * line's fork cut never happened here, so it is not a difference.
	 */
	let lineDifferences = $derived.by(() => {
		if (line.branchId === null) return []
		const at = amendmentsAt
		const byEntry = groupAmendments(entryAmendments, "entryId")
		const byMember = groupAmendments(castAmendments, "castId")
		// ⚠ The key is what tells the two apart downstream: an entry and a
		// cast member are separate id spaces and collide at the same number.
		const entries = compareLines(
			Object.values(bookRows).flat() as any[],
			(id) => (byEntry.get(id) ?? []) as any,
			at,
			rowDate
		).map((d) => ({
			...d,
			key: `entry#${d.id}`,
			subject: "entry" as const
		}))
		const cast = compareLines(
			castRows as any[],
			(id) => (byMember.get(id) ?? []) as any,
			at
		).map((d) => ({ ...d, key: `cast#${d.id}`, subject: "cast" as const }))
		return [...entries, ...cast]
	})

	/**
	 * The book's own rows, read through that function.
	 *
	 * ⚠ ALWAYS through it. This returned `bookRows` untouched whenever the
	 * book had no entry amendments, which put a fork's own entries on main
	 * the moment a book forked before anybody amended anything (#80).
	 */
	let resolvedRows = $derived.by(() => {
		const out: Record<string, PoolSource[]> = {}
		for (const [typeId, rows] of Object.entries(bookRows))
			out[typeId] = resolveRows(rows)
		return out
	})

	/**
	 * The book's scenes on the line being read. A fork's scenes are not
	 * main's (the server's counts filter them the same way).
	 */
	let lineScenes = $derived(
		rowsReadingOnLine(sceneRows as any[], line) as PoolSource[]
	)

	/**
	 * The lists the book draws: only where it has something in it — entries
	 * of that kind on this line, or rows in its rules' library (ruled
	 * 2026-10-21). A Freeform book draws none until it holds some.
	 */
	let drawnRulesLists = $derived(drawnListsOf(rulesLists, counts))
	/** The doors of every one of the book's lists: Everything holds their rows. */
	let rulesListDoors = $derived(rulesLists.map((list) => rulesListDoor(list)))

	/** Every row in the book, as the pool reads them. */
	let bookPool = $derived(
		bookPoolItems(resolvedRows, lineScenes, rulesListDoors)
	)

	/**
	 * The book, for every lens (plan B4) — read through getters, so a lens's
	 * effects and deriveds follow the shell's state. The verbs are the
	 * shell's own requests, answered on the keys it already holds.
	 */
	setBookData({
		get lorebookId() {
			return openBookId
		},
		get bookAccess() {
			return bookAccess
		},
		get readOnly() {
			return readOnly
		},
		get rows() {
			return resolvedRows
		},
		get rawRows() {
			return bookRows
		},
		get cast() {
			return castRows
		},
		resolveCast: (rows) => resolveCast(rows),
		get scenes() {
			return lineScenes
		},
		get allScenes() {
			return sceneRows
		},
		get suggestions() {
			return castSuggestions
		},
		get duplicates() {
			return castDuplicates
		},
		get rulesLists() {
			return rulesLists
		},
		get drawnRulesLists() {
			return drawnRulesLists
		},
		get library() {
			return library
		},
		loaded(what) {
			if (what === "cast") return castLoaded
			if (what === "scenes") return scenesLoaded
			return bookRows[what] !== undefined
		},
		refreshScenes() {
			const id = route.lorebookId
			if (id !== null)
				socket.emit("scenes:listByLorebook", { lorebookId: id })
		},
		refreshCast() {
			const id = route.lorebookId
			if (id !== null)
				socket.emit("lorebooks:bindingList", {
					lorebookId: id
				} satisfies Sockets.Lorebooks.BindingList.Params)
		},
		refreshRows(typeId) {
			const id = route.lorebookId
			if (id !== null)
				socket.emit("entries:list", {
					lorebookId: id,
					typeId: typeId as any
				})
		}
	})

	/**
	 * The cast on this line, as Everything lists them (note 12): each
	 * member as they read at the moment, named by the card they read as.
	 * The face is the joined card's while the member still reads as it.
	 */
	let castItems = $derived(
		(resolveCast(rowsReadingOnLine(castRows, line)) as any[]).map((r) =>
			castPoolItem(
				r,
				r.characterId != null
					? cardNames.get(r.characterId)
					: undefined,
				// Their face when retold (it belongs to the member, whichever
				// card they read as), else the joined card's avatar.
				memberFaceSrc(r, { full: false }) ??
					(r.character && r.character.id === r.characterId
						? avatarSrc(r.character)
						: undefined)
			)
		)
	)

	/** The links the line being read draws, for Book settings' readout. */
	let lineRelationshipCount = $derived(
		edgesOnLine(
			relationships.all,
			line,
			Object.values(bookRows).flat() as any[]
		).length
	)

	/** Every line the book has, by name, for Book settings (#90, #133). */
	let lineNames = $derived(["main", ...branches.map((b) => b.name)])

	/** What a cast endpoint is called, so an edge can name who it names. */
	let castNames = $derived(
		new Map(relationships.nodes.map((node) => [node.id, node.name]))
	)
	/**
	 * ⚠ Read from the store rather than only in the graph lens: an edge is
	 * what the Refs board calls a direct reference, and the editor must not
	 * have to have the canvas open to know a road exists — nor miss one drawn
	 * there a moment ago.
	 *
	 * The links the line being read draws (`edgesOnLine`, the canvas's own
	 * filter): a sibling line's link is no reference here (places plan B5).
	 */
	let bookLinks = $derived<RefLink[]>(
		refLinksFrom(
			edgesOnLine(
				relationships.all,
				line,
				(bookRows[HISTORY_TYPE_ID] ?? []) as any[]
			),
			castNames
		)
	)

	/** Every entry the book holds, whatever kind, as the line reads them. */
	let lineEntries = $derived(
		Object.values(resolvedRows).flat() as TimeEntryRow[]
	)
	/**
	 * The session reading this book, for the header's reading line.
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
					branchId: openSessionCtx.lorebookBranchId ?? null,
					clock: openSessionCtx.storyClock ?? null
				}
			: null
	)

	/**
	 * 🚧 A session that reads this book but is not the open one (DC walk 6: a
	 * book made from a session said "Not read by a session"): the asker's own
	 * readers off the list row (`readBy`), newest first. Named only — where
	 * it stands is the open session's to say.
	 */
	let closedReaders = $derived(
		railSession ? [] : ((book as { readBy?: { id: number; name: string | null }[] } | undefined)?.readBy ?? [])
	)

	/**
	 * Stand where the session stands: its line, at its story clock (or now,
	 * when it follows the line's present — owner ruling 3).
	 *
	 * Both at once and in ONE guarded transition, because "what the model
	 * sees" is the pair — a reader on the right line at the wrong date is
	 * still not looking at what was sent. Two `navigate` calls raced and left
	 * the reader at the old moment (#81).
	 */
	function matchSession() {
		if (!railSession) return
		void loreRoute.navigateTo(
			matchSessionRoute(route, {
				branchId: railSession.branchId,
				clock: railSession.clock
			})
		)
	}

	/**
	 * Whether the reader is somewhere the session reading this book is not:
	 * another line, or another moment than its story clock (now when it
	 * follows the line's present — owner ruling 3, 2026-09-28). The Moment
	 * bar is the author's tool, not the session's, so this is when the
	 * reading line offers **Read what it reads**.
	 */
	let readingParted = $derived(
		!!railSession &&
			((route.moment ?? undefined) !==
				sessionMomentKey(railSession.clock) ||
				(route.branch ?? null) !== railSession.branchId)
	)

	/**
	 * Where the session reads this book, said only when it is not the plain
	 * case: " on marrow-stays", " as of Year 3, Mo. 2", or nothing on main
	 * at now. Retrieval reads the session's line at its clock, never the
	 * moment the author has dragged to, so an author standing at Y2 is told
	 * where the model stands.
	 */
	let readingWhere = $derived.by(() => {
		if (!railSession) return ""
		let where = ""
		if (railSession.branchId !== null)
			where += ` on ${
				branches.find((b) => b.id === railSession.branchId)?.name ??
				"a deleted line"
			}`
		if (railSession.clock)
			where += ` as of ${formatDate(railSession.clock)}`
		return where
	})

	/** What the newest run read in, said: "12 entries reached the last turn". */
	let readingReached = $derived.by(() => {
		const n = readInKeys?.size ?? 0
		if (n === 0) return "nothing reached the last turn"
		return `${n} ${n === 1 ? "entry" : "entries"} reached the last turn`
	})

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
	/**
	 * The moment as a DATE, or null at now. Ordering is `compareDates` on
	 * this — never the packed `momentValue`, which collides once a month or
	 * a day passes 100 (a book numbering days of the year).
	 */
	let momentDate = $derived(parseMoment(moment))

	/**
	 * The pool and the cast at the moment being read.
	 *
	 * Only history carries a date, so only history can be later than one; a
	 * row of any other kind is in the story at every moment and is counted in
	 * the total rather than against it. Null at now, where the question does
	 * not arise.
	 */
	let poolAsOf = $derived.by(() => {
		if (momentDate == null) return null
		const dated = (resolvedRows[HISTORY_TYPE_ID] ?? []).map((row: any) => ({
			key: `entry#${row.id}`,
			date: rowDate(row)
		}))
		return {
			total: bookPool.length,
			notYet: notYetKeys(dated, momentDate).length
		}
	})

	let castAsOfCounts = $derived.by(() => {
		if (momentDate == null) return null
		const at = momentDate
		const arrivals = castArrivalDates(
			storyItems({
				entries: lineEntries,
				scenes: lineScenes as TimeSceneRow[]
			})
		)
		const notYet = [...arrivals.values()].filter(
			(date) => compareDates(date, at) > 0
		).length
		return { notYet, total: counts?.[CAST_KIND] ?? arrivals.size }
	})

	/**
	 * Each saved scope's figure over the whole book, which is the list
	 * choosing it opens (`savedScopeRoute`), so badge = list length (note 6).
	 */
	let savedCounts = $derived(savedScopeCounts(bookPool))

	/**
	 * Turns a saved scope on or off. Choosing one opens Everything, in a lens
	 * that lists the pool, with Book settings left (`savedScopeRoute`).
	 */
	function chooseSaved(next: SavedScopeId | null) {
		if (next) leaveQueue()
		if (next) {
			const target = savedScopeRoute(route)
			if (target !== route) void loreRoute.navigateTo(target)
		}
		saved = next
	}

	// ── Loose ends (note 5, built 2026-10-02) ────────────────────────────
	// One queue of the book's chores, replacing the saved scopes "Needs
	// keywords" and "Loose ends". Rows leave only when fixed — no per-row
	// dismissal (owner, 2026-10-02).

	/** The cast's pending suggestions and possible duplicates, for the queue. */
	let castSuggestions = $state<Sockets.BindingSuggestions.Suggestion[]>([])
	let castDuplicates = $state<
		Sockets.NarrativeGraph.DuplicateCandidates.Response["candidates"]
	>([])

	function handleCastSuggestions(
		msg: Sockets.BindingSuggestions.List.Response
	) {
		if (msg.lorebookId !== route.lorebookId) return
		castSuggestions = msg.suggestions
	}

	function handleCastDuplicates(
		msg: Sockets.NarrativeGraph.DuplicateCandidates.Response
	) {
		if (msg.lorebookId !== route.lorebookId) return
		castDuplicates = msg.candidates
	}

	/** Every pool key a link on the line being read touches. */
	let linkedKeys = $derived.by(() => {
		const keys = new Set<string>()
		for (const edge of edgesOnLine(
			relationships.all,
			line,
			(bookRows[HISTORY_TYPE_ID] ?? []) as any[]
		)) {
			keys.add(endpointKey(edge.from as any))
			keys.add(endpointKey(edge.to as any))
		}
		return keys
	})

	/** Every loose end in the book now — what the rail's figure counts. */
	let liveLooseEnds = $derived(
		looseEnds({
			items: bookPool,
			members: castItems.map((m) => ({
				id: m.id,
				name: m.name,
				castKind: m.castKind,
				updatedAt: m.updatedAt
			})),
			linkedKeys,
			membersWithLore: membersWithLore(
				(resolvedRows[CHARACTER_LORE_TYPE_ID] ?? []) as any[]
			),
			suggestions: castSuggestions
				.filter((s) => s.status === "pending")
				.map((s) => ({ id: s.id, name: s.surface || s.name })),
			duplicates: castDuplicates
		})
	)

	/**
	 * The queue as it was when it opened, or null while it is closed.
	 * Snapshotted on open and dropped on leave, so nothing reshuffles under
	 * the reader; a fixed row leaves (`liveQueue`).
	 */
	let queueSnapshot = $state<LooseEnd[] | null>(null)
	/** The row the reader is on. */
	let queueCurrent = $state<string | null>(null)
	let queueRows = $derived(
		queueSnapshot ? liveQueue(queueSnapshot, liveLooseEnds) : []
	)
	/** Ask the entry editor to focus a field, or the cast to open Suggestions. */
	let focusRequest = $state<{
		entryId: number
		field: ChoreField
		n: number
	} | null>(null)
	let suggestionsRequest = $state<{
		tab: "suggestions" | "duplicates"
		n: number
	} | null>(null)
	let requestCount = 0

	/** Opens the queue at Everything, on the lens its rows are drawn on. */
	function openQueue() {
		saved = null
		queueSnapshot = [...liveLooseEnds]
		queueCurrent = null
		let target = reduce(route, { type: "openScope", scope: "all" })
		if ((route.lens ?? DEFAULT_LENS) !== QUEUE_LENS)
			target = reduce(target, { type: "setLens", lens: QUEUE_LENS })
		void loreRoute.navigateTo(target)
	}

	/** Leaves the queue; the next open takes it afresh. */
	function leaveQueue() {
		queueSnapshot = null
		queueCurrent = null
	}

	/** Opens what one row is about, with its fixing field asked for. */
	async function openLooseEnd(row: LooseEnd) {
		const was = queueCurrent
		queueCurrent = row.id
		const target = row.target
		if (target.kind === "entry") {
			let next = reduce(route, {
				type: "openEntry",
				entryId: target.entryId,
				scope: "all"
			})
			if ((next.lens ?? DEFAULT_LENS) !== QUEUE_LENS)
				next = reduce(next, { type: "setLens", lens: QUEUE_LENS })
			const field = choreOf(row.chore).field
			if (field)
				focusRequest = {
					entryId: target.entryId,
					field,
					n: ++requestCount
				}
			await loreRoute.navigateTo(next)
			// Kept by the unsaved-changes guard: the row was not opened.
			if (loreRoute.route.entryId !== target.entryId) {
				queueCurrent = was
				focusRequest = null
			}
		} else if (target.kind === "member") {
			await loreRoute.navigate({
				type: "openCastMember",
				scope: "cast",
				castId: target.castId
			})
		} else {
			await loreRoute.navigate({ type: "openScope", scope: "cast" })
			suggestionsRequest = { tab: target.tab, n: ++requestCount }
		}
	}

	/** "Next loose end": the row after the current one, wrapping. */
	function nextInQueue() {
		if (!queueSnapshot) return
		const next = nextLooseEnd(queueSnapshot, liveLooseEnds, queueCurrent)
		if (!next) {
			toaster.success({ title: "No loose ends left in this book" })
			return
		}
		void openLooseEnd(next)
	}

	/** Save in the entry editor, while the queue is open: on to the next. */
	function savedInQueue(entryId: number) {
		const current = queueSnapshot?.find((r) => r.id === queueCurrent)
		if (
			current?.target.kind === "entry" &&
			current.target.entryId === entryId
		)
			nextInQueue()
	}

	/** Back to the queue's list from the Cast board. */
	function backToQueue() {
		void loreRoute.navigateTo(
			reduce(route, { type: "openScope", scope: "all" })
		)
	}

	/** What the entry list draws instead of the pool while the queue is open. */
	let queueProps = $derived(
		queueSnapshot
			? {
					rows: queueRows,
					currentId: queueCurrent,
					onOpen: (row: LooseEnd) => void openLooseEnd(row),
					onNext: nextInQueue,
					onLeave: leaveQueue
				}
			: null
	)

	/** The address said out loud, which is what the book chip's hover says. */
	let crumbs = $derived(
		describeRoute(route, {
			book: book?.name,
			scope: scopeTitle(route.scope)
		})
	)

	let scopes = $derived(railScopes(counts))

	/**
	 * The rail's rules group (PLAN-lorebook-kinds §C): named by the book's
	 * rules (**Vis Itineris**), one row per list the book draws. Null when it
	 * draws none — a Freeform book with nothing in its lists looks as it
	 * always has.
	 */
	let rulesGroup = $derived.by(() => {
		const facets = rulesListFacets(rulesLists, counts)
		if (!facets.length) return null
		return { label: rulesName ?? "Rules", facets }
	})

	/** What the book's rules are called (`entries:types`): "Vis Itineris". */
	let rulesName = $state<string | null>(null)
	/**
	 * What the line over the lens names: the scope in force and its figure
	 * ("World lore · 41"; Everything is the book's total), or the saved scope
	 * that stands instead of one ("Pinned · 5").
	 */
	let lensLineScope = $derived.by(() => {
		if (saved)
			return {
				label: SAVED_SCOPES.find((s) => s.id === saved)?.label ?? "",
				count: savedCounts[saved] as number | undefined
			}
		const facet = [...scopes, ...(rulesGroup?.facets ?? [])].find(
			(f) => f.id === route.scope
		)
		return {
			label: facet?.label ?? scopeTitle(route.scope),
			count: facet?.count
		}
	})

	/** The one chip under the compact find row; null draws none. */
	let scopeChip = $derived(scopeChipLabel(route.scope, saved))

	/**
	 * A book with nothing in it at all, which is the one book day one is for.
	 *
	 * The question is the rail's arithmetic rather than this screen's, so it is
	 * asked of the same figures the chips are drawn from.
	 */
	let bookEmpty = $derived(bookIsEmpty(counts))

	/**
	 * The reader chose somewhere day one does not stand in front of (#82):
	 * the Cast board, where a member can be added by hand, or a lens that
	 * draws something other than the pool (its descriptor's
	 * `bypassesDayOne`: Time, Lives, Graph, Places). Each of those draws its
	 * own empty state. The default landing — Everything, List — still meets
	 * day one.
	 */
	let explicitlyElsewhere = $derived(
		route.scope === "cast" || activeLens.bypassesDayOne
	)

	/**
	 * The facets in force. A saved scope answers the same question the count
	 * beside it answered, so it wins over the chips it overlaps while it is on.
	 */
	let filters = $derived<PoolFilters>(
		saved
			? { ...poolFacets, search, ...savedScopeFilters(saved) }
			: { ...poolFacets, search }
	)

	/** The book the open session reads, when it is not this one. */
	let otherReadBook = $derived.by(() => {
		const id = openSessionCtx.lorebookId
		if (id === null || id === book?.id) return null
		return lorebookList.find((l) => l.id === id)?.name ?? "another lorebook"
	})

	/**
	 * 🚧 The book lock (PLAN-lorebook-kinds §A): the open session's story is
	 * underway, so it keeps the book it reads (or its own notes) — the verbs
	 * stay in place, disabled, saying so.
	 */
	let readingFixed = $derived(!!openSessionCtx.lorebookFixed)
	/** What reading this book into the open session, or stopping, does. */
	let readingVerbTitle = $derived(
		readingInto
			? `Stop reading this book into ${readingInto}`
			: otherReadBook
				? `This session reads ${otherReadBook}; reading this book replaces it`
				: "Read this book into the open session"
	)

	/**
	 * 🚧 A starter lorebook's `⋯`: settings, a lorebook made from it, and its
	 * delete. Never a reading verb: sessions start from a kit, never read one.
	 */
	let kitMenu = $derived<RowMenuEntries>([
		{
			label: "Book settings",
			icon: Icons.SlidersHorizontal,
			title: "Name, cover, rules, calendar and clock",
			onSelect: openSettings
		},
		{
			label: "Make a lorebook from it",
			icon: Icons.BookPlus,
			title: "Start a lorebook of your own from this starter lorebook",
			onSelect: makeBookFromOpenKit
		},
		{ separator: true },
		{
			label: "Delete starter lorebook",
			icon: Icons.Trash2,
			destructive: true,
			onSelect: () => {
				deletingId = book?.id ?? null
			}
		}
	])

	function makeBookFromOpenKit() {
		if (book) actions?.makeBookFromKit(book.id, book.name)
	}

	/**
	 * Everything about the book that is not its reading verb: the nav
	 * header's `⋯` (STYLE-GUIDE §6.3). The verb is the header's primary at
	 * desk; compact, where the name needs the row, it heads this menu.
	 */
	/** 🚧 pr-6 (R-p): a session-notes book's menu is its Share verbs and its settings. */
	let sessionNotesMenu = $derived<RowMenuEntries>([
		...shareItemsFor(
			sessionNotes.find((n) => n.id === book?.id) ?? {
				sessionId: null,
				attached: null
			}
		),
		{
			label: "Book settings",
			icon: Icons.SlidersHorizontal,
			title: "Name, cover, rules, calendar and clock",
			onSelect: openSettings
		}
	])

	let shareAsking = $state<{
		asking: { question: string; description?: string; confirmLabel: string }
		go: () => void
	} | null>(null)
	function ask(sentence: string, label: string, go: () => void) {
		shareAsking = { asking: askingOf(sentence, label), go }
	}
	/** 🚧 pr-6 (R-p): a session-notes book's Share — one verb with no attached book, the drop-down's two with one. */
	function shareItemsFor(row: {
		sessionId: number | null
		attached: { id: number; name: string } | null
	}): RowMenuEntries {
		if (row.sessionId == null) return []
		const sessionId = row.sessionId
		if (row.attached === null)
			return [
				{
					label: SHARE_LABELS.asLorebook,
					icon: Icons.BookPlus,
					onSelect: () =>
						ask(SHARE_CONFIRMS.asLorebook, SHARE_LABELS.asLorebook, () =>
							socket.emit("sessions:shareAsLorebook", { sessionId })
						)
				}
			]
		const name = row.attached.name
		return [
			{
				label: SHARE_LABELS.toAttached(name),
				icon: Icons.BookUp,
				onSelect: () =>
					ask(SHARE_CONFIRMS.toAttached(name), SHARE_LABELS.toAttached(name), () =>
						socket.emit("sessions:applyOverlay", { sessionId, entryIds: null })
					)
			},
			{
				label: SHARE_LABELS.cloneWithChanges,
				icon: Icons.CopyPlus,
				onSelect: () =>
					ask(
						SHARE_CONFIRMS.cloneWithChanges(name),
						SHARE_LABELS.cloneWithChanges,
						() => socket.emit("sessions:cloneWithChanges", { sessionId })
					)
			}
		]
	}

	let bookMenu = $derived<RowMenuEntries>(
		readOnly
			? [
					// Shared with the reader: read and copy only (ruled Q3/Q4).
					{
						label: "Duplicate",
						icon: Icons.Copy,
						title: "Make your own copy of this book, entries, cast and all",
						onSelect: () => {
							duplicating = book ? { id: book.id, name: book.name } : null
						}
					}
				]
			: bookIsSessionNotes
				? sessionNotesMenu
				: bookIsKit
					? kitMenu
					: [
		mode === "compact" &&
			hasOpenSession &&
			!readingFixed && {
				label: readingInto ? STOP_READING : READ_INTO_SESSION,
				icon: readingInto ? Icons.BookX : Icons.BookOpen,
				title: readingVerbTitle,
				onSelect: changeReading
			},
		{
			label: "Book settings",
			icon: Icons.SlidersHorizontal,
			title: "Name, cover, rules, calendar and clock",
			onSelect: openSettings
		},
		{
			label: "Duplicate",
			icon: Icons.Copy,
			title: "Copy this book, entries, cast and all",
			onSelect: () => {
				duplicating = book ? { id: book.id, name: book.name } : null
			}
		},
		isAdmin && {
			label: "Save as starter lorebook",
			icon: Icons.Package,
			title: "Copy this book as a starter lorebook everyone on the pub can start from",
			onSelect: () => {
				if (book) actions?.saveAsStarterKit(book.id)
			}
		},
		canShare && {
			label: "Share…",
			icon: Icons.Share2,
			title: "Let people on this pub read this book and make their own copy",
			onSelect: () => (sharing = true)
		},
		{
			label: "Export… (paused)",
			icon: Icons.Download,
			disabled: true,
			title: LOREBOOK_EXPORT_PAUSED
		},
		!hasOpenSession && {
			label: READ_INTO_SESSION,
			icon: Icons.BookOpen,
			disabled: true,
			title: "Open a session you own to read this book into it"
		},
		{ separator: true },
		{
			label: "Delete this lorebook",
			icon: Icons.Trash2,
			destructive: true,
			onSelect: () => {
				deletingId = book?.id ?? null
			}
		}
			]
	)

	/**
	 * The way back to every book, where New and Import live (note 10). At
	 * both widths: the book level replaces the list, so the list is never
	 * on screen beside it (STYLE-GUIDE §6.3).
	 */
	function backToList() {
		void loreRoute.navigate({ type: "openBook", lorebookId: null })
	}

	let filteredSessionNotes = $derived.by(() => {
		if (!bookSearch) return sessionNotes
		const needle = bookSearch.toLowerCase()
		return sessionNotes.filter(
			(l) =>
				l.name?.toLowerCase().includes(needle) ||
				(l.description && l.description.toLowerCase().includes(needle))
		)
	})

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

	/** The reader's own books, then the ones shared with them. */
	let shelf = $derived(splitSharedRows(filteredLorebooks))
	/** 🚧 The asker's own starter lorebooks, in a group of their own. */
	let ownBooks = $derived(shelf.own.filter((l) => !isStarterKit(l)))
	let ownKits = $derived(shelf.own.filter((l) => isStarterKit(l)))

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
		void loreRoute.navigate({ type: "openBook", lorebookId, scope })
	}

	/**
	 * Opens a scope, which a saved scope stands instead of, so choosing one
	 * leaves the saved scope. Book settings is left by the route (`reduce`).
	 */
	function openScope(scope: LoreScope) {
		saved = null
		leaveQueue()
		// Under a lens that draws its own set whatever the scope (Places,
		// Lives), the scope opens in the default lens (`scopeRoute`).
		void loreRoute.navigateTo(scopeRoute(route, scope))
	}

	function openLens(next: LoreLens) {
		leaveQueue()
		void loreRoute.navigate({ type: "setLens", lens: next })
	}

	/**
	 * Opens an entry; the route leaves Book settings with it (#86), through
	 * the settings page's unsaved-changes guard.
	 */
	function openEntry(entryId: number) {
		void loreRoute.navigate({ type: "openEntry", entryId })
	}

	/** Opens a cast member on the Cast board, leaving Book settings (#86). */
	function openMember(castId: number) {
		void loreRoute.navigate({
			type: "openCastMember",
			scope: "cast",
			castId
		})
	}

	/**
	 * Reads the book as of a date — the moment bar's one path (plan B7: one
	 * path, so the same move never asks in one place and not the other).
	 *
	 * Set rather than navigated: a moment is a way of reading the screen that
	 * is open rather than a screen being left, so there is no draft to ask
	 * about — the same rule the inspector's tabs follow. A draft being typed
	 * keeps the moment it was opened at, and its save files there (the
	 * editors snapshot it: `draftMoment`).
	 */
	function setMoment(next?: string) {
		loreRoute.set(reduce(route, { type: "setMoment", moment: next }))
	}

	function applyFilters(next: PoolFilters) {
		poolFacets = { ...next }
		search = next.search
		saved = null
	}

	/**
	 * The lens bench (`lenses/types.ts`): what every lens is drawn with that
	 * is not the book — one stable object of getters, so a lens reading
	 * `bench.filters` follows the filters and nothing else. The workspace
	 * mounts the lens's descriptor's mount with it (`mountFor`); no lens is
	 * wired here by hand.
	 */
	const bench: LensBench = {
		get route() {
			return route
		},
		get mode() {
			return mode
		},
		get line() {
			return line
		},
		get moment() {
			return amendmentsAt.moment
		},
		get branchName() {
			return route.branch
				? (branches.find((b) => b.id === route.branch)?.name ?? null)
				: null
		},
		get bookPool() {
			return bookPool
		},
		get castItems() {
			return castItems
		},
		get bookLinks() {
			return bookLinks
		},
		get filters() {
			return filters
		},
		get readInKeys() {
			return readInKeys
		},
		get decisions() {
			return decisions
		},
		get runRelationships() {
			return runRelationships
		},
		get timeSession() {
			return timeSession
		},
		get presences() {
			return presences
		},
		get livesMembers() {
			return livesMembers
		},
		get queue() {
			return queueProps
		},
		get focusField() {
			return focusRequest
		},
		get suggestionsRequest() {
			return suggestionsRequest
		},
		get onSaved() {
			return queueSnapshot ? savedInQueue : undefined
		},
		// The functions themselves, not wrappers: a lens re-reads when the
		// resolver is rebuilt (a new moment, line or overlay), as it did
		// when they were props.
		get resolveRows() {
			return resolveRows
		},
		get resolveCast() {
			return resolveCast
		},
		get amendmentsFor() {
			return amendmentsFor
		},
		get castAmendmentsFor() {
			return castAmendmentsFor
		},
		openLens,
		openMember,
		applyFilters,
		leaveQueue
	}

	/**
	 * A lens's shortcut (its descriptor's, `Alt+Shift+1`…), heard while focus
	 * is inside the workspace and not in a field — never app-wide, so a
	 * session beside the book keeps its keys. The same as pressing the lens's
	 * button: through the guard, leaving the queue and Book settings.
	 */
	function onWorkspaceKey(event: KeyboardEvent) {
		if (route.lorebookId === null) return
		if (!workspaceEl?.contains(event.target as Node | null)) return
		const next = lensForKey(event)
		if (!next) return
		event.preventDefault()
		openLens(next)
	}

	/**
	 * Escape over Book settings is Back: Settings is a route, so it pops
	 * first and alone, through the unsaved-changes guard. Heard on the
	 * workspace's own element, so it is claimed before the shell's Escape
	 * (which steps the view's width down) and only while focus is inside the
	 * book. Outside a text box, as the shell's is; a popover or menu is
	 * portaled outside the workspace and answers its own Escape.
	 */
	function onSettingsEscape(event: KeyboardEvent) {
		if (event.key !== "Escape" || event.defaultPrevented) return
		if (!route.settings) return
		const el = event.target as HTMLElement | null
		if (
			el?.isContentEditable ||
			el?.closest?.("input, textarea, select, [contenteditable='true']")
		)
			return
		event.preventDefault()
		void loreRoute.navigate({ type: "back" })
	}
	$effect(() => {
		const el = workspaceEl
		if (!el) return
		el.addEventListener("keydown", onSettingsEscape)
		return () => el.removeEventListener("keydown", onSettingsEscape)
	})

	/**
	 * A book waiting on the reader's word before it replaces the one the open
	 * session reads. A session reads one book at a time, so reading another
	 * stops reading this one — which is worth a question, not a surprise.
	 */
	let replacing = $state<{
		lorebookId: number
		bookName: string
		currentName: string
	} | null>(null)

	function readIntoSession(lorebookId: number) {
		if (openSessionCtx.sessionId === null) return
		attachLorebookToSession(socket, openSessionCtx.sessionId, lorebookId)
	}

	/** Reads a book in, asking first when that stops reading another. */
	function handleAttachToSession(lorebookId: number) {
		if (openSessionCtx.sessionId === null) return
		const current = openSessionCtx.lorebookId
		if (current !== null && current !== lorebookId) {
			replacing = {
				lorebookId,
				bookName:
					lorebookList.find((l) => l.id === lorebookId)?.name ??
					"this lorebook",
				currentName:
					lorebookList.find((l) => l.id === current)?.name ??
					"another lorebook"
			}
			return
		}
		readIntoSession(lorebookId)
	}

	function handleDetachFromSession() {
		if (openSessionCtx.sessionId === null) return
		attachLorebookToSession(socket, openSessionCtx.sessionId, null)
	}

	/** Reads this book into the open session, or stops reading it into one. */
	function changeReading() {
		if (!book || openSessionCtx.sessionId === null || readingFixed) return
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
	 *
	 * ⚠ Keyed on the book and the line as primitives, and the read untracked
	 * (`whenBookOpens`' two halves): `route` is a new object on every
	 * navigation, so reading `route.branch` here — or letting `refreshCounts`
	 * read the route under this effect — re-asked on every click inside a
	 * book (places-graph B5 review).
	 */
	let openBranch = $derived(route.branch ?? null)
	$effect(() => {
		void openBookId
		void openBranch
		untrack(refreshCounts)
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
				if (hit.kind === "entry") openEntry(Number(hit.id))
				else openBook(Number(hit.id))
			}
		})
	)

	function refreshBook() {
		const id = route.lorebookId
		if (id === null) return
		for (const typeId of BOOK_ENTRY_TYPES)
			socket.emit("entries:list", { lorebookId: id, typeId })
		// The book's rules lists: their rows are asked for once the lists
		// themselves land (`handleEntryTypes`).
		refreshRulesLists()
		socket.emit("scenes:listByLorebook", { lorebookId: id })
		relationships.load()
		socket.emit("amendments:list", { lorebookId: id })
		openBookTime.open(id)
		socket.emit("lorebooks:storyTime", { lorebookId: id })
		// ⚠ The cast is REQUESTED on open, for the roster popover. As a
		// cascade of somebody else's write it would not arrive at all until
		// something touched a binding, and the world would read as empty.
		socket.emit("lorebooks:bindingList", {
			lorebookId: id
		} satisfies Sockets.Lorebooks.BindingList.Params)
		// The cast's suggestions and possible duplicates are Loose ends rows.
		socket.emit("bindingSuggestions:list", { lorebookId: id })
		socket.emit("narrativeGraph:duplicateCandidates", { lorebookId: id })
		refreshCounts()
	}

	/** Asks which lists the book's rules declare (`entries:types`). */
	function refreshRulesLists() {
		const id = route.lorebookId
		if (id === null) return
		rulesListsFor = book?.primaryRuleset ?? null
		socket.emit("entries:types", {
			lorebookId: id
		} satisfies Sockets.Entries.Types.Params)
		// The rules' library comes with its lists: both follow the Rules.
		socket.emit("lorebooks:library", {
			lorebookId: id
		} satisfies Sockets.Lorebooks.Library.Params)
	}

	/** The book's rules library, for the ‹Rules› library chip and its rows. */
	function handleLibrary(msg: Sockets.Lorebooks.Library.Response) {
		const id = route.lorebookId
		if (id === null || msg.lorebookId !== id) return
		library = { name: msg.name, source: msg.source, rows: msg.rows }
	}

	/**
	 * The book's rules lists, and then each list's rows — the whole book,
	 * as every core kind's are (the rail and Everything report on all of it).
	 */
	function handleEntryTypes(msg: Sockets.Entries.Types.Response) {
		const id = route.lorebookId
		if (id === null || msg.lorebookId !== id) return
		// Remembered before the rows are asked for, so each row lands on a
		// door and a label (`descriptorForKind`, `kindLabel`).
		rememberRulesLists(msg.types)
		rulesLists = msg.types
		rulesName = msg.rulesName ?? null
		for (const list of msg.types)
			socket.emit("entries:list", {
				lorebookId: id,
				typeId: list.typeId as any
			})
	}

	function handleSessionNotes(msg: Sockets.Lorebooks.SessionNotes.Response) {
		sessionNotes = msg.books ?? []
		sessionNotesLoaded = true
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
		const before = branches
		entryAmendments = msg.entries
		castAmendments = msg.cast
		presences = msg.presences ?? []
		branches = msg.branches
		// Shared with the screens that draw amendments without being handed
		// the branch list (AmendmentList labels each row's line).
		openBookTime.setBranches(msg.lorebookId, msg.branches)
		// A deleted line moves its sessions to the line it left
		// (`amendments:deleteBranch`); the open session's copy follows here,
		// found the way the server found it, rather than holding a dead id
		// until a reload (#136).
		if (openSessionCtx.sessionId !== null && openSessionCtx.lorebookId === msg.lorebookId)
			sessionStore.patchSession(openSessionCtx.sessionId, {
				lorebookBranchId: survivingLineOf(openSessionCtx.lorebookBranchId, before, msg.branches)
			})
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

	/**
	 * A row this book lost, dropped from the rail's copy — patched, like a
	 * create or an update (plan B5). The reply names the book, the row and
	 * its type (`Entries.Delete.Response`), so the rail patches that row
	 * rather than re-reading the whole book. The figures are the server's,
	 * so they are asked for again.
	 */
	function handleEntryDeleted(msg: Sockets.Entries.Delete.Response) {
		if (!msg || msg.lorebookId !== route.lorebookId || !msg.success) return
		bookRows = dropDeletedEntry(bookRows, msg)
		refreshCounts()
	}

	function handleScenesList(msg: Sockets.Scenes.ListByLorebook.Response) {
		if (msg.lorebookId !== undefined && msg.lorebookId !== route.lorebookId)
			return
		sceneRows = msg.sceneList as PoolSource[]
		scenesLoaded = true
	}

	/**
	 * A scene of this book saved — patched into the rows every lens reads
	 * (plan B4). BARE (`scenes:update` is not in `SCOPED_EVENTS`), so another
	 * book's save is dropped by the book it names.
	 */
	function handleSceneUpdated(msg: Sockets.Scenes.Update.Response) {
		const scene = msg?.scene
		if (!scene || scene.lorebookId !== route.lorebookId) return
		sceneRows = patchScene(sceneRows, scene as any)
	}

	/**
	 * The vectorizer writes `embeddingModel` straight to the row, so without
	 * this a row's embedding badge only moves on its next write. Scoped to the
	 * book; the source kind it reports in is a door's `vectorSource`. The
	 * relationship store takes its own (a cast node's badge).
	 */
	function handleVectorized(msg: Sockets.Vectorization.ItemUpdated.Response) {
		relationships.embedded(msg)
		if (msg.lorebookId !== route.lorebookId) return
		const patched = patchEmbedding(bookRows, msg, (typeId) => {
			const door = descriptorForKind(typeId)
			return door ? (door.vectorSource ?? typeId) : undefined
		})
		if (patched) bookRows = patched
	}

	/**
	 * A member deleted, absorbed or put back in THIS book: the cast, the
	 * links and the lore anchored to them move, and the server re-sends only
	 * the lore whose tags it rewrote — so the cast and the relationships are
	 * asked for here, once, for every lens (plan B4: the Cast board and the
	 * graph lens each asked for themselves). A deleted member's private lore
	 * went with them, so character lore is asked for too.
	 */
	function handleCastRemoved(bookId: number | undefined, loreWent = false) {
		const id = route.lorebookId
		if (id === null || bookId !== id) return
		socket.emit("lorebooks:bindingList", {
			lorebookId: id
		} satisfies Sockets.Lorebooks.BindingList.Params)
		relationships.load()
		if (loreWent)
			socket.emit("entries:list", {
				lorebookId: id,
				typeId: CHARACTER_LORE_TYPE_ID
			})
		refreshCounts()
	}

	function handleSceneWritten(
		msg: Sockets.Scenes.Create.Response | Sockets.Scenes.Delete.Response
	) {
		const id = route.lorebookId
		if (id === null) return
		// Both events are bare, so another book's writes arrive here too.
		const bookId = "scene" in msg ? msg.scene?.lorebookId : msg?.lorebookId
		if (bookId !== undefined && bookId !== id) return
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
		const before = castSignature(castRows)
		// Kept, not just counted: every lens reads the cast from here.
		castRows = msg.lorebookBindingList as any[]
		castLoaded = true
		const merged = mergeCastCount(counts, msg.lorebookBindingList)
		// A figure that has not arrived cannot be merged into, and the answer
		// on its way was counted before these rows existed.
		if (merged) counts = merged
		else refreshCounts()
		// ⚠ The graph is read again only when the CAST moved (plan B5): every
		// entry save cascades this list, and re-reading the graph on each one
		// ran `narrativeGraph:list` per save. A member added, renamed,
		// re-carded or re-stated is a change the graph's names follow.
		if (castSignature(castRows) !== before) relationships.load()
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
		const readId = msg.session.lorebookId
		const readName = readId
			? lorebookList.find((l) => l.id === readId)?.name
			: null
		toaster.success({
			title: readId
				? `Reading ${readName ?? "the lorebook"} into this session`
				: "Stopped reading the lorebook into this session"
		})
		// The ack says what the session reads, so the session store follows it
		// here rather than waiting on the session's own reload: the reading
		// line and the run's marks both hang off this one field.
		sessionStore.patchSession(msg.session.id, {
			lorebookId: msg.session.lorebookId ?? null,
			lorebookBranchId: msg.session.lorebookBranchId ?? null
		})
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
		if (isLoading || !sessionNotesLoaded || route.lorebookId === null) return
		if (!knownBooks.some((l) => l.id === route.lorebookId))
			loreRoute.set(emptyRoute())
	})

	// The strip runs under every scope, so its axis is read here once rather
	// than by whichever scope happens to be open.
	//
	// ⚠ On the LINE being read: its history (fork cut included — the same
	// rows the pool draws) and the amendments that apply on it at the head.
	// Another line's dates are not moments this line can stand at.
	$effect(() => {
		timelineCursor.setAxis(
			route.lorebookId,
			momentAxisRows(
				(resolvedRows[HISTORY_TYPE_ID] ?? []) as any[],
				[
					...amendmentsOnLine(entryAmendments, line),
					// A cast overlay dates the story exactly as an entry's does:
					// the year a member changed card is a moment worth standing at.
					...amendmentsOnLine(castAmendments, line)
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
		const key = route.moment ?? null
		const at = momentValue(key)
		const hasAxis = timelineCursor.ticks.length > 0
		untrack(() => {
			const next = hasAxis ? at : null
			// The KEY rides along: the packed value is placement only and two
			// dates can share one; the key is the lossless address.
			if (
				timelineCursor.position !== next ||
				timelineCursor.key !== (hasAxis ? key : null)
			)
				timelineCursor.setPosition(next, hasAxis ? key : null)
		})
	})

	$effect(() => {
		guardedChanges = managerMounted && tabHasUnsavedChanges
	})

	/**
	 * Reload and closing the tab ask too (plan B7): the guard covers every
	 * move inside the workspace, and the browser's own leave is the one exit
	 * it could not see.
	 */
	warnBeforeUnload(() => guardedChanges)

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
	 *
	 * ⚠ Keyed on `openBookId`, never `route.lorebookId`: every navigation is a
	 * new route, and re-running here re-declares nine keys and re-opens the
	 * relationship store on the same book (review round, places-graph B3).
	 */
	$effect(() => {
		const id = openBookId
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
			declareInterest<"entries:types">(
				interestKey("entries:types", id),
				handleEntryTypes
			),
			declareInterest<"lorebooks:library">(
				interestKey("lorebooks:library", id),
				handleLibrary
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
			declareInterest<"bindingSuggestions:list">(
				interestKey("bindingSuggestions:list", id),
				handleCastSuggestions
			),
			declareInterest<"narrativeGraph:duplicateCandidates">(
				interestKey("narrativeGraph:duplicateCandidates", id),
				handleCastDuplicates
			),
			// The embedding badge on every row and node (plan B4: each lens
			// heard it for its own copy).
			declareInterest<"vectorization:itemUpdated">(
				interestKey("vectorization:itemUpdated", id),
				handleVectorized
			),
			// The graph's list and its three relationship writes: the store's
			// read, turned to this book (and off the last one) here.
			relationships.open(id),
			// The book's calendar and clocks: every reply of the family is
			// the whole of it, so one handler takes all four.
			...(
				[
					"lorebooks:storyTime",
					"lorebooks:setCalendar",
					"lorebooks:setClock"
				] as const
			).map((event) =>
				declareInterest<typeof event>(
					interestKey(event, id),
					openBookTime.apply
				)
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	// The whole book, re-read whenever the BOOK changes — never on a
	// navigation inside it (see `whenBookOpens`): the rail reports on every
	// row rather than on the scope that happens to be open.
	whenBookOpens(
		() => openBookId,
		(id) => {
			bookRows = {}
			rulesLists = []
			rulesName = null
			library = null
			// The ‹Rules› library chip is off each time a book opens (owner
			// default, 2026-10-21): the book's own entries come first.
			poolFacets = { ...poolFacets, library: false }
			sceneRows = []
			castRows = []
			castLoaded = false
			scenesLoaded = false
			counts = null
			castSuggestions = []
			castDuplicates = []
			leaveQueue()
			if (id === null) return
			refreshBook()
		}
	)

	/**
	 * A change of the book's Rules (Book settings) changes its lists: asked
	 * again, with the figures, when the stored rules move under an open book.
	 * Keyed on the rules as a primitive, so a navigation inside the book asks
	 * nothing.
	 */
	let openRules = $derived(book?.primaryRuleset ?? null)
	$effect(() => {
		const rules = openRules
		if (openBookId === null || rules === rulesListsFor) return
		untrack(() => {
			refreshRulesLists()
			refreshCounts()
		})
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
	 * scene writes are not in `SCOPED_EVENTS` (each names its book in the
	 * payload, and `handleSceneWritten` drops another book's); and an `:error`
	 * is never gated (plan ruling 2) but still goes through the registry,
	 * which is the only listener path.
	 */
	useInterest<"lorebooks:list">("lorebooks:list", handleLorebooksList)
	useInterest<"lorebooks:sessionNotes">(
		"lorebooks:sessionNotes",
		handleSessionNotes
	)
	useInterest<"lorebooks:list:error">(
		"lorebooks:list:error",
		handleLorebooksListError
	)
	useInterest<"scenes:create">("scenes:create", handleSceneWritten)
	useInterest<"scenes:delete">("scenes:delete", handleSceneWritten)
	/**
	 * Four more BARE writes the shell hears for the lenses' one copy
	 * (plan B4): a scene saved, and a member deleted, absorbed or put back.
	 * None is in `SCOPED_EVENTS`; each handler drops another book's by the
	 * book its reply names.
	 */
	useInterest<"scenes:update">("scenes:update", handleSceneUpdated)
	useInterest<"narrativeGraph:deleteNode">(
		"narrativeGraph:deleteNode",
		(msg) =>
			handleCastRemoved(msg.lorebookId, (msg.deletedLoreCount ?? 0) > 0)
	)
	useInterest<"narrativeGraph:mergeNode">("narrativeGraph:mergeNode", (msg) =>
		handleCastRemoved(msg.survivorNode?.lorebookId)
	)
	useInterest<"narrativeGraph:undoMerge">("narrativeGraph:undoMerge", (msg) =>
		handleCastRemoved(msg.lorebookId)
	)

	onMount(() => {
		socket.emit("lorebooks:list", {})
		socket.emit("lorebooks:sessionNotes", {})
		const detachHash = loreRoute.attachHash()
		// ⚠ Both read, so a lens that has JUST dropped its draft (written
		// to the bound flag synchronously, as `discardDraft` does) is not
		// asked about again by the transition on its very next line — the
		// mirror above runs only after the effects flush (plan B7).
		const unregister = loreRoute.registerUnsavedChanges(
			() => guardedChanges && tabHasUnsavedChanges
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

{#snippet readingVerb()}
	<!-- The book's one verb toward the open session, labelled (STYLE-GUIDE
	     §6.3): offered only for a session the reader owns. -->
	{#if hasOpenSession && !readingFixed && !bookIsSessionNotes}
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface shrink-0 gap-1"
			title={readingVerbTitle}
			data-lore-book-reading
			onclick={changeReading}
		>
			{#if readingInto}
				<Icons.BookX size={14} aria-hidden="true" />
				<span>{STOP_READING}</span>
			{:else}
				<Icons.BookOpen size={14} aria-hidden="true" />
				<span>{READ_INTO_SESSION}</span>
			{/if}
		</button>
	{/if}
{/snippet}

{#snippet readingSubtitle()}
	<!-- The reading line: which session reads this book, where it stands
	     when that is not main at now, and what reached its last turn. When
	     the reader stands somewhere else, one link puts them where the
	     session is. -->
	<p class="text-surface-600-400 min-w-0 text-xs" data-lore-reading>
		{#if railSession}
			Read by <a
				href="/sessions/{railSession.id}"
				class="text-primary-ink font-medium underline-offset-2 hover:underline"
				title="Open {railSession.name}"
			>
				{railSession.name}
			</a>
			{readingWhere} · {readingReached}{#if readingParted}
				· <button
					type="button"
					class="text-primary-ink font-medium underline-offset-2 hover:underline"
					title="Go to the line and moment the session reads"
					data-lore-match-session
					onclick={matchSession}
				>
					Read what it reads
				</button>{/if}
		{:else}
			<BookReadBy readers={closedReaders} />
		{/if}
	</p>
{/snippet}

{#snippet bookHeader()}
	<!-- One nav header at both widths (STYLE-GUIDE §6.3): the book's name is
	     the title, the reading line its subtitle, and the back always shows
	     — the book list is off screen at desk too. -->
	<PanelNavHeader
		title={book?.name ?? "Lorebook"}
		onBack={backToList}
		backLabel="Lorebooks"
		primaryAction={mode === "desk" && !readOnly && !bookIsKit && !bookIsSessionNotes
			? readingVerb
			: undefined}
		menuItems={bookMenu}
		actionsLabel={book?.name ?? "this lorebook"}
		subtitle={readOnly
			? sharedSubtitle
			: bookIsKit
				? kitSubtitle
				: readingSubtitle}
		leading={lorebookCoverSrc(book) ? bookCover : undefined}
	/>
	{#if canShare}
		<SharedWithLine people={sharedWith} class="-mt-2" />
	{/if}
{/snippet}

{#snippet bookCover()}
	<!-- The cover image, square (STYLE-GUIDE §6.4); only when there is one —
	     a glyph here would only repeat the rail. -->
	<Avatar src={lorebookCoverSrc(book)} size="sm" shape="square" decorative />
{/snippet}

{#snippet kitSubtitle()}
	<!-- 🚧 A starter lorebook: the badge, and what people do with it. -->
	<p
		class="text-surface-600-400 flex min-w-0 items-center gap-1.5 text-xs"
		data-lore-kit
	>
		<span
			class="badge preset-tonal-surface shrink-0 px-1.5 py-0 text-meta"
			data-starter-kit-badge
		>
			Starter lorebook
		</span>
		<span class="min-w-0 truncate">
			Everyone on the pub can start a lorebook or a session from it.
		</span>
	</p>
{/snippet}

{#snippet sharedSubtitle()}
	<!-- A book shared with the reader: whose it is, and that it only reads.
	     It is never read into the reader's session (ruled Q3). -->
	<p class="text-surface-600-400 min-w-0 text-xs" data-lore-shared>
		{book?.ownerName ? `Shared by ${book.ownerName}` : "Shared with you"} · read
		only
	</p>
{/snippet}

{#snippet roster()}
	<!-- Who is in the world at the moment being read: a cast fact, so it
	     stands beside the Cast scope's name. -->
	<RosterPopover
		{branches}
		branchId={route.branch ?? null}
		moment={route.moment}
		{inhabitants}
		onOpenMember={openMember}
		placement="bottom-start"
	/>
{/snippet}

{#snippet lensLine()}
	<!-- The line over every lens: WHAT on the left (the scope and its
	     figure, and on Cast who is in the world now), HOW on the right.
	     Book settings sets the lenses aside, so the line goes with them. -->
	{#if !route.settings}
		<div
			class="flex min-w-0 shrink-0 items-center gap-2"
			data-lore-lens-line
		>
			<p class="min-w-0 truncate text-sm" data-lore-lens-line-scope>
				<span class="font-semibold">{lensLineScope.label}</span>
				{#if lensLineScope.count !== undefined}
					<span class="text-surface-600-400">
						· {lensLineScope.count}
					</span>
				{/if}
			</p>
			{#if route.scope === "cast" && !saved}
				{@render roster()}
			{/if}
			<span class="flex-1"></span>
			<LensTrack value={lens} onselect={openLens} />
		</div>
	{/if}
{/snippet}

{#snippet findRow()}
	<!-- Compact's find row (STYLE-GUIDE §6.3): the filter box, the scope
	     popout, the lens popout; the scope in force as one chip under it,
	     whose × returns to Everything. -->
	{#if !route.settings}
		<div class="flex shrink-0 flex-col gap-2" data-lore-find-row>
			<div class="flex min-w-0 items-center gap-2">
				<div class="min-w-0 flex-1">
					<PanelFilterInput
						bind:value={search}
						data-lore-search
						placeholder="Search this book"
					/>
				</div>
				<ScopePopout
					{scopes}
					{rulesGroup}
					scope={route.scope}
					{savedCounts}
					{saved}
					onScope={openScope}
					onSaved={chooseSaved}
					looseEndsCount={readOnly ? 0 : liveLooseEnds.length}
					onOpenLooseEnds={openQueue}
					onOpenSettings={readOnly ? undefined : openSettings}
				/>
				<LensTrack compact value={lens} onselect={openLens} />
			</div>
			{#if scopeChip}
				<div class="flex min-w-0 items-center gap-2">
					<Badge size="md" class="text-surface-700-300 flex min-w-0 items-center gap-1" data-lore-scope-chip>
						<span class="min-w-0 truncate">{scopeChip}</span>
						<button
							type="button"
							class="hover:text-foreground shrink-0"
							onclick={() => {
								saved = null
								openScope("all")
							}}
							title="Show everything"
							aria-label="Clear {scopeChip}, show everything"
						>
							<Icons.X size={12} aria-hidden="true" />
						</button>
					</Badge>
					{#if route.scope === "cast" && !saved}
						{@render roster()}
					{/if}
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet momentBar(compact: boolean)}
	<!-- WHEN, in one place (design A.1): the line, the moment in words, the
	     axis, and the one Return to now. Compact folds it to one line. -->
	<MomentBar
		{moment}
		present={storyPresent}
		onSetPresent={readOnly ? undefined : setStoryClock}
		castNotYet={castAsOfCounts}
		asOfCount={poolAsOf}
		onMoment={setMoment}
		onOpenTimeline={lens === "time" ? undefined : () => openLens("time")}
		lorebookId={book?.id}
		{branches}
		branchId={route.branch ?? null}
		comparing={!!route.compare}
		onBranch={(next) =>
			loreRoute.navigate({ type: "setBranch", branch: next })}
		onCompare={() =>
			loreRoute.navigate({ type: "setCompare", compare: true })}
		{compact}
	/>
{/snippet}

{#snippet queueBar()}
	<!-- The queue stays open while one of its rows has taken the reader to
	     the Cast board: the way on, and the way back to its list. -->
	<div
		class="panel-inset mb-2 flex flex-wrap items-center gap-2 px-3 py-2"
		data-loose-ends-bar
	>
		<span class="text-sm font-semibold">Loose ends</span>
		<span class="text-surface-600-400 text-xs">
			{queueRows.length} left
		</span>
		<span class="flex-1"></span>
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface"
			onclick={backToQueue}
		>
			Back to the list
		</button>
		<button
			type="button"
			class="btn btn-sm preset-tonal-primary gap-1"
			disabled={queueRows.length === 0}
			onclick={nextInQueue}
		>
			<span>Next loose end</span>
			<Icons.ArrowRight size={14} aria-hidden="true" />
		</button>
	</div>
{/snippet}

{#snippet workspace()}
	{#if queueSnapshot && route.scope === "cast"}
		{@render queueBar()}
	{/if}
	{#if !book}
		<LoadingState message="Opening the lorebook…" />
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
	{:else if route.settings && readOnly}
		<!-- A shared book has no settings to change. -->
		<EmptyState
			icon={Icons.Lock}
			message="This book is shared with you to read. Duplicate it to change its settings."
		/>
	{:else if route.settings}
		{#key book.id}
			<BookSettings
				lorebookId={book.id}
				bookName={book.name}
				branchId={route.branch ?? null}
				branchName={route.branch != null
					? (branches.find((b) => b.id === route.branch)?.name ??
						null)
					: null}
				branches={lineNames}
				present={storyPresent}
				onSetClock={setStoryClock}
				{counts}
				rowsByType={resolvedRows}
				scenes={lineScenes}
				relationships={lineRelationshipCount}
				{readingInto}
				readBy={book.readBy ?? []}
				primaryRuleset={book.primaryRuleset ?? null}
				loreWriteMode={book.loreWriteMode ?? null}
				canChangeReading={hasOpenSession && !readingFixed}
				isStarterKit={bookIsKit}
				onSaveAsStarterKit={isAdmin && !bookIsKit
					? () => actions?.saveAsStarterKit(book.id)
					: undefined}
				onMakeBookFromKit={bookIsKit ? makeBookFromOpenKit : undefined}
				bind:hasUnsavedChanges={tabHasUnsavedChanges}
				onClose={() => loreRoute.navigate({ type: "closeSettings" })}
				onChangeReading={changeReading}
				onImport={() => (importing = true)}
				onDuplicate={() =>
					(duplicating = { id: book.id, name: book.name })}
				onDelete={() => (deletingId = book.id)}
			/>
		{/key}
	{:else if bookEmpty && !explicitlyElsewhere && readOnly}
		<EmptyState icon={Icons.Book} message="This book is empty." />
	{:else if bookEmpty && !explicitlyElsewhere}
		{#key book.id}
			<DayOne lorebookId={book.id} onImport={() => (importing = true)} />
		{/key}
	{:else}
		<!-- The lens, from its descriptor (`lenses/registry.ts`): its mount
		     draws it with the bench. Lenses that share a mount (List, Cards
		     and Tree; Graph and Places) keep the screen when switched
		     between; another lens, or another book, mounts afresh. -->
		{@const LensMount = mountFor(activeLens)}
		{#key book.id}
			<LensMount
				lens={activeLens}
				lorebookId={book.id}
				{bench}
				bind:hasUnsavedChanges={tabHasUnsavedChanges}
			/>
		{/key}
	{/if}
{/snippet}

<svelte:window onkeydown={onWorkspaceKey} />

<!-- A view's root (STYLE-GUIDE §5.2): measured by `vm` — a ResizeObserver,
     so the layout follows the container it is given rather than the
     viewport — and no padding; the panes own the 16px. -->
<div
	class="flex h-full min-h-0 flex-col"
	use:vm.observe
	bind:this={workspaceEl}
	data-lore-layout={mode}
>
	{#if route.lorebookId === null}
		<!-- The list of books is a list column like every other view's, and
		     it fills the view: nothing opens beside it (a book replaces it).
		     Centred at a list's own 560px, like every list with nothing open
		     (L7, 2026-10-24). -->
		<PanelSplit mode={vm.mode} hasDetail={false} listFills fillWidth="list">
			{#snippet toolbar()}
				<!-- The view toolbar (STYLE-GUIDE §6.3): New is the primary,
				     Import a secondary icon button, the filter box on its own
				     row. -->
				<ViewToolbar label="Lorebooks">
					{#snippet primary()}
						<button
							type="button"
							class="btn btn-sm preset-filled-primary-500 shrink-0"
							onclick={() => (creating = true)}
							title="Create new lorebook"
						>
							<Icons.Plus size={16} aria-hidden="true" />
							New
						</button>
					{/snippet}
					{#snippet actions()}
						<button
							type="button"
							class={toolbarButtonClass()}
							title="Import a lorebook"
							aria-label="Import a lorebook"
							onclick={() => (importing = true)}
						>
							<Icons.Upload size={16} aria-hidden="true" />
						</button>
					{/snippet}
					{#snippet filter()}
						<PanelFilterInput
							bind:value={bookSearch}
							placeholder="lorebooks"
							count={lorebookList.length}
							aria-label="Search lorebooks"
						/>
					{/snippet}
				</ViewToolbar>
			{/snippet}
			{#snippet list()}
				{#if isLoading}
					<LoadingState message="Loading lorebooks…" />
				{:else if filteredLorebooks.length === 0 && filteredSessionNotes.length === 0}
					<EmptyState
						icon={Icons.Book}
						message={bookSearch
							? `No lorebooks found matching "${bookSearch}".`
							: "No lorebooks yet. A lorebook holds the world, the cast and the history a session can read from. Create one to get started."}
						ctaLabel={bookSearch ? undefined : "New lorebook"}
						onCta={bookSearch ? undefined : () => (creating = true)}
					/>
				{:else}
					{#if ownBooks.length}
					<div
						class="flex flex-col gap-2"
						role="list"
						aria-label="Lorebooks"
					>
						{#each ownBooks as l (l.id)}
							<LorebookListItem
								lorebook={l}
								onclick={(lorebook) => openBook(lorebook.id)}
								onOpenSettings={openBookSettings}
								onDuplicate={(id, name) => (duplicating = { id, name })}
								onDelete={(id) => (deletingId = id)}
								bindingsCount={l.lorebookBindings?.length || 0}
								entryCounts={l.entryCounts}
								hasOpenSession={hasOpenSession && !readingFixed}
								{openSessionHasLorebook}
								isOpenSessionLorebook={openSessionCtx.lorebookId ===
									l.id}
								onAttachToSession={handleAttachToSession}
								onDetachFromSession={handleDetachFromSession}
							/>
						{/each}
					</div>
					{/if}
					{#if ownKits.length}
						<!-- 🚧 An admin's own starter lorebooks (PLAN-lorebook-kinds
						     §B), under their books: edited here, never read
						     into a session. -->
						<ListGroupLabel
							label="Your starter lorebooks"
							id="loreYourStarterKits"
						/>
						<div
							class="flex flex-col gap-2"
							role="list"
							aria-labelledby="loreYourStarterKits"
						>
							{#each ownKits as l (l.id)}
								<LorebookListItem
									lorebook={l}
									onclick={(lorebook) => openBook(lorebook.id)}
									onOpenSettings={openBookSettings}
									onDelete={(id) => (deletingId = id)}
									bindingsCount={l.lorebookBindings?.length || 0}
									entryCounts={l.entryCounts}
									hasOpenSession={false}
									openSessionHasLorebook={false}
									isOpenSessionLorebook={false}
								/>
							{/each}
						</div>
					{/if}
					{#if shelf.shared.length}
						<!-- Read and Duplicate only (ruled Q3/Q4): never
						     deleted or read into a session from here. -->
						<ListGroupLabel
							label="Shared with you"
							id="loreSharedWithYou"
						/>
						<div
							class="flex flex-col gap-2"
							role="list"
							aria-labelledby="loreSharedWithYou"
						>
							{#each shelf.shared as l (l.id)}
								<LorebookListItem
									lorebook={l}
									onclick={(lorebook) => openBook(lorebook.id)}
									onDuplicate={(id, name) => (duplicating = { id, name })}
									entryCounts={l.entryCounts}
									hasOpenSession={false}
									openSessionHasLorebook={false}
									isOpenSessionLorebook={false}
								/>
							{/each}
						</div>
					{/if}
					{#if filteredSessionNotes.length}
						<!-- 🚧 pr-6 (R-f): each session's own book, here and never in a picker; Share moves it to the main list. -->
						<ListGroupLabel label={SESSION_NOTES_LABEL} id="loreSessionNotes" />
						<div
							class="flex flex-col gap-2"
							role="list"
							aria-labelledby="loreSessionNotes"
						>
							{#each filteredSessionNotes as l (l.id)}
								<LorebookListItem
									lorebook={l}
									onclick={(lorebook) => openBook(lorebook.id)}
									onOpenSettings={openBookSettings}
									entryCounts={l.entryCounts}
									hasOpenSession={false}
									openSessionHasLorebook={false}
									isOpenSessionLorebook={false}
									sessionNotesOf={l}
									shareItems={shareItemsFor(l)}
								/>
							{/each}
						</div>
					{/if}
				{/if}
			{/snippet}
			{#snippet detail()}{/snippet}
		</PanelSplit>
	{:else if mode === "desk"}
		<!-- Three columns (STYLE-GUIDE §5.2): the book's section list, flush
		     at the view's edge with its own hairline, then the book pane,
		     whose lens draws its own `ResizableSplit`. The pane is four
		     bands: the header, the lens line, the lens, the moment bar. -->
		<div class="flex min-h-0 flex-1">
			<LoreRail
				{scopes}
				{rulesGroup}
				scope={route.settings ? null : route.scope}
				{lens}
				{search}
				{savedCounts}
				{saved}
				looseEndsCount={readOnly ? 0 : liveLooseEnds.length}
				looseEndsOpen={queueSnapshot !== null}
				onOpenLooseEnds={openQueue}
				onScope={openScope}
				onSaved={chooseSaved}
				onSearch={(next) => (search = next)}
				onOpenSettings={readOnly ? undefined : openSettings}
				settingsOpen={!!route.settings}
			/>
			<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
				{@render bookHeader()}
				{@render lensLine()}
				<div class="flex min-h-0 min-w-0 flex-1 flex-col">
					{@render workspace()}
				</div>
				<!-- One line under every lens: the line, the moment being
				     read, the story axis. Never inside a lens, because moving
				     between them must not move the moment. -->
				<div class="shrink-0">
					{@render momentBar(false)}
				</div>
			</div>
		</div>
	{:else}
		<!-- Compact: the header, the find row, the lens, and the moment bar
		     folded to one line. -->
		<div class="flex min-h-0 flex-1 flex-col gap-3 p-4">
			{@render bookHeader()}
			{@render findRow()}
			<div class="flex min-h-0 flex-1 flex-col">
				{@render workspace()}
			</div>
			<div class="shrink-0">
				{@render momentBar(true)}
			</div>
		</div>
	{/if}
</div>

<LorebookActions
	bind:this={actions}
	bind:creating
	bind:importing
	bind:exportingId
	bind:deletingId
	bind:duplicating
	deletingBook={deletingId === null
		? null
		: (lorebookList.find((l) => l.id === deletingId) ?? null)}
	{canOfferAttachToSession}
	onDeleted={(id) => {
		if (route.lorebookId === id) loreRoute.set(emptyRoute())
	}}
	onDuplicated={(id) => openBook(id)}
	onCreated={(id) => openBook(id)}
	onImported={(id) => openBook(id)}
/>

{#if book && canShare}
	<SharePeopleModal
		open={sharing}
		title="Share {book.name}"
		initialUserIds={sharedWith.map((p) => p.id)}
		onConfirm={handleShareConfirm}
		onclose={() => (sharing = false)}
	/>
{/if}

<ActionConfirm
	asking={shareAsking?.asking ?? null}
	onConfirm={() => {
		const g = shareAsking?.go
		shareAsking = null
		g?.()
	}}
	onCancel={() => (shareAsking = null)}
/>

<ReplaceReadingModal
	open={replacing !== null}
	sessionName={openSessionCtx.sessionName ?? "The open session"}
	currentBook={replacing?.currentName ?? ""}
	nextBook={replacing?.bookName ?? ""}
	onConfirm={() => {
		const next = replacing
		replacing = null
		if (next) readIntoSession(next.lorebookId)
	}}
	onCancel={() => (replacing = null)}
/>

<LorebookUnsavedChangesModal
	open={loreRoute.confirming}
	onOpenChange={(e) => {
		if (!e.open) loreRoute.resolveConfirm(false)
	}}
	onConfirm={() => loreRoute.resolveConfirm(true)}
	onCancel={() => loreRoute.resolveConfirm(false)}
/>
