<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { announce } from "$lib/client/accessibility/state.svelte"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
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

	const socket = useTypedSocket()
	/**
	 * The format picker's options, read from `completion_templates` instead of
	 * the eight-entry constant that used to sit beside the table — so a template
	 * an admin authored is offered by the one control that selects it. Falls back
	 * to the built-ins until the reply lands.
	 */
	const formatOptions = completionTemplateOptions()
	let userCtx: UserCtx = getContext("userCtx")

	// KoboldCPP Manager connections — text and image both — are created from
	// the KoboldCPP Manager page, not this generic form; see
	// /document-view/koboldcpp.
	const typeOptions = CONNECTION_TYPE.options.filter(
		(o) => !isKoboldCppManagedType(o.value)
	)

	let name = $state("")
	let type = $state(CONNECTION_TYPE.OLLAMA)
	/**
	 * Which METHOD a connection of this type is called by.
	 *
	 * Nothing is saved yet, so there is no resolved capability set to read and
	 * the TYPE's own declaration is the whole answer — which is the correct one
	 * for a connection nobody has tested or toggled. It moves with the service
	 * picker above, so choosing Anthropic hides a control Anthropic has no use
	 * for.
	 */
	const showFormat = $derived(
		usesCompletionTemplate(wireModeFor(type, undefined))
	)
	let baseUrl = $state(CONNECTION_DEFAULTS[CONNECTION_TYPE.OLLAMA].baseUrl)
	let model = $state("")
	let apiKey = $state("")
	let tokenCounter = $state(TokenCounterOptions.ESTIMATE)
	let promptFormat = $state(PromptFormats.VICUNA)
	/** The user's own reminder about this connection; see schema.ts. Free text,
	 *  read by nobody. */
	let notes = $state("")
	let error = $state("")
	let saving = $state(false)

	let availableModels: any[] = $state([])
	let testResult: { ok: boolean; error?: string } | null = $state(null)
	let testing = $state(false)

	function onTypeChange() {
		const defaults = (CONNECTION_DEFAULTS as any)[type]
		if (defaults) {
			baseUrl = defaults.baseUrl || ""
			tokenCounter = defaults.tokenCounter || TokenCounterOptions.ESTIMATE
			promptFormat = defaults.promptFormat || PromptFormats.VICUNA
		}
		availableModels = []
		testResult = null
	}

	function buildConnection() {
		return {
			name: name.trim(),
			type,
			baseUrl: baseUrl.trim(),
			model: model.trim(),
			tokenCounter,
			promptFormat,
			// NULL rather than "" for a blank one, so "never wrote a note" has
			// exactly one spelling in the column.
			notes: normalizeNote(notes),
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
		if (!baseUrl.trim()) {
			error = "Base URL is required."
			announce(error)
			return
		}
		saving = true
		socket.emit("connections:create", {
			connection: buildConnection() as any
		})
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
	}
	function handleConnectionsCreate(msg: any) {
		saving = false
		if (msg.connection) goto("/document-view/connections")
	}
	function handleConnectionsCreateError(msg: { error?: string }) {
		saving = false
		error = msg.error || "Failed to create connection."
		announce(error)
	}

	onMount(() => {
		socket.on("connections:refreshModels", handleConnectionsRefreshModels)
		socket.on("connections:test", handleConnectionsTest)
		socket.on("connections:create", handleConnectionsCreate)
		socket.on("connections:create:error", handleConnectionsCreateError)
		return () => {
			socket.off(
				"connections:refreshModels",
				handleConnectionsRefreshModels
			)
			socket.off("connections:test", handleConnectionsTest)
			socket.off("connections:create", handleConnectionsCreate)
			socket.off("connections:create:error", handleConnectionsCreateError)
		}
	})
</script>

<svelte:head>
	<title>New Connection — Document View — Serene Pub</title>
</svelte:head>

<h1>New Connection</h1>
<p><a href="/document-view/connections">Back to Connections</a></p>

{#if !userCtx.user?.isAdmin}
	<p>Admin access required.</p>
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
		     design systems, which is the drift the edit form's own capability
		     panel documents refusing. -->
		<div class="a11y-field">
			<label for="a11y-conn-type">Service Type</label>
			<select
				id="a11y-conn-type"
				bind:value={type}
				onchange={onTypeChange}
				disabled={saving}
			>
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
			{saving ? "Creating…" : "Create Connection"}
		</button>
	</form>
{/if}
