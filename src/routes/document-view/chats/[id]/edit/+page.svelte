<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { announce } from "$lib/client/accessibility/state.svelte"
	import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"

	const socket = useTypedSocket()
	const chatId = $derived(Number(page.params.id))
	let userCtx: UserCtx = getContext("userCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let chat: Sockets.Chats.Get.Response["chat"] | undefined = $state()
	let loaded = $state(false)
	let notFound = $state(false)
	let error = $state("")
	let saving = $state(false)
	let deleting = $state(false)

	let name = $state("")
	let scenario = $state("")
	let groupReplyStrategy = $state(GroupReplyStrategies.ORDERED)
	let tags: string[] = $state([])
	let tagInput = $state("")

	let characters: Sockets.Characters.List.Response["characterList"] = $state(
		[]
	)
	let personas: Sockets.Personas.List.Response["personaList"] = $state([])
	let selectedCharacters: (Partial<SelectCharacter> & { id: number })[] =
		$state([])
	let selectedPersonas: (Partial<SelectPersona> & { id: number })[] = $state(
		[]
	)
	let addCharacterId: number | "" = $state("")
	let addPersonaId: number | "" = $state("")

	let allUsers: SelectUser[] = $state([])
	let addGuestId: number | "" = $state("")
	// systemSettingsCtx.settings is populated by AccessibleShell's own async
	// systemSettings:get round-trip, which can still be in flight when this
	// page mounts — a one-time onMount check of isAccountsEnabled can run
	// before that arrives and never emit users:list at all. Guarded $effect
	// instead, so it fires once as soon as the setting is actually known.
	let usersListRequested = $state(false)

	let isGuest = $derived(!!chat && chat.userId !== userCtx.user?.id)

	let availableCharacters = $derived(
		characters.filter((c) => !selectedCharacters.some((s) => s.id === c.id))
	)
	let availablePersonas = $derived(
		personas.filter((p) => !selectedPersonas.some((s) => s.id === p.id))
	)
	let availableGuestUsers = $derived(
		allUsers.filter(
			(u) =>
				u.id !== chat?.userId &&
				!(chat?.chatGuests || []).some((g) => g.userId === u.id)
		)
	)

	$effect(() => {
		if (
			!usersListRequested &&
			systemSettingsCtx.settings?.isAccountsEnabled
		) {
			usersListRequested = true
			socket.emit("users:list", {})
		}
	})

	function load() {
		loaded = false
		notFound = false
		socket.emit("chats:get", { id: chatId })
	}

	function addCharacter() {
		if (addCharacterId === "") return
		const found = characters.find((c) => c.id === addCharacterId)
		if (found?.id != null)
			selectedCharacters = [
				...selectedCharacters,
				{ ...found, id: found.id }
			]
		addCharacterId = ""
	}
	function removeCharacter(id: number) {
		selectedCharacters = selectedCharacters.filter((c) => c.id !== id)
	}
	function moveCharacter(index: number, delta: number) {
		const target = index + delta
		if (target < 0 || target >= selectedCharacters.length) return
		const next = selectedCharacters.slice()
		;[next[index], next[target]] = [next[target], next[index]]
		selectedCharacters = next
	}

	function addPersona() {
		if (addPersonaId === "") return
		const found = personas.find((p) => p.id === addPersonaId)
		if (found?.id != null)
			selectedPersonas = [...selectedPersonas, { ...found, id: found.id }]
		addPersonaId = ""
	}
	function removePersona(id: number) {
		selectedPersonas = selectedPersonas.filter((p) => p.id !== id)
	}
	function movePersona(index: number, delta: number) {
		const target = index + delta
		if (target < 0 || target >= selectedPersonas.length) return
		const next = selectedPersonas.slice()
		;[next[index], next[target]] = [next[target], next[index]]
		selectedPersonas = next
	}

	function addTag() {
		const trimmed = tagInput.trim()
		if (!trimmed || tags.includes(trimmed)) return
		tags = [...tags, trimmed]
		tagInput = ""
	}
	function removeTag(tag: string) {
		tags = tags.filter((t) => t !== tag)
	}

	function addGuest() {
		if (addGuestId === "") return
		socket.emit("chats:addGuest", { chatId, guestUserId: addGuestId })
		addGuestId = ""
	}
	function removeGuest(userId: number) {
		socket.emit("chats:removeGuest", { chatId, guestUserId: userId })
	}

	function submit(event: SubmitEvent) {
		event.preventDefault()
		error = ""
		if (!name.trim()) {
			error = "Chat name is required."
			announce(error)
			return
		}
		if (selectedCharacters.length === 0) {
			error = "Add at least one character."
			announce(error)
			return
		}
		if (selectedPersonas.length === 0) {
			error = "Add at least one persona."
			announce(error)
			return
		}
		saving = true
		socket.emit("chats:update", {
			chat: {
				id: chatId,
				name: name.trim(),
				scenario: scenario.trim(),
				groupReplyStrategy
			} as any,
			characterIds: selectedCharacters.map((c) => c.id),
			personaIds: selectedPersonas.map((p) => p.id),
			characterPositions: Object.fromEntries(
				selectedCharacters.map((c, i) => [c.id, i])
			),
			tags
		})
	}

	function deleteChat() {
		if (!confirm("Delete this chat? This cannot be undone.")) return
		deleting = true
		socket.emit("chats:delete", { id: chatId })
	}

	function applyChat(c: NonNullable<Sockets.Chats.Get.Response["chat"]>) {
		chat = c
		name = c.name || ""
		scenario = c.scenario || ""
		groupReplyStrategy =
			c.groupReplyStrategy || GroupReplyStrategies.ORDERED
		tags = c.tags || []
		selectedCharacters = (c.chatCharacters || []).map((cc) => cc.character)
		selectedPersonas = (c.chatPersonas || []).map((cp) => cp.persona)
	}

	function handleChatsGet(msg: Sockets.Chats.Get.Response) {
		loaded = true
		if (!msg.chat) {
			notFound = true
			return
		}
		applyChat(msg.chat)
	}
	function handleChatsUpdate(msg: any) {
		saving = false
		if (msg.chat) {
			applyChat({ ...chat!, ...msg.chat })
			announce("Chat saved.")
		}
	}
	function handleChatsUpdateError(msg: { error?: string }) {
		saving = false
		error = msg.error || "Failed to save chat."
		announce(error)
	}
	function handleChatsDelete() {
		goto("/document-view/chats")
	}
	function handleChatsDeleteError(msg: { error?: string }) {
		deleting = false
		error = msg.error || "Failed to delete chat."
		announce(error)
	}
	function handleChatsAddGuest() {
		load()
	}
	function handleChatsRemoveGuest() {
		load()
	}
	function handleCharactersList(msg: Sockets.Characters.List.Response) {
		characters = msg.characterList || []
	}
	function handlePersonasList(msg: Sockets.Personas.List.Response) {
		personas = msg.personaList || []
	}
	function handleUsersList(msg: any) {
		allUsers = msg.users || []
	}

	onMount(() => {
		socket.on("chats:get", handleChatsGet)
		socket.on("chats:update", handleChatsUpdate)
		socket.on("chats:update:error", handleChatsUpdateError)
		socket.on("chats:delete", handleChatsDelete)
		socket.on("chats:delete:error", handleChatsDeleteError)
		socket.on("chats:addGuest", handleChatsAddGuest)
		socket.on("chats:removeGuest", handleChatsRemoveGuest)
		socket.on("characters:list", handleCharactersList)
		socket.on("personas:list", handlePersonasList)
		socket.on("users:list", handleUsersList)
		socket.emit("characters:list", {})
		socket.emit("personas:list", {})
		load()
		return () => {
			socket.off("chats:get", handleChatsGet)
			socket.off("chats:update", handleChatsUpdate)
			socket.off("chats:update:error", handleChatsUpdateError)
			socket.off("chats:delete", handleChatsDelete)
			socket.off("chats:delete:error", handleChatsDeleteError)
			socket.off("chats:addGuest", handleChatsAddGuest)
			socket.off("chats:removeGuest", handleChatsRemoveGuest)
			socket.off("characters:list", handleCharactersList)
			socket.off("personas:list", handlePersonasList)
			socket.off("users:list", handleUsersList)
		}
	})
</script>

<svelte:head>
	<title>Edit Chat — Document View — Serene Pub</title>
</svelte:head>

<h1>Edit Chat</h1>
<p><a href="/document-view/chats">Back to Chats</a></p>

{#if !loaded}
	<p>Loading…</p>
{:else if notFound}
	<p>Chat not found, or you don't have access to it.</p>
{:else}
	{#if isGuest}
		<div class="a11y-status">
			<p>
				You're a guest in this chat. You can manage characters and
				personas below — chat name, scenario, tags, and reply strategy
				can only be changed by the chat owner.
			</p>
		</div>
	{/if}
	{#if error}
		<div class="a11y-status a11y-status-error" role="alert">
			<p class="a11y-error-text">{error}</p>
		</div>
	{/if}

	<form onsubmit={submit}>
		<div class="a11y-field">
			<label for="a11y-chat-name">Chat Name</label>
			<input
				id="a11y-chat-name"
				type="text"
				required
				bind:value={name}
				disabled={saving || isGuest}
			/>
		</div>

		<div class="a11y-field">
			<label for="a11y-chat-add-character">Characters</label>
			<div class="a11y-inline-add">
				<select
					id="a11y-chat-add-character"
					bind:value={addCharacterId}
					disabled={saving}
				>
					<option value="">Choose a character…</option>
					{#each availableCharacters as c (c.id)}
						<option value={c.id}>{c.nickname || c.name}</option>
					{/each}
				</select>
				<button
					type="button"
					class="a11y-btn a11y-btn-small"
					onclick={addCharacter}
					disabled={addCharacterId === ""}
				>
					Add
				</button>
			</div>
			{#if selectedCharacters.length > 0}
				<ol class="a11y-list">
					{#each selectedCharacters as c, i (c.id)}
						<li class="a11y-list-item">
							<span>{c.nickname || c.name}</span>
							<div class="a11y-list-item-actions">
								<button
									type="button"
									class="a11y-btn a11y-btn-small"
									onclick={() => moveCharacter(i, -1)}
									disabled={i === 0}
									aria-label="Move {c.name} up"
								>
									Move Up
								</button>
								<button
									type="button"
									class="a11y-btn a11y-btn-small"
									onclick={() => moveCharacter(i, 1)}
									disabled={i ===
										selectedCharacters.length - 1}
									aria-label="Move {c.name} down"
								>
									Move Down
								</button>
								<button
									type="button"
									class="a11y-btn a11y-btn-danger a11y-btn-small"
									onclick={() => removeCharacter(c.id)}
								>
									Remove
								</button>
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</div>

		<div class="a11y-field">
			<label for="a11y-chat-add-persona">Personas</label>
			<div class="a11y-inline-add">
				<select
					id="a11y-chat-add-persona"
					bind:value={addPersonaId}
					disabled={saving}
				>
					<option value="">Choose a persona…</option>
					{#each availablePersonas as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
				<button
					type="button"
					class="a11y-btn a11y-btn-small"
					onclick={addPersona}
					disabled={addPersonaId === ""}
				>
					Add
				</button>
			</div>
			{#if selectedPersonas.length > 0}
				<ol class="a11y-list">
					{#each selectedPersonas as p, i (p.id)}
						<li class="a11y-list-item">
							<span>{p.name}</span>
							<div class="a11y-list-item-actions">
								<button
									type="button"
									class="a11y-btn a11y-btn-small"
									onclick={() => movePersona(i, -1)}
									disabled={i === 0}
									aria-label="Move {p.name} up"
								>
									Move Up
								</button>
								<button
									type="button"
									class="a11y-btn a11y-btn-small"
									onclick={() => movePersona(i, 1)}
									disabled={i === selectedPersonas.length - 1}
									aria-label="Move {p.name} down"
								>
									Move Down
								</button>
								<button
									type="button"
									class="a11y-btn a11y-btn-danger a11y-btn-small"
									onclick={() => removePersona(p.id)}
								>
									Remove
								</button>
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</div>

		{#if systemSettingsCtx.settings?.isAccountsEnabled}
			<div class="a11y-field">
				<span>Guests</span>
				<p class="a11y-hint">
					Other users who can view and participate in this chat.
				</p>
				{#if !isGuest}
					<div class="a11y-inline-add">
						<select
							bind:value={addGuestId}
							aria-label="Choose a user to add as a guest"
						>
							<option value="">Choose a user…</option>
							{#each availableGuestUsers as u (u.id)}
								<option value={u.id}>
									{u.displayName || u.username}
								</option>
							{/each}
						</select>
						<button
							type="button"
							class="a11y-btn a11y-btn-small"
							onclick={addGuest}
							disabled={addGuestId === ""}
						>
							Add
						</button>
					</div>
				{/if}
				{#if (chat?.chatGuests || []).length > 0}
					<ul class="a11y-list">
						{#each chat!.chatGuests! as guest (guest.userId)}
							<li class="a11y-list-item">
								<span>
									{guest.user.displayName ||
										guest.user.username}
								</span>
								{#if !isGuest}
									<div class="a11y-list-item-actions">
										<button
											type="button"
											class="a11y-btn a11y-btn-danger a11y-btn-small"
											onclick={() =>
												removeGuest(guest.userId)}
										>
											Remove
										</button>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		{#if selectedCharacters.length > 1 || selectedPersonas.length > 1}
			<div class="a11y-field">
				<label for="a11y-chat-group-strategy">
					Group Reply Strategy
				</label>
				<select
					id="a11y-chat-group-strategy"
					bind:value={groupReplyStrategy}
					disabled={saving || isGuest}
				>
					{#each GroupReplyStrategies.options as opt}
						{#if opt.value !== GroupReplyStrategies.USER_SPLIT || systemSettingsCtx.settings?.isAccountsEnabled}
							<option value={opt.value}>{opt.label}</option>
						{/if}
					{/each}
				</select>
			</div>
		{/if}

		<div class="a11y-field">
			<label for="a11y-chat-scenario">Scenario</label>
			<textarea
				id="a11y-chat-scenario"
				bind:value={scenario}
				disabled={saving || isGuest}
			></textarea>
		</div>

		<div class="a11y-field">
			<label for="a11y-chat-tag-input">Tags</label>
			<div class="a11y-inline-add">
				<input
					id="a11y-chat-tag-input"
					type="text"
					bind:value={tagInput}
					disabled={saving || isGuest}
					onkeydown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault()
							addTag()
						}
					}}
				/>
				<button
					type="button"
					class="a11y-btn a11y-btn-small"
					onclick={addTag}
					disabled={!tagInput.trim() || isGuest}
				>
					Add
				</button>
			</div>
			{#if tags.length > 0}
				<ul class="a11y-list">
					{#each tags as tag}
						<li class="a11y-list-item">
							<span>{tag}</span>
							{#if !isGuest}
								<button
									type="button"
									class="a11y-btn a11y-btn-danger a11y-btn-small"
									onclick={() => removeTag(tag)}
								>
									Remove
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<button type="submit" class="a11y-btn" disabled={saving}>
			{saving ? "Saving…" : "Save Changes"}
		</button>
		{#if !isGuest}
			<button
				type="button"
				class="a11y-btn a11y-btn-danger"
				onclick={deleteChat}
				disabled={deleting}
			>
				{deleting ? "Deleting…" : "Delete Chat"}
			</button>
		{/if}
	</form>
{/if}
