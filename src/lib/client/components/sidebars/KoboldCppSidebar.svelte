<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import PanelTabList from "$lib/client/components/panels/PanelTabList.svelte"
	import PanelTab from "$lib/client/components/panels/PanelTab.svelte"
	import PanelSectionTitle from "$lib/client/components/panels/PanelSectionTitle.svelte"
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
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import KoboldCppUnsavedChangesModal from "../modals/KoboldCppUnsavedChangesModal.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx")
	)

	const panelsCtx: PanelsCtx = getContext("panelsCtx")

	// Setup-wizard hand-off — see the matching block in OllamaSidebar. The
	// wizard sets digest.tutorial immediately before opening this panel, so a
	// truthy flag means the user just clicked "KoboldCPP Manager" on the
	// current step. With no GGUF downloaded, the Models tab is an empty list
	// and a dead end, so point at Available and glow the tab.
	//
	// The flag stays lit across panel → Available → pick a model → recommended
	// quantization; it's cleared when a download actually starts.
	let isTutorial = $derived(!!panelsCtx?.digest?.tutorial)
	let installedCount = $state<number | null>(null)
	let hasNoModels = $derived(installedCount === 0)
	let didAutoOpenAvailable = $state(false)

	let activeTab = $state("models")

	// Section names. The tab triggers are icon-only (see PanelTab), so
	// PanelSectionTitle is where the active section's full name is shown.
	const SECTION_LABELS: Record<string, string> = {
		models: "Models",
		available: "Available",
		downloads: "Downloads",
		performance: "Performance",
		settings: "Settings"
	}
	let sectionLabel = $derived(SECTION_LABELS[activeTab] ?? "")
	let isConnected = $state(false)
	let isLocal = $state(true)
	let isTesting = $state(false)
	let isSavingBaseUrl = $state(false)
	let baseUrlField = $state("")
	let showVariantPicker = $state(false)
	let lastToastedError: string | null = $state(null)
	let missingBinaryError: string | null = $state(null)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null

	// baseUrlField re-syncs from context below whenever a save succeeds, so
	// this self-resolves back to false without an explicit post-save reset.
	let hasUnsavedChanges = $derived(
		baseUrlField.trim() !==
			(koboldCppSettingsCtx.settings?.koboldCppManagerBaseUrl ?? "")
	)

	// Derive mode from system settings
	let managedMode = $derived(
		koboldCppSettingsCtx.settings?.koboldCppManagedMode ?? null
	)
	let isManaged = $derived(managedMode === "managed")
	let isExternal = $derived(managedMode === "external")
	let isUnconfigured = $derived(managedMode === null)

	function handleTabChange(e: ValueChangeDetails): void {
		// A deliberate choice outranks the wizard's suggestion from here on.
		didAutoOpenAvailable = true
		activeTab = e.value
	}

	$effect(() => {
		if (!isTutorial || didAutoOpenAvailable) return
		if (!hasNoModels) return
		didAutoOpenAvailable = true
		activeTab = "available"
	})

	// End of the wizard's hand-off path. Kept at this single funnel rather than
	// on individual download buttons, so every route into a download clears the
	// cue — otherwise the Available tab keeps glowing after the user has acted.
	function handleDownloadStart() {
		if (panelsCtx?.digest?.tutorial) panelsCtx.digest.tutorial = false
		activeTab = "downloads"
	}

	function checkConnection() {
		isTesting = true
		socket.emit("koboldcpp:version", {
			baseUrl: baseUrlField.trim() || undefined
		})
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
		baseUrlField =
			koboldCppSettingsCtx.settings?.koboldCppManagerBaseUrl ?? ""
	})

	// Auto-check connection for external mode
	$effect(() => {
		if (isExternal && !isConnected) {
			checkConnection()
		}
	})

	// When managed mode is set: if binary not yet chosen, show picker
	$effect(() => {
		if (
			isManaged &&
			!koboldCppSettingsCtx.settings?.koboldCppManagedBinaryVariant
		) {
			showVariantPicker = true
		} else if (
			isManaged &&
			koboldCppSettingsCtx.settings?.koboldCppManagedBinaryVariant
		) {
			showVariantPicker = false
		}
	})

	onMount(() => {
		// Only KoboldCppModelsTab fetches this, and only once it has rendered —
		// backwards for deciding which tab to render. Ask here too, but only
		// during the wizard hand-off so the normal path is unchanged.
		socket.on(
			"koboldcpp:listModels",
			(message: Sockets.KoboldCPP.ListModels.Response) => {
				installedCount = message.availableModels?.length ?? 0
			}
		)
		if (panelsCtx?.digest?.tutorial) socket.emit("koboldcpp:listModels", {})

		socket.on(
			"koboldcpp:version",
			(message: Sockets.KoboldCPP.Version.Response) => {
				isTesting = false
				isLocal = message.isLocal
				if (!isConnected) {
					isConnected = !!message.version
					if (message.version) {
						toaster.success({
							title: "Connected to KoboldCPP",
							description: `Version ${message.version}`
						})
					}
				}
			}
		)
		socket.on("koboldcpp:version:error", (message: { error?: string }) => {
			isTesting = false
			toaster.error({
				title: "Connection test failed",
				description:
					message.error || "Could not reach KoboldCPP at that URL."
			})
		})
		socket.on(
			"koboldcpp:setBaseUrl",
			(message: Sockets.KoboldCPP.SetBaseUrl.Response) => {
				isSavingBaseUrl = false
				if (message.success) {
					toaster.success({ title: "URL updated" })
					checkConnection()
				} else {
					toaster.error({ title: "Failed to update URL" })
				}
			}
		)
		socket.on("koboldcpp:setManagedMode", () => {
			// Mode change is reflected via systemSettingsCtx push
		})
		socket.on(
			"koboldcpp:subprocessStatus",
			(msg: Sockets.KoboldCPP.SubprocessStatus.Response) => {
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
						description:
							"It may have been lost from storage between restarts. Re-download it below."
					})
				}
			}
		)
	})

	onDestroy(() => {
		socket.off("koboldcpp:version")
		socket.off("koboldcpp:version:error")
		socket.off("koboldcpp:setBaseUrl")
		socket.off("koboldcpp:setManagedMode")
		socket.off("koboldcpp:subprocessStatus")
	})

	function handleUnsavedChangesModalOnOpenChange(e: OpenChangeDetails) {
		if (!e.open) {
			showUnsavedChangesModal = false
			if (confirmCloseSidebarResolve) {
				confirmCloseSidebarResolve(false)
				confirmCloseSidebarResolve = null
			}
		}
	}

	function handleUnsavedChangesModalConfirm() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) {
			confirmCloseSidebarResolve(true)
			confirmCloseSidebarResolve = null
		}
	}

	function handleUnsavedChangesModalCancel() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) {
			confirmCloseSidebarResolve(false)
			confirmCloseSidebarResolve = null
		}
	}

	onclose = async () => {
		if (!hasUnsavedChanges) return true
		showUnsavedChangesModal = true
		return new Promise<boolean>((resolve) => {
			confirmCloseSidebarResolve = resolve
		})
	}
