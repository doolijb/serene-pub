<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { announce } from "$lib/client/accessibility/state.svelte"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { isKoboldCppManagedType } from "$lib/shared/utils/connectionServiceItems"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"
	import { joinWithAnd } from "$lib/shared/utils/joinWithAnd"
	import {
		buildCapabilityRows,
		OVERRIDE_STATES,
		type CapabilityRow,
		type OverrideState
	} from "$lib/shared/connectionAdapters/capabilityRows"

	const socket = useTypedSocket()
	const connectionId = $derived(Number(page.params.id))
	let userCtx: UserCtx = getContext("userCtx")

	// Both Manager-owned types are left out for the same reason the create form
	// leaves them out: they are made from the KoboldCPP Manager page.
	const typeOptions = CONNECTION_TYPE.options.filter(
		(o) => !isKoboldCppManagedType(o.value)
	)

	let name = $state("")
	let type = $state(CONNECTION_TYPE.OLLAMA)
	let baseUrl = $state("")
	let model = $state("")
	let apiKey = $state("")
	let tokenCounter = $state(TokenCounterOptions.ESTIMATE)
	let promptFormat = $state(PromptFormats.VICUNA)
	/**
	 * The named service this connection is, carried but never edited here.
	 *
	 * It is layer 2 of capability resolution, and `connections:test` resolves
	 * against what the FORM sends rather than the stored row — so a payload
	 * without it silently drops the preset's capabilities and persists the
	 * adapter's bare defaults over them.
	 */
	let preset = $state<string | null>(null)
	let loaded = $state(false)
	let notFound = $state(false)
	let error = $state("")
	let saving = $state(false)
	let deleting = $state(false)

	let availableModels: any[] = $state([])
	let testResult: { ok: boolean; error?: string } | null = $state(null)
	let testing = $state(false)

	/**
	 * The capability switches, on their own fetch.
	 *
	 * Document View gets this control now, and not a "use the standard site"
	 * pointer: this is a smaller surface, not a lesser one, and "the switch is on
	 * the other site" is not an answer on the accessibility surface. The row
	 * model is shared with the sidebar's panel; only the markup differs, because
	 * sharing markup across two design systems is what would actually drift.
	 *
	 * Its own read is also what keeps it honest here specifically: `type` above
	 * is a `<select>` bound to local state, and the key space belongs to the
	 * SAVED type. Rendering the half-changed value would offer switches the
	 * stored connection has no field for.
	 */
	let capabilities = $state<Sockets.Connections.Capabilities.Response | null>(
		null
	)
	let capabilitiesLoading = $state(true)
	/** Radio positions the server has not answered yet. Reassigned, never mutated. */
	let capabilityPending = $state<Record<string, OverrideState>>({})
	let lastToggledCapability: string | null = null
	let capabilityRows = $derived(
		buildCapabilityRows({
			type: capabilities?.type,
			preset: capabilities?.preset,
			capabilities: capabilities?.capabilities
		})
	)

	const capabilityPositionOf = (row: CapabilityRow): OverrideState =>
		capabilityPending[row.id] ?? row.state

	function chooseCapability(row: CapabilityRow, state: OverrideState) {
		const option = OVERRIDE_STATES.find((s) => s.value === state)
		if (!option) return
		capabilityPending = { ...capabilityPending, [row.id]: state }
		lastToggledCapability = row.id
		// `wire` carries the three-state rule: Auto sends null, which the handler
		// reads as DELETE the key — handing authority back to the probe rather
		// than writing a `false` that would outrank every test from then on.
		socket.emit("connections:setCapability", {
			id: connectionId,
			capability: row.id,
			value: option.wire
		})
	}

	function handleCapabilities(
		msg: Sockets.Connections.Capabilities.Response
	) {
		if (msg.connectionId !== connectionId) return
		capabilitiesLoading = false
		if (msg.error) return
		capabilities = msg
		// Replaced wholesale: the chips and the provenance lines are the server's
		// answer, and the optimistic radio positions go with them.
		capabilityPending = {}
		const toggled = lastToggledCapability
		lastToggledCapability = null
		if (!toggled) return
		const row = [
			...capabilityRows.transforms,
			...capabilityRows.features
		].find((r) => r.id === toggled)
		// An explicit off does not survive the SDK's closure — KoboldCPP's tool
		// calling comes back emulated through its native grammar — and a radio
		// that silently snapped back would read as a lost click.
		if (row?.contested && row.derived)
			announce(`${row.label}: ${row.derived}`)
	}

	function handleCapabilitiesError() {
		// The :error events carry an error string and nothing else, so this can't
		// tell whose failure it was: it only stops the spinner and drops the
		// optimistic positions so the control falls back to the last answer the
		// server actually gave.
		capabilitiesLoading = false
		capabilityPending = {}
	}

	function buildConnection() {
		return {
			id: connectionId,
			name: name.trim(),
			type,
			baseUrl: baseUrl.trim(),
			model: model.trim(),
			tokenCounter,
			promptFormat,
			// Carried, not edited — see handleConnectionsGet.
			preset,
			extraJson: apiKey.trim() ? { apiKey: apiKey.trim() } : {}
		}
	}

	function fetchModels() {
		socket.emit("connections:refreshModels", {
			connection: buildConnection()
		})
	}

	function testConnection() {
		testing = true
		testResult = null
		socket.emit("connections:test", { connection: buildConnection() })
	}

	function submit(event: SubmitEvent) {
		event.preventDefault()
		error = ""
		if (!name.trim()) {
			error = "Connection name is required."
			announce(error)
			return
		}
		saving = true
		socket.emit("connections:update", {
			connection: buildConnection() as any
		})
	}

	function deleteConnection() {
		if (!confirm("Delete this connection? This cannot be undone.")) return
		deleting = true
		socket.emit("connections:delete", { id: connectionId })
	}

	function handleConnectionsGet(msg: Sockets.Connections.Get.Response) {
		loaded = true
		if (!msg.connection) {
			notFound = true
			return
		}
		const c = msg.connection
		name = c.name
		type = c.type
		baseUrl = c.baseUrl || ""
		model = c.model || ""
		apiKey = (c.extraJson as any)?.apiKey || ""
		tokenCounter = c.tokenCounter
		promptFormat = c.promptFormat || PromptFormats.VICUNA
		// Nothing on this page edits the preset, but it has to round-trip: the
		// test path resolves capabilities against the FORM's type AND preset, so
		// omitting it drops the preset layer and persists the adapter's bare
		// defaults over a preset-derived set.
		preset = (c as { preset?: string | null }).preset ?? null
	}
	function handleConnectionsRefreshModels(msg: any) {
		availableModels = msg.models || []
		if (msg.error) {
			error = msg.error
			announce(error)
		} else {
			announce(
				`${availableModels.length} model${availableModels.length === 1 ? "" : "s"} found.`
			)
		}
	}
	function handleConnectionsTest(msg: Sockets.Connections.Test.Response) {
		testing = false
		testResult = { ok: msg.ok, error: msg.error ?? undefined }
		announce(
			testResult.ok
				? "Connection test succeeded."
				: `Connection test failed: ${testResult.error || "Unknown error"}`
		)
		// A passing test rewrote the capability column, so re-READ it rather than
		// apply `msg.capabilities`: that carries the resolved set but neither
		// `probe.found` nor `probe.at`, so applying it would print "nothing has
		// tested this connection yet" one second after somebody tested it.
		if (msg.ok && msg.connectionId === connectionId)
			socket.emit("connections:capabilities", { id: connectionId })
	}
	function handleConnectionsUpdate(msg: any) {
		saving = false
		if (!msg.connection) return
		announce("Connection saved.")
		// Re-READ the column, for the same reason the test path does. This is the
		// only surface with a Type picker for an existing connection, and the
		// capability panel renders the SAVED type's key space — so after a type
		// change the rows on screen belong to the old adapter until this lands.
		// Choosing one of them would then hit the server gate and come back as
		// "this connection type has no such capability", for a switch this page
		// itself just offered.
		socket.emit("connections:capabilities", { id: connectionId })
	}
	function handleConnectionsUpdateError(msg: { error?: string }) {
		saving = false
		error = msg.error || "Failed to save connection."
		announce(error)
	}
	function handleConnectionsDelete() {
		goto("/document-view/connections")
	}

	onMount(() => {
		socket.on("connections:get", handleConnectionsGet)
		socket.on("connections:refreshModels", handleConnectionsRefreshModels)
		socket.on("connections:test", handleConnectionsTest)
		socket.on("connections:update", handleConnectionsUpdate)
		socket.on("connections:update:error", handleConnectionsUpdateError)
		socket.on("connections:delete", handleConnectionsDelete)
		socket.on("connections:capabilities", handleCapabilities)
		socket.on("connections:setCapability", handleCapabilities)
		socket.on("connections:capabilities:error", handleCapabilitiesError)
		socket.on("connections:setCapability:error", handleCapabilitiesError)
		socket.emit("connections:get", { id: connectionId })
		socket.emit("connections:capabilities", { id: connectionId })
		return () => {
			socket.off("connections:get", handleConnectionsGet)
			socket.off(
				"connections:refreshModels",
				handleConnectionsRefreshModels
			)
			socket.off("connections:test", handleConnectionsTest)
			socket.off("connections:update", handleConnectionsUpdate)
			socket.off("connections:update:error", handleConnectionsUpdateError)
			socket.off("connections:delete", handleConnectionsDelete)
			// By named reference, like every off above it: a bare
			// socket.off("connections:capabilities") would take down the
			// first-registered listener for the event, whoever owns it.
			socket.off("connections:capabilities", handleCapabilities)
			socket.off("connections:setCapability", handleCapabilities)
			socket.off(
				"connections:capabilities:error",
				handleCapabilitiesError
			)
			socket.off(
				"connections:setCapability:error",
				handleCapabilitiesError
			)
		}
	})
