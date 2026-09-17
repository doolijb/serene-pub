<script lang="ts">
	import { onMount } from "svelte"
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { announce } from "$lib/client/accessibility/state.svelte"

	const socket = useTypedSocket()
	const characterId = $derived(Number(page.params.id))

	let name = $state("")
	let nickname = $state("")
	let description = $state("")
	let personality = $state("")
	let scenario = $state("")
	let firstMessage = $state("")
	let isPersona = $state(false)
	let isDefaultPersona = $state(false)
	/**
	 * The character's tags as loaded, sent back UNCHANGED on save.
	 *
	 * ⚠ Load-bearing: `characters:update` runs `processCharacterTags` with
	 * whatever `tags` the payload carries, and an absent array reads as an
	 * empty one — so a save from this form (which has no tag field) would
	 * otherwise strip every tag off the character as a side effect.
	 */
	let tags: string[] = $state([])
	let isOwner = $state(true)
	let loaded = $state(false)
	let notFound = $state(false)
	let error = $state("")
	let saving = $state(false)
	let deleting = $state(false)

	function load() {
		loaded = false
		notFound = false
		socket.emit("characters:get", { id: characterId })
	}

	function submit(event: SubmitEvent) {
		event.preventDefault()
		error = ""
		if (!name.trim()) {
			error = "Name is required."
			announce(error)
			return
		}
		if (!description.trim()) {
			error = "Description is required."
			announce(error)
			return
		}
		saving = true
		socket.emit("characters:update", {
			character: {
				id: characterId,
				name: name.trim(),
				nickname: nickname.trim() || null,
				description: description.trim(),
				personality: personality.trim() || null,
				scenario: scenario.trim() || null,
				firstMessage: firstMessage.trim() || null,
				isPersona,
				// Sent whichever way it is set: the handler only clears a
				// default on an EXPLICIT false, and clearing Persona has to
				// take the default with it.
				isDefaultPersona: isPersona && isDefaultPersona,
				tags
			} as any
		})
	}

	function deleteCharacter() {
		if (!confirm("Delete this character? This cannot be undone.")) return
		deleting = true
		socket.emit("characters:delete", { id: characterId })
	}

	function handleCharactersGet(msg: any) {
		loaded = true
		if (!msg.character) {
			notFound = true
			return
		}
		name = msg.character.name
		nickname = msg.character.nickname || ""
		description = msg.character.description
		personality = msg.character.personality || ""
		scenario = msg.character.scenario || ""
		firstMessage = msg.character.firstMessage || ""
		isPersona = !!msg.character.isPersona
		isDefaultPersona = !!msg.character.isDefaultPersona
		tags = msg.character.tags ?? []
		isOwner = msg.character.isOwner
	}
	function handleCharactersUpdate(msg: any) {
		saving = false
		if (msg.character) {
			name = msg.character.name
			nickname = msg.character.nickname || ""
			description = msg.character.description
			personality = msg.character.personality || ""
			scenario = msg.character.scenario || ""
			firstMessage = msg.character.firstMessage || ""
			isPersona = !!msg.character.isPersona
			isDefaultPersona = !!msg.character.isDefaultPersona
			announce("Character saved.")
		}
	}
	function handleCharactersUpdateError(msg: { error?: string }) {
		saving = false
		error = msg.error || "Failed to save character."
		announce(error)
	}
	function handleCharactersDelete() {
		goto("/document-view/characters")
	}
	function handleCharactersDeleteError(msg: { error?: string }) {
		deleting = false
		error = msg.error || "Failed to delete character."
		announce(error)
	}

	/**
	 * The rest, all BARE: no `SCOPED_EVENTS` entry, so a `#<id>` key would
	 * match no payload at all. `characters:update` is also the cascade
	 * `characters:setAvatar` re-emits, which is why it is a STANDING key rather
	 * than a one-shot around the save. The two `:error` events are never gated
	 * (plan ruling 2) but the registry is still the only listener path.
	 */
	useInterest<"characters:update">(
		"characters:update",
		handleCharactersUpdate
	)
	useInterest<"characters:update:error">(
		"characters:update:error",
		handleCharactersUpdateError
	)
	useInterest<"characters:delete">(
		"characters:delete",
		handleCharactersDelete
	)
	useInterest<"characters:delete:error">(
		"characters:delete:error",
		handleCharactersDeleteError
	)

	/**
	 * This character's own `characters:get`, SCOPED to the id in the route — the
	 * reply to `load()`. An effect rather than `useInterest` because that
	 * helper reads its key once and the key moves with the route.
	 *
	 * No bare key beside it: the not-found reply carries the requested id on
	 * `characterId` next to a null character, so it has this scope too. A bare key
	 * would have matched every other character's reply as well, and would keep
	 * the server's gate open for every id while this page is open.
	 */
	$effect(() => {
		if (!Number.isFinite(characterId)) return
		return declareInterest<"characters:get">(
			interestKey("characters:get", characterId),
			handleCharactersGet
		)
	})

	onMount(() => {
		// Every `characters:*` listener is an interest, declared above; the typed
		// `emit` inside `load()` puts its sync ahead of the request on the
		// same socket (plan ruling 3).
		load()
	})
