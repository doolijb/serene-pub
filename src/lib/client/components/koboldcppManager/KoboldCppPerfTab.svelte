<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import * as skio from "sveltekit-io"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		isManaged?: boolean
	}
	let { isManaged = false }: Props = $props()

	const socket = skio.get()
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(getContext("koboldCppSettingsCtx"))

	// --- Perf ---
	let perf = $state<Sockets.KoboldCpp.Perf.Response | null>(null)
	let isLoadingPerf = $state(false)

	// --- Subprocess status ---
	type Status = Sockets.KoboldCpp.SubprocessStatus.Response
	let subStatus = $state<Status | null>(null)
	let currentModel = $state<string | null>(null)
	let currentContext = $state<number | null>(null)
	let adminEnabled = $state(false)
	let unloading = $state(false)
	let starting = $state(false)
	let stopping = $state(false)

	const statusColors: Record<string, string> = {
		running: "bg-success-500",
		starting: "bg-warning-500 animate-pulse",
		stopped: "bg-surface-400",
		crashed: "bg-error-500",
		stopping: "bg-warning-500"
	}

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

	function refreshPerf() {
		isLoadingPerf = true
		socket.emit("koboldcpp:perf", {})
	}

	function startSubprocess() {
		starting = true
		socket.emit("koboldcpp:startSubprocess", {})
	}

	function stopSubprocess() {
		stopping = true
		socket.emit("koboldcpp:stopSubprocess", {})
	}

	function unloadModel() {
		unloading = true
		socket.emit("koboldcpp:unloadModel", {})
	}

	async function refreshModel() {
		try {
			const baseUrl = koboldCppSettingsCtx.settings?.koboldCppManagerBaseUrl ?? "http://localhost:5001"
			const resp = await fetch(`${baseUrl}/api/v1/model`)
			if (resp.ok) {
				const d = await resp.json()
				currentModel = d.result && d.result !== "Read Only" ? d.result : null
			}
			const vResp = await fetch(`${baseUrl}/api/extra/version`)
			if (vResp.ok) {
				const d = await vResp.json()
				adminEnabled = !!d.admin
			}
			const cResp = await fetch(`${baseUrl}/api/extra/true_max_context_length`)
			if (cResp.ok) {
				const d = await cResp.json()
				currentContext = typeof d.value === "number" ? d.value : null
			} else {
				currentContext = null
			}
		} catch {
			currentModel = null
			currentContext = null
		}
	}

	onMount(() => {
		socket.on("koboldcpp:perf", (message: Sockets.KoboldCpp.Perf.Response) => {
			isLoadingPerf = false
			perf = message
		})
		socket.on("koboldcpp:perf:error", (message: any) => {
			isLoadingPerf = false
			toaster.error({ title: "Failed to fetch performance stats", description: message.error })
		})

		if (isManaged) {
			socket.emit("koboldcpp:getSubprocessStatus", {})

			socket.on("koboldcpp:subprocessStatus", (msg: Status) => {
				subStatus = msg
				starting = false
				stopping = false
				if (msg.status === "running") refreshModel()
			})
			socket.on("koboldcpp:getSubprocessStatus", (msg: Sockets.KoboldCpp.GetSubprocessStatus.Response) => {
				subStatus = msg.status
				starting = false
				stopping = false
				if (msg.status.status === "running") refreshModel()
			})
			socket.on("koboldcpp:startSubprocess", () => {
				starting = false
				toaster.success({ title: "KoboldCPP starting…" })
			})
			socket.on("koboldcpp:startSubprocess:error", (msg: any) => {
				starting = false
				toaster.error({ title: "Failed to start", description: msg?.error })
			})
			socket.on("koboldcpp:stopSubprocess", () => {
				stopping = false
				toaster.success({ title: "KoboldCPP stopped" })
			})
			socket.on("koboldcpp:unloadModel", (msg: Sockets.KoboldCpp.UnloadModel.Response) => {
				unloading = false
				if (msg.success) {
					currentModel = null
					currentContext = null
					toaster.success({ title: "Model unloaded" })
				} else {
					toaster.error({ title: "Unload not supported by this build" })
				}
			})
		}

		refreshPerf()
	})

	onDestroy(() => {
		socket.off("koboldcpp:perf")
		socket.off("koboldcpp:perf:error")
		if (isManaged) {
			socket.off("koboldcpp:subprocessStatus")
			socket.off("koboldcpp:getSubprocessStatus")
			socket.off("koboldcpp:startSubprocess")
			socket.off("koboldcpp:startSubprocess:error")
			socket.off("koboldcpp:stopSubprocess")
			socket.off("koboldcpp:unloadModel")
		}
	})
