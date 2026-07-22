<script lang="ts">
	import { onMount } from "svelte"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	const socket = useTypedSocket()
	const characterId = $derived(Number(page.params.id))

	let character:
		| (Partial<SelectCharacter> & {
				isOwner?: boolean
				ownerName?: string | null
		  })
		| undefined = $state()
	let loaded = $state(false)
	let notFound = $state(false)

	function load() {
		loaded = false
		notFound = false
		socket.emit("characters:get", { id: characterId })
	}

	onMount(() => {
		socket.on("characters:get", (msg) => {
			loaded = true
			if (!msg.character) {
				notFound = true
				return
			}
			character = msg.character
		})
		load()
		return () => {
			socket.off("characters:get")
		}
	})
</script>

<svelte:head>
	<title>
		{character?.nickname || character?.name || "Character"} — Document View —
		Serene Pub
	</title>
</svelte:head>

<h1>{character?.nickname || character?.name || "Character"}</h1>
<p>
	<a href="/document-view/characters">Back to Characters</a>
	{#if character?.isOwner}
		· <a href="/document-view/characters/{characterId}/edit">Edit</a>
	{/if}
</p>

{#if !loaded}
	<p>Loading…</p>
{:else if notFound}
	<p>Character not found, or you don't have access to it.</p>
{:else if character}
	{#if !character.isOwner}
		<p class="a11y-hint">
			{character.ownerName
				? `Owned by ${character.ownerName}.`
				: "You don't own this character."} This is a read-only view.
		</p>
	{/if}
	{#if character.nickname && character.nickname !== character.name}
		<p>
			<strong>Full name:</strong>
			{character.name}
		</p>
	{/if}
	{#if character.description}
		<h2>Description</h2>
		<p>{character.description}</p>
	{/if}
	{#if character.personality}
		<h2>Personality</h2>
		<p>{character.personality}</p>
	{/if}
	{#if character.scenario}
		<h2>Scenario</h2>
		<p>{character.scenario}</p>
	{/if}
	{#if character.firstMessage}
		<h2>First Message</h2>
		<p>{character.firstMessage}</p>
	{/if}
{/if}
