<script lang="ts">
	import { onMount } from "svelte"
	import { page } from "$app/state"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"

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

	function handleCharactersGet(msg: any) {
		loaded = true
		if (!msg.character) {
			notFound = true
			return
		}
		character = msg.character
	}

	/**
	 * SCOPED to the character in the route, and no bare key beside it: the
	 * not-found reply carries `characterId` next to a null character, so it has
	 * this same scope. A bare key would match every OTHER character's reply
	 * too — which on the server is the gate open for every id while this page
	 * is open.
	 *
	 * An effect rather than `useInterest` because that helper reads its key
	 * once: a client-side move between two characters changes `characterId`, and
	 * this releases the old scope as it takes the new one.
	 *
	 * Declared ahead of `onMount` so the key is held before `load()` sends its
	 * request — effects run in declaration order, and the typed `emit` flushes
	 * the interest sync ahead of the request itself (plan ruling 3).
	 */
	$effect(() => {
		if (!Number.isFinite(characterId)) return
		return declareInterest<"characters:get">(
			interestKey("characters:get", characterId),
			handleCharactersGet
		)
	})

	onMount(() => {
		// The `characters:get` reply is an interest, declared above.
		load()
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
		<h2>First message</h2>
		<p>{character.firstMessage}</p>
	{/if}
{/if}