</script>

<svelte:head>
	<title>Edit Connection — Document View — Serene Pub</title>
</svelte:head>

<h1>Edit Connection</h1>
<p><a href="/document-view/connections">Back to Connections</a></p>

{#if !userCtx.user?.isAdmin}
	<p>Admin access required.</p>
{:else if !loaded}
	<p>Loading…</p>
{:else if notFound}
	<p>Connection not found.</p>
{:else}
	{#if error}
		<div class="a11y-status a11y-status-error" role="alert">
			<p class="a11y-error-text">{error}</p>
		</div>
	{/if}

	<form onsubmit={submit}>
		<div class="a11y-field">
			<label for="a11y-conn-name">Connection Name</label>
			<input
				id="a11y-conn-name"
				type="text"
				required
				bind:value={name}
				disabled={saving}
			/>
		</div>

		<div class="a11y-field">
			<label for="a11y-conn-type">Provider Type</label>
			<select id="a11y-conn-type" bind:value={type} disabled={saving}>
				{#each typeOptions as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>

		<div class="a11y-field">
			<label for="a11y-conn-base-url">Base URL</label>
			<input
				id="a11y-conn-base-url"
				type="text"
				required
				bind:value={baseUrl}
				disabled={saving}
			/>
		</div>

		<div class="a11y-field">
			<label for="a11y-conn-api-key">API Key</label>
			<p class="a11y-hint">
				Only required for providers that need one (e.g. OpenAI,
				Anthropic).
			</p>
			<input
				id="a11y-conn-api-key"
				type="password"
				autocomplete="off"
				bind:value={apiKey}
				disabled={saving}
			/>
		</div>

		<div class="a11y-field">
			<label for="a11y-conn-model">Model</label>
			<input
				id="a11y-conn-model"
				type="text"
				list="a11y-conn-model-list"
				bind:value={model}
				disabled={saving}
			/>
			<datalist id="a11y-conn-model-list">
				{#each availableModels as m}
					<option value={m.model || m.name || m.id}>
						{m.name || m.model || m.id}
					</option>
				{/each}
			</datalist>
		</div>

		<div class="a11y-list-item-actions">
			<button
				type="button"
				class="a11y-btn a11y-btn-secondary a11y-btn-small"
				onclick={fetchModels}
				disabled={saving}
			>
				Fetch Available Models
			</button>
			<button
				type="button"
				class="a11y-btn a11y-btn-secondary a11y-btn-small"
				onclick={testConnection}
				disabled={saving || testing}
			>
				{testing ? "Testing…" : "Test Connection"}
			</button>
		</div>
		{#if testResult}
			<p class={testResult.ok ? "" : "a11y-error-text"}>
				{testResult.ok
					? "Connection test succeeded."
					: `Connection test failed: ${testResult.error || "Unknown error"}`}
			</p>
		{/if}

		<div class="a11y-field">
			<label for="a11y-conn-prompt-format">Prompt Format</label>
			<select
				id="a11y-conn-prompt-format"
				bind:value={promptFormat}
				disabled={saving}
			>
				{#each PromptFormats.options as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>

		<div class="a11y-field">
			<label for="a11y-conn-token-counter">Token Counter</label>
			<select
				id="a11y-conn-token-counter"
				bind:value={tokenCounter}
				disabled={saving}
			>
				{#each TokenCounterOptions.options as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>

		<p class="a11y-hint">
			Advanced provider-specific options (streaming, thinking, keep-alive,
			etc.) aren't available in Document View yet — use the standard site
			for those.
		</p>

		<button type="submit" class="a11y-btn" disabled={saving}>
			{saving ? "Saving…" : "Save Changes"}
		</button>
		<button
			type="button"
			class="a11y-btn a11y-btn-danger"
			onclick={deleteConnection}
			disabled={deleting}
		>
			{deleting ? "Deleting…" : "Delete Connection"}
		</button>
	</form>

	<!-- Outside the form on purpose: each switch saves itself the moment it is
	     chosen, over its own event, and has nothing to do with Save Changes. -->
	<section aria-labelledby="a11y-cap-heading">
		<h2 id="a11y-cap-heading">What this connection can do</h2>
		<p class="a11y-hint">
			Auto follows this service's preset and the last successful test.
			Switch one by hand only when you know better than the backend does —
			a hand-set value outranks every test that comes after it. Each
			choice saves immediately.
		</p>
		<p class="a11y-hint">{capabilityRows.testedText}</p>
		{#if capabilitiesLoading}
			<p>Loading…</p>
		{:else if !capabilityRows.declared}
			<p>
				Nothing is declared for this connection type, so there is
				nothing to switch.
			</p>
		{:else}
			{#each capabilityRows.transforms as row (row.id)}
				{@render capabilityFieldset(row)}
			{/each}
			{#if capabilityRows.features.length}
				<details>
					<summary>
						Advanced — {capabilityRows.featuresOnLabels.length
							? `${joinWithAnd(capabilityRows.featuresOnLabels)} on`
							: "nothing on"}
					</summary>
					{#each capabilityRows.features as row (row.id)}
						{@render capabilityFieldset(row)}
					{/each}
				</details>
			{/if}
		{/if}
	</section>
{/if}

{#snippet capabilityFieldset(row: CapabilityRow)}
	<fieldset>
		<legend>{row.label}</legend>
		{#if row.tagline}
			<p class="a11y-hint">{row.tagline}</p>
		{/if}
		<p class="a11y-cap-state">
			{row.stateLabel}{row.assumed ? " (assumed)" : ""}
		</p>
		<div class="a11y-cap-choices">
			{#each OVERRIDE_STATES as option (option.value)}
				<label class="a11y-cap-choice">
					<input
						type="radio"
						name={`a11y-cap-${row.id}`}
						value={option.value}
						checked={capabilityPositionOf(row) === option.value}
						onchange={() => chooseCapability(row, option.value)}
					/>
					{option.label}
				</label>
			{/each}
		</div>
		<p class="a11y-cap-note">{row.provenance}</p>
		{#if row.derived}
			<p class="a11y-cap-note">{row.derived}</p>
		{/if}
	</fieldset>
{/snippet}

<style>
	/* Document View's base rule stretches every input to the full field width
	   (see .a11y-root :where(input, select, textarea) in accessible.css) — right
	   for a text box, nonsense for a radio. Overridden here rather than there
	   because this is the first radio group on the surface, and a global rule
	   should be written when there is a second one to agree with it. */
	.a11y-cap-choices {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25em;
		margin: 0.5em 0;
	}
	.a11y-cap-choice {
		display: flex;
		align-items: center;
		gap: 0.5em;
		font-weight: 400;
	}
	.a11y-cap-choice input[type="radio"] {
		width: 1.4em;
		height: 1.4em;
		min-height: 0;
	}
	.a11y-cap-state {
		font-weight: 700;
		margin: 0;
	}
	.a11y-cap-note {
		margin: 0.25em 0 0 0;
		font-size: 0.9em;
	}
</style>
