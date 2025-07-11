<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Progress } from "@skeletonlabs/skeleton-svelte"
	import { onDestroy, onMount } from "svelte"
	import * as skio from "sveltekit-io"

	interface DownloadProgress {
		modelName: string
		status: string
		files: {
			[key: string]: { total: number; completed: number }
		}
	}

	const socket = skio.get()

	// Download progress state managed by this component
	let downloadingQuants: {
		[key: string]: {
			modelName: string
			status: string
			isDone: boolean
			files: {
				[key: string]: { total: number; completed: number }
			}
		}
	} = $state({})

	let downloadingCount = $derived(
		Object.keys(downloadingQuants).filter(
			(key) => key !== "undefined" && !downloadingQuants[key].isDone
		).length
	)

	let doneCount = $derived(
		Object.keys(downloadingQuants).filter(
			(key) => key !== "undefined" && downloadingQuants[key].isDone
		).length
	)

	function isComplete(progress: DownloadProgress) {
		const files = Object.values(progress.files)
		return (
			files.length > 0 &&
			files.every(
				(file) => file.total > 0 && file.completed >= file.total
			)
		)
	}

	// Get file count and completion status
	function getFileStats(progress: DownloadProgress) {
		const files = Object.values(progress.files)
		const completedFiles = files.filter(
			(file) => file.total > 0 && file.completed >= file.total
		).length
		const totalFiles = files.length
		return { completed: completedFiles, total: totalFiles }
	}

	function cancelDownload(modelName: string) {
		socket.emit("ollamaCancelPull", {
			modelName
		} as Sockets.OllamaCancelPull.Call)
	}

	function clearDownloadHistory() {
		socket.emit(
			"ollamaClearDownloadHistory",
			{} as Sockets.OllamaClearDownloadHistory.Call
		)
	}

	onMount(() => {
		socket.on(
			"ollamaPullProgress",
			(message: Sockets.OllamaPullProgress.Response) => {
				// Server sends the entire downloadingQuants object
				downloadingQuants = message.downloadingQuants || {}
			}
		)

		socket.on(
			"ollamaClearDownloadHistory",
			(message: Sockets.OllamaClearDownloadHistory.Response) => {
				if (message.success) {
					downloadingQuants = {}
				}
			}
		)

		// Request current download progress from server after setting up listeners
		socket.emit("ollamaGetDownloadProgress", {})
	})

	onDestroy(() => {
		socket.off("ollamaPullProgress")
		socket.off("ollamaClearDownloadHistory")
	})
</script>

