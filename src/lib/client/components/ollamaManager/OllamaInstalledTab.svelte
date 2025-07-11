<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import * as skio from "sveltekit-io"
	import { onMount, onDestroy, getContext } from "svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
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

	const socket = skio.get()

	// State
	let installedModels: OllamaModel[] = $state([])
	let isConnected = $state(true)
	let isLoading = $state(false)
	let searchQuery = $state("")
	let runningModels: ListResponse["models"] = $state([])
	let userCtx: UserCtx = $state(getContext("userCtx"))
	let showDeleteModal = $state(false)
	let modelToDelete: OllamaModel | null = $state(null)

	// Context
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)

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
		if (userCtx?.user?.activeConnection?.type === CONNECTION_TYPE.OLLAMA) {
			const currentName = userCtx.user.activeConnection.model
			return currentName
		}
		return null
	})

	$effect(() => {
		console.log(
			"Current connection model name:",
			currentConnectionModelName
		)
	})

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
		const res = runningModels.some((runningModel) => {
			return runningModel.name === model.name
		})
		return res
	}

	// Check Ollama connection and refresh models
	async function refreshModels() {
		isLoading = true
		socket.emit("ollamaModelsList", {})
		socket.emit("ollamaListRunningModels", {})
		socket.emit("connectionsList", {})
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

		socket.emit("ollamaDeleteModel", { modelName: model.name })
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

		socket.emit("ollamaConnectModel", { modelName: model.name })
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

	onMount(() => {
		// Socket event listeners
		socket.on(
			"ollamaModelsList",
			(message: Sockets.OllamaModelsList.Response) => {
				installedModels = message.models
				isLoading = false
				console.log("ollamaModelsList", message.models)
			}
		)

		socket.on(
			"ollamaDeleteModel",
			(message: Sockets.OllamaDeleteModel.Response) => {
				if (message.success) {
					refreshModels()
					toaster.success({ title: "Model deleted successfully" })
				} else {
					toaster.error({ title: "Failed to delete model" })
				}
			}
		)

		socket.on(
			"ollamaListRunningModels",
			(message: Sockets.OllamaListRunningModels.Response) => {
				runningModels = message.models
			}
		)

		socket.on(
			"ollamaStopModel",
			(message: Sockets.OllamaStopModel.Response) => {
				if (message.success) {
					toaster.success({ title: "Model stopped successfully" })
					refreshModels()
				}
			}
		)

		socket.on(
			"ollamaConnectModel",
			(message: Sockets.OllamaConnectModel.Response) => {
				if (message.success) {
					toaster.success({ title: "Model connected successfully" })
					refreshModels()
				}
			}
		)

		// Initial load
		refreshModels()
	})

	onDestroy(() => {
		socket.off("ollamaModelsList")
		socket.off("ollamaDeleteModel")
		socket.off("ollamaListRunningModels")
		socket.off("ollamaStopModel")
		socket.off("ollamaConnectModel")
	})
</script>

<!-- Search for installed models -->
<div class="px-4 py-2">
	<div class="flex gap-2">
		<div class="relative flex-1">
			<Icons.Search
				class="text-surface-500 absolute top-1/2 left-3 -translate-y-1/2 transform"
				size={16}
			/>
			<input
				type="text"
				placeholder="Search installed models..."
				class="input w-full pl-10"
				bind:value={searchQuery}
			/>
		</div>
		<button
			class="btn preset-filled-surface-500"
			onclick={refreshModels}
			title="Refresh models"
		>
			<Icons.RefreshCw size={16} />
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
		<button class="btn preset-filled-primary-500" onclick={refreshModels}>
			<Icons.RefreshCw size={16} />
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
		<Icons.Package class="text-surface-500 mx-auto mb-4" size={48} />
		<h3 class="h4 mb-2">No models installed</h3>
		<p class="mb-4 text-sm opacity-75">
			Install models from the Available tab to get started.
		</p>
	</div>
{:else}
	<div class="space-y-3 p-4">
		{#each filteredModels as model}
			{@const isRunning = isModelRunning(model)}
			{@const isConnected = currentConnectionModelName === model.name}
			<div class="card preset-tonal flex flex-col gap-2 p-4">
				<div class="flex items-center justify-between">
					<h4 class="font-semibold">
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
							>
								Running
							</span>
						</div>
					{/if}
				</div>
				<div class="flex justify-between gap-2">
					<div class="flex gap-2">
						<button
							class="btn btn-sm preset-filled-success-500"
							title="Connect to this model"
							aria-label="Connect to model"
							disabled={isConnected}
							onclick={() => connectToModel(model)}
						>
							{#if isConnected}
								<Icons.Check size={14} /> Connected
							{:else}
								<Icons.Cable size={14} /> Connect
							{/if}
						</button>
						<button
							class="btn btn-sm preset-filled-surface-500"
							onclick={() => viewModelWebsite(model)}
							title="View model website"
						>
							<Icons.ExternalLink size={14} /> View
						</button>
					</div>
					<button
						class="btn btn-sm preset-filled-error-500"
						onclick={() => handleDeleteClick(model)}
						title="Delete model"
					>
						<Icons.Trash2 size={14} /> Delete
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

<Modal
	open={showDeleteModal}
	onOpenChange={(e) => (showDeleteModal = e.open)}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h2">Delete Model</h2>
		</header>
		<article>
			<p class="opacity-60">
				Are you sure you want to delete "{modelToDelete}" from Ollama?
				This action cannot be undone.
			</p>
			<p class="opacity-60">
				Any associated connections to this model will be removed.
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
