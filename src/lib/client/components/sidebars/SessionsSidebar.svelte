<script lang="ts">
	import { getContext, onDestroy, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		getInterestContext
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import EditSessionForm from "../sessionForms/EditSessionForm.svelte"
	import StartSessionForm from "../sessionForms/StartSessionForm.svelte"
	import SessionViewPanel from "../sessionForms/SessionViewPanel.svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { goto } from "$app/navigation"
	import { toaster } from "$lib/client/utils/toaster"
	import { page } from "$app/state"
	import SessionListItem from "../listItems/SessionListItem.svelte"
	import SessionsUnsavedChangesModal from "../modals/SessionsUnsavedChangesModal.svelte"
	import EmptyState from "../EmptyState.svelte"
	import PanelFilterInput from "../panels/PanelFilterInput.svelte"
	import PanelSplit from "../panels/PanelSplit.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import { JUMP_CONTEXT, type JumpCtx } from "$lib/client/shell/jump.svelte"
	import { lastActivityAt } from "$lib/client/utils/timeAgo"
	import { SvelteMap } from "svelte/reactivity"
	import type { StatusText } from "@serene-pub/sdk"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
		/** The session currently open in the main view — pinned and highlighted. */
		sessionId?: number | null
	}
	let { onclose = $bindable(), sessionId = null }: Props = $props()

	type SessionRow = Sockets.Sessions.List.Response["sessionList"][0]

	let sessions: SessionRow[] = $state([])
	/**
	 * What each session's run in flight is doing (R-19), kept current between
	 * lists by `sessions:runStatus`: a status per session while one runs,
	 * `null` once the run ends. Layered over the list's own `runStatus`, which
	 * is the registry's answer at the moment the list was built. `SvelteMap`,
	 * not a Map in `$state` — mutation is what changes here.
	 */
	const runStatuses = new SvelteMap<number, StatusText | null>()
	let isLoading = $state(true)
	let search = $state("")
	let showEditSessionForm = $state(false)
	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	let searchByCharacterId: number | null = $state(null)
	let searchByPersonaId: number | null = $state(null)
	// embedding/embeddingModel/vectorizedAt are deliberately excluded from
	// the "characters:get" response (see charactersGet's `columns`
	// restriction) — these types mirror that rather than hand-declaring the
	// full Select* shape. A persona is a character, so both chips read the
	// same row.
	let searchCharacter: Sockets.Characters.Get.Response["character"] =
		$state(null)
	let searchPersona: Sockets.Characters.Get.Response["character"] =
		$state(null)
	let editSessionId: number | null = $state(null)
	/**
	 * The start-a-session screen is open.
	 *
	 * Its own flag rather than `showEditSessionForm` with a null id: starting
	 * and editing are two screens with two shapes, and one boolean standing for
	 * both lets the edit form open with nothing to edit.
	 */
	let isStarting = $state(false)
	/** What the start screen opens knowing, when a caller knew something. */
	let startPrefill: PanelsCtx["digest"]["createSession"] = $state(undefined)
	let viewingId: number | null = $state(null)
	let returnToViewId: number | null = $state(null)
	let sessionFormHasChanges = $state(false)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	const socket = useTypedSocket()
	const interest = getInterestContext()
	// Measures the view's own box, not the window: the same view is 400px in
	// the dock and ~1376px full page, and both must land in the right shape.
	const vm = new ViewModeTracker()

	/**
	 * The filter popout's one pick, on top of whatever the filter box says.
	 *
	 * One at a time rather than a set: `All` is the resting state, and two
	 * picks lit at once would have to mean either "and" or "or" without the
	 * popout being able to say which.
	 */
	type SessionChip = "all" | "waiting" | `genre:${string}` | `tag:${string}`
	let chipFilter: SessionChip = $state("all")

	/** Whether the toolbar's filter popout is showing. */
	let filterOpen = $state(false)

	/**
	 * Every genre any session carries, taken from the whole list rather than
	 * the filtered one — a set that reshuffled under the cursor as the filter
	 * box narrowed would move the row being aimed at.
	 */
	let genreNames = $derived.by(() => {
		const names = new Set<string>()
		for (const s of sessions) if (s.genreName) names.add(s.genreName)
		return [...names].sort((a, b) => a.localeCompare(b))
	})

	/**
	 * Whether a genre is worth naming at all. On an install with one genre the
	 * answer is the same for every session, so the chip and the popout rows
	 * both say nothing and are both absent.
	 */
	let hasSeveralGenres = $derived(genreNames.length > 1)

	/**
	 * A pick for every tag any session carries. The whole tag record and not
	 * just its name: `sessions:list` carries `colorPreset` already, so the
	 * popout's dot is coloured from the payload this view has rather than a
	 * second lookup.
	 */
	let chipTags = $derived.by(() => {
		const byName = new Map<string, { name: string; colorPreset?: string }>()
		for (const s of sessions) {
			for (const st of (s as any).sessionTags ?? []) {
				if (!st?.tag?.name || byName.has(st.tag.name)) continue
				byName.set(st.tag.name, {
					name: st.tag.name,
					colorPreset: st.tag.colorPreset ?? undefined
				})
			}
		}
		return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
	})

	/** The popout as rendered: the two standing picks, then genres, then tags. */
	let filterOptions: Array<{
		value: SessionChip
		label: string
		colorPreset?: string
	}> = $derived([
		{ value: "all", label: "All" },
		{ value: "waiting", label: "Waiting on you" },
		...(hasSeveralGenres
			? genreNames.map((name) => ({
					value: `genre:${name}` as SessionChip,
					label: name
				}))
			: []),
		...chipTags.map((t) => ({
			value: `tag:${t.name}` as SessionChip,
			label: t.name,
			colorPreset: t.colorPreset
		}))
	])

	/**
	 * A pick whose tag or genre has left every session reads as `All`, so the
	 * popout only ever shows a pick that is still on the list.
	 */
	let activeChip: SessionChip = $derived.by(() =>
		filterOptions.some((o) => o.value === chipFilter) ? chipFilter : "all"
	)

	/**
	 * What the dismissible chip under the toolbar says. Undefined at `All`,
	 * which is the same condition as "there is no chip".
	 */
	let activeFilterLabel = $derived(
		activeChip === "all"
			? undefined
			: filterOptions.find((o) => o.value === activeChip)?.label
	)

	/** The dot's colour for a tag, or the neutral one an uncoloured tag gets. */
	function tagDotPreset(colorPreset?: string): string {
		return (
			colorPreset ||
			"bg-primary-500/20 text-primary-600 dark:text-primary-400"
		)
	}

	/** A pick applies and closes the popout: one choice, one interaction. */
	function pickFilter(value: SessionChip) {
		chipFilter = value
		filterOpen = false
	}

	/**
	 * Drop the deep-link filter parameters from the address bar.
	 *
	 * `goto` with `replaceState` and not a bare `searchParams.delete()`: the
	 * URL object a page exposes is a copy, so mutating it changes the address
	 * bar not at all and leaves the filter to come back on the next reload.
	 * Every place that clears one of these filters — the close gate, the
	 * discard path, each chip's × — goes through here for that reason.
	 */
	type DeepLinkParam = "sessions-by-characterId" | "sessions-by-personaId"
	function clearDeepLinkParams(...names: DeepLinkParam[]) {
		const url = new URL(window.location.href)
		const toDelete: DeepLinkParam[] = names.length
			? names
			: ["sessions-by-characterId", "sessions-by-personaId"]
		for (const name of toDelete) url.searchParams.delete(name)
		goto(url.toString(), { replaceState: true })
	}

	/** Drop the character chip, and the address that would restore it. */
	function clearCharacterFilter() {
		searchByCharacterId = null
		searchCharacter = null
		clearDeepLinkParams("sessions-by-characterId")
	}

	/** Drop the persona chip, and the address that would restore it. */
	function clearPersonaFilter() {
		searchByPersonaId = null
		searchPersona = null
		clearDeepLinkParams("sessions-by-personaId")
	}

	// The handlers for the two list events. Both are declared on the interest
	// registry below, which owns the one listener per event and releases this
	// sidebar's subscribers when it is destroyed.
	function handleSessionsList(msg: Sockets.Sessions.List.Response) {
		sessions = msg.sessionList || []
		// A fresh list is the registry's current answer for every row; what
		// this map heard before it is older than that.
		runStatuses.clear()
		isLoading = false
	}
	function handleRunStatus(msg: Sockets.Sessions.RunStatus.Response) {
		runStatuses.set(msg.sessionId, msg.status)
	}
	/** The row's status: the push's word where one arrived, else the list's. */
	const runStatusOf = (session: SessionRow) =>
		session.id != null && runStatuses.has(session.id)
			? runStatuses.get(session.id)
			: session.runStatus
	// The generic **:error listener in Layout.svelte already toasts this —
	// this just stops the spinner from spinning forever if the initial
	// fetch fails, so it settles into the (accurate enough) empty state.
	function handleSessionsListError() {
		isLoading = false
	}
	/**
	 * The user's own session list and the request that fills it, in one: the
	 * interest sync naming `sessions:list` leaves ahead of the request. BARE —
	 * the list is the whole of this user's sessions, not one session's rows,
	 * so it has no interest scope to narrow to. The listener also catches the
	 * re-sent list a create or rename elsewhere in the app provokes.
	 */
	$effect(() =>
		interest.requestWithInterest("sessions:list", {}, handleSessionsList)
	)
	interest.useInterest<"sessions:list:error">(
		"sessions:list:error",
		handleSessionsListError
	)
	// BARE, like the list: every session this sidebar shows may have a run in
	// flight, so there is no one scope to narrow to.
	interest.useInterest<"sessions:runStatus">(
		"sessions:runStatus",
		handleRunStatus
	)

	async function handleOnClose() {
		if (sessionFormHasChanges) {
			showUnsavedChangesModal = true
			return new Promise<boolean>((resolve) => {
				confirmCloseSidebarResolve = resolve
			})
		} else {
			clearDeepLinkParams()
			return true
		}
	}

	function handleCreateClick() {
		// Clear tutorial flag when user interacts with the highlighted button
		if (panelsCtx.digest.tutorial) {
			panelsCtx.digest.tutorial = false
		}

		startPrefill = undefined
		openStartForm()
	}

	/**
	 * Show the start screen, and only it, in the detail column.
	 *
	 * The dirty flag is cleared with the form that held it: the close gate asks
	 * about the screen on show, and a flag left standing for a form that is no
	 * longer mounted makes it ask about one nobody can see.
	 */
	function openStartForm() {
		showEditSessionForm = false
		editSessionId = null
		returnToViewId = null
		viewingId = null
		sessionFormHasChanges = false
		isStarting = true
	}

	/**
	 * Leave the start screen. Guarded rather than unconditional: the view and
	 * edit entries call it on their way in, and clearing the dirty flag when no
	 * start screen was open would disarm the gate for the edit form instead.
	 */
	function closeStartForm() {
		if (!isStarting) return
		isStarting = false
		startPrefill = undefined
		sessionFormHasChanges = false
	}

	/** The server has made the session — leave the screen and go into it. */
	function handleSessionCreated(newSessionId: number) {
		closeStartForm()
		handleOpenSession(newSessionId)
	}

	/**
	 * Jump, scoped to this view — see CharactersSidebar's matching block for
	 * why the registration is closures rather than values.
	 *
	 * `filteredSessions` and not the grouped list: the grouping is this
	 * panel's "keep the open session at the top, then by when it last moved"
	 * arrangement, which is about a list you are looking at rather than about
	 * what matched.
	 */
	const jumpCtx = getContext<JumpCtx | undefined>(JUMP_CONTEXT)
	$effect(() =>
		jumpCtx?.registerScope("sessions", {
			label: "Sessions",
			placeholder: "Filter sessions",
			getQuery: () => search,
			setQuery: (next) => (search = next),
			getHits: () =>
				filteredSessions
					// A row with no id has no address to jump to.
					.filter((session) => session.id != null)
					.map((session) => ({
						kind: "session" as const,
						id: session.id!,
						title: session.name || "Untitled session",
						subtitle:
							(session.sessionCharacters || [])
								.map((sc) => sc.character?.name)
								.filter(Boolean)
								.join(", ") || undefined
					})),
			// The row's own onclick, which opens the session — or, for the one
			// already open, its view panel.
			onPick: (hit) => {
				const id = Number(hit.id)
				const session = sessions.find((s) => s.id === id)
				if (session) handleSessionClick(session)
				else handleOpenSession(id)
			}
		})
	)

	function handleEditClick(sessionId: number) {
		closeStartForm()
		showEditSessionForm = true
		editSessionId = sessionId
		viewingId = null
	}

	function handleViewClick(sessionId: number) {
		closeStartForm()
		viewingId = sessionId
	}

	function handleEditFromView() {
		returnToViewId = viewingId
		editSessionId = viewingId
		viewingId = null
		showEditSessionForm = true
	}

	function handleOpenSession(sessionId: number) {
		goto(`/sessions/${sessionId}`)
		panelsCtx.fullPageView = null
		if (panelsCtx.isMobileMenuOpen) {
			panelsCtx.isMobileMenuOpen = false
		}
		if (panelsCtx.mobilePanel) {
			panelsCtx.mobilePanel = null
		}
	}

	function handleViewLorebook(lorebookId: number) {
		// Same deep-link the Activity sidebar uses: stash one address and open
		// the Lorebooks panel, which consumes the digest to land on that book.
		panelsCtx.digest.lore = { lorebookId, scope: "all" }
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
	}

	function handleSessionClick(session: any) {
		// Clicking the already-open session a second time opens *into* it in
		// the sidebar (its detail panel: cast, last line, scenario) rather than
		// re-navigating to where you already are.
		if (session.id === sessionId) {
			handleViewClick(session.id)
			return
		}
		handleOpenSession(session.id)
	}

	function closeEditForm() {
		showEditSessionForm = false
		editSessionId = null
		sessionFormHasChanges = false
		const returnId = returnToViewId
		returnToViewId = null
		if (returnId) viewingId = returnId
	}

	/**
	 * The edit form has a session to edit. The id is half the condition, not a
	 * detail: this form edits, and an edit screen with no session behind it has
	 * nothing to show.
	 */
	const isEditing = $derived(showEditSessionForm && editSessionId != null)

	let showDeleteModal = $state(false)
	let sessionToDelete: number | null = $state(null)
	let isDeleting = $state(false)

	function handleDeleteClick(sessionId: number) {
		sessionToDelete = sessionId
		showDeleteModal = true
	}
	function cancelDelete() {
		showDeleteModal = false
		sessionToDelete = null
	}
	function confirmDelete() {
		// Guard against double-submit (eg. an impatient re-click while the
		// previous delete is still in flight)
		if (isDeleting) return
		if (sessionToDelete != null) {
			if (page.params.id === sessionToDelete.toString()) {
				// If the current session is being deleted, navigate away
				goto("/")
				panelsCtx.fullPageView = null
			}
			isDeleting = true
			socket.emit("sessions:delete", { id: sessionToDelete })
			showDeleteModal = false
			sessionToDelete = null
		}
	}
	function handleSessionsDelete(msg: Sockets.Sessions.Delete.Response) {
		isDeleting = false
		sessions = sessions.filter((c) => c.id !== msg.id)
		// The detail panel is showing the row that just went away — close it.
		if (viewingId === msg.id) viewingId = null
		toaster.success({ title: "Session deleted" })
	}
	// Not shown to the user here - the generic onAny catch-all in Layout.svelte
	// already toasts on "sessions:delete:error"; this listener just clears the
	// in-flight guard so a failed delete doesn't leave the button stuck.
	function handleSessionsDeleteError() {
		isDeleting = false
	}
	// The delete itself is sent by `confirmDelete` above, so the interest is
	// declared on its own and the request stays where the press is.
	interest.useInterest<"sessions:delete">(
		"sessions:delete",
		handleSessionsDelete
	)
	interest.useInterest<"sessions:delete:error">(
		"sessions:delete:error",
		handleSessionsDeleteError
	)

	function handleCloseModalDiscard() {
		showUnsavedChangesModal = false
		// Clear search params when discarding changes and closing
		clearDeepLinkParams()

		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(true)
	}

	function handleCloseModalCancel() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
	}

	function handleUnsavedChangesOnOpenChange(e: { open: boolean }) {
		if (!e.open) {
			showUnsavedChangesModal = false
			if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
		}
	}

	/**
	 * Every narrowing in force, stacked: the two deep-link filters, then the
	 * popout's pick, then the text. They stack rather than replace each other,
	 * so a tag chip plus a typed word means both, never either.
	 */
	let filteredSessions: SessionRow[] = $derived.by(() => {
		const lower = search.toLowerCase()

		let filtered = [...sessions]

		// If searching by character ID, filter sessions that include that character
		if (searchByCharacterId) {
			filtered = filtered.filter((session) =>
				session.sessionCharacters?.some(
					(cc) => cc.character?.id === searchByCharacterId
				)
			)
		}

		// If searching by persona ID, filter sessions that include that persona
		if (searchByPersonaId) {
			filtered = filtered.filter((session) =>
				session.sessionPersonas?.some(
					(cp) => cp.persona?.id === searchByPersonaId
				)
			)
		}

		if (activeChip === "waiting") {
			// The model spoke last, so the next line is the reader's.
			filtered = filtered.filter(
				(session) => session.lastMessage && !session.lastMessage.isUser
			)
		} else if (activeChip.startsWith("genre:")) {
			const genreName = activeChip.slice(6)
			filtered = filtered.filter(
				(session) => session.genreName === genreName
			)
		} else if (activeChip.startsWith("tag:")) {
			const tagName = activeChip.slice(4)
			filtered = filtered.filter((session) =>
				((session as any).sessionTags ?? []).some(
					(st: any) => st?.tag?.name === tagName
				)
			)
		}

		return filtered.filter((session) => {
			const sessionName = session.name?.toLowerCase() || ""
			const personaNames = (session.sessionPersonas || [])
				.map((cp) => cp.persona?.name?.toLowerCase() || "")
				.join(" ")
			const characterNames = (session.sessionCharacters || [])
				.map((cc) => cc.character?.name?.toLowerCase() || "")
				.join(" ")
			const tagNames = (session.sessionTags || [])
				.map((ct: any) => ct.tag?.name?.toLowerCase() || "")
				.join(" ")
			return (
				sessionName.includes(lower) ||
				personaNames.includes(lower) ||
				characterNames.includes(lower) ||
				tagNames.includes(lower)
			)
		})
	})

	/**
	 * Whether anything is currently hiding rows — the empty state offers to
	 * start a session only when the list is genuinely empty, not when a filter
	 * has emptied it.
	 */
	let listIsNarrowed = $derived(
		!!search ||
			activeChip !== "all" ||
			!!searchByCharacterId ||
			!!searchByPersonaId
	)

	// The open session pinned to the top, so it is always at hand and never
	// scrolled past. Highlight rides along via `active` on each item.
	const orderedSessions = $derived.by(() => {
		if (sessionId == null) return filteredSessions
		const active = filteredSessions.filter((s) => s.id === sessionId)
		if (!active.length) return filteredSessions
		return [
			...active,
			...filteredSessions.filter((s) => s.id !== sessionId)
		]
	})

	/** The open session, when this filtering still shows it. */
	const pinnedSession = $derived(
		sessionId == null
			? undefined
			: orderedSessions.find((s) => s.id === sessionId)
	)

	const DAY_MS = 86_400_000
	type BucketKey = "today" | "yesterday" | "week" | "earlier"
	const BUCKET_ORDER: Array<{ key: BucketKey; label: string }> = [
		{ key: "today", label: "Today" },
		{ key: "yesterday", label: "Yesterday" },
		{ key: "week", label: "This week" },
		{ key: "earlier", label: "Earlier" }
	]

	/**
	 * The list under the pinned row, cut into buckets by when each session
	 * last moved.
	 *
	 * Calendar days from local midnight rather than rolling 24-hour windows: a
	 * reader asking "did I play this today" means the date, and a session
	 * played at 23:00 last night is "yesterday" at 09:00 whatever the clock
	 * arithmetic says. "This week" is the six days before that, and everything
	 * older is "Earlier" — including a session with no readable timestamp,
	 * whose activity resolves to 0.
	 *
	 * Server order is kept inside a bucket: the list arrives sorted, and
	 * re-sorting here would fight it.
	 */
	const sessionBuckets = $derived.by(() => {
		const rows = orderedSessions.filter((s) => s.id !== pinnedSession?.id)
		const midnight = new Date()
		midnight.setHours(0, 0, 0, 0)
		const today = midnight.getTime()

		const byKey: Record<BucketKey, SessionRow[]> = {
			today: [],
			yesterday: [],
			week: [],
			earlier: []
		}
		for (const session of rows) {
			const at = lastActivityAt(session)
			const key: BucketKey =
				at >= today
					? "today"
					: at >= today - DAY_MS
						? "yesterday"
						: at >= today - 7 * DAY_MS
							? "week"
							: "earlier"
			byKey[key].push(session)
		}
		return BUCKET_ORDER.map((bucket) => ({
			...bucket,
			rows: byKey[bucket.key]
		})).filter((bucket) => bucket.rows.length > 0)
	})

	$effect(() => {
		if (panelsCtx.digest.sessionId) {
			showEditSessionForm = true
			editSessionId = panelsCtx.digest.sessionId
			delete panelsCtx.digest.sessionId
			delete panelsCtx.digest.sessionCharacterId
			delete panelsCtx.digest.sessionPersonaId
		}
	})

	/**
	 * "Start one" from somewhere else in the app — the home's button, a
	 * character's own panel — with whatever that caller already knew.
	 *
	 * The entry is deleted before anything async, so a confirm that takes a
	 * round trip cannot find it a second time and open two screens. The prefill
	 * is read out first for the same reason: a discard resolves after that
	 * delete, so the digest cannot supply it then.
	 */
	$effect(() => {
		const prefill = panelsCtx.digest.createSession
		if (!prefill) return
		delete panelsCtx.digest.createSession
		if (sessionFormHasChanges) {
			handleOnClose().then((confirmed) => {
				if (!confirmed) return
				startPrefill = prefill
				openStartForm()
			})
			return
		}
		startPrefill = prefill
		openStartForm()
	})

	$effect(() => {
		if (panelsCtx.digest.sessionCharacterId) {
			searchByCharacterId = panelsCtx.digest.sessionCharacterId
		}
		if (panelsCtx.digest.sessionPersonaId) {
			searchByPersonaId = panelsCtx.digest.sessionPersonaId
		}
		delete panelsCtx.digest.sessionCharacterId
		delete panelsCtx.digest.sessionPersonaId
	})

	/**
	 * The character this sidebar is filtering by, as a SCOPED interest
	 * (`characters:get#<id>`; the payload carries the id on `character.id`,
	 * see `SCOPED_EVENTS`) declared and asked for in one effect — so a filter
	 * pointed at another character releases the old key as it takes the new
	 * one.
	 *
	 * Released on the first reply: the filter wants this row once, not every
	 * later re-send of it. The release is idempotent, so the cleanup below
	 * still covers an id that changes — or a sidebar that closes — before any
	 * reply arrives.
	 */
	$effect(() => {
		if (searchByCharacterId) {
			const requestedId = searchByCharacterId
			let release: (() => void) | undefined
			release = declareInterest<"characters:get">(
				interestKey("characters:get", requestedId),
				(msg: Sockets.Characters.Get.Response) => {
					release?.()
					// Belt and braces: the key already narrows the fan-out to
					// this id, and this says the same of the payload.
					if (msg.character?.id !== requestedId) return
					searchCharacter = msg.character
				}
			)
			const charIdReq: Sockets.Characters.Get.Params = {
				id: requestedId
			}
			socket.emit("characters:get", charIdReq)
			return () => release?.()
		}
	})

	/** The persona filter — same scoped key, same release-on-reply. A persona
	 *  is a character, so this asks `characters:get` too. */
	$effect(() => {
		if (searchByPersonaId) {
			const requestedId = searchByPersonaId
			let release: (() => void) | undefined
			release = declareInterest<"characters:get">(
				interestKey("characters:get", requestedId),
				(msg: Sockets.Characters.Get.Response) => {
					release?.()
					if (msg.character?.id !== requestedId) return
					searchPersona = msg.character
				}
			)
			const personaIdReq: Sockets.Characters.Get.Params = {
				id: requestedId
			}
			socket.emit("characters:get", personaIdReq)
			return () => release?.()
		}
	})

	$effect(() => {
		if (editSessionId && !showEditSessionForm) {
			editSessionId = null
		}
	})

	/** The row whose detail panel is showing, as the list row the list has. */
	const viewingSession = $derived(
		viewingId == null ? undefined : sessions.find((s) => s.id === viewingId)
	)

	onMount(() => {
		// The list itself is asked for by the `requestWithInterest` above.
		onclose = handleOnClose
	})

	onDestroy(() => {
		// The `sessions:*` listeners are not here: the interest registry
		// releases this sidebar's subscribers as its effects are destroyed.
		onclose = undefined
	})