</script>

<div class="flex h-full flex-col p-4">
	{#if !koboldCppSettingsCtx.settings?.koboldCppManagerEnabled}
		<!-- Feature disabled by admin -->
		<!-- No p-4 here: the root above already applies it, so this was insetting
		     the content by 32px against every other sidebar's 16px. -->
		<div class="flex flex-1 items-center justify-center">
			<div class="text-center">
				<Icons.AlertCircle
					class="text-warning-500 mx-auto mb-4 h-12 w-12"
				/>
				<h3 class="mb-2 text-lg font-semibold">
					KoboldCPP Manager Disabled
				</h3>
				<p class="text-surface-700-300 text-sm">
					Enable KoboldCPP Manager in Settings to use this feature.
				</p>
			</div>
		</div>
	{:else if isUnconfigured}
		<!-- First-time setup: choose mode -->
		<div
			class="border-surface-300-700 flex items-center justify-between border-b px-3 py-2"
		>
			<div class="flex items-center gap-2">
				<span
					class="inline-block h-5 w-5 flex-shrink-0"
					style="background-color: currentColor; mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain; -webkit-mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain;"
					aria-hidden="true"
				></span>
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
		<div
			class="border-surface-300-700 flex items-center justify-between border-b px-3 py-2"
		>
			<div class="flex items-center gap-2">
				<span
					class="inline-block h-5 w-5 flex-shrink-0"
					style="background-color: currentColor; mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain; -webkit-mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain;"
					aria-hidden="true"
				></span>
				<span class="text-sm font-semibold">Download KoboldCPP</span>
			</div>
			<button
				class="btn btn-sm preset-filled-surface-400-600 text-xs"
				onclick={handleReset}
			>
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
		<div
			class="border-surface-300-700 flex items-center justify-between border-b px-3 py-2"
		>
			<div class="flex items-center gap-2">
				<span
					class="inline-block h-5 w-5 flex-shrink-0"
					style="background-color: currentColor; mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain; -webkit-mask: url('/koboldcpp/koboldcpp-icon.svg') no-repeat center / contain;"
					aria-hidden="true"
				></span>
				<span class="text-sm font-semibold">Connect to KoboldCPP</span>
			</div>
			<button
				class="btn btn-sm preset-filled-surface-400-600 text-xs"
				onclick={handleReset}
			>
				<Icons.ArrowLeft size={12} />
				Back
			</button>
		</div>
		<!-- px-4 dropped: on top of the root's p-4 it indented this block 32px
		     while its sibling sections sat at 16px, so the column visibly
		     stepped in and out as you moved down the panel. -->
		<div class="mt-6 flex flex-col gap-4">
			<p class="text-surface-700-300 text-sm">
				Enter the URL of your running KoboldCPP instance.
			</p>
			<div>
				<label
					class="text-surface-600-400 mb-1 block text-xs font-medium"
					for="koboldBaseUrl"
				>
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
				<p class="text-surface-700-300 mb-2 text-xs">
					Want Serene Pub to manage KoboldCPP for you?
				</p>
				<button
					class="btn btn-sm preset-tonal-primary w-full"
					onclick={handleReset}
				>
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
			<Tabs value={activeTab} onValueChange={handleTabChange}>
				<PanelTabList>
					<PanelTab
						value="models"
						label="Models"
						icon={Icons.Package}
					/>
					<PanelTab
						value="available"
						label="Available"
						icon={Icons.Search}
						class={isTutorial && hasNoModels
							? "tutorial-highlight"
							: ""}
					/>
					<PanelTab
						value="downloads"
						label="Downloads"
						icon={Icons.Download}
					/>
					<PanelTab
						value="perf"
						label="Performance"
						icon={Icons.Gauge}
					/>
					<PanelTab
						value="settings"
						label="Settings"
						icon={Icons.Settings}
					/>
				</PanelTabList>
				<PanelSectionTitle title={sectionLabel} />
				<Tabs.Content value="models">
					{#if activeTab === "models"}
						<KoboldCppModelsTab />
					{/if}
				</Tabs.Content>
				<Tabs.Content value="available">
					{#if activeTab === "available"}
						<KoboldCppDownloadTab
							{isLocal}
							onDownloadStart={handleDownloadStart}
						/>
					{/if}
				</Tabs.Content>
				<Tabs.Content value="downloads">
					{#if activeTab === "downloads"}
						<KoboldCppDownloadsTab />
					{/if}
				</Tabs.Content>
				<Tabs.Content value="perf">
					{#if activeTab === "perf"}
						<KoboldCppPerfTab {isManaged} />
					{/if}
				</Tabs.Content>
				<Tabs.Content value="settings">
					{#if activeTab === "settings"}
						<KoboldCppSettingsTab
							onReset={handleReset}
							{isManaged}
							onUpdateBinary={() => (showVariantPicker = true)}
						/>
					{/if}
				</Tabs.Content>
			</Tabs>
		</div>
	{/if}
</div>

<KoboldCppUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={handleUnsavedChangesModalOnOpenChange}
	onConfirm={handleUnsavedChangesModalConfirm}
	onCancel={handleUnsavedChangesModalCancel}
/>
