<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext, onMount, onDestroy } from "svelte"
	import { Tabs } from "@skeletonlabs/skeleton-svelte"
	import type { ValueChangeDetails } from "@zag-js/tabs"
	import KoboldCppModelsTab from "../koboldcppManager/KoboldCppModelsTab.svelte"
	import KoboldCppSettingsTab from "../koboldcppManager/KoboldCppSettingsTab.svelte"
	import * as skio from "sveltekit-io"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = skio.get()

	let activeTab = $state<"models" | "settings">("models")
	let isConnected = $state(false)
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let isSavingBaseUrl = $state(false)
	let isTesting = $state(false)
	let baseUrlField = $state("")

	function handleTabChange(e: ValueChangeDetails): void {
		activeTab = e.value as "models" | "settings"
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

	$effect(() => {
		baseUrlField = systemSettingsCtx.settings?.koboldCppManagerBaseUrl ?? ""
	})

	onMount(() => {
		socket.on(
			"koboldcpp:version",
			(message: Sockets.KoboldCpp.Version.Response) => {
				isTesting = false
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

		socket.on("koboldcpp:version:error", (_message: any) => {
			isTesting = false
			toaster.error({
				title: "Cannot reach KoboldCPP",
				description: `Check that KoboldCPP is running at ${baseUrlField}`
			})
		})

		socket.on(
			"koboldcpp:setBaseUrl",
			(message: Sockets.KoboldCpp.SetBaseUrl.Response) => {
				isSavingBaseUrl = false
				if (message.success) {
					toaster.success({ title: "KoboldCPP URL updated successfully" })
					checkConnection()
				} else {
					toaster.error({ title: "Failed to update KoboldCPP URL" })
				}
			}
		)

		checkConnection()
	})

	onDestroy(() => {
		socket.off("koboldcpp:version")
		socket.off("koboldcpp:version:error")
		socket.off("koboldcpp:setBaseUrl")
	})

	onclose = async () => true
</script>

<div class="flex h-full flex-col">
	{#if !systemSettingsCtx.settings?.koboldCppManagerEnabled}
		<div class="flex flex-1 items-center justify-center p-4">
			<div class="text-center">
				<Icons.AlertCircle class="text-warning-500 mx-auto mb-4 h-12 w-12" />
				<h3 class="text-foreground mb-2 text-lg font-semibold">
					KoboldCPP Manager Disabled
				</h3>
				<p class="text-muted-foreground text-sm">
					Enable KoboldCPP Manager in Settings to use this feature.
				</p>
			</div>
		</div>
	{:else if !isConnected}
		<!-- Connection setup -->
		<div class="mt-10 flex items-center justify-center p-4">
			<div class="w-full max-w-md space-y-6">
				<div class="text-center">
					<Icons.Cpu class="text-muted-foreground mx-auto mb-4 h-12 w-12" />
					<h3 class="text-foreground mb-2 text-lg font-semibold">
						Connect to KoboldCPP
					</h3>
					<p class="text-muted-foreground mb-4 text-sm">
						Connect to your running KoboldCPP instance to manage models.
					</p>
				</div>

				<div class="bg-surface-200 dark:bg-surface-800 rounded-lg border p-4">
					<div class="flex items-start gap-3">
						<Icons.Info class="text-primary-500 mt-0.5 h-5 w-5 flex-shrink-0" />
						<div class="flex-1">
							<h4 class="text-foreground mb-1 text-sm font-medium">
								KoboldCPP must be running
							</h4>
							<p class="text-muted-foreground mb-3 text-xs">
								Start KoboldCPP externally before connecting. The manager
								connects to an already-running instance.
							</p>
							<a
								href="https://github.com/LostRuins/koboldcpp/releases"
								target="_blank"
								rel="noopener noreferrer"
								class="btn btn-sm preset-filled-primary-500 inline-flex items-center gap-2"
							>
								<Icons.ExternalLink class="h-4 w-4" />
								Download KoboldCPP
							</a>
						</div>
					</div>
				</div>

				<div class="space-y-3">
					<div>
						<label
							class="text-foreground mb-1 block text-sm font-medium"
							for="koboldBaseUrl"
						>
							KoboldCPP Server URL
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
								Connecting...
							{:else}
								<Icons.Save class="h-4 w-4" />
								Save & Connect
							{/if}
						</button>
						<button
							class="btn preset-filled-secondary-500"
							onclick={checkConnection}
							disabled={isTesting}
							title="Test connection to KoboldCPP"
						>
							{#if isTesting}
								<Icons.Loader2 class="h-4 w-4 animate-spin" />
								Testing...
							{:else}
								<Icons.RefreshCw class="h-4 w-4" />
								Test
							{/if}
						</button>
					</div>
				</div>
			</div>
		</div>
	{:else}
		<div class="flex-1 overflow-y-auto">
			<Tabs value={activeTab} onValueChange={handleTabChange}>
				{#snippet list()}
					<Tabs.Control value="models">
						<Icons.Package size={20} class="inline" />
						{#if activeTab === "models"}
							Models
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
					<Tabs.Panel value="models">
						{#if activeTab === "models"}
							<KoboldCppModelsTab />
						{/if}
					</Tabs.Panel>
					<Tabs.Panel value="settings">
						{#if activeTab === "settings"}
							<KoboldCppSettingsTab />
						{/if}
					</Tabs.Panel>
				{/snippet}
			</Tabs>
		</div>
	{/if}
</div>
