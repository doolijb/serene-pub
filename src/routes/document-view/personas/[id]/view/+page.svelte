<script lang="ts">
	import { onMount } from "svelte"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	const socket = useTypedSocket()
	const personaId = $derived(Number(page.params.id))

	let persona:
		| (Partial<SelectPersona> & {
				isOwner?: boolean
				ownerName?: string | null
		  })
		| undefined = $state()
	let loaded = $state(false)
	let notFound = $state(false)

	function load() {
		loaded = false
		notFound = false
		socket.emit("personas:get", { id: personaId })
	}

	onMount(() => {
		socket.on("personas:get", (msg) => {
			loaded = true
			if (!msg.persona) {
				notFound = true
				return
			}
			persona = msg.persona
		})
		load()
		return () => {
			socket.off("personas:get")
		}
	})
</script>

<svelte:head>
	<title>{persona?.name || "Persona"} — Document View — Serene Pub</title>
</svelte:head>

<h1>{persona?.name || "Persona"}</h1>
<p>
	<a href="/document-view/personas">Back to Personas</a>
	{#if persona?.isOwner}
		· <a href="/document-view/personas/{personaId}/edit">Edit</a>
	{/if}
</p>

{#if !loaded}
	<p>Loading…</p>
{:else if notFound}
	<p>Persona not found, or you don't have access to it.</p>
{:else if persona}
	{#if !persona.isOwner}
		<p class="a11y-hint">
			{persona.ownerName
				? `Owned by ${persona.ownerName}.`
				: "You don't own this persona."} This is a read-only view.
		</p>
	{/if}
	{#if persona.isDefault}
		<p><strong>This is the default persona.</strong></p>
	{/if}
	{#if persona.description}
		<h2>Description</h2>
		<p>{persona.description}</p>
	{/if}
{/if}