</script>

<div class="space-y-4 p-4">
	{#if isManaged}
		<!-- Subprocess status -->
		<div class="card bg-surface-100-800 flex flex-col gap-3 p-4">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<span class="h-2.5 w-2.5 rounded-full {statusColors[subStatus?.status ?? 'stopped']}"></span>
					<span class="text-sm font-medium capitalize">{subStatus?.status ?? "stopped"}</span>
					{#if subStatus?.pid}
						<span class="text-surface-500 text-xs">PID {subStatus.pid}</span>
					{/if}
				</div>
				<div class="flex gap-1.5">
					{#if subStatus?.status === "running" || subStatus?.status === "starting"}
						<button
							class="btn btn-sm preset-tonal-error"
							onclick={stopSubprocess}
							disabled={stopping || subStatus?.status === "stopping"}
						>
							{#if stopping}<Icons.Loader2 size={13} class="animate-spin" />{:else}<Icons.Square size={13} />{/if}
							Stop
						</button>
					{:else}
						<button
							class="btn btn-sm preset-tonal-success"
							onclick={startSubprocess}
							disabled={starting}
						>
							{#if starting}<Icons.Loader2 size={13} class="animate-spin" />{:else}<Icons.Play size={13} />{/if}
							Start
						</button>
					{/if}
				</div>
			</div>
			{#if subStatus?.lastError}
				<p class="text-error-500 text-xs">{subStatus.lastError}</p>
			{/if}
			{#if subStatus?.startedAt}
				<p class="text-surface-500 text-xs">Started {new Date(subStatus.startedAt).toLocaleTimeString()}</p>
			{/if}

			<!-- Loaded model -->
			<div>
				<p class="text-surface-500 mb-1 text-xs font-semibold uppercase tracking-wide">Loaded model</p>
				<div class="flex items-center gap-2">
					<Icons.Brain size={14} class="text-surface-400 shrink-0" />
					<span class="min-w-0 flex-1 truncate text-xs">
						{currentModel ?? "No model loaded"}
						{#if currentModel && currentContext}
							<span class="text-surface-500">· {currentContext.toLocaleString()} ctx</span>
						{/if}
					</span>
					{#if currentModel}
						<button
							class="btn btn-sm preset-tonal-warning shrink-0 text-xs"
							onclick={unloadModel}
							disabled={unloading}
							title="Unload model from memory"
						>
							{#if unloading}<Icons.Loader2 size={12} class="animate-spin" />{:else}<Icons.Eject size={12} />{/if}
							Unload
						</button>
					{/if}
				</div>
				{#if adminEnabled}
					<p class="text-success-600-400 mt-1 flex items-center gap-1 text-xs">
						<Icons.ShieldCheck size={11} />
						Admin mode active
					</p>
				{/if}
			</div>

			<!-- Binary info -->
			{#if koboldCppSettingsCtx.settings?.koboldCppManagedBinaryVariant}
				<div>
					<p class="text-surface-500 mb-1 text-xs font-semibold uppercase tracking-wide">Binary</p>
					<p class="text-xs">{koboldCppSettingsCtx.settings.koboldCppManagedBinaryVariant}</p>
					{#if koboldCppSettingsCtx.settings.koboldCppManagedBinaryDir}
						<p class="text-surface-500 text-xs">{koboldCppSettingsCtx.settings.koboldCppManagedBinaryDir}</p>
					{/if}
				</div>
			{/if}
		</div>

	{/if}

	<!-- Performance stats -->
	<div class="flex items-center justify-between">
		<h3 class="font-semibold">Performance</h3>
		<button
			class="btn btn-sm preset-filled-surface-500"
			onclick={refreshPerf}
			disabled={isLoadingPerf}
			title="Refresh stats"
		>
			<Icons.RefreshCw size={14} class={isLoadingPerf ? "animate-spin" : ""} />
		</button>
	</div>

	{#if !perf && isLoadingPerf}
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
