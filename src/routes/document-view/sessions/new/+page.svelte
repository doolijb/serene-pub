<script lang="ts">
	import { getContext } from "svelte"
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import { announce } from "$lib/client/accessibility/state.svelte"
	import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"

	const socket = useTypedSocket()
	const interest = getInterestContext()
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let name = $state("")
	let scenario = $state("")
	let groupReplyStrategy = $state(GroupReplyStrategies.ORDERED)
	let error = $state("")
	let saving = $state(false)

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
	let tagInput = $state("")
	let tags: string[] = $state([])

	let availableCharacters = $derived(
		characters.filter((c) => !selectedCharacters.some((s) => s.id === c.id))
	)
	let availablePersonas = $derived(
		personas.filter((p) => !selectedPersonas.some((s) => s.id === p.id))
	)

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
		socket.emit("sessions:create", {
			session: {
				name: name.trim(),
				scenario: scenario.trim(),
				groupReplyStrategy,
				lorebookId: null,
				samplingConfigId: null,
				promptConfigId: null,
				narratorPromptConfigId: null
			} as any,
			characterIds: selectedCharacters.map((c) => c.id),
			personaIds: selectedPersonas.map((p) => p.id),
			characterPositions: Object.fromEntries(
				selectedCharacters.map((c, i) => [c.id, i])
			),
			tags
		})
	}

	function handleCharactersList(msg: Sockets.Characters.List.Response) {
		characters = msg.characterList || []
		const preselectId = Number(page.url.searchParams.get("characterId"))
		if (preselectId) {
			const found = characters.find((c) => c.id === preselectId)
			if (
				found?.id != null &&
				!selectedCharacters.some((s) => s.id === found.id)
			) {
				selectedCharacters = [
					...selectedCharacters,
					{ ...found, id: found.id }
				]
			}
		}
	}
	function handleSessionsCreate(msg: any) {
		saving = false
		if (msg.session) goto(`/document-view/sessions/${msg.session.id}`)
	}
	function handleSessionsCreateError(msg: { error?: string }) {
		saving = false
		error = msg.error || "Failed to create session."
	}

	/**
	 * The create reply and its refusal, both BARE: the session the form is
	 * about does not exist yet, so there is no id to scope either to. The
	 * request is sent from the submit handler above.
	 */
	interest.useInterest<"sessions:create">(
		"sessions:create",
		handleSessionsCreate
	)
	interest.useInterest<"sessions:create:error">(
		"sessions:create:error",
		handleSessionsCreateError
	)

	/**
	 * Both participant pickers, off ONE list: a persona is a character
	 * carrying `isPersona`. BARE — this is the user's whole cast list — and
	 * STANDING, because the server re-emits it as a cascade after any
	 * character write.
	 */
	$effect(() =>
		interest.requestWithInterest(
			"characters:list",
			{},
			handleCharactersList
		)
	)
</script>

<svelte:head>
	<title>New Session — Document View — Serene Pub</title>
</svelte:head>

<h1>New Session</h1>
<p><a href="/document-view/sessions">Back to Sessions</a></p>

{#if error}
	<div class="a11y-status a11y-status-error" role="alert">
		<p class="a11y-error-text">{error}</p>
	</div>
{/if}

<form onsubmit={submit}>
	<div class="a11y-field">
		<label for="a11y-session-name">Session Name</label>
		<input
			id="a11y-session-name"
			type="text"
			required
			bind:value={name}
			disabled={saving}
		/>
	</div>

	<div class="a11y-field">
		<label for="a11y-session-add-character">Characters</label>
		<p class="a11y-hint">At least one character is required.</p>
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
								Move Up
							</button>
							<button
								type="button"
								class="a11y-btn a11y-btn-small"
								onclick={() => moveCharacter(i, 1)}
								disabled={i === selectedCharacters.length - 1}
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
		<label for="a11y-session-add-persona">Personas</label>
		<p class="a11y-hint">
			At least one persona is required — this is who you'll speak as.
		</p>
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

	{#if selectedCharacters.length > 1 || selectedPersonas.length > 1}
		<div class="a11y-field">
			<label for="a11y-session-group-strategy">
				Group Reply Strategy
			</label>
			<p class="a11y-hint">
				Controls the order characters and personas take turns in.
			</p>
			<select
				id="a11y-session-group-strategy"
				bind:value={groupReplyStrategy}
				disabled={saving}
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
		<label for="a11y-session-scenario">Scenario</label>
		<p class="a11y-hint">
			Optional. Describes the setting or context — included in prompts.
		</p>
		<textarea
			id="a11y-session-scenario"
			bind:value={scenario}
			disabled={saving}
		></textarea>
	</div>

	<div class="a11y-field">
		<label for="a11y-session-tag-input">Tags</label>
		<div class="a11y-inline-add">
			<input
				id="a11y-session-tag-input"
				type="text"
				bind:value={tagInput}
				disabled={saving}
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
				disabled={!tagInput.trim()}
			>
				Add
			</button>
		</div>
		{#if tags.length > 0}
			<ul class="a11y-list">
				{#each tags as tag}
					<li class="a11y-list-item">
						<span>{tag}</span>
						<button
							type="button"
							class="a11y-btn a11y-btn-danger a11y-btn-small"
							onclick={() => removeTag(tag)}
						>
							Remove
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<button type="submit" class="a11y-btn" disabled={saving}>
		{saving ? "Creating…" : "Create Session"}
	</button>
</form>
