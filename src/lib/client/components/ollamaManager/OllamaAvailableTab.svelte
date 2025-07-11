<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import * as skio from "sveltekit-io"
	import { onMount, onDestroy } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { OllamaModelSearchSource } from "$lib/shared/constants/OllamaModelSource"
	import HuggingFaceQuantizationModal from "$lib/client/components/modals/HuggingFaceQuantizationModal.svelte"
	import OllamaManualPullModal from "$lib/client/components/modals/OllamaManualPullModal.svelte"
	import OllamaInstructionModal from "$lib/client/components/modals/OllamaInstructionModal.svelte"

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

	interface Props {
		// Callback when a download starts - to switch tabs
		onDownloadStart?: (modelName: string) => void
	}

	let { onDownloadStart }: Props = $props()

	const socket = skio.get()

	let searchString = $state("")
	let installedModels: Sockets.OllamaModelsList.Response["models"] = $state(
		[]
	)
	let selectedSource = $state(OllamaModelSearchSource.HUGGING_FACE)
	let availableModels: Sockets.OllamaSearchAvailableModels.Response["models"] =
		$state([])
	let isSearching = $state(false)
	let showHuggingFaceModal = $state(false)
	let showOllamaInstructionModal = $state(false)
	let showOllamaManualPullModal = $state(false)
	let selectedModelForDownload: string | null = $state(null)
	let selectedModel: Sockets.OllamaSearchAvailableModels.Response["models"][0] | null = $state(null)

	// Track which models are being downloaded locally (for UI state only)
	let currentlyDownloading = $state(new Set<string>())

	function isModelInstalled(modelName: string): boolean {
		return installedModels.some((model) => model.name.startsWith(modelName))
	}

	function searchAvailableModels() {
		isSearching = true
		socket.emit("ollamaSearchAvailableModels", {
			search: searchString.trim(),
			source: selectedSource
		} as Sockets.OllamaSearchAvailableModels.Call)
	}

	function openHuggingFaceModal(model: Sockets.OllamaSearchAvailableModels.Response["models"][0]) {
		selectedModelForDownload = model.name
		selectedModel = model
		showHuggingFaceModal = true
	}

	function closeHuggingFaceModal() {
		showHuggingFaceModal = false
		selectedModelForDownload = null
		selectedModel = null
	}

	function downloadHuggingFaceQuantization(
		modelId: string,
		pullOption: { label: string; pull: string }
	) {

		console.log("Downloading Hugging Face quantization:", pullOption.pull)

		// Track this model as currently downloading
		currentlyDownloading.add(modelId)

		// Emit the pull request to Ollama
		socket.emit("ollamaPullModel", {
			modelName: pullOption.pull
		} as Sockets.OllamaPullModel.Call)

		// Close modal and switch to downloads tab
		closeHuggingFaceModal()
		onDownloadStart?.(pullOption.pull)
	}

	function openOllamaManualPullModal(modelName: string) {
		selectedModelForDownload = modelName
		showOllamaManualPullModal = true
	}

	function openOllamaInstructionModal(modelName: string) {
		selectedModelForDownload = modelName
		showOllamaInstructionModal = true
	}

	function closeOllamaInstructionModal() {
		showOllamaInstructionModal = false
		selectedModelForDownload = null
	}

	function handleInstructionContinue() {
		showOllamaInstructionModal = false
		showOllamaManualPullModal = true
	}

	function closeOllamaManualPullModal() {
		showOllamaManualPullModal = false
		selectedModelForDownload = null
	}

	function handleOllamaInstallConfirm(cleanedModelName: string) {
		console.log("Installing Ollama model:", cleanedModelName)

		// Track this model as currently downloading
		currentlyDownloading.add(cleanedModelName)

		// Emit the pull request to Ollama
		socket.emit("ollamaPullModel", {
			modelName: cleanedModelName
		} as Sockets.OllamaPullModel.Call)

		// Close modal and switch to downloads tab
		closeOllamaManualPullModal()
		onDownloadStart?.(cleanedModelName)
	}

	$effect(() => {
		const _search = searchString.trim()
		const _source = selectedSource
		const timeoutId = setTimeout(() => {
			searchAvailableModels()
		}, 500) // 500ms delay

		return () => clearTimeout(timeoutId)
	})

	async function refreshInstalled() {
		socket.emit("ollamaModelsList", {})
	}

	onMount(() => {
		// Socket event listeners
		socket.on(
			"ollamaModelsList",
			(message: Sockets.OllamaModelsList.Response) => {
				installedModels = message.models
			}
		)

		socket.on(
			"ollamaSearchAvailableModels",
			(message: Sockets.OllamaSearchAvailableModels.Response) => {
				isSearching = false
				if (message.error) {
					toaster.error({ title: message.error })
					availableModels = []
				} else {
					availableModels = message.models || []
				}
			}
		)

		socket.on(
			"ollamaPullModel",
			(message: Sockets.OllamaPullModel.Response) => {
				// Handle model pull completion/error only - no progress handling
				console.log("Pull model response:", message)
				if (message.success) {
					socket.emit("ollamaModelsList", {})
					toaster.success({ title: "Model downloaded successfully" })
					closeHuggingFaceModal()
				} else if (message.error) {
					toaster.error({ title: message.error })
				}
			}
		)

		// Load initial installed models
		refreshInstalled()
	})

	onDestroy(() => {
		socket.off("ollamaModelsList")
		socket.off("ollamaSearchAvailableModels")
		socket.off("ollamaPullModel")
		socket.off("ollamaCancelPull")
	})
</script>

