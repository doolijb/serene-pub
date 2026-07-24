<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { announce } from "$lib/client/accessibility/state.svelte"

	const PAGE_SIZE = 25

	const socket = useTypedSocket()
	const chatId = $derived(Number(page.params.id))
	let userCtx: UserCtx = getContext("userCtx")

	let chat: Sockets.Chats.Get.Response["chat"] | undefined = $state()
	let pagination: Sockets.Chats.Get.Response["pagination"] | undefined =
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

	let isGuest = $derived(!!chat && chat.userId !== userCtx.user?.id)
	let isOwner = $derived(!!chat && chat.userId === userCtx.user?.id)

	let userPersonasInChat = $derived(
		(chat?.chatPersonas || []).filter(
			(cp) => cp.persona?.userId === userCtx.user?.id
		)
	)
	let selectedPersonaId: number | null = $state(null)
	let currentUserPersona = $derived.by(() => {
		if (!userPersonasInChat.length) return undefined
		if (selectedPersonaId) {
			const found = userPersonasInChat.find(
				(cp) => cp.personaId === selectedPersonaId
			)
			if (found) return found
		}
		return userPersonasInChat[0]
	})
	let showAddPersonaCTA = $derived(isGuest && userPersonasInChat.length === 0)
	let availableOwnPersonas = $derived(
		personas.filter(
			(p) =>
				!(chat?.chatPersonas || []).some((cp) => cp.personaId === p.id)
		)
	)

	function speakerName(msg: SelectChatMessage): string {
		if (msg.isNarratorResponse) return "Narrator"
		if (msg.characterId) {
			const cc = chat?.chatCharacters?.find(
				(c) => c.characterId === msg.characterId
			)
			return cc?.character?.nickname || cc?.character?.name || "Character"
		}
		if (msg.personaId) {
			const cp = chat?.chatPersonas?.find(
				(p) => p.personaId === msg.personaId
			)
			return cp?.persona?.name || "You"
		}
		return msg.role === "system" ? "System" : "Unknown"
	}

	// Narrator/system messages aren't tied to any character or persona record,
	// so there's nothing to view for those — only character/persona messages
	// get a View link.
	function viewHref(msg: SelectChatMessage): string | null {
		if (msg.characterId)
			return `/document-view/characters/${msg.characterId}/view`
		if (msg.personaId)
			return `/document-view/personas/${msg.personaId}/view`
		return null
	}

	function swipeInfo(
		msg: SelectChatMessage
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
		socket.emit("chats:get", { id: chatId, limit: PAGE_SIZE, beforeId })
	}

	function loadEarlier() {
		if (!chat?.chatMessages?.length) return
		const oldestId = chat.chatMessages[0].id
		load(oldestId)
	}

	function send() {
		if (!newMessage.trim()) return
		const personaId =
			currentUserPersona?.personaId || chat?.chatPersonas?.[0]?.personaId
		if (!personaId) {
			error = "No persona selected for this chat."
			announce(error)
			return
		}
		error = ""
		socket.emit("chatMessages:sendPersonaMessage", {
			chatId,
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
	// to work out whose turn it is via chats:triggerGenerateMessage's
	// `triggered: true` path — that could quietly do nothing once a full
	// round had already completed, with no way to tell it happened and no
	// way to choose who goes instead. This single selector always shows a
	// live, real due-character (or Narrator) and always does something when
	// used: characterId + once:true forces exactly that responder right now,
	// regardless of turn order.
	let chatResponseOrder: Sockets.Chats.GetResponseOrder.Response | undefined =
		$state()
	let triggerResponseFrom: number | "narrator" | "" = $state("")
	// Keep the selection tracking the live due-rotation rather than a
	// one-time default — chatResponseOrder is re-queried after every message
	// (see onMount below), so this re-syncs each time whoever's actually due
	// next changes. A manual pick right before clicking "Get Response" still
	// works fine; it just resets on the next refresh, same as the response
	// order itself would have moved on anyway.
	$effect(() => {
		triggerResponseFrom = chatResponseOrder?.nextCharacterId ?? ""
	})
	function triggerSelectedResponse() {
		if (triggerResponseFrom === "") return
		if (triggerResponseFrom === "narrator") {
			socket.emit("chats:triggerNarratorResponse", { chatId })
			return
		}
		socket.emit("chats:triggerGenerateMessage", {
			chatId,
			characterId: triggerResponseFrom,
			once: true
		})
	}

	function cancelGeneration() {
		if (generatingMessageId == null) return
		socket.emit("chatMessages:cancel", { chatId, id: generatingMessageId })
	}

	function regenerateLast() {
		const last = chat?.chatMessages?.[chat.chatMessages.length - 1]
		if (last && !last.isGenerating)
			socket.emit("chatMessages:regenerate", { id: last.id })
	}

	function swipeLeft(id: number) {
		socket.emit("chatMessages:swipeLeft", { id })
	}

	function swipeRight(id: number) {
		socket.emit("chatMessages:swipeRight", { id })
	}

	function deleteMessage(id: number) {
		if (!confirm("Delete this message? This cannot be undone.")) return
		socket.emit("chatMessages:delete", { id })
	}

	// "Hidden" excludes a message from what's sent to the AI as context while
	// leaving it visible in the transcript here — a way to walk back
	// something from the story without deleting the record of it.
	function toggleHidden(msg: SelectChatMessage) {
		socket.emit("chatMessages:update", {
			id: msg.id,
			isHidden: !msg.isHidden
		})
	}

	function addOwnPersona() {
		if (addPersonaId === "") return
		socket.emit("chats:addPersona", { chatId, personaId: addPersonaId })
		addPersonaId = ""
	}

	function upsertMessage(m: SelectChatMessage) {
		if (!chat) return
		const existingIndex = chat.chatMessages.findIndex((c) => c.id === m.id)
		let next: SelectChatMessage[]
		if (existingIndex !== -1) {
			next = [...chat.chatMessages]
			next[existingIndex] = m
		} else {
			next = [...chat.chatMessages, m]
		}
		chat = { ...chat, chatMessages: next.sort((a, b) => a.id - b.id) }
	}

	onMount(() => {
		socket.on("chats:get", (msg) => {
			if (msg.chat === null) {
				loaded = true
				notFound = true
				return
			}
			if (msg.chat?.id !== chatId) return
			if (loadingOlder && msg.beforeId != null && chat) {
				const existingIds = new Set(chat.chatMessages.map((m) => m.id))
				const older = msg.chat.chatMessages.filter(
					(m) => !existingIds.has(m.id)
				)
				chat = {
					...chat,
					chatMessages: [...older, ...chat.chatMessages].sort(
						(a, b) => a.id - b.id
					)
				}
				loadingOlder = false
			} else {
				chat = {
					...msg.chat,
					chatMessages: [...msg.chat.chatMessages].sort(
						(a, b) => a.id - b.id
					)
				}
				loaded = true
			}
			pagination = msg.pagination
		})
		socket.on("chatMessage", (msg: Sockets.ChatMessage.Response) => {
			if (!msg.chatMessage || msg.chatMessage.chatId !== chatId) return
			const m = msg.chatMessage
			if (m.isGenerating) {
				generatingMessageId = m.id
				generatingStatus = `Generating a response as ${speakerName(m)}…`
				return
			}
			generatingMessageId = null
			generatingStatus = ""
			if (m.error) {
				error = m.error.message || "Generation failed."
				announce(error)
				return
			}
			error = ""
			upsertMessage(m)
			messageAnnouncement = `${speakerName(m)} replied.`
			socket.emit("chats:getResponseOrder", { chatId })
		})
		socket.on(
			"chatMessages:delete",
			(msg: Sockets.ChatMessages.Delete.Response) => {
				if (!chat) return
				error = ""
				chat = {
					...chat,
					chatMessages: chat.chatMessages.filter(
						(m) => m.id !== msg.id
					)
				}
				socket.emit("chats:getResponseOrder", { chatId })
			}
		)
		socket.on(
			"chatMessages:update",
			(msg: Sockets.ChatMessages.Update.Response) => {
				if (msg.error) {
					error = msg.error
					announce(error)
					return
				}
				if (msg.chatMessage) {
					error = ""
					upsertMessage(msg.chatMessage)
					announce(
						msg.chatMessage.isHidden
							? "Message hidden from AI."
							: "Message unhidden."
					)
				}
			}
		)
		socket.on(
			"chatMessages:swipeLeft",
			(msg: Sockets.ChatMessages.SwipeLeft.Response) => {
				if (msg.error) {
					error = msg.error
					announce(error)
					return
				}
				if (msg.chatMessage) {
					error = ""
					upsertMessage(msg.chatMessage)
					socket.emit("chats:getResponseOrder", { chatId })
				}
			}
		)
		socket.on(
			"chatMessages:swipeRight",
			(msg: Sockets.ChatMessages.SwipeRight.Response) => {
				if (msg.error) {
					error = msg.error
					announce(error)
					return
				}
				if (msg.chatMessage) {
					error = ""
					upsertMessage(msg.chatMessage)
					socket.emit("chats:getResponseOrder", { chatId })
				}
			}
		)
		socket.on("chatMessages:cancel", () => {
			generatingMessageId = null
			generatingStatus = ""
		})
		socket.on(
			"chats:addPersona",
			(msg: Sockets.Chats.AddPersona.Response) => {
				if (msg.error) {
					error = msg.error
					announce(error)
					return
				}
				error = ""
				load()
			}
		)
		socket.on("personas:list", (msg) => {
			personas = msg.personaList || []
		})
		socket.on(
			"chats:getResponseOrder",
			(msg: Sockets.Chats.GetResponseOrder.Response) => {
				if (msg.chatId === chatId) chatResponseOrder = msg
			}
		)
		socket.emit("personas:list", {})
		socket.emit("chats:getResponseOrder", { chatId })
		load()
		return () => {
			socket.off("chats:get")
			socket.off("chatMessage")
			socket.off("chatMessages:delete")
			socket.off("chatMessages:update")
			socket.off("chatMessages:swipeLeft")
			socket.off("chatMessages:swipeRight")
			socket.off("chatMessages:cancel")
			socket.off("chats:addPersona")
			socket.off("personas:list")
			socket.off("chats:getResponseOrder")
		}
	})
</script>

<svelte:head>
	<title>{chat?.name || "Chat"} — Document View — Serene Pub</title>
</svelte:head>

<h1>{chat?.name || "Chat"}</h1>
<p>
	<a href="/document-view/chats">Back to Chats</a>
	{#if chat?.chatMessages}
		· <a href="/document-view/chats/{chatId}/edit">Edit Chat</a>
	{/if}
</p>

{#if chat?.chatMessages?.length}
	<p>
		<a href="#a11y-latest-message">Skip to latest message</a>
		·
		<a href="#a11y-chat-message">Skip to message box</a>
	</p>
{/if}

{#if !loaded}
	<p>Loading…</p>
{:else if notFound}
	<p>Chat not found, or you don't have access to it.</p>
{:else if chat}
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

	<ol class="a11y-list" aria-label="Chat messages">
		{#each chat.chatMessages as msg, i (msg.id)}
			{@const isLast = i === chat.chatMessages.length - 1}
			{@const swipes = isLast && msg.characterId ? swipeInfo(msg) : null}
			<li class="a11y-list-item">
				<h2>{speakerName(msg)}</h2>
				{#if msg.isHidden}
					<p class="a11y-hint">
						Hidden — excluded from what the AI sees, still visible
						here to you.
					</p>
				{/if}
				<p>{msg.content}</p>
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
		{#if chat.chatMessages.length === 0}
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
			<p>You need a persona in this chat before you can send messages.</p>
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
					Join Chat
				</button>
			</div>
		</div>
	{:else}
		{#if userPersonasInChat.length > 1}
			<div class="a11y-field">
				<label for="a11y-chat-speaking-as">Speaking As</label>
				<select
					id="a11y-chat-speaking-as"
					bind:value={selectedPersonaId}
				>
					{#each userPersonasInChat as cp (cp.personaId)}
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
				<label for="a11y-chat-message">Message</label>
				<p class="a11y-hint">
					Press Ctrl+Enter (or Cmd+Enter on Mac) to send.
				</p>
				<textarea
					id="a11y-chat-message"
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
				<label for="a11y-chat-trigger-character">
					Get a Response From
				</label>
				<p class="a11y-hint">
					Defaults to whoever's due next in the turn order. Pick a
					different character, or Narrator, to make them reply
					instead.
				</p>
				<div class="a11y-inline-add">
					<select
						id="a11y-chat-trigger-character"
						bind:value={triggerResponseFrom}
						disabled={!!generatingStatus}
					>
						<option value="">Choose…</option>
						<option value="narrator">Narrator</option>
						{#each chat.chatCharacters as cc (cc.characterId)}
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
			{#if isOwner && chat.chatMessages.length > 0}
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
