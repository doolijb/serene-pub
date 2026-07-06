<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy } from "svelte"
	import * as skio from "sveltekit-io"
	import { toaster } from "$lib/client/utils/toaster"

	const socket = skio.get()

	let perf = $state<Sockets.KoboldCpp.Perf.Response | null>(null)
	let isLoading = $state(false)

	function formatUptime(seconds: number): string {
		if (seconds < 60) return `${Math.floor(seconds)}s`
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
		const h = Math.floor(seconds / 3600)
		const m = Math.floor((seconds % 3600) / 60)
		return `${h}h ${m}m`
	}

	function formatSpeed(tokensPerSec: number): string {
		if (tokensPerSec <= 0) return "—"
		return `${tokensPerSec.toFixed(1)} t/s`
	}

	function refresh() {
		isLoading = true
		socket.emit("koboldcpp:perf", {})
	}

	onMount(() => {
		socket.on(
			"koboldcpp:perf",
			(message: Sockets.KoboldCpp.Perf.Response) => {
				isLoading = false
				perf = message
			}
		)

		socket.on("koboldcpp:perf:error", (message: any) => {
			isLoading = false
			toaster.error({ title: "Failed to fetch performance stats", description: message.error })
		})

		refresh()
	})

	onDestroy(() => {
		socket.off("koboldcpp:perf")
		socket.off("koboldcpp:perf:error")
	})
</script>

<div class="space-y-4 p-4">
	<div class="flex items-center justify-between">
		<h3 class="font-semibold">Performance</h3>
		<button
			class="btn btn-sm preset-filled-surface-500"
			onclick={refresh}
			disabled={isLoading}
			title="Refresh stats"
		>
			<Icons.RefreshCw size={14} class={isLoading ? "animate-spin" : ""} />
		</button>
	</div>

	{#if !perf && isLoading}
		<div class="flex items-center justify-center py-10">
			<Icons.Loader2 size={24} class="text-muted-foreground animate-spin" />
		</div>
	{:else if perf}
		<!-- Status badge -->
		<div class="card bg-surface-100-800 flex items-center justify-between p-4">
			<span class="text-sm font-medium">Status</span>
			<span
				class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold {perf.idle
					? 'bg-success-100 dark:bg-success-900 text-success-800 dark:text-success-200'
					: 'bg-warning-100 dark:bg-warning-900 text-warning-800 dark:text-warning-200'}"
			>
				<span class="h-1.5 w-1.5 rounded-full {perf.idle ? 'bg-success-500' : 'bg-warning-500'}"></span>
				{perf.idle ? "Idle" : "Busy"}
			</span>
		</div>

		<!-- Speed stats -->
		<div class="card bg-surface-100-800 p-4">
			<h4 class="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wide">Generation Speed</h4>
			<div class="grid grid-cols-2 gap-3">
				<div class="text-center">
					<div class="text-2xl font-bold tabular-nums">{formatSpeed(perf.avgGenSpeed)}</div>
					<div class="text-muted-foreground text-xs">Avg generation</div>
				</div>
				<div class="text-center">
					<div class="text-2xl font-bold tabular-nums">{formatSpeed(perf.avgPromptSpeed)}</div>
					<div class="text-muted-foreground text-xs">Avg prompt processing</div>
				</div>
			</div>
		</div>

		<!-- Last request -->
		{#if perf.lastTokenCount > 0}
			<div class="card bg-surface-100-800 p-4">
				<h4 class="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wide">Last Request</h4>
				<div class="space-y-2 text-sm">
					<div class="flex justify-between">
						<span class="text-muted-foreground">Tokens processed</span>
						<span class="font-mono">{perf.lastTokenCount}</span>
					</div>
					<div class="flex justify-between">
						<span class="text-muted-foreground">Prompt time</span>
						<span class="font-mono">{perf.lastProcess.toFixed(2)}s</span>
					</div>
					<div class="flex justify-between">
						<span class="text-muted-foreground">Generation time</span>
						<span class="font-mono">{perf.lastEval.toFixed(2)}s</span>
					</div>
				</div>
			</div>
		{/if}

		<!-- System stats -->
		<div class="card bg-surface-100-800 p-4">
			<h4 class="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wide">System</h4>
			<div class="space-y-2 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Uptime</span>
					<span class="font-mono">{formatUptime(perf.uptime)}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Total generations</span>
					<span class="font-mono">{perf.totalGens}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Queue depth</span>
					<span class="font-mono {perf.queue > 0 ? 'text-warning-500' : ''}">{perf.queue}</span>
				</div>
			</div>
		</div>
	{/if}
</div>
