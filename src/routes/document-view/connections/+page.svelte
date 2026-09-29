<script lang="ts">
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { sectionForModality } from "$lib/shared/constants/connectionSections"
	import { serviceLabel } from "$lib/client/components/connections/connectionIndexFilter"
	import { isLocalOnnxType } from "$lib/client/components/connections/modelManagement"

	const socket = useTypedSocket()
	let userCtx: UserCtx = getContext("userCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let connections: Sockets.Connections.List.Response["connectionsList"] =
		$state([])
	let loaded = $state(false)

	/**
	 * Which connection is starred for a capability.
	 *
	 * There is no such thing as "the default connection": `connection_defaults`
	 * is keyed by capability and one endpoint can hold several. This page is the
	 * accessible analogue of the Connections sidebar, and it draws the same line
	 * the sidebar does — one star per SECTION, taken from the same table, so a
	 * new modality appears here without an edit.
	 */
	const starredId = (capability: string) =>
		systemSettingsCtx.capabilityDefaults?.[capability]?.connectionId ?? null
	const starredModelId = (capability: string) =>
		systemSettingsCtx.capabilityDefaults?.[capability]?.connectionModelId ??
		null

	type Row = Sockets.Connections.List.Response["connectionsList"][number]
	/**
	 * The models on this connection that can be registered for `capability`:
	 * switched on, still listed, able to do it — and, for a local ONNX model,
	 * on disk, which the server now requires (plan 2026-09-24 A1).
	 */
	function usableModels(conn: Row, capability: string) {
		const local = isLocalOnnxType(conn.type)
		return (conn.models ?? []).filter(
			(m) =>
				m.enabled &&
				m.missingSince == null &&
				(m.satisfiableCapabilities ?? []).includes(capability) &&
				(!local || m.local?.state === "on_disk")
		)
	}
	/** "3 models", or "2 on disk" for a local ONNX connection. */
	function countLine(conn: Row): string {
		if (isLocalOnnxType(conn.type)) {
			const onDisk = (conn.models ?? []).filter(
				(m) => m.local?.state === "on_disk"
			).length
			return `${onDisk} downloaded`
		}
		const n = conn.models?.length ?? 0
		return n === 1 ? "1 model" : `${n} models`
	}

	// `capability` is required and cannot be derived from the connection — one
	// KoboldCPP row does chat AND image generation, and the derivation anyone
	// would write is "the first one it can do". `modelId` is required too:
	// connections have no default model, and the server refuses a
	// registration without one.
	let setDefaultError = $state<string | null>(null)
	function setDefault(capability: string, id: number, modelId: number) {
		setDefaultError = null
		socket.emit("connections:setDefault", { capability, id, modelId })
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

	// The two cascade triggers first, then the list interest and the request
	// that fills it: effects run in creation order and a request flushes the
	// pending interest sync, so a declaration made below the request would miss
	// the flush its own reply rides on. All three keys are bare and standing —
	// this page re-asks for the whole list after every write.
	useInterest<"connections:delete">(
		"connections:delete",
		handleConnectionsDelete
	)
	useInterest<"connections:setDefault">(
		"connections:setDefault",
		handleConnectionsSetDefault
	)
	useInterest<"error">("error", (msg: { error?: string }) => {
		if (msg?.error) setDefaultError = msg.error
	})
	$effect(() =>
		requestWithInterest("connections:list", {}, handleConnectionsList)
	)
</script>

<svelte:head>
	<title>Connections — Document View — Serene Pub</title>
</svelte:head>

<h1>Connections</h1>

{#if !userCtx.user?.isAdmin}
	<p>Admin access required.</p>
{:else}
	<p>
		Connections tell Serene Pub how to reach an AI service. A connection is
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

	{#if setDefaultError}
		<p role="alert"><strong>{setDefaultError}</strong></p>
	{/if}

	{#if !loaded}
		<p>Loading…</p>
	{:else if connections.length === 0}
		<p>No connections configured yet.</p>
	{:else}
		<ul class="a11y-list">
			{#each connections as conn (conn.id)}
				{@const section =
					sectionForModality(conn.modality) ??
					sectionForModality(CONNECTION_TYPE.modalityOf(conn.type!))}
				{@const starred = section
					? starredId(section.starCapability)
					: null}
				{@const usable = section
					? usableModels(conn, section.starCapability)
					: []}
				{@const starredModel = section
					? starredModelId(section.starCapability)
					: null}
				<li class="a11y-list-item">
					<h2>{conn.name}</h2>
					<p>
						Service: {serviceLabel(conn)} · {countLine(conn)}
					</p>
					{#if section && conn.id === starred}
						{@const name = conn.models?.find(
							(m) => m.id === starredModel
						)?.name}
						<p>
							<strong>
								Used for {section.starVerb}{name
									? ` (${name})`
									: ""}.
							</strong>
						</p>
					{/if}
					{#if section && usable.length}
						<!-- One button per MODEL: a registration names the
						     pair, never the bare endpoint. -->
						<ul>
							{#each usable as model (model.id)}
								{#if !(conn.id === starred && model.id === starredModel)}
									<li>
										<button
											type="button"
											class="a11y-btn a11y-btn-small"
											onclick={() =>
												setDefault(
													section.starCapability,
													conn.id!,
													model.id
												)}
										>
											Use {model.name} for {section.starVerb}
										</button>
									</li>
								{/if}
							{/each}
						</ul>
					{/if}
					<!-- ONE button, naming the capability this row's own
					     modality can serve. Offering every capability on every
					     row would let an OpenAI endpoint be registered as the
					     image default, or an embeddings endpoint as the chat
					     one — registrations this page has no capability data to
					     refuse and the run would fail on. The sidebar draws the
					     same line, from the same table. -->
					<div class="a11y-list-item-actions">
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
