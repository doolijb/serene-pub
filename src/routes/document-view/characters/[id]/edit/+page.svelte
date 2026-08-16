<script lang="ts">
	import { onMount } from "svelte"
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { announce } from "$lib/client/accessibility/state.svelte"

	const socket = useTypedSocket()
	const characterId = $derived(Number(page.params.id))

	let name = $state("")
	let nickname = $state("")
	let description = $state("")
	let personality = $state("")
	let scenario = $state("")
	let firstMessage = $state("")
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
				firstMessage: firstMessage.trim() || null
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

	onMount(() => {
		socket.on("characters:get", handleCharactersGet)
		socket.on("characters:update", handleCharactersUpdate)
		socket.on("characters:update:error", handleCharactersUpdateError)
		socket.on("characters:delete", handleCharactersDelete)
		socket.on("characters:delete:error", handleCharactersDeleteError)
		load()
		return () => {
			socket.off("characters:get", handleCharactersGet)
			socket.off("characters:update", handleCharactersUpdate)
			socket.off(
				"characters:update:error",
				handleCharactersUpdateError
			)
			socket.off("characters:delete", handleCharactersDelete)
			socket.off(
				"characters:delete:error",
				handleCharactersDeleteError
			)
		}
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
