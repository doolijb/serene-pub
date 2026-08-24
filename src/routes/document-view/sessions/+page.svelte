<script lang="ts">
	import { onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	const socket = useTypedSocket()
	let sessions: Sockets.Sessions.List.Response["sessionList"] = $state([])
	let loaded = $state(false)

	function participantSummary(session: (typeof sessions)[number]): string {
		const characters = (session.sessionCharacters || [])
			.map((cc) => cc.character?.nickname || cc.character?.name)
			.filter(Boolean)
		const personas = (session.sessionPersonas || [])
			.map((cp) => cp.persona?.name)
			.filter(Boolean)
		return [...characters, ...personas].join(", ") || "No participants yet"
	}

	function deleteSession(id: number, name: string) {
		if (!confirm(`Delete session "${name}"? This cannot be undone.`)) return
		socket.emit("sessions:delete", { id })
	}

	function handleSessionsList(msg: Sockets.Sessions.List.Response) {
		sessions = msg.sessionList || []
		loaded = true
	}
	function handleSessionsDelete() {
		socket.emit("sessions:list", {})
	}

	onMount(() => {
		socket.on("sessions:list", handleSessionsList)
		socket.on("sessions:delete", handleSessionsDelete)
		socket.emit("sessions:list", {})
		return () => {
			socket.off("sessions:list", handleSessionsList)
			socket.off("sessions:delete", handleSessionsDelete)
		}
	})
</script>

<svelte:head>
	<title>Sessions — Document View — Serene Pub</title>
</svelte:head>

<h1>Sessions</h1>
<p>
	<a href="/document-view/sessions/new" class="a11y-btn">
		Start a new session
	</a>
</p>

{#if !loaded}
	<p>Loading…</p>
{:else if sessions.length === 0}
	<p>You don't have any sessions yet.</p>
{:else}
	<ul class="a11y-list">
		{#each sessions as session (session.id)}
			<li class="a11y-list-item">
				<h2>{session.name || "Unnamed Session"}</h2>
				<p>{participantSummary(session)}</p>
				{#if session.isGuest}
					<p class="a11y-hint">You're a guest in this session.</p>
				{/if}
				<div class="a11y-list-item-actions">
					<a
						href="/document-view/sessions/{session.id}"
						class="a11y-btn a11y-btn-small"
					>
						Open
					</a>
					{#if session.canEdit}
						<a
							href="/document-view/sessions/{session.id}/edit"
							class="a11y-btn a11y-btn-small"
						>
							Edit
						</a>
					{/if}
					{#if session.isOwner}
						<button
							type="button"
							class="a11y-btn a11y-btn-danger a11y-btn-small"
							onclick={() =>
								deleteSession(
									session.id!,
									session.name || "Unnamed Session"
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
