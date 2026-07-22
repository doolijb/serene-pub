<script lang="ts">
	import { onMount } from "svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { announce } from "$lib/client/accessibility/state.svelte"

	const socket = useTypedSocket()

	let name = $state("")
	let nickname = $state("")
	let description = $state("")
	let personality = $state("")
	let scenario = $state("")
	let firstMessage = $state("")
	let error = $state("")
	let saving = $state(false)

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
		socket.emit("characters:create", {
			character: {
				name: name.trim(),
				nickname: nickname.trim() || null,
				description: description.trim(),
				personality: personality.trim() || null,
				scenario: scenario.trim() || null,
				firstMessage: firstMessage.trim() || null
			} as any
		})
	}

	onMount(() => {
		socket.on("characters:create", (msg) => {
			saving = false
			if (msg.character)
				goto(`/document-view/characters/${msg.character.id}/edit`)
		})
		socket.on("characters:create:error", (msg: { error?: string }) => {
			saving = false
			error = msg.error || "Failed to create character."
			announce(error)
		})
		return () => {
			socket.off("characters:create")
			socket.off("characters:create:error")
		}
	})
</script>

<svelte:head>
	<title>New Character — Document View — Serene Pub</title>
</svelte:head>

<h1>New Character</h1>
<p><a href="/document-view/characters">Back to Characters</a></p>

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
			disabled={saving}
		/>
	</div>
	<div class="a11y-field">
		<label for="a11y-char-nickname">Nickname</label>
		<p class="a11y-hint">Optional. Shown instead of Name where set.</p>
		<input
			id="a11y-char-nickname"
			type="text"
			bind:value={nickname}
			disabled={saving}
		/>
	</div>
	<div class="a11y-field">
		<label for="a11y-char-description">Description</label>
		<textarea
			id="a11y-char-description"
			required
			bind:value={description}
			disabled={saving}
		></textarea>
	</div>
	<div class="a11y-field">
		<label for="a11y-char-personality">Personality</label>
		<textarea
			id="a11y-char-personality"
			bind:value={personality}
			disabled={saving}
		></textarea>
	</div>
	<div class="a11y-field">
		<label for="a11y-char-scenario">Scenario</label>
		<textarea
			id="a11y-char-scenario"
			bind:value={scenario}
			disabled={saving}
		></textarea>
	</div>
	<div class="a11y-field">
		<label for="a11y-char-first-message">First Message</label>
		<p class="a11y-hint">
			What the character says to start a conversation.
		</p>
		<textarea
			id="a11y-char-first-message"
			bind:value={firstMessage}
			disabled={saving}
		></textarea>
	</div>
	<button type="submit" class="a11y-btn" disabled={saving}>
		{saving ? "Creating…" : "Create Character"}
	</button>
</form>
