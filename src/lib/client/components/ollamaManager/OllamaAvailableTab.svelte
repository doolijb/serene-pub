<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import * as skio from "sveltekit-io"
	import { onMount, onDestroy, getContext } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { toaster } from "$lib/client/utils/toaster"
	import { OllamaModelSearchSource } from "$lib/shared/constants/OllamaModelSource"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import HuggingFaceQuantizationModal from "$lib/client/components/modals/HuggingFaceQuantizationModal.svelte"
	import OllamaManualPullModal from "$lib/client/components/modals/OllamaManualPullModal.svelte"

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
	let selectedSource = $state(OllamaModelSearchSource.RECOMMENDED)
	let availableModels: Sockets.OllamaSearchAvailableModels.Response["models"] =
		$state([])
	let recommendedModels: Sockets.OllamaRecommendedModels.Response["recommendedModels"] =
		$state([])
	let isSearching = $state(false)
	let showHuggingFaceModal = $state(false)
	let showOllamaManualPullModal = $state(false)
	let selectedModelForDownload: string | null = $state(null)
	let selectedModel:
		| Sockets.OllamaSearchAvailableModels.Response["models"][0]
		| null = $state(null)

	// Get user context to track active connection
	let userCtx: UserCtx = $state(getContext("userCtx"))

	// Track which models are being downloaded locally (for UI state only).
	// Uses SvelteSet (not a plain Set in $state) so .add()/.delete() mutations
	// are actually reactive - a plain Set wrapped in $state only reacts to
	// reassignment, not in-place mutation.
	let currentlyDownloading = new SvelteSet<string>()

	// Derive the current active connection model name for reactivity
	let currentConnectionModelName: string | null = $derived.by(() => {
		if (userCtx?.user?.activeConnection?.type === CONNECTION_TYPE.OLLAMA) {
			const currentName = userCtx.user.activeConnection.model
			return currentName
		}
		return null
	})

	// Create a derived set of installed model names for efficient lookups and reactivity
	let installedModelNames = $derived(
		new Set(installedModels.map((model) => model.name))
	)

	function isModelInstalled(modelName: string): boolean {
		if (selectedSource === OllamaModelSearchSource.RECOMMENDED) {
			// For recommended models, check against the pull string
			const modelNameFromPull =
				modelName.split("/").pop()?.split(":")[0] || modelName
			// Check using the derived set
			for (const name of installedModelNames) {
				if (
					name.includes(modelNameFromPull) ||
					name.startsWith(modelName.replace("hf.co/", ""))
				) {
					return true
				}
			}
			return false
		}
		// Check if any installed model name starts with the given model name
		for (const name of installedModelNames) {
			if (name.startsWith(modelName)) {
				return true
			}
		}
		return false
	}

	function isModelActive(modelName: string): boolean {
		// Access currentConnectionModelName to create reactive dependency
		if (!currentConnectionModelName) return false

		if (selectedSource === OllamaModelSearchSource.RECOMMENDED) {
			// For recommended models, check against the pull string
			const modelNameFromPull =
				modelName.split("/").pop()?.split(":")[0] || modelName
			return (
				currentConnectionModelName.includes(modelNameFromPull) ||
				currentConnectionModelName.startsWith(
					modelName.replace("hf.co/", "")
				)
			)
		}
		return currentConnectionModelName.startsWith(modelName)
	}

	function searchAvailableModels() {
		isSearching = true
		if (selectedSource === OllamaModelSearchSource.RECOMMENDED) {
			socket.emit("ollama:recommendedModels", {})
		} else {
			socket.emit("ollama:searchAvailableModels", {
				searchTerm: searchString.trim(),
				source: selectedSource
			} as Sockets.OllamaSearchAvailableModels.Call)
		}
	}

	function openHuggingFaceModal(
		model: Sockets.OllamaSearchAvailableModels.Response["models"][0]
	) {
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

		// Track this model as currently downloading
		currentlyDownloading.add(modelId)

		// Emit the pull request to Ollama
		socket.emit("ollama:pullModel", {
			modelName: pullOption.pull
		} as Sockets.OllamaPullModel.Call) // Close modal and switch to downloads tab
		closeHuggingFaceModal()
		onDownloadStart?.(pullOption.pull)
	}

	function openOllamaManualPullModal(modelName: string) {
		selectedModelForDownload = modelName
		showOllamaManualPullModal = true
	}


	function closeOllamaManualPullModal() {
		showOllamaManualPullModal = false
		selectedModelForDownload = null
	}

	function handleOllamaInstallConfirm(cleanedModelName: string) {

		// Track this model as currently downloading
		currentlyDownloading.add(cleanedModelName)

		// Emit the pull request to Ollama
		socket.emit("ollama:pullModel", {
			modelName: cleanedModelName
		} as Sockets.OllamaPullModel.Call) // Close modal and switch to downloads tab
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
		socket.emit("ollama:modelsList", {})
	}

	onMount(() => {
		// Socket event listeners
		socket.on(
			"ollama:modelsList",
			(message: Sockets.OllamaModelsList.Response) => {
				installedModels = message.models
			}
		)

		socket.on(
			"ollama:searchAvailableModels",
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
			"ollama:recommendedModels",
			(message: Sockets.OllamaRecommendedModels.Response) => {
				isSearching = false
				if (message.error) {
					toaster.error({ title: message.error })
					recommendedModels = []
				} else {
					recommendedModels = message.recommendedModels || []
				}
			}
		)

		socket.on(
			"ollama:pullModel",
			(message: Sockets.OllamaPullModel.Response) => {
				// Handle model pull completion only - errors arrive on the
				// separate "ollama:pullModel:error" event (registered below),
				// not as an `error` field on this event.
				currentlyDownloading.clear()
				if (message.success) {
					socket.emit("ollama:modelsList", {})
					toaster.success({ title: "Model downloaded successfully" })
					closeHuggingFaceModal()
				}
			}
		)

		// The server response doesn't carry which model failed, so this just
		// clears the whole in-flight set - the per-model progress/error state
		// lives in the Downloads tab (driven by "ollamaPullProgress").
		;(socket as any).on("ollama:pullModel:error", (message: any) => {
			currentlyDownloading.clear()
			toaster.error({
				title: "Model download failed",
				description: message?.error
			})
		})

		// Load initial installed models
		refreshInstalled()
	})

	onDestroy(() => {
		socket.off("ollama:modelsList")
		socket.off("ollama:searchAvailableModels")
		socket.off("ollama:recommendedModels")
		socket.off("ollama:pullModel")
		;(socket as any).off("ollama:pullModel:error")
		socket.off("ollama:cancelPull")
	})
