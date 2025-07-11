<script lang="ts">
	import * as skio from "sveltekit-io"
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import OllamaForm from "$lib/client/connectionForms/OllamaForm.svelte"
	import OpenAIForm from "$lib/client/connectionForms/OpenAIForm.svelte"
	import LmStudioForm from "$lib/client/connectionForms/LMStudioForm.svelte"
	import {
		CONNECTION_TYPE,
		CONNECTION_TYPES
	} from "$lib/shared/constants/ConnectionTypes"
	import LlamaCppForm from "$lib/client/connectionForms/LlamaCppForm.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()
	let userCtx: UserCtx = getContext("userCtx")
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	const socket = skio.get()

	const OAIChatPresets: {
		name: string
		value: number
		connectionDefaults: {
			baseUrl: string
			promptFormat?: string
			tokenCounter?: string
			extraJson: {
				stream: boolean
				prerenderPrompt: boolean
				apiKey: string
			}
		}
	}[] = [
		{
			name: "Empty",
			value: 0,
			connectionDefaults: {
				baseUrl: "",
				promptFormat: PromptFormats.VICUNA,
				tokenCounter: TokenCounterOptions.ESTIMATE,
				extraJson: {
					stream: true,
					prerenderPrompt: false,
					apiKey: ""
				}
			}
		},
		{
			name: "Ollama",
			value: 1,
			connectionDefaults: {
				baseUrl: "http://localhost:11434/v1/",
				promptFormat: PromptFormats.VICUNA,
				tokenCounter: TokenCounterOptions.ESTIMATE,
				extraJson: {
					stream: true,
					prerenderPrompt: false,
					apiKey: "ollama"
				}
			}
		},
		// {
		// 	name: "LM Studio",
		// 	value: 2,
		// 	connectionDefaults: {
		// 		baseUrl: "http://localhost:1234/v1/",
		// 		promptFormat: PromptFormats.VICUNA,
		// 		tokenCounter: TokenCounterOptions.ESTIMATE,
		// 		extraJson: {
		// 			stream: true,
		// 			prerenderPrompt: false,
		// 			apiKey: "",
		// 		}
		// 	}
		// }
		{
			name: "OpenRouter",
			value: 3,
			connectionDefaults: {
				baseUrl: "https://openrouter.ai/api/v1/",
				promptFormat: PromptFormats.OPENAI,
				tokenCounter: TokenCounterOptions.ESTIMATE,
				extraJson: {
					stream: true,
					prerenderPrompt: false,
					apiKey: ""
				}
			}
		},
		{
			name: "OpenAI (Official)",
			value: 4,
			connectionDefaults: {
				baseUrl: "https://api.openai.com/v1/",
				promptFormat: PromptFormats.OPENAI,
				tokenCounter: TokenCounterOptions.OPENAI_GPT4O,
				extraJson: {
					stream: true,
					prerenderPrompt: false,
					apiKey: ""
				}
			}
		},
		{
			name: "LocalAI",
			value: 5,
			connectionDefaults: {
				baseUrl: "http://localhost:8080/v1/",
				promptFormat: PromptFormats.OPENAI,
				tokenCounter: TokenCounterOptions.ESTIMATE,
				extraJson: {
					stream: true,
					prerenderPrompt: false,
					apiKey: ""
				}
			}
		},
		{
			name: "AnyScale",
			value: 6,
			connectionDefaults: {
				baseUrl: "https://api.endpoints.anyscale.com/v1/",
				promptFormat: PromptFormats.OPENAI,
				tokenCounter: TokenCounterOptions.ESTIMATE,
				extraJson: {
					stream: true,
					prerenderPrompt: false,
					apiKey: ""
				}
			}
		},
		{
			name: "Groq",
			value: 7,
			connectionDefaults: {
				baseUrl: "https://api.groq.com/openai/v1/",
				promptFormat: PromptFormats.OPENAI,
				tokenCounter: TokenCounterOptions.ESTIMATE,
				extraJson: {
					stream: true,
					prerenderPrompt: false,
					apiKey: ""
				}
			}
		},
		{
			name: "Together AI",
			value: 8,
			connectionDefaults: {
				baseUrl: "https://api.together.xyz/v1/",
				promptFormat: PromptFormats.OPENAI,
				tokenCounter: TokenCounterOptions.ESTIMATE,
				extraJson: {
					stream: true,
					prerenderPrompt: false,
					apiKey: ""
				}
			}
		},
		{
			name: "DeepInfra",
			value: 9,
			connectionDefaults: {
				baseUrl: "https://api.deepinfra.com/v1/openai/",
				promptFormat: PromptFormats.OPENAI,
				tokenCounter: TokenCounterOptions.ESTIMATE,
				extraJson: {
					stream: true,
					prerenderPrompt: false,
					apiKey: ""
				}
			}
		},
		{
			name: "Fireworks AI",
			value: 10,
			connectionDefaults: {
				baseUrl: "https://api.fireworks.ai/inference/v1/",
				promptFormat: PromptFormats.OPENAI,
				tokenCounter: TokenCounterOptions.ESTIMATE,
				extraJson: {
					stream: true,
					prerenderPrompt: false,
					apiKey: ""
				}
			}
		},
		{
			name: "Perplexity AI",
			value: 11,
			connectionDefaults: {
				baseUrl: "https://api.perplexity.ai/v1/",
				promptFormat: PromptFormats.OPENAI,
				tokenCounter: TokenCounterOptions.ESTIMATE,
				extraJson: {
					stream: true,
					prerenderPrompt: false,
					apiKey: ""
				}
			}
		},
		{
			name: "KoboldCPP",
			value: 12,
			connectionDefaults: {
				baseUrl: "http://localhost:5001/v1/",
				promptFormat: PromptFormats.OPENAI,
				tokenCounter: TokenCounterOptions.ESTIMATE,
				extraJson: {
					stream: true,
					prerenderPrompt: false,
					apiKey: ""
				}
			}
		}
	]

	// --- State ---
	let connectionsList: SelectConnection[] = $state([])
	let connection: Sockets.Connection.Response["connection"] | undefined =
		$state()
	let originalConnection = $state()
	let unsavedChanges = $derived.by(() => {
		if (!connection || !originalConnection) return false
		return JSON.stringify(connection) !== JSON.stringify(originalConnection)
	})
	let editingField: string | null = $state(null)
	let showConfirmModal = $state(false)
	let confirmResolve: ((v: boolean) => void) | null = null
	let testResult: { ok: boolean; error?: string; models?: any[] } | null =
		$state(null)
	let refreshModelsResult: { models?: any[]; error?: string } | null =
		$state(null)
	let showNewConnectionModal = $state(false)
	let newConnectionName = $state("")
	let newConnectionType = $state(CONNECTION_TYPES[0].value)
	let newConnectionOAIChatPreset: number | undefined = $state()
	let showDeleteModal = $state(false)

	function handleSelectChange(e: Event) {
		socket.emit("setUserActiveConnection", {
			id: +(e.target as HTMLSelectElement).value
		})
	}
	function handleNew() {
		newConnectionName = ""
		newConnectionType = CONNECTION_TYPES[0].value
		showNewConnectionModal = true
	}
	function handleNewConnectionConfirm() {
		if (!newConnectionName.trim()) {
			toaster.error({ title: "Connection name is required" })
			return
		}
		if (newConnectionType === CONNECTION_TYPE.OPENAI_CHAT) {
			const preset = OAIChatPresets.find(
				(p) => p.value === newConnectionOAIChatPreset
			)
			if (!preset) {
				toaster.error({ title: "Invalid OpenAI Chat preset" })
				return
			}
		}
		const newConn = {
			name: newConnectionName.trim(),
			type: newConnectionType,
			enabled: true,
			...(newConnectionType === CONNECTION_TYPE.OPENAI_CHAT
				? OAIChatPresets.find(
						(p) => p.value === newConnectionOAIChatPreset
					)?.connectionDefaults
				: {})
		}
		socket.emit("createConnection", { connection: newConn })
		showNewConnectionModal = false
	}
	function handleNewConnectionCancel() {
		showNewConnectionModal = false
	}
	function handleUpdate() {
		socket.emit("updateConnection", { connection })
	}
	function handleReset() {
		connection = { ...originalConnection }
	}
	function handleDelete() {
		showDeleteModal = true
	}
	function handleDeleteModalConfirm() {
		if (connection) {
			socket.emit("deleteConnection", { id: connection.id })
		}
		showDeleteModal = false
	}
	function handleDeleteModalCancel() {
		showDeleteModal = false
	}
	function handleOnClose() {
		if (!unsavedChanges) return true
		showConfirmModal = true
		return new Promise<boolean>((resolve) => {
			confirmResolve = resolve
		})
	}
	function handleModalDiscard() {
		showConfirmModal = false
		if (confirmResolve) confirmResolve(true)
	}
	function handleModalCancel() {
		showConfirmModal = false
		if (confirmResolve) confirmResolve(false)
	}
	function handleRefreshModels() {
		refreshModelsResult = null
		socket.emit("refreshModels", { baseUrl: connection?.baseUrl })
	}

	onMount(() => {
		socket.on(
			"connectionsList",
			(msg: Sockets.ConnectionsList.Response) => {
				connectionsList = msg.connectionsList
					.slice()
					.sort((a, b) => a.name!.localeCompare(b.name!))
			}
		)
		socket.on("connection", (msg: Sockets.Connection.Response) => {
			connection = { ...msg.connection }
			originalConnection = { ...msg.connection }
		})
		socket.on("testConnection", (msg: Sockets.TestConnection.Response) => {
			testResult = msg
		})
		socket.on("refreshModels", (msg: Sockets.RefreshModels.Response) => {
			refreshModelsResult = msg.models || []
		})
		socket.on(
			"updateConnection",
			(msg: Sockets.UpdateConnection.Response) => {
				toaster.success({ title: "Connection Updated" })
			}
		)
		socket.on(
			"deleteConnection",
			(msg: Sockets.DeleteConnection.Response) => {
				toaster.success({ title: "Connection Deleted" })
				connection = undefined
				originalConnection = undefined
			}
		)
		socket.on(
			"createConnection",
			(msg: Sockets.CreateConnection.Response) => {
				toaster.success({ title: "Connection Created" })
			}
		)
		socket.emit("connectionsList", {})
		if (userCtx.user?.activeConnectionId) {
			socket.emit("connection", { id: userCtx.user.activeConnectionId })
		}
		onclose = handleOnClose

		if (connection?.type === "ollama" && connection.baseUrl) {
			handleRefreshModels()
		}
	})

	onDestroy(() => {
		socket.off("connectionsList")
		socket.off("connection")
		socket.off("testConnection")
		socket.off("refreshModels")
		socket.off("updateConnection")
		socket.off("deleteConnection")
		socket.off("createConnection")
		onclose = undefined
	})
