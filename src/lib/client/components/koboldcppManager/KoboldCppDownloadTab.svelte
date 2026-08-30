<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		isLocal: boolean
		onDownloadStart?: () => void
	}

	let { isLocal, onDownloadStart }: Props = $props()

	const SOURCE_RECOMMENDED = "recommended"
	const SOURCE_HUGGING_FACE = "huggingface"
	const sourceOptions = [
		{ value: SOURCE_RECOMMENDED, label: "Recommended" },
		{ value: SOURCE_HUGGING_FACE, label: "Hugging Face" }
	]

	const socket = useTypedSocket()
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx")
	)
	const panelsCtx: PanelsCtx = getContext("panelsCtx")

	/** Q4_K_M is the balance this modal already recommends in prose; during the
	 * wizard hand-off it also gets the glow, so a first-time user isn't left
	 * comparing quantization names they have no basis to choose between. */
	const isRecommendedQuant = (label: string) => label.includes("Q4_K_M")
	let isTutorial = $derived(!!panelsCtx?.digest?.tutorial)

	let modelsDir = $state(
		koboldCppSettingsCtx.settings?.koboldCppManagerModelsDir ?? ""
	)
	let selectedSource = $state(SOURCE_RECOMMENDED)
	let searchString = $state("")
	let isSearching = $state(false)
	// Distinguishes "haven't searched yet" from "searched, zero results" —
	// searchResults starts empty, so gating the "No models found" message on
	// searchString alone showed it the instant you typed anything, before
	// Enter (the only way to actually trigger search()) was ever pressed.
	let hasSearched = $state(false)

	let searchResults = $state<Sockets.KoboldCPP.SearchModels.ModelResult[]>([])
	let recommendedModels = $state<
		Sockets.KoboldCPP.RecommendedModels.RecommendedModel[]
	>([])
	let isLoadingRecommended = $state(false)

	let selectedModel =
		$state<Sockets.KoboldCPP.SearchModels.ModelResult | null>(null)
	let showQuantModal = $state(false)

	function vramColor(gb: number): string {
		if (gb <= 3) return "text-success-500"
		if (gb <= 6) return "text-primary-500"
		if (gb <= 10) return "text-warning-500"
		if (gb <= 16) return "text-warning-500"
		return "text-error-500"
	}

	function vramTier(gb: number): string {
		if (gb <= 3) return "Ultra Budget"
		if (gb <= 6) return "Budget"
		if (gb <= 10) return "Mainstream"
		if (gb <= 16) return "High-End"
		return "Enthusiast"
	}

	function search() {
		if (!searchString.trim()) return
		isSearching = true
		hasSearched = true
		searchResults = []
		socket.emit("koboldcpp:searchModels", {
			searchTerm: searchString.trim()
		})
	}

	function startDownload(
		model: Sockets.KoboldCPP.SearchModels.ModelResult,
		opt: Sockets.KoboldCPP.SearchModels.PullOption
	) {
		showQuantModal = false
		selectedModel = null
		// End of the wizard's hand-off path (panel → Available → model →
		// quantization). Cleared here rather than on the first click, because
		// the cue has to survive every step in between — unlike the other
		// sidebars, where it marks a single button.
		if (panelsCtx?.digest?.tutorial) panelsCtx.digest.tutorial = false
		socket.emit("koboldcpp:downloadModel", {
			modelName: model.name,
			filename: opt.filename,
			downloadUrl: opt.downloadUrl,
			modelUrl: model.url,
			description: model.description,
			quantization: opt.label,
			sizeBytes: opt.sizeBytes
		})
		toaster.success({
			title: "Download started",
			description: opt.filename
		})
		onDownloadStart?.()
	}

	onMount(() => {
		socket.on(
			"systemSettings:get",
			(message: Sockets.SystemSettings.Get.Response) => {
				modelsDir =
					message.koboldCppSettings?.koboldCppManagerModelsDir ?? ""
			}
		)

		socket.on(
			"koboldcpp:searchModels",
			(msg: Sockets.KoboldCPP.SearchModels.Response) => {
				isSearching = false
				searchResults = msg.models
			}
		)
		socket.on("koboldcpp:searchModels:error", () => {
			isSearching = false
			toaster.error({ title: "Search failed" })
		})

		socket.on("koboldcpp:downloadModel", () => {})
		socket.on(
			"koboldcpp:downloadModel:error",
			(msg: Sockets.ErrorResponse) => {
				toaster.error({
					title: "Download failed",
					description: msg.error
				})
			}
		)

		socket.on(
			"koboldcpp:recommendedModels",
			(msg: Sockets.KoboldCPP.RecommendedModels.Response) => {
				isLoadingRecommended = false
				recommendedModels = msg.models
			}
		)
		socket.on("koboldcpp:recommendedModels:error", () => {
			isLoadingRecommended = false
			toaster.error({ title: "Failed to load recommended models" })
		})

		isLoadingRecommended = true
		socket.emit("koboldcpp:recommendedModels", {})
	})

	onDestroy(() => {
		socket.off("systemSettings:get")
		socket.off("koboldcpp:searchModels")
		socket.off("koboldcpp:searchModels:error")
		socket.off("koboldcpp:downloadModel")
		socket.off("koboldcpp:downloadModel:error")
		socket.off("koboldcpp:recommendedModels")
		socket.off("koboldcpp:recommendedModels:error")
	})
