<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getContext, onMount, onDestroy } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"

	const socket = useTypedSocket()
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx")
	)

	type Status = Sockets.KoboldCPP.SubprocessStatus.Response

	let subStatus = $state<Status | null>(null)
	let currentModel = $state<string | null>(null)
	let adminEnabled = $state(false)
	let unloading = $state(false)
	let starting = $state(false)
	let stopping = $state(false)

	let ttlSecs = $state(
		koboldCppSettingsCtx.settings?.koboldCppManagedModelTtlSecs ?? 300
	)
	let ttlDraft = $state(String(ttlSecs))
	let savingTtl = $state(false)

	let port = $state(
		koboldCppSettingsCtx.settings?.koboldCppManagedPort ?? 5001
	)
	let portDraft = $state(String(port))
	let savingPort = $state(false)

	const statusColors: Record<string, string> = {
		running: "bg-success-500",
		starting: "bg-warning-500 animate-pulse",
		stopped: "bg-surface-400",
		crashed: "bg-error-500",
		stopping: "bg-warning-500"
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

	function saveTtl() {
		const v = parseInt(ttlDraft)
		if (isNaN(v) || v < 0) return
		savingTtl = true
		socket.emit("koboldcpp:setModelTtl", { ttlSecs: v })
	}

	function savePort() {
		const v = parseInt(portDraft)
		if (isNaN(v) || v < 1024 || v > 65535) return
		savingPort = true
		socket.emit("koboldcpp:setManagedPort", { port: v })
	}

	async function refreshModel() {
		try {
			const baseUrl =
				koboldCppSettingsCtx.settings?.koboldCppManagerBaseUrl ??
				"http://localhost:5001"
			const resp = await fetch(`${baseUrl}/api/v1/model`)
			if (resp.ok) {
				const d = await resp.json()
				currentModel =
					d.result && d.result !== "Read Only" ? d.result : null
			}
			const vResp = await fetch(`${baseUrl}/api/extra/version`)
			if (vResp.ok) {
				const d = await vResp.json()
				adminEnabled = !!d.admin
			}
		} catch {
			currentModel = null
		}
	}

	onMount(() => {
		socket.emit("koboldcpp:getSubprocessStatus", {})

		socket.on("koboldcpp:subprocessStatus", (msg: Status) => {
			subStatus = msg
			starting = false
			stopping = false
			if (msg.status === "running") refreshModel()
		})
		socket.on(
			"koboldcpp:getSubprocessStatus",
			(msg: Sockets.KoboldCPP.GetSubprocessStatus.Response) => {
				subStatus = msg.status
				starting = false
				stopping = false
				if (msg.status.status === "running") refreshModel()
			}
		)
		socket.on("koboldcpp:startSubprocess", () => {
			starting = false
			toaster.success({ title: "KoboldCPP starting…" })
		})
		socket.on(
			"koboldcpp:startSubprocess:error",
			(msg: Sockets.ErrorResponse) => {
				starting = false
				toaster.error({
					title: "Failed to start",
					description: msg?.error
				})
			}
		)
		socket.on("koboldcpp:stopSubprocess", () => {
			stopping = false
			toaster.success({ title: "KoboldCPP stopped" })
		})
		socket.on(
			"koboldcpp:unloadModel",
			(msg: Sockets.KoboldCPP.UnloadModel.Response) => {
				unloading = false
				if (msg.success) {
					currentModel = null
					toaster.success({ title: "Model unloaded" })
				} else {
					toaster.error({
						title: "Unload not supported by this build"
					})
				}
			}
		)
		socket.on("koboldcpp:setModelTtl", () => {
			savingTtl = false
			toaster.success({ title: "TTL updated" })
		})
		socket.on("koboldcpp:setManagedPort", () => {
			savingPort = false
			toaster.success({ title: "Port updated — restart required" })
		})
	})

	onDestroy(() => {
		socket.off("koboldcpp:subprocessStatus")
		socket.off("koboldcpp:getSubprocessStatus")
		socket.off("koboldcpp:startSubprocess")
		socket.off("koboldcpp:startSubprocess:error")
		socket.off("koboldcpp:stopSubprocess")
		socket.off("koboldcpp:unloadModel")
		socket.off("koboldcpp:setModelTtl")
		socket.off("koboldcpp:setManagedPort")
	})
</script>

<div class="flex flex-col gap-4 p-3">
	<!-- Process status -->
	<div class="bg-surface-100-900 rounded-lg p-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<span
					class="h-2.5 w-2.5 rounded-full {statusColors[
						subStatus?.status ?? 'stopped'
					]}"
				></span>
				<span class="text-sm font-medium capitalize">
					{subStatus?.status ?? "stopped"}
				</span>
				{#if subStatus?.pid}
					<span class="text-surface-700-300 text-xs">
						PID {subStatus.pid}
					</span>
				{/if}
			</div>
			<div class="flex gap-1.5">
				{#if subStatus?.status === "running" || subStatus?.status === "starting" || subStatus?.status === "stopping"}
					<button
						class="btn btn-sm preset-tonal-error"
						onclick={stopSubprocess}
						disabled={stopping || subStatus?.status === "stopping"}
					>
						{#if stopping}<Icons.Loader2
								size={13}
								class="animate-spin"
							/>{:else}<Icons.Square size={13} />{/if}
						Stop
					</button>
				{:else}
					<button
						class="btn btn-sm preset-tonal-success"
						onclick={startSubprocess}
						disabled={starting}
					>
						{#if starting}<Icons.Loader2
								size={13}
								class="animate-spin"
							/>{:else}<Icons.Play size={13} />{/if}
						Start
					</button>
				{/if}
			</div>
		</div>
		{#if subStatus?.lastError}
			<p class="text-error-500 mt-2 text-xs">{subStatus.lastError}</p>
		{/if}
		{#if subStatus?.startedAt}
			<p class="text-surface-700-300 mt-1 text-xs">
				Started {new Date(subStatus.startedAt).toLocaleTimeString()}
			</p>
		{/if}
	</div>

	<!-- Current model -->
	<div class="bg-surface-100-900 rounded-lg p-3">
		<p
			class="text-surface-700-300 mb-1 text-xs font-semibold tracking-wide uppercase"
		>
			Loaded model
		</p>
		<div class="flex items-center gap-2">
			<Icons.Brain size={14} class="text-surface-400 shrink-0" />
			<span class="min-w-0 flex-1 truncate text-xs">
				{currentModel ?? "No model loaded"}
			</span>
			{#if currentModel}
				<button
					class="btn btn-sm preset-tonal-warning shrink-0 text-xs"
					onclick={unloadModel}
					disabled={unloading}
					title="Unload model from memory"
				>
					{#if unloading}<Icons.Loader2
							size={12}
							class="animate-spin"
						/>{:else}<Icons.LogOut size={12} />{/if}
					Unload
				</button>
			{/if}
		</div>
		{#if adminEnabled}
			<p
				class="text-success-600-400 mt-1 flex items-center gap-1 text-xs"
			>
				<Icons.ShieldCheck size={11} />
				Admin mode active
			</p>
		{/if}
	</div>

	<!-- TTL setting -->
	<div class="bg-surface-100-900 rounded-lg p-3">
		<p
			class="text-surface-700-300 mb-2 text-xs font-semibold tracking-wide uppercase"
		>
			Model unload timer
		</p>
		<div class="flex items-center gap-2">
			<input
				type="number"
				min="0"
				step="60"
				bind:value={ttlDraft}
				class="input w-24 text-sm"
				placeholder="300"
				aria-label="Model unload timer, seconds"
			/>
			<span class="text-surface-700-300 text-xs">seconds</span>
			<button
				class="btn btn-sm preset-filled-surface-400-600 text-xs"
				onclick={saveTtl}
				disabled={savingTtl}
			>
				{#if savingTtl}<Icons.Loader2
						size={12}
						class="animate-spin"
					/>{:else}Save{/if}
			</button>
		</div>
		<p class="text-surface-700-300 mt-1 text-xs">
			{ttlDraft === "0" || ttlDraft === ""
				? "Model stays loaded until manually unloaded."
				: `Unload model after ${ttlDraft}s of inactivity.`}
		</p>
	</div>

	<!-- Port setting -->
	<div class="bg-surface-100-900 rounded-lg p-3">
		<p
			class="text-surface-700-300 mb-2 text-xs font-semibold tracking-wide uppercase"
		>
			Port
		</p>
		<div class="flex items-center gap-2">
			<input
				type="number"
				min="1024"
				max="65535"
				bind:value={portDraft}
				class="input w-24 text-sm"
				placeholder="5001"
				aria-label="Port"
			/>
			<button
				class="btn btn-sm preset-filled-surface-400-600 text-xs"
				onclick={savePort}
				disabled={savingPort}
			>
				{#if savingPort}<Icons.Loader2
						size={12}
						class="animate-spin"
					/>{:else}Save{/if}
			</button>
		</div>
		<p class="text-surface-700-300 mt-1 text-xs">
			Requires restart to take effect.
		</p>
	</div>

	<!-- Binary info -->
	{#if koboldCppSettingsCtx.settings?.koboldCppManagedBinaryVariant}
		<div class="bg-surface-100-900 rounded-lg p-3">
			<p
				class="text-surface-700-300 mb-1 text-xs font-semibold tracking-wide uppercase"
			>
				Binary
			</p>
			<p class="text-xs">
				{koboldCppSettingsCtx.settings.koboldCppManagedBinaryVariant}
			</p>
			{#if koboldCppSettingsCtx.settings.koboldCppManagedBinaryDir}
				<p class="text-surface-700-300 text-xs">
					{koboldCppSettingsCtx.settings.koboldCppManagedBinaryDir}
				</p>
			{/if}
		</div>
	{/if}
</div>