</script>

<svelte:head>
	<title>Edit Character — Document View — Serene Pub</title>
</svelte:head>

<h1>Edit Character</h1>
<p><a href="/document-view/characters">Back to Characters</a></p>

{#if !loaded}
	<p>Loading…</p>
{:else if notFound}
	<p>Character not found, or you don't have access to it.</p>
{:else}
	{#if !isOwner}
		<div class="a11y-status">
			<p>You don't own this character, so it's read-only here.</p>
		</div>
	{/if}
	{#if error}
		<div class="a11y-status a11y-status-error" role="alert">
			<p class="a11y-error-text">{error}</p>
		</div>
	{/if}

	<form onsubmit={submit}>
		<div class="a11y-field">
			<label for="a11y-char-name">Name</label>
			<input
				id="a11y-char-name"
				type="text"
				required
				bind:value={name}
				disabled={saving || !isOwner}
			/>
		</div>
		<div class="a11y-field">
			<label for="a11y-char-nickname">Nickname</label>
			<input
				id="a11y-char-nickname"
				type="text"
				bind:value={nickname}
				disabled={saving || !isOwner}
			/>
		</div>
		<div class="a11y-field">
			<label for="a11y-char-description">Description</label>
			<textarea
				id="a11y-char-description"
				required
				bind:value={description}
				disabled={saving || !isOwner}
			></textarea>
		</div>
		<div class="a11y-field">
			<label for="a11y-char-personality">Personality</label>
			<textarea
				id="a11y-char-personality"
				bind:value={personality}
				disabled={saving || !isOwner}
			></textarea>
		</div>
		<div class="a11y-field">
			<label for="a11y-char-scenario">Scenario</label>
			<textarea
				id="a11y-char-scenario"
				bind:value={scenario}
				disabled={saving || !isOwner}
			></textarea>
		</div>
		<div class="a11y-field">
			<label for="a11y-char-first-message">First Message</label>
			<textarea
				id="a11y-char-first-message"
				bind:value={firstMessage}
				disabled={saving || !isOwner}
			></textarea>
		</div>
		<div class="a11y-field">
			<label for="a11y-char-persona">
				<input
					id="a11y-char-persona"
					type="checkbox"
					bind:checked={isPersona}
					onchange={() => {
						// A default you cannot play is not a state worth
						// having, here or anywhere else.
						if (!isPersona) isDefaultPersona = false
					}}
					disabled={saving || !isOwner}
				/>
				Persona
			</label>
			<p class="a11y-hint">A character you play.</p>
		</div>
		<div class="a11y-field">
			<label for="a11y-char-default-persona">
				<input
					id="a11y-char-default-persona"
					type="checkbox"
					bind:checked={isDefaultPersona}
					onchange={() => {
						if (isDefaultPersona) isPersona = true
					}}
					disabled={saving || !isOwner}
				/>
				Default persona
			</label>
			<p class="a11y-hint">
				The persona a new session starts with. You have one.
			</p>
		</div>
		{#if isOwner}
			<button type="submit" class="a11y-btn" disabled={saving}>
				{saving ? "Saving…" : "Save Changes"}
			</button>
			<button
				type="button"
				class="a11y-btn a11y-btn-danger"
				onclick={deleteCharacter}
				disabled={deleting}
			>
				{deleting ? "Deleting…" : "Delete Character"}
			</button>
		{/if}
	</form>
{/if}
