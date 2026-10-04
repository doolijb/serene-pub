<script lang="ts">
	import { onMount, getContext } from "svelte"
	import PipelineCards from "$lib/client/components/sessionForms/PipelineCards.svelte"
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { announce } from "$lib/client/accessibility/state.svelte"
	import { changedGenreFields } from "$lib/client/components/sessionForms/genreFieldsPatch"

	const socket = useTypedSocket()
	const sessionId = $derived(Number(page.params.id))
	let userCtx: UserCtx = getContext("userCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let session: Sockets.Sessions.Get.Response["session"] | undefined = $state()
	let loaded = $state(false)
	let notFound = $state(false)
	let error = $state("")
	let saving = $state(false)
	let deleting = $state(false)

	let name = $state("")
	let scenario = $state("")
	// Turn order (19 §5): the strategies this session's genre offers and the
	// session's rebound choice; "" inherits the reply pipeline's own pin.
	// Applied on Save through its own event, beside the row update.
	let tags: string[] = $state([])
	/**
	 * The genre's declared fields (§4.11) — auto-advance, turn mode — and
	 * the session's values for them, stored in `genre_fields`. Rendered as
	 * plain controls by field type; nothing undeclared is shown or saved.
	 */
	type FieldDecl = {
		type: string
		label?: unknown
		description?: unknown
		of?: string[]
		/** Labelled choices; `of` derives from their keys. */
		members?: Array<{ key: string; label?: unknown }>
		default?: unknown
	}
	const choicesOf = (d: FieldDecl) =>
		d.members?.length
			? d.members.map((m) => ({ value: m.key, label: textOf(m.label) || m.key }))
			: (d.of ?? []).map((o) => ({ value: o, label: o }))
	let genres: Sockets.Sessions.Genres.Response["genres"] = $state([])
	let genreFields: Record<string, unknown> = $state({})
	/** The genre fields as loaded: Save sends only those changed since (2026-10-03). */
	let loadedGenreFields: Record<string, unknown> = {}
	const fieldDecls = $derived(
		((genres.find((g: any) => g.genreId === (session as any)?.genreId) as any)?.shape
			?.fields ?? {}) as Record<string, FieldDecl>
	)
	const textOf = (v: unknown): string =>
		typeof v === "string"
			? v
			: v && typeof v === "object" && typeof (v as any).en === "string"
				? (v as any).en
				: ""
	const fieldValue = (key: string, d: FieldDecl) =>
		genreFields[key] !== undefined ? genreFields[key] : d.default
	let tagInput = $state("")

	let characters: Sockets.Characters.List.Response["characterList"] = $state(
		[]
	)
	/** A persona is a character the user voices — one list, narrowed below. */
	let personas = $derived(characters.filter((c) => c.isPersona))
	let selectedCharacters: (Partial<SelectCharacter> & { id: number })[] =
		$state([])
	let selectedPersonas: (Partial<SelectCharacter> & { id: number })[] =
		$state([])
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

	let isGuest = $derived(!!session && session.userId !== userCtx.user?.id)

	let availableCharacters = $derived(
		characters.filter((c) => !selectedCharacters.some((s) => s.id === c.id))
	)
	let availablePersonas = $derived(
		personas.filter((p) => !selectedPersonas.some((s) => s.id === p.id))
	)
	let availableGuestUsers = $derived(
		allUsers.filter(
			(u) =>
				u.id !== session?.userId &&
				!(session?.sessionGuests || []).some((g) => g.userId === u.id)
		)
	)

	/**
	 * The roster the guest picker offers. BARE — `users:list` has no
	 * `SCOPED_EVENTS` entry — and STANDING, because the server re-emits it
	 * after every account write.
	 *
	 * Declared HERE rather than beside the other keys below so it is held
	 * before the guarded request underneath it goes out: Svelte runs user
	 * effects in creation order, and that one can emit in the very first flush
	 * when the settings round-trip has already landed.
	 */
	useInterest<"users:list">("users:list", handleUsersList)

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
		socket.emit("sessions:get", { id: sessionId })
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
		socket.emit("sessions:addGuest", { sessionId, guestUserId: addGuestId })
		addGuestId = ""
	}
	function removeGuest(userId: number) {
		socket.emit("sessions:removeGuest", { sessionId, guestUserId: userId })
	}

	function submit(event: SubmitEvent) {
		event.preventDefault()
		error = ""
		if (!name.trim()) {
			error = "Session name is required."
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
		socket.emit("sessions:update", {
			session: {
				id: sessionId,
				name: name.trim(),
				scenario: scenario.trim(),
				// Only the fields changed here: the server merges them over
				// what is stored, so a note saved from the widget meanwhile
				// is not put back (2026-10-03).
				genreFields: changedGenreFields(
					$state.snapshot(genreFields),
					loadedGenreFields,
					Object.keys(fieldDecls)
				)
			} as any,
			characterIds: selectedCharacters.map((c) => c.id),
			personaIds: selectedPersonas.map((p) => p.id),
			characterPositions: Object.fromEntries(
				selectedCharacters.map((c, i) => [c.id, i])
			),
			tags
		})
	}

	function deleteSession() {
		if (!confirm("Delete this session? This cannot be undone.")) return
		deleting = true
		socket.emit("sessions:delete", { id: sessionId })
	}

	function applySession(
		c: NonNullable<Sockets.Sessions.Get.Response["session"]>
	) {
		session = c
		name = c.name || ""
		scenario = c.scenario || ""
		tags = c.tags || []
		selectedCharacters = (c.sessionCharacters || []).map(
			(cc) => cc.character
		)
		selectedPersonas = (c.sessionPersonas || []).map((cp) => cp.persona)
		genreFields = { ...(((c as any).genreFields ?? {}) as Record<string, unknown>) }
		loadedGenreFields = JSON.parse(JSON.stringify(genreFields))
	}
	$effect(() =>
		requestWithInterest("sessions:genres", {}, (res: Sockets.Sessions.Genres.Response) => {
			genres = res.genres ?? []
		})
	)

	function handleSessionsGet(msg: Sockets.Sessions.Get.Response) {
		loaded = true
		if (!msg.session) {
			notFound = true
			return
		}
		applySession(msg.session)
	}
	function handleSessionsUpdate(msg: any) {
		saving = false
		if (msg.session) {
			applySession({ ...session!, ...msg.session })
			announce("Session saved.")
		}
	}
	function handleSessionsUpdateError(msg: { error?: string }) {
		saving = false
		error = msg.error || "Failed to save session."
		announce(error)
	}
	function handleSessionsDelete() {
		goto("/document-view/sessions")
	}
	function handleSessionsDeleteError(msg: { error?: string }) {
		deleting = false
		error = msg.error || "Failed to delete session."
		announce(error)
	}
	function handleSessionsAddGuest() {
		load()
	}
	function handleSessionsRemoveGuest() {
		load()
	}
	function handleCharactersList(msg: Sockets.Characters.List.Response) {
		characters = msg.characterList || []
	}
	function handleUsersList(msg: any) {
		allUsers = msg.users || []
	}

	/**
	 * This session's own `sessions:get`, SCOPED to the id in the route: the
	 * reply to `load()` and to the re-reads the guest handlers ask for. An
	 * effect rather than `useInterest` because the key moves with the route.
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
	 * The rest, all BARE: no `SCOPED_EVENTS` entry, so a `#<id>` key would match
	 * no payload at all. The two `:error` events are never gated (plan ruling 2)
	 * but the registry is still the only listener path.
	 */
	useInterest<"sessions:update">("sessions:update", handleSessionsUpdate)
	useInterest<"sessions:update:error">(
		"sessions:update:error",
		handleSessionsUpdateError
	)
	useInterest<"sessions:delete">("sessions:delete", handleSessionsDelete)
	useInterest<"sessions:delete:error">(
		"sessions:delete:error",
		handleSessionsDeleteError
	)
	useInterest<"sessions:addGuest">(
		"sessions:addGuest",
		handleSessionsAddGuest
	)
	useInterest<"sessions:removeGuest">(
		"sessions:removeGuest",
		handleSessionsRemoveGuest
	)


	/**
	 * Both cast pickers, off ONE list: a persona is a character carrying
	 * `isPersona`. BARE — this is the user's whole list, with no one character
	 * to scope it to — and STANDING, because the server re-emits it as a
	 * cascade after any cast write and this form should offer the new row.
	 */
	$effect(() =>
		requestWithInterest("characters:list", {}, handleCharactersList)
	)

	onMount(() => {
		// Every listener on this page is an interest, declared above.
		// The `sessions:get` key is already held; the typed `emit` inside
		// `load()` puts its sync ahead of that request on the same socket
		// (ruling 3).
		load()
	})
</script>

<svelte:head>
	<title>Edit session — Document View — Serene Pub</title>
</svelte:head>

<h1>Edit session</h1>
<p><a href="/document-view/sessions">Back to Sessions</a></p>

{#if !loaded}
	<p>Loading…</p>
{:else if notFound}
	<p>Session not found, or you don't have access to it.</p>
{:else}
	{#if isGuest}
		<div class="a11y-status">
			<p>
				You're a guest in this session. You can manage characters and
				personas below — session name, scenario, tags, and reply
				strategy can only be changed by the session owner.
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
			<label for="a11y-session-name">Session name</label>
			<input
				id="a11y-session-name"
				type="text"
				required
				bind:value={name}
				disabled={saving || isGuest}
			/>
		</div>

		<div class="a11y-field">
			<label for="a11y-session-add-character">Characters</label>
			<div class="a11y-inline-add">
				<select
					id="a11y-session-add-character"
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
									Move up
								</button>
								<button
									type="button"
									class="a11y-btn a11y-btn-small"
									onclick={() => moveCharacter(i, 1)}
									disabled={i ===
										selectedCharacters.length - 1}
									aria-label="Move {c.name} down"
								>
									Move down
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
			<label for="a11y-session-add-persona">Personas</label>
			<div class="a11y-inline-add">
				<select
					id="a11y-session-add-persona"
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
									Move up
								</button>
								<button
									type="button"
									class="a11y-btn a11y-btn-small"
									onclick={() => movePersona(i, 1)}
									disabled={i === selectedPersonas.length - 1}
									aria-label="Move {p.name} down"
								>
									Move down
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
					Other users who can view and participate in this session.
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
				{#if (session?.sessionGuests || []).length > 0}
					<ul class="a11y-list">
						{#each session!.sessionGuests! as guest (guest.userId)}
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

		<!-- Pipeline cards (PLAN-turn-order §4.11): the turn order's
		     strategy and every other node the session's pipelines expose,
		     each applied on its own. -->
		{#if Number.isFinite(sessionId)}
			<PipelineCards {sessionId} canEdit={!isGuest} variant="document" />
		{/if}

		{#each Object.entries(fieldDecls) as [key, d] (key)}
			{@const id = `a11y-genre-field-${key}`}
			<div class="a11y-field">
				{#if d.type === "boolean"}
					<label for={id}>
						<input
							{id}
							type="checkbox"
							checked={!!fieldValue(key, d)}
							disabled={saving || isGuest}
							onchange={(e) => (genreFields[key] = e.currentTarget.checked)}
						/>
						{textOf(d.label) || key}
					</label>
				{:else}
					<label for={id}>{textOf(d.label) || key}</label>
					{#if d.type === "enum"}
						<select
							{id}
							value={String(fieldValue(key, d) ?? "")}
							disabled={saving || isGuest}
							onchange={(e) => (genreFields[key] = e.currentTarget.value)}
						>
							{#each choicesOf(d) as c (c.value)}
								<option value={c.value}>{c.label}</option>
							{/each}
						</select>
					{:else if d.type === "number" || d.type === "integer"}
						<input
							{id}
							type="number"
							value={fieldValue(key, d) as number}
							disabled={saving || isGuest}
							onchange={(e) => (genreFields[key] = Number(e.currentTarget.value))}
						/>
					{:else}
						<input
							{id}
							type="text"
							value={String(fieldValue(key, d) ?? "")}
							disabled={saving || isGuest}
							onchange={(e) => (genreFields[key] = e.currentTarget.value)}
						/>
					{/if}
				{/if}
				{#if textOf(d.description)}
					<p class="a11y-hint">{textOf(d.description)}</p>
				{/if}
			</div>
		{/each}

		<div class="a11y-field">
			<label for="a11y-session-scenario">Scenario</label>
			<textarea
				id="a11y-session-scenario"
				bind:value={scenario}
				disabled={saving || isGuest}
			></textarea>
		</div>

		<div class="a11y-field">
			<label for="a11y-session-tag-input">Tags</label>
			<div class="a11y-inline-add">
				<input
					id="a11y-session-tag-input"
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
			{saving ? "Saving…" : "Save changes"}
		</button>
		{#if !isGuest}
			<button
				type="button"
				class="a11y-btn a11y-btn-danger"
				onclick={deleteSession}
				disabled={deleting}
			>
				{deleting ? "Deleting…" : "Delete session"}
			</button>
		{/if}
	</form>
{/if}