</script>

<div class="text-foreground p-4">
		<div class="mt-2 mb-2 flex justify-between gap-2 sm:mt-0">
			<div class="gap-2">
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500"
					onclick={handleNew}
					title="Create New Connection"
					aria-label="Create New Connection"
				>
					<Icons.Plus size={16} />
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-secondary-500"
					onclick={handleReset}
					disabled={!unsavedChanges}
					title="Reset Changes"
					aria-label="Reset Changes"
				>
					<Icons.RefreshCcw size={16} />
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-error-500"
					onclick={handleDelete}
					disabled={!connection}
				>
					<Icons.X size={16} />
				</button>
			</div>
		</div>
		<div
			class="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center"
			class:hidden={!connectionsList.length}
		>
			<select
				class="select bg-background border-muted rounded border"
				onchange={handleSelectChange}
				bind:value={userCtx!.user!.activeConnectionId}
				disabled={unsavedChanges}
			>
				{#each connectionsList as c}
					<option value={c.id}>
						{c.name} ({CONNECTION_TYPE.options.find(
							(t) => t.value === c.type
						)!.label})
					</option>
				{/each}
			</select>
		</div>
		{#if !!connection}
			{#key connection.id}
				<div class="my-4 flex">
					<button
						type="button"
						class="btn btn-sm preset-filled-success-500 w-full"
						onclick={handleUpdate}
						disabled={!unsavedChanges}
					>
						<Icons.Save size={16} />
						Save
					</button>
				</div>
				<div class="flex flex-col gap-1">
					<label class="font-semibold" for="name">Name</label>
					<input
						id="name"
						type="text"
						bind:value={connection.name}
						class="input"
					/>
				</div>
				{#if connection.type === CONNECTION_TYPE.OLLAMA}
					<OllamaForm bind:connection />
				{:else if connection.type === CONNECTION_TYPE.OPENAI_CHAT}
					<OpenAIForm bind:connection />
				{:else if connection.type === CONNECTION_TYPE.LM_STUDIO}
					<LmStudioForm bind:connection />
				{:else if connection.type === CONNECTION_TYPE.LLAMACPP_COMPLETION}
					<LlamaCppForm bind:connection />
				{/if}
			{/key}
		{/if}
		{#if !connectionsList.length}
			<div class="text-muted-foreground py-8 text-center">
				No connections found. Create a new connection to get started.
			</div>
		{/if}
	</div>

<Modal
	open={showConfirmModal}
	onOpenChange={(e) => (showConfirmModal = e.open)}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h2">Confirm</h2>
		</header>
		<article>
			<p class="opacity-60">
				Your connection has unsaved changes. Are you sure you want to
				discard them?
			</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button
				class="btn preset-filled-surface-500"
				onclick={handleModalCancel}
			>
				Cancel
			</button>
			<button
				class="btn preset-filled-error-500"
				onclick={handleModalDiscard}
			>
				Discard
			</button>
		</footer>
	{/snippet}
</Modal>
<Modal
	open={showNewConnectionModal}
	onOpenChange={(e) => (showNewConnectionModal = e.open)}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h2">Create New Connection</h2>
		</header>
		<article class="flex flex-col gap-2">
			<div>
				<label class="font-semibold" for="newConnName">Name</label>
				<input
					id="newConnName"
					type="text"
					class="input w-full"
					bind:value={newConnectionName}
					placeholder="Enter a name..."
					onkeydown={(e) => {
						if (e.key === "Enter" && newConnectionName.trim()) {
							handleNewConnectionConfirm()
						}
					}}
				/>
			</div>
			<div>
				<label class="font-semibold" for="newConnType">Type</label>
				<select
					id="newConnType"
					class="select w-full"
					bind:value={newConnectionType}
				>
					{#each CONNECTION_TYPES as t}
						<option value={t.value}>{t.label}</option>
					{/each}
				</select>
			</div>
			{#if newConnectionType === CONNECTION_TYPE.OPENAI_CHAT}
				<div class="mt-2">
					<label class="font-semibold" for="oaiChatPreset">
						Preset
					</label>
					<select
						id="oaiChatPreset"
						class="select w-full"
						bind:value={newConnectionOAIChatPreset}
					>
						{#each OAIChatPresets as preset}
							<option value={preset.value}>
								{preset.name}
							</option>
						{/each}
					</select>
				</div>
			{/if}
			{#if !!newConnectionType}
				{@const connectionType = CONNECTION_TYPES.find(
					(t) => t.value === newConnectionType
				)}
				<div
					class="bg-surface-500/25 mt-4 flex flex-col gap-2 rounded p-4"
				>
					<span class="preset-filled-primary-500 p-2">
						Difficulty: {connectionType?.difficulty}
					</span>
					{@html connectionType?.description}
				</div>
			{/if}
		</article>
		<footer class="mt-4 flex justify-end gap-4">
			<button
				class="btn preset-filled-surface-500"
				onclick={handleNewConnectionCancel}
			>
				Cancel
			</button>
			<button
				class="btn preset-filled-primary-500"
				onclick={handleNewConnectionConfirm}
				disabled={!newConnectionName.trim()}
			>
				Create
			</button>
		</footer>
	{/snippet}
</Modal>
<Modal
	open={showDeleteModal}
	onOpenChange={(e) => (showDeleteModal = e.open)}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h2">Delete Connection</h2>
		</header>
		<article>
			<p class="opacity-60">
				Are you sure you want to delete this connection? This cannot be
				undone.
			</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button
				class="btn preset-filled-surface-500"
				onclick={handleDeleteModalCancel}
			>
				Cancel
			</button>
			<button
				class="btn preset-filled-error-500"
				onclick={handleDeleteModalConfirm}
			>
				Delete
			</button>
		</footer>
	{/snippet}
</Modal>
