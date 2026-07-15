<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext, onMount, onDestroy } from "svelte"
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { ValueChangeDetails } from "@zag-js/tabs"
	import KoboldCppModelsTab from "../koboldcppManager/KoboldCppModelsTab.svelte"
	import KoboldCppSettingsTab from "../koboldcppManager/KoboldCppSettingsTab.svelte"
	import KoboldCppPerfTab from "../koboldcppManager/KoboldCppPerfTab.svelte"
	import KoboldCppDownloadTab from "../koboldcppManager/KoboldCppDownloadTab.svelte"
	import KoboldCppDownloadsTab from "../koboldcppManager/KoboldCppDownloadsTab.svelte"
	import KoboldCppSetupScreen from "../koboldcppManager/KoboldCppSetupScreen.svelte"
	import KoboldCppBinaryVariantPicker from "../koboldcppManager/KoboldCppBinaryVariantPicker.svelte"
	import * as skio from "sveltekit-io"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = skio.get()
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(getContext("koboldCppSettingsCtx"))

	let activeTab = $state("models")
	let isConnected = $state(false)
	let isLocal = $state(true)
	let isTesting = $state(false)
	let isSavingBaseUrl = $state(false)
	let baseUrlField = $state("")
	let showVariantPicker = $state(false)
	let lastToastedError: string | null = $state(null)
	let missingBinaryError: string | null = $state(null)

	// Derive mode from system settings
	let managedMode = $derived(koboldCppSettingsCtx.settings?.koboldCppManagedMode ?? null)
	let isManaged = $derived(managedMode === "managed")
	let isExternal = $derived(managedMode === "external")
	let isUnconfigured = $derived(managedMode === null)

	function handleTabChange(e: ValueChangeDetails): void {
		activeTab = e.value
	}

	function checkConnection() {
		isTesting = true
		socket.emit("koboldcpp:version", {})
	}

	function handleSaveBaseUrl() {
		if (!baseUrlField.trim()) {
			toaster.error({ title: "Base URL cannot be empty" })
			return
		}
		isSavingBaseUrl = true
		socket.emit("koboldcpp:setBaseUrl", { baseUrl: baseUrlField.trim() })
	}

	function handleReset() {
		socket.emit("koboldcpp:setManagedMode", { mode: null })
		isConnected = false
		showVariantPicker = false
	}

	$effect(() => {
		baseUrlField = koboldCppSettingsCtx.settings?.koboldCppManagerBaseUrl ?? ""
	})

	// Auto-check connection for external mode
	$effect(() => {
		if (isExternal && !isConnected) {
			checkConnection()
		}
	})

	// When managed mode is set: if binary not yet chosen, show picker
	$effect(() => {
		if (isManaged && !koboldCppSettingsCtx.settings?.koboldCppManagedBinaryVariant) {
			showVariantPicker = true
		} else if (isManaged && koboldCppSettingsCtx.settings?.koboldCppManagedBinaryVariant) {
			showVariantPicker = false
		}
	})

	onMount(() => {
		socket.on("koboldcpp:version", (message: Sockets.KoboldCpp.Version.Response) => {
			isTesting = false
			isLocal = message.isLocal
			if (!isConnected) {
				isConnected = !!message.version
				if (message.version) {
					toaster.success({ title: "Connected to KoboldCPP", description: `Version ${message.version}` })
				}
			}
		})
		socket.on("koboldcpp:version:error", () => {
			isTesting = false
		})
		socket.on("koboldcpp:setBaseUrl", (message: Sockets.KoboldCpp.SetBaseUrl.Response) => {
			isSavingBaseUrl = false
			if (message.success) {
				toaster.success({ title: "URL updated" })
				checkConnection()
			} else {
				toaster.error({ title: "Failed to update URL" })
			}
		})
		socket.on("koboldcpp:setManagedMode", () => {
			// Mode change is reflected via systemSettingsCtx push
		})
		socket.on("koboldcpp:subprocessStatus", (msg: Sockets.KoboldCpp.SubprocessStatus.Response) => {
			if (msg.status === "running" && !isConnected) {
				isConnected = true
			}
			// The binary can go missing without any in-app action (eg. the host lost
			// the volume between restarts) — without this, the failure only ever
			// shows as a small error line buried in the Perf tab, which the sidebar
			// doesn't default to, so a crash on auto-start can go unnoticed.
			const isMissingBinary =
				msg.status === "crashed" &&
				!!msg.lastError &&
				(msg.lastError.includes("Binary not found") ||
					msg.lastError.includes("Binary not configured"))
			missingBinaryError = isMissingBinary ? msg.lastError : null
			if (isMissingBinary && msg.lastError !== lastToastedError) {
				lastToastedError = msg.lastError
				toaster.error({
					title: "KoboldCPP binary is missing",
					description: "It may have been lost from storage between restarts. Re-download it below."
				})
			}
		})
	})

	onDestroy(() => {
		socket.off("koboldcpp:version")
		socket.off("koboldcpp:version:error")
		socket.off("koboldcpp:setBaseUrl")
		socket.off("koboldcpp:setManagedMode")
		socket.off("koboldcpp:subprocessStatus")
	})

	onclose = async () => true
