<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import PanelTabList from "$lib/client/components/panels/PanelTabList.svelte"
	import PanelTab from "$lib/client/components/panels/PanelTab.svelte"
	import PanelSectionTitle from "$lib/client/components/panels/PanelSectionTitle.svelte"
	import { getContext, onMount, onDestroy } from "svelte"
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { ValueChangeDetails } from "@zag-js/tabs"
	import OllamaInstalledTab from "../ollamaManager/OllamaInstalledTab.svelte"
	import OllamaAvailableTab from "../ollamaManager/OllamaAvailableTab.svelte"
	import OllamaSettingsTab from "../ollamaManager/OllamaSettingsTab.svelte"
	import OllamaDownloadsTab from "../ollamaManager/OllamaDownloadsTab.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"
	import OllamaIcon from "../icons/OllamaIcon.svelte"
	import OllamaUnsavedChangesModal from "../modals/OllamaUnsavedChangesModal.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()

	// State
	let activeTab = $state<
		"installed" | "available" | "downloads" | "settings"
	>("installed")

	// Section names. The tab triggers are icon-only (see PanelTab), so
	// PanelSectionTitle is where the active section's full name is shown.
	const SECTION_LABELS: Record<string, string> = {
		installed: "Installed",
		available: "Available",
		downloads: "Downloads",
		settings: "Settings"
	}
	let sectionLabel = $derived(SECTION_LABELS[activeTab] ?? "")
	let isConnected = $state(false)
	let ollamaSettingsCtx: OllamaSettingsCtx = $state(
		getContext("ollamaSettingsCtx")
	)
	const panelsCtx: PanelsCtx = getContext("panelsCtx")

	// Setup-wizard hand-off. The wizard sets digest.tutorial before opening this
	// panel, so a truthy flag means "the user just clicked 'Ollama Manager' on
	// the current wizard step" — nothing else sets it. On a fresh install the
	// Installed tab is empty, so landing there shows a dead end; point at
	// Available instead and glow the tab so the jump is explained rather than
	// silent.
	//
	// The flag deliberately survives the tab switch. Unlike the other sidebars,
	// where it marks a single button, here it has to stay lit across
	// panel → Available tab → pick a model → recommended quantization. It is
	// cleared where that path ends, when a download actually starts.
	let isTutorial = $derived(!!panelsCtx?.digest?.tutorial)
	let installedCount = $state<number | null>(null)
	let hasNoModels = $derived(installedCount === 0)
	// One-shot: re-running after the user has chosen a tab would drag them back.
	let didAutoOpenAvailable = $state(false)

	let isSavingBaseUrl = $state(false)
	let baseUrlField = $state("")
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null

	// baseUrlField re-syncs from context below whenever a save succeeds, so
	// this self-resolves back to false without an explicit post-save reset.
	let hasUnsavedChanges = $derived(
		baseUrlField.trim() !==
			(ollamaSettingsCtx.settings?.ollamaManagerBaseUrl ?? "")
	)

	// Handle tab switching
	function handleTabChange(e: ValueChangeDetails): void {
		// A deliberate choice outranks the wizard's suggestion from here on.
		didAutoOpenAvailable = true
		activeTab = e.value as
			| "installed"
			| "available"
			| "downloads"
			| "settings"
	}

	$effect(() => {
		if (!isTutorial || didAutoOpenAvailable) return
		if (!hasNoModels) return
		didAutoOpenAvailable = true
		activeTab = "available"
	})

	// Handle download start - switch to downloads tab
	function handleDownloadStart(modelName: string) {
		// End of the wizard's hand-off path. Cleared here rather than at any
		// individual download button because OllamaAvailableTab has three ways
		// to start one — the quantization modal, the manual pull, and the
		// direct "Install" on a recommended model — and this callback is the
		// single point they all funnel through. Clearing it at the modal only
		// left the Available tab still glowing after an "Install".
		if (panelsCtx?.digest?.tutorial) panelsCtx.digest.tutorial = false
		activeTab = "downloads"
	}

	// Check connection to Ollama
	function checkConnection() {
		socket.emit("ollama:version", {
			baseUrl: baseUrlField.trim() || undefined
		})
	}

	// Save base URL
	function handleSaveBaseUrl() {
		if (!baseUrlField.trim()) {
			toaster.error({ title: "Base URL cannot be empty" })
			return
		}

		isSavingBaseUrl = true
		socket.emit("ollama:setBaseUrl", {
			baseUrl: baseUrlField.trim()
		})
	}

	$effect(() => {
		baseUrlField = ollamaSettingsCtx.settings?.ollamaManagerBaseUrl ?? ""
	})

	onMount(() => {
		// Only the tabs fetch the model list, and only once they're rendered —
		// which is exactly backwards for deciding which tab to open. Ask here
		// too, but only during the wizard hand-off, so the normal path keeps
		// its current single request.
		socket.on(
			"ollama:modelsList",
			(message: Sockets.Ollama.ModelsList.Response) => {
				installedCount = message.models?.length ?? 0
			}
		)
		if (panelsCtx?.digest?.tutorial) socket.emit("ollama:modelsList", {})

		socket.on(
			"ollama:version",
			(message: Sockets.Ollama.Version.Response) => {
				// We only want to set isConnected if it hasn't been set yet
				// We don't want to display the initial setup screen if the user
				// is working in the settings tab, etc.
				if (!isConnected) {
					isConnected = !!message.version
				}
			}
		)

		socket.on("ollama:version:error", (message: { error?: string }) => {
			toaster.error({
				title: "Connection test failed",
				description:
					message.error || "Could not reach Ollama at that URL."
			})
		})

		socket.on(
			"ollama:setBaseUrl",
			(message: Sockets.Ollama.SetBaseUrl.Response) => {
				isSavingBaseUrl = false
				if (message.success) {
					toaster.success({
						title: "Ollama URL updated successfully"
					})
					// Try to reconnect after URL change
					checkConnection()
				} else {
					toaster.error({ title: "Failed to update Ollama URL" })
				}
			}
		)

		// Check initial connection
		checkConnection()
	})

	onDestroy(() => {
		socket.off("ollama:version")
		socket.off("ollama:version:error")
		socket.off("ollama:setBaseUrl")
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

	// Sidebar close handler
	onclose = async () => {
		if (!hasUnsavedChanges) return true
		showUnsavedChangesModal = true
		return new Promise<boolean>((resolve) => {
			confirmCloseSidebarResolve = resolve
		})
	}
</script>

<div class="flex h-full flex-col p-4">
	<!-- Check if Ollama Manager is enabled -->
	{#if !ollamaSettingsCtx.settings?.ollamaManagerEnabled}
		<!-- No p-4 here: the root above already applies it, so this was insetting
		     the content by 32px against every other sidebar's 16px. -->
		<div class="flex flex-1 items-center justify-center">
			<div class="text-center">
				<Icons.AlertCircle
					class="text-warning-500 mx-auto mb-4 h-12 w-12"
				/>
				<h3 class="text-foreground mb-2 text-lg font-semibold">
					Ollama Manager Disabled
				</h3>
				<p class="text-muted-foreground text-sm">
					Enable Ollama Manager in Settings to use this feature.
				</p>
			</div>
		</div>
	{:else if !isConnected}
		<!-- Connection setup -->
		<div class="mt-10 flex items-center justify-center">
			<div class="w-full max-w-md space-y-6">
				<div class="text-center">
					<OllamaIcon
						class="text-muted-foreground mx-auto mb-4 h-12 w-12"
					/>
					<h3 class="text-foreground mb-2 text-lg font-semibold">
						Connect to Ollama
					</h3>
					<p class="text-muted-foreground mb-4 text-sm">
						Connect to your Ollama server to manage AI models
						locally.
					</p>
				</div>

				<!-- Don't have Ollama installed? -->
				<div
					class="bg-surface-200 dark:bg-surface-800 rounded-lg border p-4"
				>
					<div class="flex items-start gap-3">
						<Icons.Download
							class="text-primary-500 mt-0.5 h-5 w-5 flex-shrink-0"
						/>
						<div class="flex-1">
							<h4
								class="text-foreground mb-1 text-sm font-medium"
							>
								Don't have Ollama installed?
							</h4>
							<p class="text-muted-foreground mb-3 text-xs">
								Download and install Ollama to run AI models
								locally on your machine. It's easy!
							</p>
							<a
								href="https://ollama.com/download"
								target="_blank"
								rel="noopener noreferrer"
								class="btn btn-sm preset-filled-primary-500 inline-flex items-center gap-2"
							>
								<Icons.ExternalLink class="h-4 w-4" />
								Download Ollama
							</a>
						</div>
					</div>
				</div>

				<!-- Connection form -->
				<div class="space-y-3">
					<div>
						<label
							class="text-foreground mb-1 block text-sm font-medium"
							for="ollamaBaseUrl"
						>
							Ollama Server URL
						</label>
						<input
							id="ollamaBaseUrl"
							type="text"
							bind:value={baseUrlField}
							placeholder="http://localhost:11434"
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
								Connecting...
							{:else}
								<Icons.Save class="h-4 w-4" />
								Save & Connect
							{/if}
						</button>
						<button
							class="btn preset-filled-secondary-500"
							onclick={checkConnection}
							title="Test connection to Ollama server"
						>
							<Icons.RefreshCw class="h-4 w-4" />
							Test
						</button>
					</div>
				</div>
			</div>
		</div>
	{:else}
		<!-- Main Ollama Manager Content -->
		<div class="flex-1 overflow-y-auto">
			<Tabs value={activeTab} onValueChange={handleTabChange}>
				<PanelTabList>
					<PanelTab
						value="installed"
						label="Installed"
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
						value="settings"
						label="Settings"
						icon={Icons.Settings}
					/>
				</PanelTabList>
				<PanelSectionTitle title={sectionLabel} />
				<Tabs.Content value="installed">
					{#if activeTab === "installed"}
						<OllamaInstalledTab />
					{/if}
				</Tabs.Content>
				<Tabs.Content value="available">
					{#if activeTab === "available"}
						<OllamaAvailableTab
							onDownloadStart={handleDownloadStart}
						/>
					{/if}
				</Tabs.Content>
				<Tabs.Content value="downloads">
					{#if activeTab === "downloads"}
						<OllamaDownloadsTab />
					{/if}
				</Tabs.Content>
				<Tabs.Content value="settings">
					{#if activeTab === "settings"}
						<OllamaSettingsTab />
					{/if}
				</Tabs.Content>
			</Tabs>
		</div>
	{/if}
</div>

<OllamaUnsavedChangesModal
	open={showUnsavedChangesModal}
	onOpenChange={handleUnsavedChangesModalOnOpenChange}
	onConfirm={handleUnsavedChangesModalConfirm}
	onCancel={handleUnsavedChangesModalCancel}
/>
