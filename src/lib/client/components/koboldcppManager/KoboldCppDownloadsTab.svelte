<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Progress } from "@skeletonlabs/skeleton-svelte"
	import { onMount, onDestroy } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"

	const socket = useTypedSocket()

	type DownloadEntry = Sockets.KoboldCPP.DownloadProgress.DownloadEntry
	let downloads = $state<Record<string, DownloadEntry>>({})

	let activeCount = $derived(
		Object.values(downloads).filter((d) => !d.isDone).length
	)
	let doneCount = $derived(
		Object.values(downloads).filter((d) => d.isDone).length
	)

	function cancelDownload(filename: string) {
		socket.emit("koboldcpp:cancelDownload", { filename })
	}

	function clearHistory() {
		socket.emit("koboldcpp:clearDownloadHistory", {})
	}

	function pct(entry: DownloadEntry) {
		if (!entry.total) return 0
		return (entry.downloaded / entry.total) * 100
	}

	function fmtBytes(bytes: number) {
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
		if (bytes < 1024 * 1024 * 1024)
			return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
	}

	onMount(() => {
		socket.on(
			"koboldcpp:downloadProgress",
			(msg: Sockets.KoboldCPP.DownloadProgress.Response) => {
				downloads = msg.downloads
			}
		)

		socket.on(
			"koboldcpp:getDownloadProgress",
			(msg: Sockets.KoboldCPP.GetDownloadProgress.Response) => {
				downloads = msg.downloads
			}
		)

		socket.on("koboldcpp:cancelDownload", () => {})

		socket.on(
			"koboldcpp:clearDownloadHistory",
			(msg: Sockets.KoboldCPP.ClearDownloadHistory.Response) => {
				if (msg.success) downloads = {}
			}
		)

		socket.emit("koboldcpp:getDownloadProgress", {})
	})

	onDestroy(() => {
		socket.off("koboldcpp:downloadProgress")
		socket.off("koboldcpp:getDownloadProgress")
		socket.off("koboldcpp:cancelDownload")
		socket.off("koboldcpp:clearDownloadHistory")
	})
</script>

<div class="flex h-full flex-col p-4">
	{#if activeCount === 0 && doneCount === 0}
		<div class="flex flex-1 items-center justify-center p-8">
			<div class="text-center">
				<Icons.Download
					class="text-muted-foreground mx-auto mb-4 h-12 w-12 opacity-50"
				/>
				<h3 class="text-foreground mb-2 text-lg font-semibold">
					No Downloads
				</h3>
				<p class="text-muted-foreground text-sm">
					Downloads started from the Available tab will appear here.
				</p>
			</div>
		</div>
	{:else}
		<div class="space-y-4">
			{#if activeCount > 0}
				<div>
					<div class="mb-2 flex items-center justify-between">
						<h3 class="font-bold">Active Downloads</h3>
						<p class="text-muted-foreground text-sm">
							{activeCount} downloading
						</p>
					</div>
					<div class="space-y-3">
						{#each Object.values(downloads).filter((d) => !d.isDone) as entry (entry.filename)}
							{@render downloadItem(entry)}
						{/each}
					</div>
				</div>
			{/if}

			{#if doneCount > 0}
				<div>
					<div class="mb-2 flex items-center justify-between">
						<h3 class="font-bold">Completed</h3>
						<button
							class="btn btn-sm preset-filled-surface-500"
							onclick={clearHistory}
						>
							<Icons.Trash2 size={14} />
							Clear History
						</button>
					</div>
					<div class="space-y-3">
						{#each Object.values(downloads).filter((d) => d.isDone) as entry (entry.filename)}
							{@render downloadItem(entry)}
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

{#snippet downloadItem(entry: DownloadEntry)}
	<div
		class="bg-surface-100-900 border-surface-300-700 rounded-lg border p-4"
	>
		<div class="flex items-start gap-4">
			<div class="bg-primary-500/10 mt-1 rounded-full p-2">
				{#if entry.isDone && entry.status === "success"}
					<Icons.Check size={16} class="text-success-500" />
				{:else if entry.isDone && entry.status === "cancelled"}
					<Icons.X size={16} class="text-warning-500" />
				{:else if entry.isDone && entry.status === "error"}
					<Icons.AlertTriangle size={16} class="text-error-500" />
				{:else}
					<Icons.Download
						size={16}
						class="text-primary-500 animate-pulse"
					/>
				{/if}
			</div>

			<div class="min-w-0 flex-1">
				<div class="mb-2 flex items-center justify-between gap-2">
					<div class="min-w-0">
						<p class="truncate font-mono text-sm font-semibold">
							{entry.filename}
						</p>
						<p class="text-muted-foreground truncate text-xs">
							{entry.modelName}
						</p>
					</div>
					{#if !entry.isDone}
						<button
							class="btn btn-sm preset-filled-error-500 shrink-0"
							onclick={() => cancelDownload(entry.filename)}
						>
							<Icons.X size={14} />
							Cancel
						</button>
					{/if}
				</div>

				{#if !entry.isDone}
					<Progress
						value={entry.downloaded}
						max={entry.total || 1}
						aria-label="Download progress for {entry.filename}: {pct(
							entry
						).toFixed(1)}%"
					>
						<Progress.Track class="bg-surface-200-800">
							<Progress.Range class="bg-primary-500" />
						</Progress.Track>
					</Progress>
					<div
						class="text-muted-foreground mt-1 flex justify-between font-mono text-xs"
					>
						<span class="capitalize">{entry.status}</span>
						{#if entry.total > 0}
							<span>
								{fmtBytes(entry.downloaded)} / {fmtBytes(
									entry.total
								)} ({pct(entry).toFixed(1)}%)
							</span>
						{/if}
					</div>
				{:else}
					<div class="border-surface-300-700 border-t pt-2">
						<div class="flex items-center gap-2">
							<div
								class="h-2 w-2 rounded-full {entry.status ===
								'success'
									? 'bg-success-500'
									: entry.status === 'cancelled'
										? 'bg-warning-500'
										: 'bg-error-500'}"
							></div>
							<span
								class="text-muted-foreground text-xs font-medium capitalize"
							>
								{entry.status}
							</span>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/snippet}
