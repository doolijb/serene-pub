<script lang="ts">
	import { onMount, getContext, untrack } from "svelte"
	import { page } from "$app/state"
	import { replaceState } from "$app/navigation"
	import {
		LANDING_SEEK_FRAMES,
		landingTarget,
		nextLandingStep,
		readMessageLanding,
		withoutLanding
	} from "$lib/client/sessions/messageLanding"
	import { landOn } from "$lib/client/utils/landOn"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { announce } from "$lib/client/accessibility/state.svelte"

	const PAGE_SIZE = 25

	const socket = useTypedSocket()
	const sessionId = $derived(Number(page.params.id))
	let userCtx: UserCtx = getContext("userCtx")

	let session: Sockets.Sessions.Get.Response["session"] | undefined = $state()
	let pagination: Sockets.Sessions.Get.Response["pagination"] | undefined =
		$state()
	let loaded = $state(false)
	let notFound = $state(false)
	let loadingOlder = $state(false)
	let error = $state("")

	let newMessage = $state("")
	let sending = $state(false)
	let generatingStatus = $state("")
	let generatingMessageId: number | null = $state(null)
	// Separate from generatingStatus (which also gates the visible "Stop
	// Generating" banner) so a completed reply doesn't leave that banner
	// stuck on screen — this is purely an aria-live announcement telling
	// screen reader users a reply arrived, since otherwise the "Generating…"
	// status just goes silent with no cue to go check the message list.
	let messageAnnouncement = $state("")

	let characters: Sockets.Characters.List.Response["characterList"] = $state(
		[]
	)
	/** A persona is a character the user voices — one list, narrowed here. */
	let personas = $derived(characters.filter((c) => c.isPersona))
	let addPersonaId: number | "" = $state("")

	let isGuest = $derived(!!session && session.userId !== userCtx.user?.id)
	let isOwner = $derived(!!session && session.userId === userCtx.user?.id)

	let userPersonasInSession = $derived(
		(session?.sessionPersonas || []).filter(
			(cp) => cp.persona?.userId === userCtx.user?.id
		)
	)
	let selectedPersonaId: number | null = $state(null)
	let currentUserPersona = $derived.by(() => {
		if (!userPersonasInSession.length) return undefined
		if (selectedPersonaId) {
			const found = userPersonasInSession.find(
				(cp) => cp.personaId === selectedPersonaId
			)
			if (found) return found
		}
		return userPersonasInSession[0]
	})
	let showAddPersonaCTA = $derived(
		isGuest && userPersonasInSession.length === 0
	)
	let availableOwnPersonas = $derived(
		personas.filter(
			(p) =>
				!(session?.sessionPersonas || []).some(
					(cp) => cp.personaId === p.id
				)
		)
	)

	/**
	 * A message's attachments — its `core:image` / `core:file` parts on the
	 * active revision of each step — named for a link (composer attachments
	 * §3.4). Document View lists them; it never draws an image inline.
	 */
	function attachmentsOf(msg: SelectSessionMessage): {
		partId: number
		assetId: number
		kind: "image" | "file"
		name: string | null
	}[] {
		const m = msg as SelectSessionMessage & {
			parts?: {
				id: number
				step: number
				revision: number
				ordinal: number
				type: string
				data: Record<string, unknown> | null
			}[]
			activeRevisions?: Record<string, number>
		}
		const active = m.activeRevisions ?? {}
		return (m.parts ?? [])
			.filter(
				(p) =>
					(p.type === "core:image" || p.type === "core:file") &&
					p.revision === (active[String(p.step)] ?? 0) &&
					typeof p.data?.assetId === "number"
			)
			.sort((a, b) => a.step - b.step || a.ordinal - b.ordinal)
			.map((p) => {
				const d = p.data ?? {}
				const name =
					[d.alt, d.filename, d.name].find(
						(v): v is string => typeof v === "string" && v.trim() !== ""
					) ?? null
				return {
					partId: p.id,
					assetId: d.assetId as number,
					kind: p.type === "core:image" ? "image" : "file",
					name
				}
			})
	}

	function speakerName(msg: SelectSessionMessage): string {
		if (msg.isNarratorResponse) return "Narrator"
		if (msg.characterId) {
			const cc = session?.sessionCharacters?.find(
				(c) => c.characterId === msg.characterId
			)
			return cc?.character?.nickname || cc?.character?.name || "Character"
		}
		if (msg.personaId) {
			const cp = session?.sessionPersonas?.find(
				(p) => p.personaId === msg.personaId
			)
			return cp?.persona?.name || "You"
		}
		return msg.role === "system" ? "System" : "Unknown"
	}

	// Narrator/system messages aren't tied to any character record, so there's
	// nothing to view for those — only character and persona messages get a
	// View link, and both go to the same card: a persona IS a character.
	function viewHref(msg: SelectSessionMessage): string | null {
		if (msg.characterId)
			return `/document-view/characters/${msg.characterId}/view`
		if (msg.personaId)
			return `/document-view/characters/${msg.personaId}/view`
		return null
	}

	function swipeInfo(
		msg: SelectSessionMessage
	): { current: number; total: number } | null {
		const swipes = (msg.metadata as any)?.swipes
		if (!swipes?.history?.length) return null
		return {
			current: (swipes.currentIdx ?? 0) + 1,
			total: swipes.history.length
		}
	}

	function load(beforeId?: number) {
		if (beforeId) loadingOlder = true
		else loaded = false
		notFound = false
		socket.emit("sessions:get", {
			id: sessionId,
			limit: PAGE_SIZE,
			beforeId
		})
	}

	function loadEarlier() {
		if (!session?.sessionMessages?.length) return
		const oldestId = session.sessionMessages[0].id
		load(oldestId)
	}

	function send() {
		if (!newMessage.trim()) return
		const personaId =
			currentUserPersona?.personaId ||
			session?.sessionPersonas?.[0]?.personaId
		if (!personaId) {
			error = "No persona selected for this session."
			announce(error)
			return
		}
		error = ""
		socket.emit("sessionMessages:sendPersonaMessage", {
			sessionId,
			personaId,
			content: newMessage
		})
		newMessage = ""
	}

	// Ctrl+Enter (or Cmd+Enter on macOS) submits — plain Enter still inserts a
	// newline as normal textarea behavior, so nothing about typing changes.
	function handleComposerKeydown(event: KeyboardEvent) {
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault()
			send()
		}
	}

	/**
	 * Who replies next (PLAN-turn-order §4.9): the session's stored turn
	 * order, pushed by the server (`sessions:turnOrder`) — never worked out
	 * here. The selector defaults to the order's head; picking a candidate or
	 * the narrator fires that turn instead (`sessions:fireTurn`, `via:
	 * 'pick'`), which the server allows the owner and refuses anyone else
	 * with a sentence.
	 */
	type TurnOrderView = {
		order: Array<{ ref: string | null }>
		candidates: Array<{
			ref: string
			kind: string
			name: string
			nickname?: string
			ownerUserId?: number
		}>
	}
	let turnOrder = $state<TurnOrderView | null>(null)
	const HEAD = "head"
	const NARRATOR = "narrator"
	let fireTurnFrom: string = $state("")
	const headName = $derived.by(() => {
		const head = turnOrder?.order[0]
		if (!head) return null
		if (head.ref === null) return "the narrator"
		const c = turnOrder!.candidates.find((x) => x.ref === head.ref)
		return c?.nickname || c?.name || "someone"
	})
	const headCandidate = $derived.by(() => {
		const head = turnOrder?.order[0]
		return head?.ref ? turnOrder!.candidates.find((c) => c.ref === head.ref) : undefined
	})
	const headIsPerson = $derived(headCandidate?.kind === "persona")
	const headIsMine = $derived(
		headIsPerson && headCandidate?.ownerUserId === userCtx.user?.id
	)
	// The selection follows the head each time the order moves; a manual
	// pick holds until then.
	$effect(() => {
		fireTurnFrom = turnOrder?.order.length && !headIsPerson ? HEAD : ""
	})
	function fireSelectedTurn() {
		if (fireTurnFrom === "") return
		if (fireTurnFrom === HEAD) {
			socket.emit("sessions:fireTurn", { sessionId })
			return
		}
		socket.emit("sessions:fireTurn", {
			sessionId,
			entry: {
				ref: fireTurnFrom === NARRATOR ? null : fireTurnFrom,
				via: "pick"
			}
		})
	}
	/**
	 * Viewing a session is what has the server push its turn order — asked
	 * again whenever the route moves to another session, with the old order
	 * dropped first so it is never shown for the wrong one.
	 */
	$effect(() => {
		if (!Number.isFinite(sessionId)) return
		turnOrder = null
		socket.emit("sessions:view", { sessionId })
	})

	function handleTurnOrder(msg: Sockets.Sessions.TurnOrder.Push) {
		if (msg.sessionId !== sessionId) return
		const t = msg.turnOrder as Partial<TurnOrderView> | null
		turnOrder = {
			order: Array.isArray(t?.order) ? t!.order : [],
			candidates: Array.isArray(t?.candidates) ? t!.candidates : []
		}
	}
	function handleFireTurnError(msg: Sockets.Sessions.FireTurn.Response) {
		if (msg.sessionId !== sessionId || !msg.error) return
		error = msg.error
		announce(error)
	}

	function cancelGeneration() {
		if (generatingMessageId == null) return
		socket.emit("sessionMessages:cancel", {
			sessionId,
			id: generatingMessageId
		})
	}

	function regenerateLast() {
		const last =
			session?.sessionMessages?.[session.sessionMessages.length - 1]
		if (last && !last.isGenerating)
			socket.emit("sessionMessages:regenerate", { id: last.id })
	}

	function swipeLeft(id: number) {
		socket.emit("sessionMessages:swipeLeft", { id })
	}

	function swipeRight(id: number) {
		socket.emit("sessionMessages:swipeRight", { id })
	}

	function deleteMessage(id: number) {
		if (!confirm("Delete this message? This cannot be undone.")) return
		socket.emit("sessionMessages:delete", { id })
	}

	// "Hidden" excludes a message from what's sent to the AI as context while
	// leaving it visible in the transcript here — a way to walk back
	// something from the story without deleting the record of it.
	function toggleHidden(msg: SelectSessionMessage) {
		socket.emit("sessionMessages:update", {
			id: msg.id,
			isHidden: !msg.isHidden
		})
	}

	function addOwnPersona() {
		if (addPersonaId === "") return
		socket.emit("sessions:addPersona", {
			sessionId,
			personaId: addPersonaId
		})
		addPersonaId = ""
	}

	function upsertMessage(m: SelectSessionMessage) {
		if (!session) return
		const existingIndex = session.sessionMessages.findIndex(
			(c) => c.id === m.id
		)
		let next: SelectSessionMessage[]
		if (existingIndex !== -1) {
			next = [...session.sessionMessages]
			next[existingIndex] = m
		} else {
			next = [...session.sessionMessages, m]
		}
		session = {
			...session,
			sessionMessages: next.sort((a, b) => a.id - b.id)
		}
	}

	function handleSessionsGet(msg: Sockets.Sessions.Get.Response) {
		if (msg.session === null) {
			loaded = true
			notFound = true
			return
		}
		if (msg.session?.id !== sessionId) return
		if (loadingOlder && msg.beforeId != null && session) {
			const existingIds = new Set(
				session.sessionMessages.map((m) => m.id)
			)
			const older = msg.session.sessionMessages.filter(
				(m) => !existingIds.has(m.id)
			)
			session = {
				...session,
				sessionMessages: [...older, ...session.sessionMessages].sort(
					(a, b) => a.id - b.id
				)
			}
			loadingOlder = false
		} else {
			session = {
				...msg.session,
				sessionMessages: [...msg.session.sessionMessages].sort(
					(a, b) => a.id - b.id
				)
			}
			loaded = true
		}
		pagination = msg.pagination
	}
	function handleSessionMessage(msg: Sockets.SessionMessage.Response) {
		if (!msg.sessionMessage || msg.sessionMessage.sessionId !== sessionId)
			return
		const m = msg.sessionMessage
		if (m.isGenerating) {
			generatingMessageId = m.id
			generatingStatus = `Generating a response as ${speakerName(m)}…`
			return
		}
		generatingMessageId = null
		generatingStatus = ""
		upsertMessage(m)
		if (m.error) {
			error = m.error.message || "Generation failed."
			announce(error)
		} else {
			error = ""
			messageAnnouncement = `${speakerName(m)} replied.`
		}
	}
	function handleSessionMessagesDelete(
		msg: Sockets.SessionMessages.Delete.Response
	) {
		if (!session) return
		error = ""
		session = {
			...session,
			sessionMessages: session.sessionMessages.filter(
				(m) => m.id !== msg.id
			)
		}
	}
	function handleSessionMessagesUpdate(
		msg: Sockets.SessionMessages.Update.Response
	) {
		if (msg.error) {
			error = msg.error
			announce(error)
			return
		}
		if (msg.sessionMessage) {
			error = ""
			upsertMessage(msg.sessionMessage)
			announce(
				msg.sessionMessage.isHidden
					? "Message hidden from AI."
					: "Message unhidden."
			)
		}
	}
	function handleSessionMessagesSwipeLeft(
		msg: Sockets.SessionMessages.SwipeLeft.Response
	) {
		if (msg.error) {
			error = msg.error
			announce(error)
			return
		}
		if (msg.sessionMessage) {
			error = ""
			upsertMessage(msg.sessionMessage)
			}
	}
	function handleSessionMessagesSwipeRight(
		msg: Sockets.SessionMessages.SwipeRight.Response
	) {
		if (msg.error) {
			error = msg.error
			announce(error)
			return
		}
		if (msg.sessionMessage) {
			error = ""
			upsertMessage(msg.sessionMessage)
			}
	}
	function handleSessionMessagesCancel() {
		generatingMessageId = null
		generatingStatus = ""
	}
	function handleSessionsAddPersona(
		msg: Sockets.Sessions.AddPersona.Response
	) {
		if (msg.error) {
			error = msg.error
			announce(error)
			return
		}
		error = ""
		load()
	}
	function handleCharactersList(msg: Sockets.Characters.List.Response) {
		characters = msg.characterList || []
	}

	/**
	 * The streamed reply, for THIS session only.
	 *
	 * `sessionMessage` is gated, so this declaration is what has the server
	 * broadcast it at all, and the session is its **interest scope**, so
	 * another tab's session does not stream through this page. An effect rather
	 * than `useInterest` because the key moves with the route: `useInterest`
	 * reads its key once, this releases the old one as it takes the new.
	 */
	$effect(() => {
		if (!Number.isFinite(sessionId)) return
		return declareInterest<"sessionMessage">(
			interestKey("sessionMessage", sessionId),
			handleSessionMessage
		)
	})

	/**
	 * This session's own `sessions:get`, SCOPED to the id in the route — the
	 * reply to `load()` and to every re-read a handler asks for. An effect
	 * rather than `useInterest` because the key moves with the route.
	 *
	 * The not-found reply arrives here too: it carries the requested id on
	 * `sessionId`, so it has this scope even with no session in it. No bare key
	 * is held for it — that one would match every other session's reply, and
	 * would keep the server's gate open for every id.
	 */
	$effect(() => {
		if (!Number.isFinite(sessionId)) return
		return declareInterest<"sessions:get">(
			interestKey("sessions:get", sessionId),
			handleSessionsGet
		)
	})

	/**
	 * The bare ones: none of these events has a `SCOPED_EVENTS` entry, so a
	 * scoped key would match nothing and the handlers' own id checks stay the
	 * filter.
	 *
	 * `characters:list` is STANDING rather than a one-shot around its request:
	 * the server re-emits it as a cascade after any character write, and this
	 * page's "add persona" picker — the same list, narrowed to the flagged
	 * rows — should show the new one.
	 */
	useInterest<"sessions:addPersona">(
		"sessions:addPersona",
		handleSessionsAddPersona
	)
	useInterest<"sessions:turnOrder">("sessions:turnOrder", handleTurnOrder)
	useInterest<"sessions:fireTurn:error">(
		"sessions:fireTurn:error",
		handleFireTurnError
	)
	useInterest<"characters:list">("characters:list", handleCharactersList)

	/**
	 * The five message writes this page reads, all BARE.
	 *
	 * ⚠ Not to be confused with the streamed `sessionMessage` above: these are
	 * the `sessionMessages:*` write replies, whose payloads are message ROWS
	 * with no session beside them, so none of them is in `SCOPED_EVENTS` and a
	 * `#<id>` key would match no payload at all. Each handler's own check
	 * against the rows this page is showing stays the filter.
	 */
	useInterest<"sessionMessages:delete">(
		"sessionMessages:delete",
		handleSessionMessagesDelete
	)
	useInterest<"sessionMessages:update">(
		"sessionMessages:update",
		handleSessionMessagesUpdate
	)
	useInterest<"sessionMessages:swipeLeft">(
		"sessionMessages:swipeLeft",
		handleSessionMessagesSwipeLeft
	)
	useInterest<"sessionMessages:swipeRight">(
		"sessionMessages:swipeRight",
		handleSessionMessagesSwipeRight
	)
	useInterest<"sessionMessages:cancel">(
		"sessionMessages:cancel",
		handleSessionMessagesCancel
	)

	/**
	 * Landing on the message a link named (`?message=<id>[&block=<blockId>]`),
	 * as the session page does: earlier pages load until it is here, then it
	 * is centred, ringed and focused (so reading starts there), and the
	 * params leave the address. This list draws no blocks, so a named block
	 * lands on its message.
	 */
	const messageLanding = $derived(readMessageLanding(page.url.searchParams))
	const messageLandingStep = $derived.by(() => {
		if (!messageLanding || !loaded || !session || session.id !== sessionId) return null
		return nextLandingStep(
			messageLanding,
			session.sessionMessages.map((m) => m.id),
			{ hasOlder: !!pagination?.hasMore, loadingOlder }
		)
	})
	function dropMessageLanding() {
		try {
			replaceState(withoutLanding(page.url), page.state)
		} catch {
			// Router not started: the params stay; nothing breaks.
		}
	}
	$effect(() => {
		const landing = messageLanding
		const step = messageLandingStep
		if (!landing || !step || step === "wait") return
		if (step === "load-older") return void untrack(loadEarlier)
		if (step === "give-up") return void untrack(dropMessageLanding)
		let frames = 0
		let raf = requestAnimationFrame(function seek() {
			const hit = landingTarget(document, landing)
			if (hit) landOn(hit.el, { focus: hit.focus })
			if (hit || ++frames >= LANDING_SEEK_FRAMES) untrack(dropMessageLanding)
			else raf = requestAnimationFrame(seek)
		})
		return () => cancelAnimationFrame(raf)
	})

	onMount(() => {
		// "sessionMessage", "sessions:get", "sessions:addPersona",
		// "sessions:turnOrder", "characters:list" and every
		// "sessionMessages:*" key are interests, declared above.
		// The `sessions:*` and `characters:list` keys are already held
		// (declared above, and effects run in declaration order); the typed
		// `emit` puts their sync ahead of this request group on the same
		// socket — plan ruling 3.
		socket.emit("characters:list", {})
		load()
	})
