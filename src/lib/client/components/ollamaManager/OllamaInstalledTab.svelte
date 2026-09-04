<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { onMount, onDestroy, getContext } from "svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import type { ListResponse, ModelDetails, ModelResponse } from "ollama"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

	interface OllamaModel {
		name: string
		size: number
		digest: string
		modified_at: string
		details?: {
			parameter_size: string
			quantization_level: string
		}
	}

	const socket = useTypedSocket()

	// State
	let installedModels: OllamaModel[] = $state([])
	let isConnected = $state(true)
	let isLoading = $state(false)
	let searchQuery = $state("")
	let runningModels: ListResponse["models"] = $state([])
	let showDeleteModal = $state(false)
	let modelToDelete: OllamaModel | null = $state(null)
	let connectionsList: Sockets.Connections.List.Response["connectionsList"] =
		$state([])

	// Context
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	const panelsCtx: PanelsCtx = getContext("panelsCtx")

	function findConnectionForModel(
		modelName: string
	):
		| Sockets.Connections.List.Response["connectionsList"][number]
		| undefined {
		return connectionsList.find(
			(c) => c.type === "ollama" && c.model === modelName
		)
	}

	function openConnectionSidebar(modelName: string) {
		const conn = findConnectionForModel(modelName)
		if (!conn) return
		panelsCtx.digest.connectionId = conn.id
		panelsCtx.openPanel({ key: "connections" })
	}

	// Filtered models based on search
	let filteredModels = $derived(
		installedModels
			.filter((model) =>
				model.name.toLowerCase().includes(searchQuery.toLowerCase())
			)
			.sort((a, b) => {
				// Sort if the model is currently connected
				if (currentConnectionModelName === a.name) return -1
				if (currentConnectionModelName === b.name) return 1
				// Sort by name, then by size
				if (a.name < b.name) return -1
				if (a.name > b.name) return 1
				return a.size - b.size
			})
	)

	let currentConnectionModelName: string | null = $derived.by(() => {
		// The instance's CHAT default, from connection_defaults — the only place
		// a default lives since 0181. This tab labels a model "in use", which is
		// a claim about what a reply would actually run on.
		const activeConnection = connectionsList.find(
			(c) =>
				c.id ===
				(systemSettingsCtx.capabilityDefaults?.["text->text"]
					?.connectionId ?? null)
		)
		if (activeConnection?.type === CONNECTION_TYPE.OLLAMA) {
			return activeConnection.model ?? null
		}
		return null
	})

	$effect(() => {})

	// Format file size
	function formatSize(bytes: number): string {
		const units = ["B", "KB", "MB", "GB", "TB"]
		let size = bytes
		let unitIndex = 0

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024
			unitIndex++
		}

		return `${size.toFixed(1)} ${units[unitIndex]}`
	}

	// Format date
	function formatDate(dateString: string): string {
		return new Date(dateString).toLocaleDateString()
	}

	function isModelRunning(model: OllamaModel): boolean {
		const res = runningModels?.some((runningModel) => {
			return runningModel.name === model.name
		})
		return res ?? false
	}

	// Check Ollama connection and refresh models
	async function refreshModels() {
		isLoading = true
		socket.emit("ollama:modelsList", {})
		socket.emit("ollama:listRunningModels", {})
		socket.emit("connections:list", {})
	}

	// Delete a model
	async function deleteModel(model: OllamaModel) {
		if (!isConnected) {
			toaster.error({ title: "Not connected to Ollama" })
			return
		}

		if (currentConnectionModelName === model.name) {
			toaster.error({
				title: "Cannot delete connected model",
				description:
					"Please choose a different connection before deleting it."
			})
			return
		}

		socket.emit("ollama:deleteModel", { modelName: model.name })
	}

	// Delete modal handlers
	function handleDeleteClick(model: OllamaModel) {
		modelToDelete = model
		showDeleteModal = true
	}

	function handleDeleteModalConfirm() {
		if (modelToDelete) {
			deleteModel(modelToDelete)
		}
		showDeleteModal = false
		modelToDelete = null
	}

	function handleDeleteModalCancel() {
		showDeleteModal = false
		modelToDelete = null
	}

	function connectToModel(model: OllamaModel) {
		if (!isConnected) {
			toaster.error({ title: "Not connected to Ollama" })
			return
		}

		if (currentConnectionModelName === model.name) {
			toaster.error({
				title: "Already connected to this model",
				description: "Please choose a different model to connect."
			})
			return
		}

		socket.emit("ollama:connectModel", { modelName: model.name })
	}

	// View model website
	function viewModelWebsite(model: OllamaModel) {
		const modelName = model.name.split(":")[0] // Remove version if present

		// Determine if ollama.com or huggingface.co
		if (modelName.includes("hf.co")) {
			window.open("https://" + modelName, "_blank")
		} else {
			window.open(`https://ollama.com/library/${modelName}`, "_blank")
		}
	}

	// Named so the teardown below can remove just this listener. A bare
	// socket.off("ollama:modelsList") drops *every* handler for the event,
	// including OllamaSidebar's, which uses the same list to decide whether to
	// open on Available during the setup wizard — switching away from this tab
	// would silently deafen the parent. OllamaAvailableTab already scopes its
	// own teardown this way.
	function handleModelsList(message: Sockets.Ollama.ModelsList.Response) {
		installedModels = message.models
		isLoading = false
	}

	onMount(() => {
		// Socket event listeners
		socket.on("ollama:modelsList", handleModelsList)

		socket.on(
			"ollama:deleteModel",
			(message: Sockets.Ollama.DeleteModel.Response) => {
				if (message.success) {
					refreshModels()
					toaster.success({ title: "Model deleted successfully" })
				} else {
					toaster.error({ title: "Failed to delete model" })
				}
			}
		)

		socket.on(
			"ollama:listRunningModels",
			(message: Sockets.Ollama.ListRunningModels.Response) => {
				runningModels = message.runningModels ?? []
			}
		)

		// Note: there is no "ollama:stopModel" server handler (see
		// src/lib/server/sockets/ollama.ts) - it was never implemented, so a
		// listener for it here was unreachable dead code and has been removed.

		socket.on(
			"ollama:connectModel",
			(message: Sockets.Ollama.ConnectModel.Response) => {
				if (message.success) {
					toaster.success({ title: "Model connected successfully" })
					refreshModels()
				}
			}
		)

		socket.on(
			"connections:list",
			(msg: Sockets.Connections.List.Response) => {
				connectionsList = msg.connectionsList ?? []
			}
		)

		// Initial load
		refreshModels()
	})

	onDestroy(() => {
		socket.off("ollama:modelsList", handleModelsList)
		socket.off("ollama:deleteModel")
		socket.off("ollama:listRunningModels")
		socket.off("ollama:connectModel")
		socket.off("connections:list")
	})