</script>

<!-- Search for available models -->
<div class="flex flex-col gap-2 px-4 py-2">
	<div class="flex gap-2">
		<button
			class="btn preset-filled-primary-500 flex-1"
			onclick={() => {
				selectedModelForDownload = ""
				showOllamaManualPullModal = true
			}}
			aria-label="Open manual download modal"
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
			placeholder={selectedSource === OllamaModelSearchSource.RECOMMENDED
				? "Search not available for recommended models"
				: "Search available models..."}
			class="input w-full pl-10"
			aria-label="Search available models by name or description"
			bind:value={searchString}
			disabled={selectedSource === OllamaModelSearchSource.RECOMMENDED}
		/>
	</div>
</div>

<div class="space-y-3 p-4">
	{#if isSearching}
		<div class="p-6 text-center">
			<Icons.Loader2 class="mx-auto mb-4 animate-spin" size={32} />
			<p class="text-sm opacity-75">Searching for models...</p>
		</div>
	{:else if selectedSource === OllamaModelSearchSource.RECOMMENDED ? recommendedModels.length === 0 : availableModels.length === 0}
		<div class="p-6 text-center">
			<Icons.Search class="text-surface-500 mx-auto mb-4" size={48} />
			<h3 class="h4 mb-2">No models found</h3>
			<p class="mb-4 text-sm opacity-75">
				{selectedSource === OllamaModelSearchSource.RECOMMENDED
					? "No recommended models available."
					: `No available models match your search for "${searchString}".`}
			</p>
		</div>
	{:else if selectedSource === OllamaModelSearchSource.RECOMMENDED}
		{#each recommendedModels as model}
			{@const installed = isModelInstalled(model.pull)}
			{@const active = isModelActive(model.pull)}
			{@const downloading = currentlyDownloading.has(model.pull)}
			<div class="card preset-tonal p-4">
				<div class="flex flex-col gap-3">
					<!-- Header with name and VRAM tier -->
					<div class="flex items-start justify-between">
						<div class="flex-1">
							<h4
								class="text-foreground mb-1 text-lg font-semibold"
							>
								{model.name}
							</h4>
							<div class="mb-2 flex flex-wrap items-center gap-2">
								<span
									class="badge preset-filled-primary-500 rounded-full px-2 py-1 text-xs"
								>
									{model.details.parameter_size}
								</span>
								<span
									class="badge preset-filled-secondary-500 rounded-full px-2 py-1 text-xs"
								>
									{model.details.quantization_level}
								</span>
								<span
									class="badge {model.recommended_vram <= 3
										? 'text-success-500'
										: model.recommended_vram <= 6
											? 'text-primary-500'
											: model.recommended_vram <= 10
												? 'text-warning-500'
												: model.recommended_vram <= 16
													? 'text-warning-500'
													: 'text-error-500'} bg-surface-200 dark:bg-surface-800 rounded-full px-2 py-1 text-xs"
								>
									{model.recommended_vram}GB VRAM • {model.recommended_vram <=
									3
										? "Ultra Budget"
										: model.recommended_vram <= 6
											? "Budget"
											: model.recommended_vram <= 10
												? "Mainstream"
												: model.recommended_vram <= 16
													? "High-End"
													: "Enthusiast"}
								</span>
							</div>
						</div>
					</div>

					<!-- Description -->
					<p class="text-muted-foreground text-sm leading-relaxed">
						{model.details.description}
					</p>

					<!-- Metadata row -->
					<div
						class="text-surface-500 flex flex-wrap items-center gap-4 text-xs"
					>
						<div class="flex items-center gap-1">
							<Icons.HardDrive size={12} />
							<span>{model.size}GB</span>
						</div>
						{#if model.details.modified_at}
							<div class="flex items-center gap-1">
								<Icons.Calendar size={12} />
								<span>Updated {model.details.modified_at}</span>
							</div>
						{/if}
					</div>

					<!-- Actions -->
					<div class="flex gap-2">
						<button
							class="btn btn-sm {active
								? 'preset-filled-primary-500'
								: installed
									? 'preset-filled-success-500'
									: 'preset-filled-primary-500'}"
							onclick={() => {
								currentlyDownloading.add(model.pull)
								socket.emit("ollama:pullModel", {
									modelName: model.pull
								} as Sockets.OllamaPullModel.Call)
								onDownloadStart?.(model.pull)
							}}
							disabled={installed || downloading}
							aria-label={active
								? `Model ${model.name} is currently active`
								: installed
									? `Model ${model.name} is already installed`
									: downloading
										? `Installing model ${model.name}`
										: `Install model ${model.name}`}
						>
							{#if active}
								<Icons.Zap size={14} aria-hidden="true" />
								Active
							{:else if installed}
								<Icons.Check size={14} aria-hidden="true" />
								Installed
							{:else if downloading}
								<Icons.Loader2 size={14} class="animate-spin" aria-hidden="true" />
								Installing
							{:else}
								<Icons.Download size={14} aria-hidden="true" />
								Install
							{/if}
						</button>
						<a
							href={`https://hf.co/${model.name}`}
							target="_blank"
							rel="noopener noreferrer"
							class="btn btn-sm preset-filled-secondary-500 text-center"
							aria-label={`View ${model.name} model page in new tab`}
						>
							<Icons.ExternalLink size={14} aria-hidden="true" />
							View
						</a>
					</div>
				</div>
			</div>
		{/each}
	{:else}
		{#each availableModels as model}
			{@const installed = isModelInstalled(model.name)}
			{@const active = isModelActive(model.name)}
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
								class="badge preset-filled-tertiary-500 text-x rounded-full px-2 py-1"
								role="img"
								aria-label="Popular model"
							>
								<Icons.TrendingUp
									size={12}
									class="mr-1 inline"
									aria-hidden="true"
								/>
								Popular
							</span>
						{/if}
						{#if model.trendingScore && model.trendingScore > 0.7}
							<span
								class="badge preset-filled-secondary-500 rounded-full px-2 py-1 text-xs"
								role="img"
								aria-label="Trending model"
							>
								<Icons.Flame
									size={12}
									class="mr-1 inline"
									aria-hidden="true"
								/>
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
							class="btn btn-sm {active
								? 'preset-filled-primary-500'
								: installed
									? 'preset-filled-success-500'
									: 'preset-filled-primary-500'}"
							onclick={() => {
								if (
									selectedSource ===
									OllamaModelSearchSource.HUGGING_FACE
								) {
									openHuggingFaceModal(model)
								} else {
									openOllamaManualPullModal(model.name)
								}
							}}
							aria-label={active
								? `Model ${model.name} is currently active`
								: installed
									? `Model ${model.name} is already installed`
									: `Install model ${model.name}`}
						>
							{#if active}
								<Icons.Zap size={14} aria-hidden="true" />
								Active
							{:else if installed}
								<Icons.Check size={14} aria-hidden="true" />
								Installed
							{:else}
								<Icons.Download size={14} aria-hidden="true" />
								Install
							{/if}
						</button>
						{#if model.url}
							<a
								href={model.url}
								target="_blank"
								rel="noopener noreferrer"
								class="btn btn-sm preset-filled-secondary-500 text-center"
								aria-label={`View ${model.name} model page in new tab`}
							>
								<Icons.ExternalLink
									size={14}
									aria-hidden="true"
								/>
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