</script>

<svelte:head>
	<title>{session?.name || "Session"} — Document View — Serene Pub</title>
</svelte:head>

<h1>{session?.name || "Session"}</h1>
<p>
	<a href="/document-view/sessions">Back to Sessions</a>
	{#if session?.sessionMessages}
		· <a href="/document-view/sessions/{sessionId}/edit">Edit session</a>
	{/if}
</p>

{#if session?.sessionMessages?.length}
	<p>
		<a href="#a11y-latest-message">Skip to latest message</a>
		·
		<a href="#a11y-session-message">Skip to message box</a>
	</p>
{/if}

{#if !loaded}
	<p>Loading…</p>
{:else if notFound}
	<p>Session not found, or you don't have access to it.</p>
{:else if session}
	{#if error}
		<div class="a11y-status a11y-status-error" role="alert">
			<p class="a11y-error-text">{error}</p>
		</div>
	{/if}

	<div class="a11y-sr-only" role="status" aria-live="polite">
		{generatingStatus}
	</div>
	<div class="a11y-sr-only" role="status" aria-live="polite">
		{messageAnnouncement}
	</div>

	{#if pagination?.hasMore}
		<p>
			<button
				type="button"
				class="a11y-btn a11y-btn-small"
				onclick={loadEarlier}
				disabled={loadingOlder}
			>
				{loadingOlder ? "Loading…" : "Load earlier messages"}
			</button>
		</p>
	{/if}

	<ol class="a11y-list" aria-label="Session messages">
		{#each session.sessionMessages as msg, i (msg.id)}
			{@const isLast = i === session.sessionMessages.length - 1}
			{@const swipes = isLast && msg.characterId ? swipeInfo(msg) : null}
			<!-- `message-<id>`: what a `?message=<id>` link lands on (messageLanding.ts). -->
			<li class="a11y-list-item" id="message-{msg.id}" tabindex="-1">
				<h2>{speakerName(msg)}</h2>
				{#if msg.isHidden}
					<p class="a11y-hint">
						Hidden — excluded from what the AI sees, still visible
						here to you.
					</p>
				{/if}
				{#if msg.content}
					<p>{msg.content}</p>
				{/if}
				{#if attachmentsOf(msg).length}
					<!-- Attachments as links, never inline images: the AAA
					     promise (composer attachments §3.4). -->
					<ul aria-label="Attachments">
						{#each attachmentsOf(msg) as file (file.partId)}
							<li>
								<a href="/media/{file.assetId}?download=1" download={file.name ?? undefined}>
									{file.name ?? (file.kind === "image" ? "Image" : "File")}
								</a>
								<span class="a11y-hint">({file.kind})</span>
							</li>
						{/each}
					</ul>
				{/if}
				{#if msg.error}
					<div class="a11y-status a11y-status-error" role="alert">
						<p class="a11y-error-text">
							{msg.error.message}
							{#if msg.error.code}
								<span class="a11y-hint">
									({msg.error.code})
								</span>
							{/if}
						</p>
					</div>
				{/if}
				{#if swipes}
					<p class="a11y-hint">
						Response {swipes.current} of {swipes.total}
					</p>
				{/if}
				<div class="a11y-list-item-actions">
					{#if viewHref(msg)}
						<a
							href={viewHref(msg)}
							class="a11y-btn a11y-btn-secondary a11y-btn-small"
						>
							View {speakerName(msg)}
						</a>
					{/if}
					{#if isOwner && isLast && msg.characterId && !msg.isGenerating}
						<button
							type="button"
							class="a11y-btn a11y-btn-secondary a11y-btn-small"
							onclick={() => swipeLeft(msg.id)}
						>
							Swipe left (previous response)
						</button>
						<button
							type="button"
							class="a11y-btn a11y-btn-secondary a11y-btn-small"
							onclick={() => swipeRight(msg.id)}
						>
							Swipe right (next response)
						</button>
						<button
							type="button"
							class="a11y-btn a11y-btn-secondary a11y-btn-small"
							onclick={regenerateLast}
						>
							Regenerate
						</button>
					{/if}
					{#if isOwner}
						<button
							type="button"
							class="a11y-btn a11y-btn-secondary a11y-btn-small"
							onclick={() => toggleHidden(msg)}
						>
							{msg.isHidden ? "Unhide" : "Hide from AI"}
						</button>
						<button
							type="button"
							class="a11y-btn a11y-btn-danger a11y-btn-small"
							onclick={() => deleteMessage(msg.id)}
						>
							Delete
						</button>
					{/if}
				</div>
			</li>
		{/each}
		{#if session.sessionMessages.length === 0}
			<li>No messages yet — say something to get started.</li>
		{/if}
		<!-- A dedicated, stable target for "Skip to latest message" — kept
			outside the keyed {#each} above so it never inherits/loses id or
			tabindex as messages arrive (a target that hopped between whichever
			<li> happened to be last would drop focus back to <body> the instant
			a new message landed right as it was activated). Visible rather than
			sr-only so a sighted keyboard user isn't left looking at nothing —
			from here, Shift+Tab (or reading backwards) reaches the actual last
			message, same as "end of results" markers in search UIs. -->
		<li id="a11y-latest-message" tabindex="-1">
			You've reached the end of the conversation.
		</li>
	</ol>

	{#if generatingStatus}
		<div class="a11y-status" role="status">
			<p>{generatingStatus}</p>
			<button
				type="button"
				class="a11y-btn a11y-btn-danger a11y-btn-small"
				onclick={cancelGeneration}
			>
				Stop generating
			</button>
		</div>
	{/if}

	{#if showAddPersonaCTA}
		<div class="a11y-status">
			<p>
				You need a persona in this session before you can send messages.
			</p>
			<div class="a11y-inline-add">
				<select
					bind:value={addPersonaId}
					aria-label="Choose your persona to join with"
				>
					<option value="">Choose a persona…</option>
					{#each availableOwnPersonas as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
				<button
					type="button"
					class="a11y-btn a11y-btn-small"
					onclick={addOwnPersona}
					disabled={addPersonaId === ""}
				>
					Join session
				</button>
			</div>
		</div>
	{:else}
		{#if userPersonasInSession.length > 1}
			<div class="a11y-field">
				<label for="a11y-session-speaking-as">Speaking as</label>
				<select
					id="a11y-session-speaking-as"
					bind:value={selectedPersonaId}
				>
					{#each userPersonasInSession as cp (cp.personaId)}
						<option value={cp.personaId}>{cp.persona?.name}</option>
					{/each}
				</select>
			</div>
		{/if}
		<form
			onsubmit={(e) => {
				e.preventDefault()
				send()
			}}
		>
			<div class="a11y-field">
				<label for="a11y-session-message">Message</label>
				<p class="a11y-hint">
					Press Ctrl+Enter (or Cmd+Enter on Mac) to send.
				</p>
				<textarea
					id="a11y-session-message"
					bind:value={newMessage}
					disabled={!!generatingStatus}
					onkeydown={handleComposerKeydown}
				></textarea>
			</div>
			<button
				type="submit"
				class="a11y-btn"
				disabled={!newMessage.trim() || !!generatingStatus}
			>
				Send
			</button>
			<div class="a11y-field">
				<label for="a11y-session-fire-turn">
					Get a Response From
				</label>
				<p class="a11y-hint">
					{#if headName && !headIsPerson}
						Next in the turn order: {headName}. Pick someone else, or
						the narrator, to make them reply instead.
					{:else if headIsMine}
						It is your turn to write. Pick someone to reply instead.
					{:else if headName}
						It is {headName}'s turn to write. Pick someone to reply
						instead.
					{:else}
						Nothing is prepared yet. Pick someone to reply.
					{/if}
				</p>
				<div class="a11y-inline-add">
					<select
						id="a11y-session-fire-turn"
						bind:value={fireTurnFrom}
						disabled={!!generatingStatus}
					>
						<option value="">Choose…</option>
						{#if headName && !headIsPerson}
							<option value={HEAD}>Next: {headName}</option>
						{/if}
						<option value={NARRATOR}>The narrator</option>
						{#each (turnOrder?.candidates ?? []).filter((c) => c.kind !== "persona") as c (c.ref)}
							<option value={c.ref}>{c.nickname || c.name}</option>
						{/each}
					</select>
					<button
						type="button"
						class="a11y-btn a11y-btn-secondary a11y-btn-small"
						onclick={fireSelectedTurn}
						disabled={fireTurnFrom === "" ||
							!!generatingStatus}
					>
						Get response
					</button>
				</div>
			</div>
			{#if isOwner && session.sessionMessages.length > 0}
				<button
					type="button"
					class="a11y-btn a11y-btn-secondary"
					onclick={regenerateLast}
					disabled={!!generatingStatus}
				>
					Regenerate last response
				</button>
			{/if}
		</form>
	{/if}
{/if}
