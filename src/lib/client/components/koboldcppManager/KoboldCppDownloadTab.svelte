<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import * as skio from "sveltekit-io"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		isLocal: boolean
		onDownloadStart?: () => void
	}

	let { isLocal, onDownloadStart }: Props = $props()

	const socket = skio.get()
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(getContext("koboldCppSettingsCtx"))

	// Seed from context; also updated via socket event so saves in Settings tab reflect immediately
	let modelsDir = $state(koboldCppSettingsCtx.settings?.koboldCppManagerModelsDir ?? "")

	let searchString = $state("")
	let isSearching = $state(false)
	let models = $state<Sockets.KoboldCpp.SearchModels.ModelResult[]>([])
	let selectedModel = $state<Sockets.KoboldCpp.SearchModels.ModelResult | null>(null)
	let showQuantModal = $state(false)

	function search() {
		if (!searchString.trim()) return
		isSearching = true
		models = []
		socket.emit("koboldcpp:searchModels", { searchTerm: searchString.trim() })
	}

	function startDownload(model: Sockets.KoboldCpp.SearchModels.ModelResult, opt: Sockets.KoboldCpp.SearchModels.PullOption) {
		showQuantModal = false
		selectedModel = null
		socket.emit("koboldcpp:downloadModel", {
			modelName: model.name,
			filename: opt.filename,
			downloadUrl: opt.downloadUrl
		})
		toaster.success({ title: "Download started", description: opt.filename })
		onDownloadStart?.()
	}

	onMount(() => {
		socket.on("systemSettings:get", (message: any) => {
			modelsDir = message.koboldCppSettings?.koboldCppManagerModelsDir ?? ""
		})

		socket.on("koboldcpp:searchModels", (msg: Sockets.KoboldCpp.SearchModels.Response) => {
			isSearching = false
			models = msg.models
		})

		socket.on("koboldcpp:searchModels:error", () => {
			isSearching = false
			toaster.error({ title: "Search failed" })
		})

		socket.on("koboldcpp:downloadModel", () => {})

		socket.on("koboldcpp:downloadModel:error", (msg: any) => {
			toaster.error({ title: "Download failed", description: msg.error })
		})
	})

	onDestroy(() => {
		socket.off("systemSettings:get")
		socket.off("koboldcpp:searchModels")
		socket.off("koboldcpp:searchModels:error")
		socket.off("koboldcpp:downloadModel")
		socket.off("koboldcpp:downloadModel:error")
	})
</script>

<div class="flex h-full flex-col gap-4 p-4">
	{#if !isLocal}
		<div class="bg-warning-100 dark:bg-warning-900 border-warning-300 dark:border-warning-700 rounded-lg border p-4">
			<div class="flex items-start gap-3">
				<Icons.AlertTriangle class="text-warning-600 mt-0.5 h-5 w-5 shrink-0" />
				<div>
					<h4 class="text-warning-800 dark:text-warning-200 font-medium">Remote instance detected</h4>
					<p class="text-warning-700 dark:text-warning-300 mt-1 text-sm">
						Model downloads are only available when KoboldCpp is running on the same machine as Serene Pub.
					</p>
				</div>
			</div>
		</div>
	{:else if !modelsDir}
		<div class="bg-surface-100-800 rounded-lg border p-6 text-center">
			<Icons.FolderOpen class="text-muted-foreground mx-auto mb-3 h-10 w-10 opacity-50" />
			<h3 class="mb-1 font-semibold">Models directory not configured</h3>
			<p class="text-muted-foreground text-sm">
				Set a <strong>Models Directory</strong> in the Settings tab before downloading models.
			</p>
		</div>
	{:else}
		<!-- Search -->
		<div class="flex gap-2">
			<input
				type="search"
				class="input flex-1"
				placeholder="Search Hugging Face for GGUF models…"
				bind:value={searchString}
				onkeydown={(e) => e.key === "Enter" && search()}
			/>
			<button
				class="btn preset-filled-primary-500"
				onclick={search}
				disabled={isSearching || !searchString.trim()}
			>
				{#if isSearching}
					<Icons.Loader2 size={16} class="animate-spin" />
				{:else}
					<Icons.Search size={16} />
				{/if}
				Search
			</button>
		</div>

		<!-- Results -->
		{#if models.length > 0}
			<div class="space-y-2">
				<h3 class="text-sm font-semibold">Results ({models.length})</h3>
				<div class="space-y-2">
					{#each models as model}
						<div class="bg-surface-100-800 border-surface-300-700 rounded-lg border p-3">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{model.name}</p>
									{#if model.description}
										<p class="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{model.description}</p>
									{/if}
									<div class="text-muted-foreground mt-1 flex items-center gap-3 text-xs">
										{#if model.downloads != null}
											<span class="flex items-center gap-1">
												<Icons.Download size={10} />
												{model.downloads.toLocaleString()}
											</span>
										{/if}
										{#if model.likes != null}
											<span class="flex items-center gap-1">
												<Icons.Heart size={10} />
												{model.likes.toLocaleString()}
											</span>
										{/if}
										<span>{model.pullOptions.length} quant{model.pullOptions.length !== 1 ? "s" : ""}</span>
									</div>
								</div>
								<button
									class="btn btn-sm preset-filled-primary-500 shrink-0"
									onclick={() => { selectedModel = model; showQuantModal = true }}
								>
									<Icons.Download size={14} />
									Download
								</button>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{:else if !isSearching && searchString}
			<p class="text-muted-foreground py-4 text-center text-sm">No results found.</p>
		{/if}
	{/if}
</div>

<!-- Quantization picker modal -->
{#if showQuantModal && selectedModel}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		aria-label="Select quantization"
	>
		<div class="card bg-surface-100-900 border-surface-300-700 w-[36rem] max-w-[95vw] space-y-4 border p-6 shadow-xl">
			<div class="flex items-start justify-between">
				<div>
					<h2 class="text-lg font-bold">Select Quantization</h2>
					<p class="text-muted-foreground mt-0.5 text-sm">{selectedModel.name}</p>
				</div>
				<button class="btn btn-sm preset-tonal-surface" onclick={() => { showQuantModal = false; selectedModel = null }}>
					<Icons.X size={16} />
				</button>
			</div>

			<div class="bg-surface-200-800 rounded-lg p-3 text-xs">
				Higher quantizations (Q8) preserve more quality but require more memory. Q4_K_M is a good balance for most systems.
			</div>

			<div class="max-h-80 space-y-2 overflow-y-auto">
				{#each selectedModel.pullOptions as opt}
					<div class="card bg-surface-200-800 flex items-center justify-between p-3">
						<div class="flex items-center gap-2">
							<span class="font-mono text-sm font-medium">{opt.label}</span>
							{#if opt.label.includes("Q4_K_M")}
								<span class="rounded bg-orange-500 px-1.5 py-0.5 text-xs text-white">Recommended</span>
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
				<button class="btn preset-tonal-surface" onclick={() => { showQuantModal = false; selectedModel = null }}>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
