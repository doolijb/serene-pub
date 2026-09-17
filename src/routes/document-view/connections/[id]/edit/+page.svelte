<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		declareInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { announce } from "$lib/client/accessibility/state.svelte"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { isKoboldCppManagedType } from "$lib/shared/utils/connectionServiceItems"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import {
		NOTE_MAX_LENGTH,
		normalizeNote
	} from "$lib/shared/utils/connectionNotes"
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import {
		usesCompletionTemplate,
		wireModeFor
	} from "$lib/shared/connectionAdapters/wireMode"
	import { joinWithAnd } from "$lib/shared/utils/joinWithAnd"
	import {
		buildCapabilityRows,
		OVERRIDE_STATES,
		type CapabilityRow,
		type OverrideState
	} from "$lib/shared/connectionAdapters/capabilityRows"

	const socket = useTypedSocket()
	/**
	 * The format picker's options, read from `completion_templates` instead of
	 * the eight-entry constant that used to sit beside the table — so a template
	 * an admin authored is offered by the one control that selects it. Falls back
	 * to the built-ins until the reply lands.
	 */
	const formatOptions = completionTemplateOptions()
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
	let apiKey = $state("")
	let tokenCounter = $state(TokenCounterOptions.ESTIMATE)
	let promptFormat = $state(PromptFormats.VICUNA)
	/** The user's own reminder about this connection; see schema.ts. Free text,
	 *  read by nobody. */
	let notes = $state("")
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
	/**
	 * A save that SUCCEEDED but did not store everything it was sent — today,
	 * only a preset slug the server refused (see Update.Response's `notice`).
	 *
	 * Its own state and its own `role="status"` box rather than a second use of
	 * `error` above: the connection did save, and an alert saying otherwise
	 * would be the wrong sentence in the wrong politeness level.
	 */
	let notice = $state("")
	let saving = $state(false)
	let deleting = $state(false)

	/**
	 * The endpoint's MODELS, read-only.
	 *
	 * An endpoint has no model of its own — a `connection_models` row is a
	 * model, and a default is an (endpoint, model) PAIR registered per
	 * capability on Admin → Defaults. So this page shows what the endpoint
	 * offers and edits none of it: model editing lives in the Connections
	 * sidebar, and a second editor on a smaller surface would be a second
	 * place to set the same thing.
	 */
	let models = $state<Sockets.Connections.Models.ModelRow[]>([])
	let modelsLoading = $state(true)
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
	/**
	 * Which METHOD this connection is called by, from the same response the
	 * capability section renders — so the format picker appears and disappears
	 * with the switch that governs it, in one round trip.
	 */
	const showFormat = $derived(
		usesCompletionTemplate(
			wireModeFor(type, (capabilities?.capabilities as any)?.resolved)
		)
	)
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
			tokenCounter,
			promptFormat,
			// NULL rather than "" for a blank one, so "never wrote a note" has
			// exactly one spelling in the column.
			notes: normalizeNote(notes),
			// Carried, not edited — see handleConnectionsGet.
			preset,
			extraJson: apiKey.trim() ? { apiKey: apiKey.trim() } : {}
		}
	}

	function testConnection() {
		testing = true
		testResult = null
		socket.emit("connections:test", { connection: buildConnection() })
	}

	function submit(event: SubmitEvent) {
		event.preventDefault()
		error = ""
		notice = ""
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
		apiKey = (c.extraJson as any)?.apiKey || ""
		tokenCounter = c.tokenCounter
		promptFormat = c.promptFormat || PromptFormats.VICUNA
		// "" for a NULL note, because a textarea has no null: the save path
		// turns a blank one back into NULL rather than storing the empty string.
		notes = (c as { notes?: string | null }).notes ?? ""
		// Nothing on this page edits the preset, but it has to round-trip: the
		// test path resolves capabilities against the FORM's type AND preset, so
		// omitting it drops the preset layer and persists the adapter's bare
		// defaults over a preset-derived set.
		preset = (c as { preset?: string | null }).preset ?? null
	}
	function handleConnectionsModels(msg: Sockets.Connections.Models.Response) {
		// `emitToUser` reaches every open tab for this user, not just the one
		// that asked — the same guard the capability handlers carry.
		if (msg.connectionId !== connectionId) return
		modelsLoading = false
		if (msg.error) return
		models = msg.models ?? []
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
		// Re-seeded from the SAVED row rather than left as the form last had it.
		// This is the only surface with a Type picker, so it is the only one that
		// can strand the preset it carries — and the server clears a stranded one
		// on write. Without this the next Save would re-send the dead slug and
		// earn the same notice again.
		preset = (msg.connection as { preset?: string | null }).preset ?? null
		// Saved, but not exactly as sent. `notice` is only ever present when the
		// server discarded something the payload claimed, so it gets its own
		// status box rather than being left for the user to notice a preset had
		// gone. ONE announce() call carrying both halves: the announcer clears
		// and re-sets on the next frame, so a second call in the same tick would
		// simply replace the first and "Connection saved." would never be read.
		notice = msg.notice ?? ""
		announce(notice ? `Connection saved. ${notice}` : "Connection saved.")
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

	/**
	 * The one SCOPED key on this page. `connections:get` extracts its scope
	 * from `connection.id`, and this page opens exactly one endpoint — so
	 * another tab loading a different one cannot refill this form underneath
	 * the typing. Declared in its own effect with the id as a dependency,
	 * because `useInterest` reads its key once and this one moves with the
	 * route parameter.
	 */
	$effect(() =>
		declareInterest<"connections:get">(
			interestKey("connections:get", connectionId),
			handleConnectionsGet
		)
	)
	/**
	 * Everything else BARE — none of these events is in `SCOPED_EVENTS` — and
	 * STANDING: each answers a write this page makes more than once, and the
	 * capability panel re-reads its column after a test and after a save.
	 * Declared ABOVE the mount that asks, because effects run in creation order
	 * and a request flushes the pending interest sync.
	 */
	useInterest<"connections:models">(
		"connections:models",
		handleConnectionsModels
	)
	useInterest<"connections:test">("connections:test", handleConnectionsTest)
	useInterest<"connections:update">(
		"connections:update",
		handleConnectionsUpdate
	)
	useInterest<"connections:update:error">(
		"connections:update:error",
		handleConnectionsUpdateError
	)
	useInterest<"connections:delete">(
		"connections:delete",
		handleConnectionsDelete
	)
	useInterest<"connections:capabilities">(
		"connections:capabilities",
		handleCapabilities
	)
	useInterest<"connections:setCapability">(
		"connections:setCapability",
		handleCapabilities
	)
	useInterest<"connections:capabilities:error">(
		"connections:capabilities:error",
		handleCapabilitiesError
	)
	useInterest<"connections:setCapability:error">(
		"connections:setCapability:error",
		handleCapabilitiesError
	)

	onMount(() => {
		socket.emit("connections:get", { id: connectionId })
		socket.emit("connections:models", { id: connectionId })
		socket.emit("connections:capabilities", { id: connectionId })
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

	{#if notice}
		<div class="a11y-status" role="status">
			<p>{notice}</p>
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

		<!-- The pickers on this form stay native <select>s deliberately, and a
		     later sweep should leave them alone. Document View is not the
		     Skeleton surface: the root layout strips data-mode/data-theme off
		     <html> for as long as this shell is mounted, so Skeleton's palette
		     falls back to greyscale (--color-primary-500 resolves to
		     oklch(0.556 0 0) here), and Combobox portals its popup to <body> —
		     OUTSIDE .a11y-root, which is where both the mode palette and
		     --a11y-font-scale live. Measured with inputs/Select.svelte dropped
		     into this shell: an rgb(245,245,245) popup over the rgb(13,13,13)
		     page, a selected row at 4.54:1 against accessible.css's stated AAA
		     7:1 floor, and a list stuck at 14px while the page sat at 32px
		     under this surface's own 200% text control — WCAG 1.4.4, on the
		     surface that exists for it. Native also hands AT the platform
		     picker, which is the strongest control here, not the weakest.
		     Styling it for Document View would mean teaching one component two
		     design systems, which this page already refuses to do for the
		     capability rows below. -->
		<div class="a11y-field">
			<label for="a11y-conn-type">Service Type</label>
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
				Only required for services that need one (e.g. OpenAI,
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
			<h2>Models</h2>
			<p class="a11y-hint">
				The models this endpoint offers. Read-only here — models are
				added, renamed and switched off in the Connections panel, and
				which model is used for what is set on the
				<a href="/admin/defaults">Defaults page</a>
				.
			</p>
			{#if modelsLoading}
				<p>Loading…</p>
			{:else if models.length === 0}
				<p>No models listed for this connection yet.</p>
			{:else}
				<ul class="a11y-list">
					{#each models as m (m.id)}
						<li class="a11y-list-item">
							{m.name}
							{#if !m.enabled}
								<strong>· off</strong>
							{/if}
							{#if m.missingSince}
								<strong>· not listed</strong>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="a11y-list-item-actions">
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

		<!-- A completion template only means something in COMPLETION wire mode:
		     in chat mode the roles carry the structure, no delimiter is emitted
		     and no stop string from the template is sent, so this control would
		     change no byte of any request. The wire-mode switches themselves are
		     in the Capabilities section, with everything else the connection
		     declares. -->
		{#if showFormat}
			<div class="a11y-field">
				<label for="a11y-conn-prompt-format">Prompt Format</label>
				<select
					id="a11y-conn-prompt-format"
					bind:value={promptFormat}
					disabled={saving}
				>
					{#each formatOptions.value as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>
		{/if}

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

		<div class="a11y-field">
			<label for="a11y-conn-notes">Notes</label>
			<p class="a11y-hint">
				For you, not for the app — "use this one for prose, the other
				for extraction". Shown beside this connection wherever you pick
				one. Nothing reads it.
			</p>
			<textarea
				id="a11y-conn-notes"
				rows="3"
				maxlength={NOTE_MAX_LENGTH}
				bind:value={notes}
				disabled={saving}
			></textarea>
		</div>

		<p class="a11y-hint">
			Advanced service-specific options (streaming, thinking, keep-alive,
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
		{#if capabilityRows.wireModeText}
			<p class="a11y-hint">{capabilityRows.wireModeText}</p>
		{/if}
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