</script>

<!-- Search for installed models -->
<div class="py-2">
	<div class="flex gap-2">
		<div class="relative flex-1">
			<Icons.Search
				class="text-surface-700-300 absolute top-1/2 left-3 -translate-y-1/2 transform"
				size={16}
			/>
			<input
				type="text"
				placeholder="Search installed models..."
				class="input w-full pl-10"
				aria-label="Search installed models by name"
				bind:value={searchQuery}
			/>
		</div>
		<button
			class="btn preset-filled-surface-500"
			onclick={refreshModels}
			title="Refresh models"
			aria-label="Refresh installed models list"
		>
			<Icons.RefreshCw size={16} aria-hidden="true" />
		</button>
	</div>
</div>

{#if !isConnected}
	<div class="p-6 text-center">
		<Icons.AlertCircle class="text-error-500 mx-auto mb-4" size={48} />
		<h3 class="h4 mb-2">Cannot connect to Ollama</h3>
		<p class="mb-4 text-sm opacity-75">
			Make sure Ollama is running and accessible at the configured URL.
		</p>
		<button
			class="btn preset-filled-primary-500"
			onclick={refreshModels}
			aria-label="Try connecting to Ollama again"
		>
			<Icons.RefreshCw size={16} aria-hidden="true" />
			Try Again
		</button>
	</div>
{:else if isLoading}
	<div class="p-6 text-center">
		<Icons.Loader2 class="mx-auto mb-4 animate-spin" size={32} />
		<p class="text-sm opacity-75">Loading installed models...</p>
	</div>
{:else if filteredModels.length === 0}
	<div class="p-6 text-center">
		<Icons.Package class="text-surface-700-300 mx-auto mb-4" size={48} />
		<h3 class="h4 mb-2">No models installed</h3>
		<p class="mb-4 text-sm opacity-75">
			Install models from the Available tab to get started.
		</p>
	</div>
{:else}
	<div class="space-y-3 py-4">
		{#each filteredModels as model}
			{@const isRunning = isModelRunning(model)}
			{@const isConnected = currentConnectionModelName === model.name}
			{@const existingConn = findConnectionForModel(model.name)}
			<div class="card preset-filled-surface-100-900 flex flex-col gap-2 p-4">
				<div class="flex items-center justify-between gap-2">
					<h4 class="min-w-0 font-semibold break-all">
						{#if isConnected}
							<Icons.Check
								size={14}
								class="text-success-500 inline-block"
							/>
						{/if}
						{model.name}
					</h4>
				</div>
				<div class="text-surface-600 space-y-1 text-sm">
					<div class="flex justify-between">
						<span>Size:</span>
						<span>{formatSize(model.size)}</span>
					</div>
					<div class="flex justify-between">
						<span>Modified:</span>
						<span>{formatDate(model.modified_at)}</span>
					</div>
					{#if model.details}
						<div class="flex justify-between">
							<span>Parameters:</span>
							<span>{model.details.parameter_size}</span>
						</div>
					{/if}
					{#if isRunning}
						<div class="flex justify-between">
							<span>Status:</span>
							<span
								class="preset-filled-success-500 rounded-xl px-2 py-1"
								role="status"
								aria-label="Model is currently running"
							>
								Running
							</span>
						</div>
					{/if}
				</div>
				<!-- One wrapping group for all of this card's actions. A nested
				     group inside a non-wrapping justify-between row can only
				     resolve by shrinking, which clipped "Set Default". -->
				<div class="panel-actions justify-between">
					<div class="panel-actions">
						<button
							class="btn btn-sm preset-filled-success-500"
							title="Set as default connection"
							aria-label="Set as default connection"
							disabled={isConnected}
							onclick={() => connectToModel(model)}
						>
							{#if isConnected}
								<Icons.Star size={14} fill="currentColor" /> Default
							{:else}
								<Icons.Star size={14} /> Set Default
							{/if}
						</button>
						{#if existingConn}
							<button
								class="btn btn-sm preset-filled-surface-500"
								onclick={() =>
									openConnectionSidebar(model.name)}
								title="Open connection settings"
								aria-label={`Open connection settings for ${model.name}`}
							>
								<Icons.Settings size={14} aria-hidden="true" />
							</button>
						{/if}
						<button
							class="btn btn-sm preset-filled-surface-500"
							onclick={() => viewModelWebsite(model)}
							title="View model website"
							aria-label={`View ${model.name} model website in new tab`}
						>
							<Icons.ExternalLink size={14} aria-hidden="true" /> Edit
						</button>
					</div>
					<button
						class="btn btn-sm preset-filled-error-500"
						onclick={() => handleDeleteClick(model)}
						title="Delete model"
						aria-label={`Delete ${model.name} model`}
					>
						<Icons.Trash2 size={14} aria-hidden="true" /> Delete
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

<Dialog open={showDeleteModal} onOpenChange={(e) => (showDeleteModal = e.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
			>
				<header class="flex justify-between">
					<h2 class="h2">Delete Model</h2>
				</header>
				<article>
					<p class="opacity-60">
						Are you sure you want to delete "{modelToDelete}" from
						Ollama? This action cannot be undone.
					</p>
					<p class="opacity-60">
						Any associated connections to this model will be
						removed.
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
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
