<script lang="ts">
	import { onMount } from "svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { announce } from "$lib/client/accessibility/state.svelte"

	const socket = useTypedSocket()

	let name = $state("")
	let description = $state("")
	let isDefault = $state(false)
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
		socket.emit("personas:create", {
			persona: {
				name: name.trim(),
				description: description.trim(),
				isDefault,
				avatar: null,
				aliases: []
			} as any
		})
	}

	onMount(() => {
		socket.on("personas:create", (msg) => {
			saving = false
			if (msg.persona)
				goto(`/document-view/personas/${msg.persona.id}/edit`)
		})
		socket.on("personas:create:error", (msg: { error?: string }) => {
			saving = false
			error = msg.error || "Failed to create persona."
			announce(error)
		})
		return () => {
			socket.off("personas:create")
			socket.off("personas:create:error")
		}
	})
</script>

<svelte:head>
	<title>New Persona — Document View — Serene Pub</title>
</svelte:head>

<h1>New Persona</h1>
<p><a href="/document-view/personas">Back to Personas</a></p>

{#if error}
	<div class="a11y-status a11y-status-error" role="alert">
		<p class="a11y-error-text">{error}</p>
	</div>
{/if}

<form onsubmit={submit}>
	<div class="a11y-field">
		<label for="a11y-persona-name">Name</label>
		<input
			id="a11y-persona-name"
			type="text"
			required
			bind:value={name}
			disabled={saving}
		/>
	</div>
	<div class="a11y-field">
		<label for="a11y-persona-description">Description</label>
		<p class="a11y-hint">How this persona is described in conversations.</p>
		<textarea
			id="a11y-persona-description"
			required
			bind:value={description}
			disabled={saving}
		></textarea>
	</div>
	<div class="a11y-checkbox-field">
		<input
			id="a11y-persona-default"
			type="checkbox"
			bind:checked={isDefault}
			disabled={saving}
		/>
		<label for="a11y-persona-default">Set as my default persona</label>
	</div>
	<button type="submit" class="a11y-btn" disabled={saving}>
		{saving ? "Creating…" : "Create Persona"}
	</button>
</form>
