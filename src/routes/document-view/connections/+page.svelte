<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	const socket = useTypedSocket()
	let userCtx: UserCtx = getContext("userCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let connections: Sockets.Connections.List.Response["connectionsList"] =
		$state([])
	let loaded = $state(false)

	let defaultConnectionId = $derived(
		systemSettingsCtx.settings?.defaultConnectionId ?? null
	)

	function setDefault(id: number) {
		socket.emit("connections:setUserActive", { id })
	}

	function deleteConnection(id: number, name: string) {
		if (!confirm(`Delete connection "${name}"? This cannot be undone.`))
			return
		socket.emit("connections:delete", { id })
	}

	function handleConnectionsList(msg: Sockets.Connections.List.Response) {
		connections = msg.connectionsList || []
		loaded = true
	}
	function handleConnectionsDelete() {
		socket.emit("connections:list", {})
	}
	function handleConnectionsSetUserActive() {
		socket.emit("connections:list", {})
	}

	onMount(() => {
		socket.on("connections:list", handleConnectionsList)
		socket.on("connections:delete", handleConnectionsDelete)
		socket.on("connections:setUserActive", handleConnectionsSetUserActive)
		socket.emit("connections:list", {})
		return () => {
			socket.off("connections:list", handleConnectionsList)
			socket.off("connections:delete", handleConnectionsDelete)
			socket.off(
				"connections:setUserActive",
				handleConnectionsSetUserActive
			)
		}
	})
</script>

<svelte:head>
	<title>Connections — Document View — Serene Pub</title>
</svelte:head>

<h1>Connections</h1>

{#if !userCtx.user?.isAdmin}
	<p>Admin access required.</p>
{:else}
	<p>
		Connections tell Serene Pub how to reach an AI provider. One connection
		is used system-wide as the default for all sessions.
	</p>
	<p>
		<a href="/document-view/connections/new" class="a11y-btn">
			Add a new connection
		</a>
	</p>

	{#if !loaded}
		<p>Loading…</p>
	{:else if connections.length === 0}
		<p>No connections configured yet.</p>
	{:else}
		<ul class="a11y-list">
			{#each connections as conn (conn.id)}
				<li class="a11y-list-item">
					<h2>{conn.name}</h2>
					<p>
						Type: {conn.type}
						{conn.model ? `· Model: ${conn.model}` : ""}
					</p>
					{#if conn.id === defaultConnectionId}
						<p><strong>This is the system default.</strong></p>
					{/if}
					<div class="a11y-list-item-actions">
						{#if conn.id !== defaultConnectionId}
							<button
								type="button"
								class="a11y-btn a11y-btn-small"
								onclick={() => setDefault(conn.id!)}
							>
								Set as Default
							</button>
						{/if}
						<a
							href="/document-view/connections/{conn.id}/edit"
							class="a11y-btn a11y-btn-small"
						>
							Edit
						</a>
						<button
							type="button"
							class="a11y-btn a11y-btn-danger a11y-btn-small"
							onclick={() =>
								deleteConnection(conn.id!, conn.name!)}
						>
							Delete
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
{/if}
