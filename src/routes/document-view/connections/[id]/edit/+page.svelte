<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { announce } from "$lib/client/accessibility/state.svelte"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"

	const socket = useTypedSocket()
	const connectionId = $derived(Number(page.params.id))
	let userCtx: UserCtx = getContext("userCtx")

	const typeOptions = CONNECTION_TYPE.options.filter(
		(o) => o.value !== CONNECTION_TYPE.KOBOLDCPP_MANAGED
	)

	let name = $state("")
	let type = $state(CONNECTION_TYPE.OLLAMA)
	let baseUrl = $state("")
	let model = $state("")
	let apiKey = $state("")
	let tokenCounter = $state(TokenCounterOptions.ESTIMATE)
	let promptFormat = $state(PromptFormats.VICUNA)
	let loaded = $state(false)
	let notFound = $state(false)
	let error = $state("")
	let saving = $state(false)
	let deleting = $state(false)

	let availableModels: any[] = $state([])
	let testResult: { ok: boolean; error?: string } | null = $state(null)
	let testing = $state(false)

	function buildConnection() {
		return {
			id: connectionId,
			name: name.trim(),
			type,
			baseUrl: baseUrl.trim(),
			model: model.trim(),
			tokenCounter,
			promptFormat,
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

	onMount(() => {
		socket.on("connections:get", (msg) => {
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
		})
		socket.on("connections:refreshModels", (msg) => {
			availableModels = msg.models || []
			if (msg.error) {
				error = msg.error
				announce(error)
			} else {
				announce(
					`${availableModels.length} model${availableModels.length === 1 ? "" : "s"} found.`
				)
			}
		})
		socket.on("connections:test", (msg) => {
			testing = false
			testResult = { ok: msg.ok, error: msg.error ?? undefined }
			announce(
				testResult.ok
					? "Connection test succeeded."
					: `Connection test failed: ${testResult.error || "Unknown error"}`
			)
		})
		socket.on("connections:update", (msg) => {
			saving = false
			if (!msg.connection) return
			announce("Connection saved.")
		})
		socket.on("connections:update:error", (msg: { error?: string }) => {
			saving = false
			error = msg.error || "Failed to save connection."
			announce(error)
		})
		socket.on("connections:delete", () => {
			goto("/document-view/connections")
		})
		socket.emit("connections:get", { id: connectionId })
		return () => {
			socket.off("connections:get")
			socket.off("connections:refreshModels")
			socket.off("connections:test")
			socket.off("connections:update")
			socket.off("connections:update:error")
			socket.off("connections:delete")
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
{/if}