</script>

{#if !isLocal}
	<div class="py-4">
		<div
			class="bg-warning-100 dark:bg-warning-900 border-warning-300 dark:border-warning-700 rounded-lg border p-4"
		>
			<div class="flex items-start gap-3">
				<Icons.AlertTriangle
					class="text-warning-600 mt-0.5 h-5 w-5 shrink-0"
				/>
				<div>
					<h4
						class="text-warning-800 dark:text-warning-200 font-medium"
					>
						Remote instance detected
					</h4>
					<p
						class="text-warning-700 dark:text-warning-300 mt-1 text-sm"
					>
						Model downloads are only available when KoboldCPP is
						running on the same machine as Serene Pub.
					</p>
				</div>
			</div>
		</div>
	</div>
{:else if !modelsDir}
	<div class="py-4">
		<div class="bg-surface-100-800 rounded-lg border p-6 text-center">
			<Icons.FolderOpen
				class="text-muted-foreground mx-auto mb-3 h-10 w-10 opacity-50"
			/>
			<h3 class="mb-1 font-semibold">Models directory not configured</h3>
			<p class="text-muted-foreground text-sm">
				Set a <strong>Models Directory</strong>
				in the Settings tab before downloading models.
			</p>
		</div>
	</div>
{:else}
	<!-- Toolbar -->
	<div class="flex flex-col gap-2 py-2">
		<select
			aria-label="Model search source"
			class="select bg-background border-muted w-full rounded border"
			bind:value={selectedSource}
		>
			{#each sourceOptions as opt}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
		<div class="relative">
			<button
				type="button"
				class="text-surface-700-300 hover:text-foreground absolute top-1/2 left-3 -translate-y-1/2 disabled:cursor-not-allowed"
				onclick={search}
				disabled={selectedSource === SOURCE_RECOMMENDED ||
					!searchString.trim()}
				title="Search"
				aria-label="Search"
			>
				<Icons.Search size={16} />
			</button>
			<input
				type="text"
				placeholder={selectedSource === SOURCE_RECOMMENDED
					? "Search not available for recommended models"
					: "Search Hugging Face for GGUF models, then press Enter…"}
				class="input w-full pl-10"
				bind:value={searchString}
				disabled={selectedSource === SOURCE_RECOMMENDED}
				onkeydown={(e) => e.key === "Enter" && search()}
			/>
		</div>
	</div>

	<!-- Results -->
	<div class="space-y-3 py-4">
		{#if selectedSource === SOURCE_RECOMMENDED}
			{#if isLoadingRecommended}
				<div class="p-6 text-center">
					<Icons.Loader2
						class="mx-auto mb-4 animate-spin"
						size={32}
					/>
					<p class="text-sm opacity-75">
						Loading recommended models…
					</p>
				</div>
			{:else if recommendedModels.length === 0}
				<div class="p-6 text-center">
					<Icons.Search
						class="text-surface-700-300 mx-auto mb-4"
						size={48}
					/>
					<p class="text-sm opacity-75">
						No recommended models available.
					</p>
				</div>
			{:else}
				{#each recommendedModels as model}
					<div class="card preset-filled-surface-100-900 p-4">
						<div class="flex flex-col gap-3">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0 flex-1 break-all">
									<h4
										class="text-foreground mb-1 text-lg font-semibold"
									>
										{model.ollamaName ?? model.name}
									</h4>
									<div
										class="mb-2 flex flex-wrap items-center gap-2"
									>
										{#if model.parameterSize}
											<span
												class="badge preset-filled-primary-500 rounded-full px-2 py-1 text-xs"
											>
												{model.parameterSize}
											</span>
										{/if}
										{#if model.recommendedVram != null}
											<span
												class="badge bg-surface-200 dark:bg-surface-800 rounded-full px-2 py-1 text-xs {vramColor(
													model.recommendedVram
												)}"
											>
												{model.recommendedVram}GB VRAM • {vramTier(
													model.recommendedVram
												)}
											</span>
										{/if}
									</div>
								</div>
							</div>

							{#if model.description}
								<p
									class="text-muted-foreground text-sm leading-relaxed"
								>
									{model.description}
								</p>
							{/if}

							<div
								class="text-surface-700-300 flex flex-wrap items-center gap-4 text-xs"
							>
								{#if model.downloads != null}
									<div class="flex items-center gap-1">
										<Icons.Download size={12} />
										<span>
											{model.downloads.toLocaleString()} downloads
										</span>
									</div>
								{/if}
								{#if model.likes != null}
									<div class="flex items-center gap-1">
										<Icons.Heart size={12} />
										<span>
											{model.likes.toLocaleString()} likes
										</span>
									</div>
								{/if}
								<div class="flex items-center gap-1">
									<Icons.Layers size={12} />
									<span>
										{model.pullOptions.length} quant{model
											.pullOptions.length !== 1
											? "s"
											: ""}
									</span>
								</div>
							</div>

							<div class="flex gap-2">
								<button
									class="btn btn-sm preset-filled-primary-500"
									onclick={() => {
										selectedModel = model
										showQuantModal = true
									}}
								>
									<Icons.Download size={14} />
									Download
								</button>
								{#if model.url}
									<a
										href={model.url}
										target="_blank"
										rel="noopener noreferrer"
										class="btn btn-sm preset-filled-secondary-500"
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
		{:else}
			<!-- Hugging Face search results -->
			{#if isSearching}
				<div class="p-6 text-center">
					<Icons.Loader2
						class="mx-auto mb-4 animate-spin"
						size={32}
					/>
					<p class="text-sm opacity-75">Searching…</p>
				</div>
			{:else if searchResults.length === 0 && hasSearched}
				<div class="p-6 text-center">
					<Icons.Search
						class="text-surface-700-300 mx-auto mb-4"
						size={48}
					/>
					<p class="text-sm opacity-75">
						No models found for "{searchString}".
					</p>
				</div>
			{:else if searchResults.length === 0}
				<div class="p-6 text-center">
					<Icons.Search
						class="text-surface-700-300 mx-auto mb-4"
						size={48}
					/>
					<p class="text-sm opacity-75">
						Search Hugging Face for GGUF models, then press Enter.
					</p>
				</div>
			{:else}
				{#each searchResults as model}
					<div class="card preset-filled-surface-100-900 p-4">
						<div class="flex flex-col gap-2">
							<h4 class="text-lg font-semibold">{model.name}</h4>

							{#if model.description}
								<p
									class="text-surface-700-300 line-clamp-2 text-sm"
								>
									{model.description}
								</p>
							{/if}

							<div
								class="text-surface-700-300 flex flex-wrap items-center gap-4 text-xs"
							>
								{#if model.downloads != null}
									<div class="flex items-center gap-1">
										<Icons.Download size={12} />
										<span>
											{model.downloads.toLocaleString()} downloads
										</span>
									</div>
								{/if}
								{#if model.likes != null}
									<div class="flex items-center gap-1">
										<Icons.Heart size={12} />
										<span>
											{model.likes.toLocaleString()} likes
										</span>
									</div>
								{/if}
								<div class="flex items-center gap-1">
									<Icons.Layers size={12} />
									<span>
										{model.pullOptions.length} quant{model
											.pullOptions.length !== 1
											? "s"
											: ""}
									</span>
								</div>
							</div>

							<div class="flex gap-2">
								<button
									class="btn btn-sm preset-filled-primary-500"
									onclick={() => {
										selectedModel = model
										showQuantModal = true
									}}
								>
									<Icons.Download size={14} />
									Download
								</button>
								{#if model.url}
									<a
										href={model.url}
										target="_blank"
										rel="noopener noreferrer"
										class="btn btn-sm preset-filled-secondary-500"
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
		{/if}
	</div>
{/if}

<!-- Quantization picker modal -->
{#if showQuantModal && selectedModel}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		aria-label="Select quantization"
	>
		<div
			class="card bg-surface-100-900 border-surface-300-700 w-[36rem] max-w-[95vw] space-y-4 border p-6 shadow-xl"
		>
			<div class="flex items-start justify-between gap-2">
				<div>
					<h2 class="text-lg font-bold">Select Quantization</h2>
					<p class="text-muted-foreground mt-0.5 text-sm">
						{selectedModel.name}
					</p>
				</div>
				<button
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={() => {
						showQuantModal = false
						selectedModel = null
					}}
				>
					<Icons.X size={16} />
				</button>
			</div>

			<div class="bg-surface-200-800 rounded-lg p-3 text-xs">
				Higher quantizations (Q8) preserve more quality but require more
				memory. Q4_K_M is a good balance for most systems.
			</div>

			<div class="max-h-80 space-y-2 overflow-y-auto">
				{#each selectedModel.pullOptions as opt}
					<div
						class="card bg-surface-200-800 flex items-center justify-between p-3 {isTutorial &&
						isRecommendedQuant(opt.label)
							? 'tutorial-highlight'
							: ''}"
						style="--tutorial-glow-radius: var(--radius-container)"
					>
						<div class="flex items-center gap-2">
							<span class="font-mono text-sm font-medium">
								{opt.label}
							</span>
							{#if isRecommendedQuant(opt.label)}
								<span
									class="bg-warning-500 rounded px-1.5 py-0.5 text-xs text-white"
								>
									Recommended
								</span>
							{/if}
							{#if opt.sizeBytes}
								<span class="text-surface-700-300 text-xs">
									{(opt.sizeBytes / 1_073_741_824).toFixed(
										1
									)}GB
								</span>
							{/if}
						</div>
						<button
							class="btn btn-sm preset-filled-primary-500"
							onclick={() => startDownload(selectedModel!, opt)}
						>
							<Icons.Download size={14} />
							Download
						</button>
					</div>
				{/each}
			</div>

			<div class="flex justify-end">
				<button
					class="btn preset-filled-surface-400-600"
					onclick={() => {
						showQuantModal = false
						selectedModel = null
					}}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
