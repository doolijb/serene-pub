<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		open: boolean
		selectedModelForDownload: string | null
		selectedModel: Sockets.OllamaSearchAvailableModels.Response["models"][0] | null
		onClose: () => void
		onDownload: (modelId: string, pullOption: { label: string; pull: string }) => void
	}

	let {
		open = $bindable(),
		selectedModelForDownload,
		selectedModel,
		onClose,
		onDownload
	}: Props = $props()

	// Helper function to extract numeric value from quantization for sorting
	function getQuantizationSortValue(label: string | undefined): number {
		if (!label) return 0

		// Extract the main number (e.g., "Q4_K_M" -> 4, "Q8_0" -> 8)
		const match = label.match(/[Qq](\d+)/)
		return match ? parseInt(match[1]) : 0
	}

	// Sort pullOptions by quantization level (highest to lowest)
	let sortedPullOptions = $derived(
		// selectedModel?.pullOptions ? 
		// [...selectedModel.pullOptions].sort((a, b) => {
		// 	const aValue = getQuantizationSortValue(a.label)
		// 	const bValue = getQuantizationSortValue(b.label)
		// 	return bValue - aValue // Descending order
		// }) : []
		selectedModel?.pullOptions || []
	)
</script>

<Modal
	{open}
	onOpenChange={(e) => (open = e.open)}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl w-[50em] max-w-dvw-lg border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h2">Select Quantization</h2>
		</header>
		<article class="space-y-4">
			<div>
				<p class="text-surface-500 mb-2 text-sm">
					Choose a quantization level for <strong>
						{selectedModelForDownload}
					</strong>
				</p>
				<div class="bg-surface-200-800 rounded-lg p-3">
					<p class="text-surface-600-400 text-xs">
						<strong>About Quantizations:</strong>
						These are compressed variants of the model that reduce file
						size and memory usage while maintaining good performance.
						Higher numbers (Q8) preserve more quality but use more resources,
						while lower numbers (Q4) are more efficient but with slight
						quality trade-offs.
					</p>
				</div>
			</div>

			{#if !selectedModel}
				<div class="p-6 text-center">
					<Icons.Loader2
						class="mx-auto mb-4 animate-spin"
						size={32}
					/>
					<p class="text-sm opacity-75">
						Loading model information...
					</p>
				</div>
			{:else if sortedPullOptions.length === 0}
				<div class="p-6 text-center">
					<Icons.AlertCircle
						class="text-surface-500 mx-auto mb-4"
						size={48}
					/>
					<p class="text-sm opacity-75">
						No GGUF quantizations are available for this model.
					</p>
				</div>
			{:else}
				<div class="max-h-96 space-y-3 overflow-y-auto">
					{#each sortedPullOptions as pullOption, index}
						<div class="card bg-surface-200-800 p-4">
							<div class="flex items-center justify-between">
								<div class="flex-1">
									<div class="mb-2 flex items-center gap-2">
										<h5 class="font-semibold">
											{pullOption.label ||
												"Unknown file"}
										</h5>

										<!-- Add special labels -->
										<!-- {#if index === 0 && sortedPullOptions.length > 1}
											<span
												class="badge rounded bg-blue-500 px-2 py-1 text-xs text-white"
											>
												Larger
											</span>
										{:else if index === sortedPullOptions.length - 1 && sortedPullOptions.length > 1}
											<span
												class="badge rounded bg-green-500 px-2 py-1 text-xs text-white"
											>
												Smaller
											</span>
										{/if} -->

										{#if pullOption.label.includes("Q4_K_M")}
											<span
												class="badge rounded bg-orange-500 px-2 py-1 text-xs text-white"
											>
												Recommended
											</span>
										{/if}
									</div>

									<!-- <div
										class="text-surface-500 flex items-center gap-4 text-xs"
									>
										{#if pullOption.size}
											<div
												class="flex items-center gap-1"
											>
												<Icons.HardDrive size={12} />
												<span>
													{(
														pullOption.size /
														(1024 * 1024 * 1024)
													).toFixed(2)} GB
												</span>
											</div>
										{/if}
									</div> -->
								</div>

								<button
									class="btn btn-sm preset-filled-primary-500"
									onclick={() => {
										if (
											selectedModelForDownload &&
											pullOption.label
										) {
											onDownload(
												selectedModelForDownload,
												pullOption
											)
										}
									}}
								>
									<Icons.Download size={14} />
									Download
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</article>
		<footer class="flex justify-end gap-4">
			<button class="btn preset-tonal" onclick={onClose}>
				Cancel
			</button>
		</footer>
	{/snippet}
</Modal>
