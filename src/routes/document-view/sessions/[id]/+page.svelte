<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
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

	let personas: Sockets.Personas.List.Response["personaList"] = $state([])
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

	// Narrator/system messages aren't tied to any character or persona record,
	// so there's nothing to view for those — only character/persona messages
	// get a View link.
	function viewHref(msg: SelectSessionMessage): string | null {
		if (msg.characterId)
			return `/document-view/characters/${msg.characterId}/view`
		if (msg.personaId)
			return `/document-view/personas/${msg.personaId}/view`
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

	// Replaces a separate "Get Next Response" button, which asked the server
	// to work out whose turn it is via sessions:triggerGenerateMessage's
	// `triggered: true` path — that could quietly do nothing once a full
	// round had already completed, with no way to tell it happened and no
	// way to choose who goes instead. This single selector always shows a
	// live, real due-character (or Narrator) and always does something when
	// used: characterId + once:true forces exactly that responder right now,
	// regardless of turn order.
	let sessionResponseOrder:
		| Sockets.Sessions.GetResponseOrder.Response
		| undefined = $state()
	let triggerResponseFrom: number | "narrator" | "" = $state("")
	// Keep the selection tracking the live due-rotation rather than a
	// one-time default — sessionResponseOrder is re-queried after every message
	// (see onMount below), so this re-syncs each time whoever's actually due
	// next changes. A manual pick right before clicking "Get Response" still
	// works fine; it just resets on the next refresh, same as the response
	// order itself would have moved on anyway.
	$effect(() => {
		triggerResponseFrom = sessionResponseOrder?.nextCharacterId ?? ""
	})
	function triggerSelectedResponse() {
		if (triggerResponseFrom === "") return
		if (triggerResponseFrom === "narrator") {
			socket.emit("sessions:triggerNarratorResponse", { sessionId })
			return
		}
		socket.emit("sessions:triggerGenerateMessage", {
			sessionId,
			characterId: triggerResponseFrom,
			once: true
		})
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
		socket.emit("sessions:getResponseOrder", { sessionId })
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
		socket.emit("sessions:getResponseOrder", { sessionId })
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
			socket.emit("sessions:getResponseOrder", { sessionId })
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
			socket.emit("sessions:getResponseOrder", { sessionId })
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
	function handlePersonasList(msg: Sockets.Personas.List.Response) {
		personas = msg.personaList || []
	}
	function handleSessionsGetResponseOrder(
		msg: Sockets.Sessions.GetResponseOrder.Response
	) {
		if (msg.sessionId === sessionId) sessionResponseOrder = msg
	}

	onMount(() => {
		socket.on("sessions:get", handleSessionsGet)
		socket.on("sessionMessage", handleSessionMessage)
		socket.on("sessionMessages:delete", handleSessionMessagesDelete)
		socket.on("sessionMessages:update", handleSessionMessagesUpdate)
		socket.on("sessionMessages:swipeLeft", handleSessionMessagesSwipeLeft)
		socket.on("sessionMessages:swipeRight", handleSessionMessagesSwipeRight)
		socket.on("sessionMessages:cancel", handleSessionMessagesCancel)
		socket.on("sessions:addPersona", handleSessionsAddPersona)
		socket.on("personas:list", handlePersonasList)
		socket.on("sessions:getResponseOrder", handleSessionsGetResponseOrder)
		socket.emit("personas:list", {})
		socket.emit("sessions:getResponseOrder", { sessionId })
		load()
		return () => {
			socket.off("sessions:get", handleSessionsGet)
			socket.off("sessionMessage", handleSessionMessage)
			socket.off("sessionMessages:delete", handleSessionMessagesDelete)
			socket.off("sessionMessages:update", handleSessionMessagesUpdate)
			socket.off(
				"sessionMessages:swipeLeft",
				handleSessionMessagesSwipeLeft
			)
			socket.off(
				"sessionMessages:swipeRight",
				handleSessionMessagesSwipeRight
			)
			socket.off("sessionMessages:cancel", handleSessionMessagesCancel)
			socket.off("sessions:addPersona", handleSessionsAddPersona)
			socket.off("personas:list", handlePersonasList)
			socket.off(
				"sessions:getResponseOrder",
				handleSessionsGetResponseOrder
			)
		}
	})
</script>

<svelte:head>
	<title>{session?.name || "Session"} — Document View — Serene Pub</title>
</svelte:head>

<h1>{session?.name || "Session"}</h1>
<p>
	<a href="/document-view/sessions">Back to Sessions</a>
	{#if session?.sessionMessages}
		· <a href="/document-view/sessions/{sessionId}/edit">Edit Session</a>
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
				{loadingOlder ? "Loading…" : "Load Earlier Messages"}
			</button>
		</p>
	{/if}

	<ol class="a11y-list" aria-label="Session messages">
		{#each session.sessionMessages as msg, i (msg.id)}
			{@const isLast = i === session.sessionMessages.length - 1}
			{@const swipes = isLast && msg.characterId ? swipeInfo(msg) : null}
			<li class="a11y-list-item">
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
							Swipe Left (Previous Response)
						</button>
						<button
							type="button"
							class="a11y-btn a11y-btn-secondary a11y-btn-small"
							onclick={() => swipeRight(msg.id)}
						>
							Swipe Right (Next Response)
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
				Stop Generating
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
					Join Session
				</button>
			</div>
		</div>
	{:else}
		{#if userPersonasInSession.length > 1}
			<div class="a11y-field">
				<label for="a11y-session-speaking-as">Speaking As</label>
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
				<label for="a11y-session-trigger-character">
					Get a Response From
				</label>
				<p class="a11y-hint">
					Defaults to whoever's due next in the turn order. Pick a
					different character, or Narrator, to make them reply
					instead.
				</p>
				<div class="a11y-inline-add">
					<select
						id="a11y-session-trigger-character"
						bind:value={triggerResponseFrom}
						disabled={!!generatingStatus}
					>
						<option value="">Choose…</option>
						<option value="narrator">Narrator</option>
						{#each session.sessionCharacters as cc (cc.characterId)}
							<option value={cc.characterId}>
								{cc.character?.nickname || cc.character?.name}
							</option>
						{/each}
					</select>
					<button
						type="button"
						class="a11y-btn a11y-btn-secondary a11y-btn-small"
						onclick={triggerSelectedResponse}
						disabled={triggerResponseFrom === "" ||
							!!generatingStatus}
					>
						Get Response
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
					Regenerate Last Response
				</button>
			{/if}
		</form>
	{/if}
{/if}
