<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext, onMount, onDestroy } from "svelte"
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { ValueChangeDetails } from "@zag-js/tabs"
	import OllamaInstalledTab from "../ollamaManager/OllamaInstalledTab.svelte"
	import OllamaAvailableTab from "../ollamaManager/OllamaAvailableTab.svelte"
	import OllamaSettingsTab from "../ollamaManager/OllamaSettingsTab.svelte"
	import OllamaDownloadsTab from "../ollamaManager/OllamaDownloadsTab.svelte"
	import * as skio from "sveltekit-io"
	import { toaster } from "$lib/client/utils/toaster"
	import OllamaIcon from "../icons/OllamaIcon.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = skio.get()

	// State
	let activeTab = $state<
		"installed" | "available" | "downloads" | "settings"
	>("installed")
	let themeCtx: ThemeCtx = $state(getContext("themeCtx"))
	let isConnected = $state(false)
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let isSavingBaseUrl = $state(false)
	let baseUrlField = $state("")

	// Handle tab switching
	function handleTabChange(e: ValueChangeDetails): void {
		activeTab = e.value as
			| "installed"
			| "available"
			| "downloads"
			| "settings"
	}

	// Handle download start - switch to downloads tab
	function handleDownloadStart(modelName: string) {
		activeTab = "downloads"
	}

	// Check connection to Ollama
	function checkConnection() {
		socket.emit("ollamaVersion", {})
	}

	// Save base URL
	function handleSaveBaseUrl() {
		if (!systemSettingsCtx.settings.ollamaManagerBaseUrl.trim()) {
			toaster.error({ title: "Base URL cannot be empty" })
			return
		}

		isSavingBaseUrl = true
		socket.emit("ollamaSetBaseUrl", {
			baseUrl: baseUrlField.trim()
		})
	}

	$effect(() => {
		baseUrlField = systemSettingsCtx.settings.ollamaManagerBaseUrl
	})

	onMount(() => {
		socket.on(
			"ollamaVersion",
			(message: Sockets.OllamaVersion.Response) => {
				// We only want to set isConnected if it hasn't been set yet
				// We don't want to display the initial setup screen if the user
				// is working in the settings tab, etc.
				if (!isConnected) {
					isConnected = !!message.version
				}
			}
		)

		socket.on(
			"ollamaSetBaseUrl",
			(message: Sockets.OllamaSetBaseUrl.Response) => {
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
		socket.off("ollamaVersion")
		socket.off("ollamaSetBaseUrl")
	})

	// Sidebar close handler
	onclose = async () => {
		return true // Allow closing
	}
</script>

<div class="flex h-full flex-col">
	<!-- Check if Ollama Manager is enabled -->
	{#if !systemSettingsCtx.settings.ollamaManagerEnabled}
		<div class="flex flex-1 items-center justify-center p-4">
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
		<div class="flex items-center justify-center p-4 mt-10">
			<div class="w-full max-w-md space-y-6">
				<div class="text-center">
                    <OllamaIcon class="text-muted-foreground mx-auto mb-4 h-12 w-12" />
					<h3 class="text-foreground mb-2 text-lg font-semibold">
						Connect to Ollama
					</h3>
					<p class="text-muted-foreground mb-4 text-sm">
						Connect to your Ollama server to manage AI models locally.
					</p>
				</div>

				<!-- Don't have Ollama installed? -->
				<div class="bg-surface-200 dark:bg-surface-800 rounded-lg border p-4">
					<div class="flex items-start gap-3">
						<Icons.Download class="text-primary-500 mt-0.5 h-5 w-5 flex-shrink-0" />
						<div class="flex-1">
							<h4 class="text-foreground mb-1 text-sm font-medium">
								Don't have Ollama installed?
							</h4>
							<p class="text-muted-foreground mb-3 text-xs">
								Download and install Ollama to run AI models locally on your machine. It's easy!
							</p>
							<a
								href="https://ollama.ai/download"
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
				{#snippet list()}
					<Tabs.Control value="installed">
						<Icons.Package size={20} class="inline" />
						{#if activeTab === "installed"}
							Installed
						{/if}
					</Tabs.Control>
					<Tabs.Control value="available">
						<Icons.Search size={20} class="inline" />
						{#if activeTab === "available"}
							Available
						{/if}
					</Tabs.Control>
					<Tabs.Control value="downloads">
						<Icons.Download size={20} class="inline" />
						{#if activeTab === "downloads"}
							Downloads
						{/if}
					</Tabs.Control>
					<Tabs.Control value="settings">
						<Icons.Settings size={20} class="inline" />
						{#if activeTab === "settings"}
							Settings
						{/if}
					</Tabs.Control>
				{/snippet}
				{#snippet content()}
					<Tabs.Panel value="installed">
						{#if activeTab === "installed"}
							<OllamaInstalledTab />
						{/if}
					</Tabs.Panel>
					<Tabs.Panel value="available">
						{#if activeTab === "available"}
							<OllamaAvailableTab onDownloadStart={handleDownloadStart} />
						{/if}
					</Tabs.Panel>
					<Tabs.Panel value="downloads">
						{#if activeTab === "downloads"}
							<OllamaDownloadsTab />
						{/if}
					</Tabs.Panel>
					<Tabs.Panel value="settings">
						{#if activeTab === "settings"}
							<OllamaSettingsTab />
						{/if}
					</Tabs.Panel>
				{/snippet}
			</Tabs>
		</div>
	{/if}
</div>
