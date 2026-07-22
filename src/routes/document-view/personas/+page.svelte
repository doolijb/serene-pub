<script lang="ts">
	import { onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	const socket = useTypedSocket()
	let personas: (Partial<SelectPersona> & {
		personaTags?: { tag: SelectTag }[]
	})[] = $state([])
	let loaded = $state(false)

	function deletePersona(id: number, name: string) {
		if (!confirm(`Delete persona "${name}"? This cannot be undone.`)) return
		socket.emit("personas:delete", { id })
	}

	onMount(() => {
		socket.on("personas:list", (msg) => {
			personas = msg.personaList || []
			loaded = true
		})
		socket.on("personas:delete", () => {
			socket.emit("personas:list", {})
		})
		socket.emit("personas:list", {})
		return () => {
			socket.off("personas:list")
			socket.off("personas:delete")
		}
	})
</script>

<svelte:head>
	<title>Personas — Document View — Serene Pub</title>
</svelte:head>

<h1>Personas</h1>
<p>
	<a href="/document-view/personas/new" class="a11y-btn">
		Create a new persona
	</a>
</p>
<p>
	<a
		href="/document-view/personas/browse"
		class="a11y-btn a11y-btn-secondary"
	>
		Browse Persona Library
	</a>
</p>

{#if !loaded}
	<p>Loading…</p>
{:else if personas.length === 0}
	<p>You don't have any personas yet.</p>
{:else}
	<ul class="a11y-list">
		{#each personas as persona (persona.id)}
			<li class="a11y-list-item">
				<h2>{persona.name}{persona.isDefault ? " (default)" : ""}</h2>
				<p>{persona.description}</p>
				<div class="a11y-list-item-actions">
					<a
						href="/document-view/personas/{persona.id}/edit"
						class="a11y-btn a11y-btn-small"
					>
						Edit
					</a>
					<button
						type="button"
						class="a11y-btn a11y-btn-danger a11y-btn-small"
						onclick={() =>
							deletePersona(persona.id!, persona.name!)}
					>
						Delete
					</button>
				</div>
			</li>
		{/each}
	</ul>
{/if}