</script>

<div class="flex h-full flex-col">
	{#if !koboldCppSettingsCtx.settings?.koboldCppManagerEnabled}
		<!-- Feature disabled by admin -->
		<div class="flex flex-1 items-center justify-center p-4">
			<div class="text-center">
				<Icons.AlertCircle class="text-warning-500 mx-auto mb-4 h-12 w-12" />
				<h3 class="mb-2 text-lg font-semibold">KoboldCPP Manager Disabled</h3>
				<p class="text-surface-500 text-sm">Enable KoboldCPP Manager in Settings to use this feature.</p>
			</div>
		</div>

	{:else if isUnconfigured}
		<!-- First-time setup: choose mode -->
		<div class="flex items-center justify-between border-b border-surface-300-700 px-3 py-2">
			<div class="flex items-center gap-2">
				<span class="inline-block h-5 w-5 flex-shrink-0" style="background-color: currentColor; mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain; -webkit-mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain;" aria-hidden="true"></span>
				<span class="text-sm font-semibold">KoboldCPP Setup</span>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto">
			<KoboldCppSetupScreen
				onChooseManaged={() => (showVariantPicker = true)}
				onChooseExternal={() => {}}
			/>
		</div>

	{:else if isManaged && showVariantPicker}
		<!-- Managed: pick & download binary -->
		<div class="flex items-center justify-between border-b border-surface-300-700 px-3 py-2">
			<div class="flex items-center gap-2">
				<span class="inline-block h-5 w-5 flex-shrink-0" style="background-color: currentColor; mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain; -webkit-mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain;" aria-hidden="true"></span>
				<span class="text-sm font-semibold">Download KoboldCPP</span>
			</div>
			<button class="btn btn-sm preset-filled-surface-400-600 text-xs" onclick={handleReset}>
				<Icons.ArrowLeft size={12} />
				Back
			</button>
		</div>
		<div class="flex-1 overflow-y-auto">
			<KoboldCppBinaryVariantPicker
				onDownloadStarted={() => {
					// Optimistic clear: a fresh download is underway, so the stale
					// "binary missing" banner shouldn't linger until (or if) a new
					// subprocessStatus event happens to arrive and overwrite it.
					// Re-set by the handler above if the new attempt fails too.
					missingBinaryError = null
					showVariantPicker = false
					activeTab = "models"
				}}
			/>
		</div>

	{:else if isExternal && !isConnected}
		<!-- External: URL setup -->
		<div class="flex items-center justify-between border-b border-surface-300-700 px-3 py-2">
			<div class="flex items-center gap-2">
				<span class="inline-block h-5 w-5 flex-shrink-0" style="background-color: currentColor; mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain; -webkit-mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain;" aria-hidden="true"></span>
				<span class="text-sm font-semibold">Connect to KoboldCPP</span>
			</div>
			<button class="btn btn-sm preset-filled-surface-400-600 text-xs" onclick={handleReset}>
				<Icons.ArrowLeft size={12} />
				Back
			</button>
		</div>
		<div class="mt-6 flex flex-col gap-4 px-4">
			<p class="text-surface-500 text-sm">
				Enter the URL of your running KoboldCPP instance.
			</p>
			<div>
				<label class="text-surface-600-400 mb-1 block text-xs font-medium" for="koboldBaseUrl">
					Server URL
				</label>
				<input
					id="koboldBaseUrl"
					type="text"
					bind:value={baseUrlField}
					placeholder="http://localhost:5001"
					class="input w-full"
				/>
			</div>
			<div class="flex gap-2">
				<button
					class="btn preset-filled-primary-500 flex-1"
					onclick={handleSaveBaseUrl}
					disabled={isSavingBaseUrl}
				>
					{#if isSavingBaseUrl}
						<Icons.Loader2 class="h-4 w-4 animate-spin" />
						Connecting…
					{:else}
						<Icons.Save class="h-4 w-4" />
						Save & Connect
					{/if}
				</button>
				<button
					class="btn preset-filled-surface-400-600"
					onclick={checkConnection}
					disabled={isTesting}
					title="Test connection"
				>
					{#if isTesting}
						<Icons.Loader2 class="h-4 w-4 animate-spin" />
						Testing…
					{:else}
						<Icons.RefreshCw class="h-4 w-4" />
						Test
					{/if}
				</button>
			</div>
			<div class="border-surface-300-700 mt-2 border-t pt-4">
				<p class="text-surface-500 mb-2 text-xs">Want Serene Pub to manage KoboldCPP for you?</p>
				<button class="btn btn-sm preset-tonal-primary w-full" onclick={handleReset}>
					<Icons.Bot size={14} />
					Switch to Managed Mode
				</button>
			</div>
		</div>

	{:else}
		<!-- Main tab view (managed running OR external connected) -->
		{#if missingBinaryError}
			<div
				class="preset-tonal-error m-2 flex items-center justify-between gap-2 rounded-lg p-2"
			>
				<p class="text-error-500 text-xs">{missingBinaryError}</p>
				<button
					class="btn btn-sm preset-filled-error-500 shrink-0 text-xs"
					onclick={() => (showVariantPicker = true)}
				>
					<Icons.Download size={13} />
					Re-download
				</button>
			</div>
		{/if}
		<div class="flex-1 overflow-y-auto">
			<Tabs value={activeTab} onValueChange={handleTabChange} listBase="flex flex-wrap gap-1">
				{#snippet list()}
					<Tabs.Control value="models">
						<Icons.Package size={20} class="inline" />
						{#if activeTab === "models"}Models{/if}
					</Tabs.Control>
					<Tabs.Control value="available">
						<Icons.Search size={20} class="inline" />
						{#if activeTab === "available"}Available{/if}
					</Tabs.Control>
					<Tabs.Control value="downloads">
						<Icons.Download size={20} class="inline" />
						{#if activeTab === "downloads"}Downloads{/if}
					</Tabs.Control>
					<Tabs.Control value="perf">
						<Icons.Gauge size={20} class="inline" />
						{#if activeTab === "perf"}Performance{/if}
					</Tabs.Control>
					<Tabs.Control value="settings">
						<Icons.Settings size={20} class="inline" />
						{#if activeTab === "settings"}Settings{/if}
					</Tabs.Control>
				{/snippet}
				{#snippet content()}
				<Tabs.Panel value="models">
						{#if activeTab === "models"}
							<KoboldCppModelsTab />
						{/if}
					</Tabs.Panel>
					<Tabs.Panel value="available">
						{#if activeTab === "available"}
							<KoboldCppDownloadTab {isLocal} onDownloadStart={() => (activeTab = "downloads")} />
						{/if}
					</Tabs.Panel>
					<Tabs.Panel value="downloads">
						{#if activeTab === "downloads"}
							<KoboldCppDownloadsTab />
						{/if}
					</Tabs.Panel>
					<Tabs.Panel value="perf">
						{#if activeTab === "perf"}
							<KoboldCppPerfTab {isManaged} />
						{/if}
					</Tabs.Panel>
					<Tabs.Panel value="settings">
						{#if activeTab === "settings"}
							<KoboldCppSettingsTab onReset={handleReset} {isManaged} onUpdateBinary={() => (showVariantPicker = true)} />
						{/if}
					</Tabs.Panel>
				{/snippet}
			</Tabs>
		</div>
	{/if}
</div>
