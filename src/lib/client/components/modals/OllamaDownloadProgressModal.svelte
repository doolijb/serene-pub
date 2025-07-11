<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Modal, Progress } from "@skeletonlabs/skeleton-svelte"

	interface DownloadProgress {
		modelName: string
		status: string
		files: {
			[key: string]: { total: number; completed: number }
		}
	}

	interface Props {
		open: boolean
		downloadingQuants: {
			[key: string]: {
				modelName: string
				status: string
				files: {
					[key: string]: { total: number; completed: number }
				}
			}
		}
		onCancel?: (modelName: string) => void
		onClose?: () => void
	}

	let { open = $bindable(), downloadingQuants, onCancel, onClose }: Props = $props()

	// Check if model download is complete
	function isComplete(progress: DownloadProgress) {
		const files = Object.values(progress.files)
		return files.length > 0 && files.every(file => file.total > 0 && file.completed >= file.total)
	}

	// Check if download is done (complete, canceled, or error)
	function isDone(progress: DownloadProgress) {
		const status = progress.status.toLowerCase()
		return status === "canceled" || status === "success" || status === "error" || isComplete(progress)
	}

	// Check if all downloads are done
	function areAllDownloadsDone() {
		const downloads = Object.values(downloadingQuants)
		return downloads.length > 0 && downloads.every(download => isDone(download))
	}

	// Handle modal close
	function handleClose() {
		if (onClose) {
			onClose()
		}
		open = false
	}

	// Get file count and completion status
	function getFileStats(progress: DownloadProgress) {
		const files = Object.values(progress.files)
		const completedFiles = files.filter(file => file.total > 0 && file.completed >= file.total).length
		const totalFiles = files.length
		return { completed: completedFiles, total: totalFiles }
	}
</script>

<Modal
	{open}
	onOpenChange={(e) => {
		if (!e.open && areAllDownloadsDone()) {
			handleClose()
		}
	}}
	contentBase="card bg-surface-100-900 p-6 space-y-6 shadow-2xl border border-surface-300-700 w-[40em] max-w-dvw-lg max-h-[90dvh]"
	backdropClasses="backdrop-blur-md bg-black/20"
>
	{#snippet content()}
		<header class="border-surface-300-700 border-b pb-4">
			<div class="flex items-center gap-3">
				<div class="bg-primary-500/10 rounded-full p-2">
					<Icons.Download size={20} class="text-primary-500" />
				</div>
				<div>
					<h2 class="h3 font-bold">Model Downloads</h2>
					<p class="text-surface-500 text-sm">
						{Object.keys(downloadingQuants).length} model{Object.keys(
							downloadingQuants
						).length !== 1
							? "s"
							: ""} downloading
					</p>
				</div>
			</div>
		</header>
		<article class="max-h-80 space-y-6 overflow-y-auto pr-2">
			{#each Object.entries(downloadingQuants) as [key, progress]}
				{#if key === "undefined"}
					<!-- Skip undefined keys -->
				{:else}
					{@const fileStats = getFileStats(progress)}
					<div
						class="bg-surface-200-800 border-surface-300-700 rounded-lg border p-4"
					>
						<div class="flex items-start gap-4">
							<div
								class="bg-primary-500/10 mt-1 rounded-full p-2"
							>
								{#if isDone(progress)}
									{#if progress.status.toLowerCase() === "canceled"}
										<Icons.X
											size={16}
											class="text-orange-500"
										/>
									{:else if progress.status.toLowerCase() === "error"}
										<Icons.AlertTriangle
											size={16}
											class="text-red-500"
										/>
									{:else}
										<Icons.Check
											size={16}
											class="text-green-500"
										/>
									{/if}
								{:else}
									<Icons.Download
										size={16}
										class="text-primary-500 animate-pulse"
									/>
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<div
									class="mb-3 flex items-center justify-between"
								>
									<h4
										class="text-surface-900-100 truncate font-semibold"
									>
										{progress.modelName}
									</h4>
									<div class="flex items-center gap-2 ml-2">
										{#if onCancel && !isDone(progress)}
											<button
												class="btn btn-sm preset-filled-error-500"
												onclick={() => onCancel?.(progress.modelName)}
												title="Cancel download"
											>
												<Icons.X size={14} />
												Cancel
											</button>
										{/if}
									</div>
								</div>

								<div class="space-y-3">
									<!-- Individual file progress bars -->
									<div class="space-y-3">
										{#each Object.entries(progress.files) as [fileName, fileProgress]}
											<div class="space-y-1">
												<div class="flex items-center justify-between text-xs">
													<span class="text-surface-500 truncate font-mono max-w-[60%]" title={fileName}>
														{fileName}
													</span>
													<span class="text-surface-400 font-mono">
														{fileProgress.total > 0 ? 
															`${((fileProgress.completed / fileProgress.total) * 100).toFixed(1)}%` : 
															'0%'
														}
													</span>
												</div>
												<div class="w-full">
													<Progress
														value={fileProgress.completed}
														max={fileProgress.total}
													/>
												</div>
												{#if fileProgress.total > 0}
													<div class="flex justify-end text-[10px] text-surface-400 font-mono">
														{(fileProgress.completed / (1024 * 1024)).toFixed(1)}MB / 
														{(fileProgress.total / (1024 * 1024)).toFixed(1)}MB
													</div>
												{/if}
											</div>
										{/each}
									</div>

									<div
										class="flex items-center justify-between text-xs pt-2 border-t border-surface-300-700"
									>
										<div class="flex items-center gap-2">
											<div
												class="h-2 w-2 rounded-full {isDone(progress) ? '' : 'animate-pulse'} {
													progress.status.toLowerCase() === 'canceled' ? 'bg-orange-500' :
													progress.status.toLowerCase() === 'error' ? 'bg-red-500' :
													progress.status.toLowerCase() === 'success' || isComplete(progress) ? 'bg-green-500' :
													'bg-blue-500'
												}"
											></div>
											<span
												class="text-surface-600-400 font-medium"
											>
												{progress.status}
											</span>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				{/if}
			{/each}
		</article>
		<footer class="border-surface-300-700 border-t pt-4">
			<div
				class="text-surface-500 flex items-center justify-between text-xs"
			>
				<!-- <div class="flex items-center gap-2">
					<Icons.Info size={14} />
					<span>Downloads will continue in the background</span>
				</div> -->
				{#if areAllDownloadsDone()}
					<button
						class="btn btn-sm preset-filled-primary-500"
						onclick={handleClose}
					>
						<Icons.X size={14} />
						Close
					</button>
				{/if}
			</div>
		</footer>
	{/snippet}
</Modal>