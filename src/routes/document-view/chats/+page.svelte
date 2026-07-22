<script lang="ts">
	import { onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	const socket = useTypedSocket()
	let chats: Sockets.Chats.List.Response["chatList"] = $state([])
	let loaded = $state(false)

	function participantSummary(chat: (typeof chats)[number]): string {
		const characters = (chat.chatCharacters || [])
			.map((cc) => cc.character?.nickname || cc.character?.name)
			.filter(Boolean)
		const personas = (chat.chatPersonas || [])
			.map((cp) => cp.persona?.name)
			.filter(Boolean)
		return [...characters, ...personas].join(", ") || "No participants yet"
	}

	function deleteChat(id: number, name: string) {
		if (!confirm(`Delete chat "${name}"? This cannot be undone.`)) return
		socket.emit("chats:delete", { id })
	}

	onMount(() => {
		socket.on("chats:list", (msg) => {
			chats = msg.chatList || []
			loaded = true
		})
		socket.on("chats:delete", () => {
			socket.emit("chats:list", {})
		})
		socket.emit("chats:list", {})
		return () => {
			socket.off("chats:list")
			socket.off("chats:delete")
		}
	})
</script>

<svelte:head>
	<title>Chats — Document View — Serene Pub</title>
</svelte:head>

<h1>Chats</h1>
<p><a href="/document-view/chats/new" class="a11y-btn">Start a new chat</a></p>

{#if !loaded}
	<p>Loading…</p>
{:else if chats.length === 0}
	<p>You don't have any chats yet.</p>
{:else}
	<ul class="a11y-list">
		{#each chats as chat (chat.id)}
			<li class="a11y-list-item">
				<h2>{chat.name || "Unnamed Chat"}</h2>
				<p>{participantSummary(chat)}</p>
				{#if chat.isGuest}
					<p class="a11y-hint">You're a guest in this chat.</p>
				{/if}
				<div class="a11y-list-item-actions">
					<a
						href="/document-view/chats/{chat.id}"
						class="a11y-btn a11y-btn-small"
					>
						Open
					</a>
					{#if chat.canEdit}
						<a
							href="/document-view/chats/{chat.id}/edit"
							class="a11y-btn a11y-btn-small"
						>
							Edit
						</a>
					{/if}
					{#if chat.isOwner}
						<button
							type="button"
							class="a11y-btn a11y-btn-danger a11y-btn-small"
							onclick={() =>
								deleteChat(
									chat.id!,
									chat.name || "Unnamed Chat"
								)}
						>
							Delete
						</button>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}
