<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

	const socket = useTypedSocket()
	let userCtx: UserCtx = getContext("userCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let connections: Sockets.Connections.List.Response["connectionsList"] =
		$state([])
	let loaded = $state(false)

	/**
	 * The chat default. There is no such thing as "the default connection" any
	 * more: `connection_defaults` is keyed by capability, and one endpoint can
	 * hold several. This page is the accessible analogue of the Connections
	 * sidebar, whose star means the same two things, so it offers the same two.
	 */
	let chatConnectionId = $derived(
		systemSettingsCtx.capabilityDefaults?.["text->text"]?.connectionId ??
			null
	)
	let imageConnectionId = $derived(
		systemSettingsCtx.capabilityDefaults?.["text->image"]?.connectionId ??
			null
	)

	// `capability` is required and cannot be derived from the connection — one
	// KoboldCPP row does chat AND image generation, and the derivation anyone
	// would write is "the first one it can do".
	function setDefault(capability: string, id: number) {
		socket.emit("connections:setDefault", { capability, id })
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
	function handleConnectionsSetDefault() {
		socket.emit("connections:list", {})
	}

	onMount(() => {
		socket.on("connections:list", handleConnectionsList)
		socket.on("connections:delete", handleConnectionsDelete)
		socket.on("connections:setDefault", handleConnectionsSetDefault)
		socket.emit("connections:list", {})
		return () => {
			socket.off("connections:list", handleConnectionsList)
			socket.off("connections:delete", handleConnectionsDelete)
			socket.off("connections:setDefault", handleConnectionsSetDefault)
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
		Connections tell Serene Pub how to reach an AI provider. A connection is
		not used by anything until it is registered for something — nothing is
		picked automatically. Registering one for chat here is the common case;
		the full list of capabilities is on the
		<a href="/admin/defaults">Defaults page</a>
		.
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
					{#if conn.id === chatConnectionId}
						<p><strong>Used for chat.</strong></p>
					{/if}
					{#if conn.id === imageConnectionId}
						<p><strong>Used for image generation.</strong></p>
					{/if}
					<!-- One button, chosen by the connection's own modality.
					     Offering both on every row would let an OpenAI endpoint
					     be registered as the image default — a registration
					     nothing on this page has the capability data to refuse,
					     and one the run would then fail on. The sidebar draws
					     the same line with its two categories. -->
					<div class="a11y-list-item-actions">
						{#if CONNECTION_TYPE.isImage(conn.type!)}
							{#if conn.id !== imageConnectionId}
								<button
									type="button"
									class="a11y-btn a11y-btn-small"
									onclick={() =>
										setDefault("text->image", conn.id!)}
								>
									Use for Image generation
								</button>
							{/if}
						{:else if conn.id !== chatConnectionId}
							<button
								type="button"
								class="a11y-btn a11y-btn-small"
								onclick={() =>
									setDefault("text->text", conn.id!)}
							>
								Use for Chat
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
