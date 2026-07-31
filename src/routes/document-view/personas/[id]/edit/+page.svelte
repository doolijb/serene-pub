<script lang="ts">
	import { onMount } from "svelte"
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { announce } from "$lib/client/accessibility/state.svelte"

	const socket = useTypedSocket()
	const personaId = $derived(Number(page.params.id))

	let name = $state("")
	let description = $state("")
	let isDefault = $state(false)
	let isOwner = $state(true)
	let loaded = $state(false)
	let notFound = $state(false)
	let error = $state("")
	let saving = $state(false)
	let deleting = $state(false)

	function load() {
		loaded = false
		notFound = false
		socket.emit("personas:get", { id: personaId })
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
		socket.emit("personas:update", {
			persona: {
				id: personaId,
				name: name.trim(),
				description: description.trim(),
				isDefault
			} as any
		})
	}

	function deletePersona() {
		if (!confirm("Delete this persona? This cannot be undone.")) return
		deleting = true
		socket.emit("personas:delete", { id: personaId })
	}

	function handlePersonasGet(msg: any) {
		loaded = true
		if (!msg.persona) {
			notFound = true
			return
		}
		name = msg.persona.name
		description = msg.persona.description
		isDefault = msg.persona.isDefault
		isOwner = msg.persona.isOwner
	}
	function handlePersonasUpdate(msg: any) {
		saving = false
		if (msg.persona) {
			name = msg.persona.name
			description = msg.persona.description
			isDefault = msg.persona.isDefault
			announce("Persona saved.")
		}
	}
	function handlePersonasUpdateError(msg: { error?: string }) {
		saving = false
		error = msg.error || "Failed to save persona."
		announce(error)
	}
	function handlePersonasDelete() {
		goto("/document-view/personas")
	}
	function handlePersonasDeleteError(msg: { error?: string }) {
		deleting = false
		error = msg.error || "Failed to delete persona."
		announce(error)
	}

	onMount(() => {
		socket.on("personas:get", handlePersonasGet)
		socket.on("personas:update", handlePersonasUpdate)
		socket.on("personas:update:error", handlePersonasUpdateError)
		socket.on("personas:delete", handlePersonasDelete)
		socket.on("personas:delete:error", handlePersonasDeleteError)
		load()
		return () => {
			socket.off("personas:get", handlePersonasGet)
			socket.off("personas:update", handlePersonasUpdate)
			socket.off("personas:update:error", handlePersonasUpdateError)
			socket.off("personas:delete", handlePersonasDelete)
			socket.off("personas:delete:error", handlePersonasDeleteError)
		}
	})
</script>

<svelte:head>
	<title>Edit Persona — Document View — Serene Pub</title>
</svelte:head>

<h1>Edit Persona</h1>
<p><a href="/document-view/personas">Back to Personas</a></p>

{#if !loaded}
	<p>Loading…</p>
{:else if notFound}
	<p>Persona not found, or you don't have access to it.</p>
{:else}
	{#if !isOwner}
		<div class="a11y-status">
			<p>You don't own this persona, so it's read-only here.</p>
		</div>
	{/if}
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
				disabled={saving || !isOwner}
			/>
		</div>
		<div class="a11y-field">
			<label for="a11y-persona-description">Description</label>
			<textarea
				id="a11y-persona-description"
				required
				bind:value={description}
				disabled={saving || !isOwner}
			></textarea>
		</div>
		<div class="a11y-checkbox-field">
			<input
				id="a11y-persona-default"
				type="checkbox"
				bind:checked={isDefault}
				disabled={saving || !isOwner}
			/>
			<label for="a11y-persona-default">Set as my default persona</label>
		</div>
		{#if isOwner}
			<button type="submit" class="a11y-btn" disabled={saving}>
				{saving ? "Saving…" : "Save Changes"}
			</button>
			<button
				type="button"
				class="a11y-btn a11y-btn-danger"
				onclick={deletePersona}
				disabled={deleting}
			>
				{deleting ? "Deleting…" : "Delete Persona"}
			</button>
		{/if}
	</form>
{/if}
