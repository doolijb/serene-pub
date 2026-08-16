<script lang="ts">
	import { onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	const socket = useTypedSocket()
	let characters: Partial<SelectCharacter>[] = $state([])
	let loaded = $state(false)

	function deleteCharacter(id: number, name: string) {
		if (!confirm(`Delete character "${name}"? This cannot be undone.`))
			return
		socket.emit("characters:delete", { id })
	}

	function handleCharactersList(msg: Sockets.Characters.List.Response) {
		characters = msg.characterList || []
		loaded = true
	}
	function handleCharactersDelete() {
		socket.emit("characters:list", {})
	}

	onMount(() => {
		socket.on("characters:list", handleCharactersList)
		socket.on("characters:delete", handleCharactersDelete)
		socket.emit("characters:list", {})
		return () => {
			socket.off("characters:list", handleCharactersList)
			socket.off("characters:delete", handleCharactersDelete)
		}
	})
</script>

<svelte:head>
	<title>Characters — Document View — Serene Pub</title>
</svelte:head>

<h1>Characters</h1>
<p>
	<a href="/document-view/characters/new" class="a11y-btn">
		Create a new character
	</a>
</p>
<p>
	<a
		href="/document-view/characters/browse"
		class="a11y-btn a11y-btn-secondary"
	>
		Browse Character Library
	</a>
</p>

{#if !loaded}
	<p>Loading…</p>
{:else if characters.length === 0}
	<p>You don't have any characters yet.</p>
{:else}
	<ul class="a11y-list">
		{#each characters as character (character.id)}
			<li class="a11y-list-item">
				<h2>{character.nickname || character.name}</h2>
				<p>{character.description}</p>
				<div class="a11y-list-item-actions">
					<a
						href="/document-view/characters/{character.id}/edit"
						class="a11y-btn a11y-btn-small"
					>
						Edit
					</a>
					<a
						href="/document-view/chats/new?characterId={character.id}"
						class="a11y-btn a11y-btn-small"
					>
						Start Chat
					</a>
					<button
						type="button"
						class="a11y-btn a11y-btn-danger a11y-btn-small"
						onclick={() =>
							deleteCharacter(character.id!, character.name!)}
					>
						Delete
					</button>
				</div>
			</li>
		{/each}
	</ul>
{/if}