</script>

<div use:vm.observe class="text-foreground flex h-full min-h-0 flex-col">
	<PanelSplit
		mode={vm.mode}
		hasDetail={isStarting || isEditing || viewingId != null}
		emptyMessage="Pick a session, or start one."
		listWidth="380px"
	>
		{#snippet detail()}
			{#if isStarting}
				<!-- Bound to the SAME dirty flag the edit form uses, so the
				     view's close gate and its unsaved-changes modal cover a
				     half-answered start screen without knowing there is one. -->
				<StartSessionForm
					prefill={startPrefill}
					bind:hasChanges={sessionFormHasChanges}
					onCreated={handleSessionCreated}
					onCancel={closeStartForm}
					showBack={vm.mode !== "desk"}
				/>
			{:else if isEditing}
				<EditSessionForm
					bind:showEditSessionForm
					bind:editSessionId
					bind:hasChanges={sessionFormHasChanges}
					onClose={closeEditForm}
				/>
			{:else if viewingId}
				{#key viewingId}
					<SessionViewPanel
						sessionId={viewingId}
						onBack={vm.mode === "desk"
							? undefined
							: () => (viewingId = null)}
						onEdit={handleEditFromView}
						onOpen={() => handleOpenSession(viewingId!)}
						onViewLorebook={handleViewLorebook}
						onDelete={handleDeleteClick}
						canEdit={!!viewingSession?.canEdit}
						isOwner={!!viewingSession?.isOwner}
						genreName={viewingSession?.genreName}
						messageCount={viewingSession?.messageCount}
						lastMessage={viewingSession?.lastMessage}
					/>
				{/key}
			{/if}
		{/snippet}

		{#snippet list()}
			<!-- The one thing this view is FOR, on its own line above the
			     controls that narrow it: starting a session is not a way of
			     filtering the list, and one row holding both would read as
			     though it were. -->
			<div class="mb-2 flex min-w-0 shrink-0 items-center">
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500 shrink-0 {panelsCtx
						.digest.tutorial
						? 'ring-primary-500/50 animate-pulse ring-4'
						: ''}"
					onclick={handleCreateClick}
					title="New session"
					aria-label="New session"
				>
					<Icons.Plus size={16} aria-hidden="true" />
					New
				</button>
			</div>
			<!-- Filter box and filter popout: everything that says "which of
			     these am I looking at" on one line, with the icon control
			     pinned at the end so the box takes the rest. Every child is
			     shrinkable or fixed, so the row fits a 399px dock without
			     scrolling sideways. -->
			<div class="mb-2 flex min-w-0 shrink-0 items-center gap-2">
				<div class="min-w-0 flex-1">
					<PanelFilterInput
						bind:value={search}
						placeholder="sessions"
						count={sessions.length}
						aria-label="Filter sessions by name, persona, character or tag"
					/>
				</div>
				<!-- The genre and tag picks live in a popout rather than a row
				     of chips: the row grows with the tag list, and the list
				     pane has no sideways room to grow into. -->
				<Popover
					open={filterOpen}
					onOpenChange={(e) => (filterOpen = e.open)}
					positioning={{ placement: "bottom-end" }}
				>
					<Popover.Trigger
						class="btn grid size-10 shrink-0 place-items-center p-0 {activeChip !==
						'all'
							? 'preset-tonal-primary'
							: ''}"
						title="Filter sessions"
						aria-label="Filter sessions"
						aria-expanded={filterOpen}
					>
						<Icons.SlidersHorizontal size={16} aria-hidden="true" />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-surface-100-900 border-surface-300-700 w-[min(90vw,260px)] border p-2 shadow-xl"
							>
								<div
									class="flex max-h-[min(60vh,320px)] flex-col gap-0.5 overflow-y-auto"
									role="radiogroup"
									aria-label="Filter sessions"
								>
									{#each filterOptions as option (option.value)}
										{@const checked =
											activeChip === option.value}
										<button
											type="button"
											role="radio"
											aria-checked={checked}
											class="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm {checked
												? 'sidebar-row-active'
												: 'hover:preset-tonal-primary'}"
											onclick={() =>
												pickFilter(option.value)}
										>
											{#if option.value.startsWith("tag:")}
												<span
													class="size-2 shrink-0 rounded-full {tagDotPreset(
														option.colorPreset
													)}"
													aria-hidden="true"
												></span>
											{/if}
											<span class="min-w-0 truncate">
												{option.label}
											</span>
										</button>
									{/each}
								</div>
							</Popover.Content>
						</Popover.Positioner>
					</Portal>
				</Popover>
			</div>
			<!-- Every narrowing in force, said once and in one strip. At `All`
			     with no deep link there is nothing to say and the strip is
			     absent entirely. -->
			{#if activeFilterLabel || searchCharacter || searchPersona}
				<div
					class="mb-3 flex min-w-0 shrink-0 flex-wrap items-center gap-2"
				>
					{#if activeFilterLabel}
						<span
							class="bg-surface-200-800 text-surface-700-300 flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs"
						>
							<span class="min-w-0 truncate">
								{activeFilterLabel}
							</span>
							<button
								type="button"
								class="hover:text-foreground shrink-0"
								onclick={() => pickFilter("all")}
								title="Clear filter"
								aria-label="Clear filter: {activeFilterLabel}"
							>
								<Icons.X size={12} aria-hidden="true" />
							</button>
						</span>
					{/if}
					{#if searchCharacter}
						<span
							class="bg-surface-200-800 text-surface-700-300 flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs"
						>
							<span class="min-w-0 truncate">
								{searchCharacter.nickname ||
									searchCharacter.name}
							</span>
							<button
								type="button"
								class="hover:text-foreground shrink-0"
								onclick={clearCharacterFilter}
								title="Clear filter"
								aria-label="Clear character filter: {searchCharacter.nickname ||
									searchCharacter.name}"
							>
								<Icons.X size={12} aria-hidden="true" />
							</button>
						</span>
					{/if}
					{#if searchPersona}
						<span
							class="bg-surface-200-800 text-surface-700-300 flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs"
						>
							<span class="min-w-0 truncate">
								{searchPersona.name}
							</span>
							<button
								type="button"
								class="hover:text-foreground shrink-0"
								onclick={clearPersonaFilter}
								title="Clear filter"
								aria-label="Clear persona filter: {searchPersona.name}"
							>
								<Icons.X size={12} aria-hidden="true" />
							</button>
						</span>
					{/if}
				</div>
			{/if}
			<div class="min-h-0 flex-1 overflow-y-auto">
				{#if isLoading}
					<div class="flex items-center justify-center py-8">
						<Icons.Loader2
							size={20}
							class="text-surface-400 animate-spin"
						/>
					</div>
				{:else if filteredSessions.length === 0}
					<EmptyState
						icon={Icons.MessageSquare}
						message={listIsNarrowed
							? "No sessions found matching your filters."
							: "No sessions yet — start one to get roleplaying."}
						ctaLabel={listIsNarrowed ? undefined : "New session"}
						onCta={listIsNarrowed ? undefined : handleCreateClick}
					/>
				{:else}
					<div class="flex min-w-0 flex-col">
						<!-- The open session, under no header: it is pinned
						     because it is open, which is a different fact from
						     when it last moved, and filing it under "Today"
						     would put it back in the scroll. -->
						{#if pinnedSession}
							<div
								class="flex min-w-0 flex-col gap-2"
								role="list"
								aria-label="Open session"
							>
								<SessionListItem
									session={pinnedSession}
									runStatus={runStatusOf(pinnedSession)}
									active={true}
									showGenre={hasSeveralGenres}
									onclick={handleSessionClick}
									onEdit={handleEditClick}
									onDelete={handleDeleteClick}
								/>
							</div>
						{/if}
						{#each sessionBuckets as bucket (bucket.key)}
							<!-- A <p> and not an <h3>: this pane carries no
							     heading of its own, so a level-3 heading would
							     open the outline at the wrong depth. The list
							     it labels points back at it instead. -->
							<p
								id="sessions-bucket-{bucket.key}"
								class="text-surface-500 px-3 pt-4 pb-1 text-[11px]"
							>
								{bucket.label}
							</p>
							<div
								class="flex min-w-0 flex-col gap-2"
								role="list"
								aria-labelledby="sessions-bucket-{bucket.key}"
							>
								{#each bucket.rows as session (session.id)}
									<!-- `active` covers two facts that never
									     disagree in practice: the session open
									     in the main view (pinned above), and —
									     in desk mode only — the one whose
									     detail is showing in the column beside
									     this list. In compact the list is not
									     on screen while a detail is, so the
									     second half would mark nothing. -->
									<SessionListItem
										{session}
										runStatus={runStatusOf(session)}
										active={session.id === sessionId ||
											(vm.mode === "desk" &&
												session.id === viewingId)}
										showGenre={hasSeveralGenres}
										onclick={handleSessionClick}
										onEdit={handleEditClick}
										onDelete={handleDeleteClick}
									/>
								{/each}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/snippet}
	</PanelSplit>
</div>

<Dialog open={showDeleteModal} onOpenChange={(e) => (showDeleteModal = e.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-[min(92vw,420px)] space-y-6 p-6 shadow-xl"
				role="alertdialog"
				aria-labelledby="session-delete-title"
				aria-describedby="session-delete-description"
			>
				<header class="flex justify-between">
					<h2 id="session-delete-title" class="h2">
						Delete session?
					</h2>
				</header>
				<article>
					<p id="session-delete-description" class="opacity-60">
						Are you sure you want to delete this session and all of
						its messages? This action cannot be undone.
					</p>
				</article>
				<footer class="flex justify-end gap-4">
					<button
						type="button"
						class="btn preset-filled-surface-500"
						onclick={cancelDelete}
						disabled={isDeleting}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-error-500"
						onclick={confirmDelete}
						disabled={isDeleting}
					>
						{#if isDeleting}
							<Icons.Loader2
								size={16}
								class="animate-spin"
								aria-hidden="true"
							/>
						{/if}
						Delete
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

{#if showUnsavedChangesModal}
	<SessionsUnsavedChangesModal
		open={showUnsavedChangesModal}
		onOpenChange={handleUnsavedChangesOnOpenChange}
		onConfirm={handleCloseModalDiscard}
		onCancel={handleCloseModalCancel}
	/>
{/if}
