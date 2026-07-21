<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		isManaged?: boolean
	}
	let { isManaged = false }: Props = $props()

	const socket = useTypedSocket()
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(getContext("koboldCppSettingsCtx"))
	let showFullConfigModal = $state(false)

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
	let loadedConfig = $state<Sockets.KoboldCpp.GetLoadedConfig.Response["config"]>(null)

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
		socket.emit("koboldcpp:getLoadedConfig", {})
	}

	onMount(() => {
		socket.on("koboldcpp:perf", (message: Sockets.KoboldCpp.Perf.Response) => {
			isLoadingPerf = false
			perf = message
		})
		socket.on("koboldcpp:perf:error", (message: Sockets.ErrorResponse) => {
			isLoadingPerf = false
			toaster.error({ title: "Failed to fetch performance stats", description: message.error })
		})

		if (isManaged) {
			socket.emit("koboldcpp:getSubprocessStatus", {})

			socket.on("koboldcpp:getLoadedConfig", (msg: Sockets.KoboldCpp.GetLoadedConfig.Response) => {
				loadedConfig = msg.config
			})
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
			socket.on("koboldcpp:startSubprocess:error", (msg: Sockets.ErrorResponse) => {
				starting = false
				toaster.error({ title: "Failed to start", description: msg?.error })
			})
			socket.on("koboldcpp:stopSubprocess", (msg: Sockets.KoboldCpp.StopSubprocess.Response) => {
				stopping = false
				if (msg.success) {
					toaster.success({ title: "KoboldCPP stopped" })
				} else {
					toaster.error({ title: "Couldn't stop KoboldCPP", description: msg.error })
				}
			})
			socket.on("koboldcpp:unloadModel", (msg: Sockets.KoboldCpp.UnloadModel.Response) => {
				unloading = false
				if (msg.success) {
					currentModel = null
					currentContext = null
					loadedConfig = null
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
			socket.off("koboldcpp:getLoadedConfig")
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
						<span class="text-surface-700-300 text-xs">PID {subStatus.pid}</span>
					{/if}
				</div>
				<div class="flex gap-1.5">
					{#if subStatus?.status === "running" || subStatus?.status === "starting" || subStatus?.status === "stopping"}
						<button
							class="btn btn-sm preset-tonal-error"
							onclick={stopSubprocess}
							disabled={stopping || subStatus?.status === "stopping" || subStatus?.isExternal}
							title={subStatus?.isExternal
								? "This instance wasn't started by this Manager, so it can't be stopped from here"
								: undefined}
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
			{#if subStatus?.isExternal}
				<div class="border-warning-500 bg-warning-500/10 flex items-start gap-2 rounded-lg border p-2">
					<Icons.AlertTriangle size={14} class="text-warning-700-300 mt-0.5 shrink-0" />
					<p class="text-warning-700-300 text-xs">
						This is an external KoboldCpp instance the Manager found already running on the
						configured port, not one it started itself — Stop and Unload aren't available for it,
						and its admin password may not match, which can make model loading fail.
					</p>
				</div>
			{/if}
			{#if subStatus?.lastError}
				<p class="text-error-500 text-xs">{subStatus.lastError}</p>
			{/if}
			{#if subStatus?.startedAt}
				<p class="text-surface-700-300 text-xs">Started {new Date(subStatus.startedAt).toLocaleTimeString()}</p>
			{/if}

			<!-- Loaded model -->
			<div>
				<p class="text-surface-700-300 mb-1 text-xs font-semibold uppercase tracking-wide">Loaded model</p>
				<div class="flex items-center gap-2">
					<Icons.Brain size={14} class="text-surface-400 shrink-0" />
					<span class="min-w-0 flex-1 truncate text-xs">
						{currentModel ?? "No model loaded"}
						{#if currentModel && currentContext}
							<span class="text-surface-700-300">· {currentContext.toLocaleString()} ctx</span>
						{/if}
					</span>
					{#if currentModel}
						<button
							class="btn btn-sm preset-tonal-warning shrink-0 text-xs"
							onclick={unloadModel}
							disabled={unloading}
							title={subStatus?.isExternal
								? "This instance's admin password may not match the Manager's — unload may fail"
								: "Unload model from memory"}
						>
							{#if unloading}<Icons.Loader2 size={12} class="animate-spin" />{:else}<Icons.LogOut size={12} />{/if}
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

			<!-- Loaded config -->
			{#if currentModel}
				<div>
					<p class="text-surface-700-300 mb-1 text-xs font-semibold uppercase tracking-wide">Loaded config</p>
					{#if loadedConfig}
						<div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
							<div class="flex justify-between gap-2">
								<span class="text-surface-700-300">Context</span>
								<span class="font-mono">{loadedConfig.contextSize.toLocaleString()}</span>
							</div>
							<div class="flex justify-between gap-2">
								<span class="text-surface-700-300">GPU layers</span>
								<span class="font-mono">{loadedConfig.gpuLayers === -1 ? "auto" : loadedConfig.gpuLayers}</span>
							</div>
							<div class="flex justify-between gap-2">
								<span class="text-surface-700-300">Batch size</span>
								<span class="font-mono">{loadedConfig.batchSize}</span>
							</div>
							<div class="flex justify-between gap-2">
								<span class="text-surface-700-300">Flash attn</span>
								<span class="font-mono">{loadedConfig.flashAttention ? "on" : "off"}</span>
							</div>
						</div>
						<button
							class="btn btn-sm preset-tonal-primary mt-2 text-xs"
							onclick={() => (showFullConfigModal = true)}
						>
							<Icons.FileText size={12} />
							View Full Config
						</button>
					{:else}
						<p class="text-surface-700-300 text-xs italic">
							Unknown — the server restarted since this model was loaded. Reload it to see its config here.
						</p>
					{/if}
				</div>
			{/if}

			<!-- Binary info -->
			{#if koboldCppSettingsCtx.settings?.koboldCppManagedBinaryVariant}
				<div>
					<p class="text-surface-700-300 mb-1 text-xs font-semibold uppercase tracking-wide">Binary</p>
					<p class="text-xs">{koboldCppSettingsCtx.settings.koboldCppManagedBinaryVariant}</p>
					{#if koboldCppSettingsCtx.settings.koboldCppManagedBinaryDir}
						<p class="text-surface-700-300 text-xs">{koboldCppSettingsCtx.settings.koboldCppManagedBinaryDir}</p>
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

<!-- Full Config Modal -->
<Dialog
	open={showFullConfigModal}
	onOpenChange={(e) => (showFullConfigModal = e.open)}
>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 p-6 space-y-4 shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
				<header class="flex items-center gap-3">
					<Icons.FileText class="text-primary-500 h-5 w-5 shrink-0" />
					<h2 class="text-lg font-bold">Loaded Config</h2>
				</header>
				<p class="text-surface-700-300 text-xs">
					The exact .kcpps config sent to KoboldCPP when this model was loaded.
				</p>
				<pre class="bg-surface-200-800 min-h-0 flex-1 overflow-auto rounded-lg p-3 text-xs">{loadedConfig?.rawConfigJson ?? ""}</pre>
				<footer class="flex justify-end">
					<button class="btn preset-filled-surface-400-600" onclick={() => (showFullConfigModal = false)}>
						Close
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