<div class="flex h-full flex-col">
	<div class="p-4">
		{#if !downloadingCount && !doneCount}
			<!-- No downloads state -->
			<div class="flex flex-1 items-center justify-center p-8">
				<div class="text-center">
					<Icons.Download
						class="text-muted-foreground mx-auto mb-4 h-12 w-12"
					/>
					<h3 class="text-foreground mb-2 text-lg font-semibold">
						No Active Downloads
					</h3>
					<p class="text-muted-foreground text-sm">
						Model downloads will appear here when started from the
						Available tab.
					</p>
				</div>
			</div>
		{/if}
		{#if downloadingCount}
			<!-- Downloads header -->
			<div class="flex flex-col gap-2 mb-6">
				<div>
					<div class="mb-2 flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div>
								<h3 class="text-foreground text-lg font-bold">
									Active Downloads
								</h3>
								<p class="text-muted-foreground text-sm">
									{downloadingCount} model{downloadingCount !==
									1
										? "s"
										: ""} downloading
								</p>
							</div>
						</div>
					</div>
				</div>

				<!-- Downloads list -->
				<div class="space-y-4">
					{#each Object.entries(downloadingQuants).filter(([key, progress]) => !progress.isDone) as [key, progress]}
						{@render downloadItem(key, progress)}
					{/each}
				</div>
			</div>
		{/if}
		{#if doneCount}
			<!-- Downloads header -->
			<div class="flex flex-col gap-2">
				<div>
					<div class="mb-2 flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div>
								<h3 class="text-foreground text-lg font-bold">
									Completed Downloads
								</h3>
								<p class="text-muted-foreground text-sm">
									{doneCount} model{doneCount !== 1
										? "s"
										: ""} completed
								</p>
							</div>
						</div>

						<!-- Clear history button -->
						{#if Object.values(downloadingQuants).some((p) => p.isDone)}
							<button
								class="btn btn-sm preset-filled-surface-500"
								onclick={clearDownloadHistory}
								title="Clear completed downloads"
							>
								<Icons.Trash2 size={14} />
								Clear History
							</button>
						{/if}
					</div>
				</div>

				<!-- Downloads list -->
				<div class="space-y-4">
					{#each Object.entries(downloadingQuants).filter(([key, progress]) => progress.isDone) as [key, progress]}
						{@render downloadItem(key, progress)}
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

{#snippet downloadItem(key, progress)}
	{#if key !== "undefined"}
		{@const fileStats = getFileStats(progress)}
		<div
			class="bg-surface-100-900 border-surface-300-700 rounded-lg border p-4"
		>
			<div class="flex items-start gap-4">
				<div class="bg-primary-500/10 mt-1 rounded-full p-2">
					{#if progress.isDone}
						{#if progress.status.toLowerCase() === "cancelled"}
							<Icons.X size={16} class="text-orange-500" />
						{:else if progress.status.toLowerCase() === "error"}
							<Icons.AlertTriangle
								size={16}
								class="text-red-500"
							/>
						{:else}
							<Icons.Check size={16} class="text-green-500" />
						{/if}
					{:else}
						<Icons.Download
							size={16}
							class="text-primary-500 animate-pulse"
						/>
					{/if}
				</div>

				<div class="min-w-0 flex-1">
					<div class="mb-3 flex items-center justify-between">
						<h4 class="text-foreground truncate font-semibold">
							{progress.modelName}
						</h4>
						<div class="ml-2 flex items-center gap-2">
							{#if !progress.isDone}
								<button
									class="btn btn-sm preset-filled-error-500"
									onclick={() =>
										cancelDownload?.(progress.modelName)}
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
									<div
										class="flex items-center justify-between text-xs"
									>
										<span
											class="text-muted-foreground max-w-[60%] truncate font-mono"
											title={fileName}
										>
											{fileName}
										</span>
										<span
											class="text-muted-foreground font-mono"
										>
											{fileProgress.total > 0
												? `${((fileProgress.completed / fileProgress.total) * 100).toFixed(1)}%`
												: "0%"}
										</span>
									</div>
									<div class="w-full">
										<Progress
											value={fileProgress.completed}
											max={fileProgress.total}
										/>
									</div>
									{#if fileProgress.total > 0}
										<div
											class="text-muted-foreground flex justify-end font-mono text-[10px]"
										>
											{(
												fileProgress.completed /
												(1024 * 1024)
											).toFixed(1)}MB /
											{(
												fileProgress.total /
												(1024 * 1024)
											).toFixed(1)}MB
										</div>
									{/if}
								</div>
							{/each}
						</div>

						<div
							class="border-surface-300-700 flex items-center justify-between border-t pt-2 text-xs"
						>
							<div class="flex items-center gap-2">
								<div
									class="h-2 w-2 rounded-full {progress.isDone
										? ''
										: 'animate-pulse'} {progress.status.toLowerCase() ===
									'canceled'
										? 'bg-orange-500'
										: ["error", "cancelled"].includes(progress.status.toLowerCase())
											? 'bg-red-500'
											: progress.status.toLowerCase() ===
														'success' ||
												  isComplete(progress)
												? 'bg-green-500'
												: 'bg-blue-500'}"
								></div>
								<span class="text-muted-foreground font-medium">
									{progress.status}
								</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}
{/snippet}