<!-- Search for available models -->
<div class="px-4 py-2 flex flex-col gap-2">
	<div class="flex gap-2">
		<button
			class="btn preset-filled-primary-500 flex-1"
			onclick={() => {
				showOllamaManualPullModal = true
			}}
		>
				<Icons.Download size={16} />
				Manual Download
		</button>
		<select
			id="source"
			name="source"
			aria-label="Model search source"
			class="select bg-background border-muted w-fit rounded border"
			bind:value={selectedSource}
		>
			{#each OllamaModelSearchSource.options as option}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</div>
		<div class="relative flex-1">
			<Icons.Search
				class="text-surface-500 absolute top-1/2 left-3 -translate-y-1/2 transform"
				size={16}
			/>
			<input
				type="text"
				placeholder="Search available models..."
				class="input w-full pl-10"
				aria-label="Model search"
				bind:value={searchString}
			/>
		</div>
		
</div>

<div class="space-y-3 p-4">
	{#if isSearching}
		<div class="p-6 text-center">
			<Icons.Loader2 class="mx-auto mb-4 animate-spin" size={32} />
			<p class="text-sm opacity-75">Searching for models...</p>
		</div>
	{:else if availableModels.length === 0}
		<div class="p-6 text-center">
			<Icons.Search class="text-surface-500 mx-auto mb-4" size={48} />
			<h3 class="h4 mb-2">No models found</h3>
			<p class="mb-4 text-sm opacity-75">
				No available models match your search for "{searchString}".
			</p>
		</div>
	{:else}
		{#each availableModels as model}
			<div class="card preset-tonal p-4">
				<div class="flex flex-col gap-2">
					<!-- Header with name and badges -->
					<div class="flex items-start justify-between">
						<div class="flex flex-wrap items-center gap-2">
							<h4 class="text-lg font-semibold">
								{model.name}
							</h4>
						</div>
					</div>

					<div>
						{#if model.popular}
							<span
								class="badge preset-filled-tertiary-500 rounded-full px-2 py-1 text-x"
							>
								<Icons.TrendingUp
									size={12}
									class="mr-1 inline"
								/>
								Popular
							</span>
						{/if}
						{#if model.trendingScore && model.trendingScore > 0.7}
							<span
								class="badge rounded-full preset-filled-secondary-500 px-2 py-1 text-xs"
							>
								<Icons.Flame size={12} class="mr-1 inline" />
								Trending
							</span>
						{/if}
					</div>

					<!-- Description -->
					<p class="text-surface-500 mb-3 line-clamp-2 text-sm">
						{model.description || "No description available"}
					</p>

					<!-- Tags -->
					{#if model.tags && model.tags.length > 0}
						<div class="mb-3 flex flex-wrap gap-1">
							{#each model.tags.slice(0, 4) as tag}
								<span
									class="badge bg-surface-200-800 text-surface-700-300 rounded px-2 py-1 text-xs"
								>
									{tag}
								</span>
							{/each}
							{#if model.tags.length > 4}
								<span class="text-surface-500 text-xs">
									+{model.tags.length - 4} more
								</span>
							{/if}
						</div>
					{/if}

					<!-- Metadata row -->
					<div
						class="text-surface-500 flex flex-wrap items-center gap-4 text-xs"
					>
						{#if model.size}
							<div class="flex items-center gap-1">
								<Icons.HardDrive size={12} />
								<span>{model.size}</span>
							</div>
						{/if}
						{#if model.downloads}
							<div class="flex items-center gap-1">
								<Icons.Download size={12} />
								<span>
									{model.downloads.toLocaleString()} downloads
								</span>
							</div>
						{/if}
						{#if model.likes}
							<div class="flex items-center gap-1">
								<Icons.Heart size={12} />
								<span>
									{model.likes.toLocaleString()} likes
								</span>
							</div>
						{/if}
						{#if model.updatedAtStr}
							<div class="flex items-center gap-1">
								<Icons.Clock size={12} />
								<span>Updated {model.updatedAtStr}</span>
							</div>
						{/if}
					</div>
					<div class="flex min-w-[100px] gap-2">
						<button
							class="btn btn-sm {isModelInstalled(model.name)
								? 'preset-filled-success-500'
								: 'preset-filled-primary-500'}"
							onclick={() => {
								if (
									selectedSource ===
									OllamaModelSearchSource.HUGGING_FACE
								) {
									openHuggingFaceModal(model)
								} else if (
									selectedSource ===
									OllamaModelSearchSource.OLLAMA_DB
								) {
									openOllamaInstructionModal(model.name)
								} else {
									openOllamaManualPullModal(model.name)
								}
							}}
						>
							{#if isModelInstalled(model.name)}
								<Icons.Check size={14} />
								Installed
							{:else}
								<Icons.Download size={14} />
								Install
							{/if}
						</button>
						{#if model.url}
							<a
								href={model.url}
								target="_blank"
								rel="noopener noreferrer"
								class="btn btn-sm preset-filled-secondary-500 text-center"
							>
								<Icons.ExternalLink size={14} />
								View
							</a>
						{/if}
					</div>
				</div>
			</div>
		{/each}
	{/if}
</div>

<!-- Hugging Face Download Modal -->
<HuggingFaceQuantizationModal
	bind:open={showHuggingFaceModal}
	{selectedModelForDownload}
	{selectedModel}
	onClose={closeHuggingFaceModal}
	onDownload={downloadHuggingFaceQuantization}
/>

<!-- Ollama Install Modal -->
<OllamaManualPullModal
	open={showOllamaManualPullModal}
	modelName={selectedModelForDownload || ""}
	onclose={closeOllamaManualPullModal}
	onconfirm={handleOllamaInstallConfirm}
/>

<!-- Ollama Instruction Modal -->
<OllamaInstructionModal
	bind:open={showOllamaInstructionModal}
	modelName={selectedModelForDownload || ""}
	onClose={closeOllamaInstructionModal}
	onContinue={handleInstructionContinue}
/>
