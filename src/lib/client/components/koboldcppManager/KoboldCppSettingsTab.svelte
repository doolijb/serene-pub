<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import * as skio from "sveltekit-io"
	import { toaster } from "$lib/client/utils/toaster"

	const socket = skio.get()

	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)

	let currentVersion = $state("")
	let isCheckingVersion = $state(false)
	let isUpdateAvailable = $state(false)
	let latestVersion = $state("")
	let releaseUrl = $state("")
	let isCheckingUpdates = $state(false)
	let isSavingBaseUrl = $state(false)
	let baseUrlField = $state("")

	$effect(() => {
		baseUrlField = systemSettingsCtx.settings?.koboldCppManagerBaseUrl ?? ""
	})

	function checkVersion() {
		isCheckingVersion = true
		socket.emit("koboldcpp:version", {})
	}

	function checkForUpdates() {
		isCheckingUpdates = true
		socket.emit("koboldcpp:isUpdateAvailable", {})
	}

	function saveBaseUrl() {
		if (!baseUrlField.trim()) {
			toaster.error({ title: "Base URL cannot be empty" })
			return
		}
		isSavingBaseUrl = true
		socket.emit("koboldcpp:setBaseUrl", { baseUrl: baseUrlField.trim() })
	}

	onMount(() => {
		socket.on(
			"koboldcpp:version",
			(message: Sockets.KoboldCpp.Version.Response) => {
				isCheckingVersion = false
				currentVersion = message.version || "Unknown"
			}
		)

		socket.on("koboldcpp:version:error", (message: any) => {
			isCheckingVersion = false
			toaster.error({
				title: "Cannot reach KoboldCPP",
				description: message.error
			})
		})

		socket.on(
			"koboldcpp:isUpdateAvailable",
			(message: Sockets.KoboldCpp.IsUpdateAvailable.Response) => {
				isCheckingUpdates = false
				isUpdateAvailable = message.isUpdateAvailable
				latestVersion = message.latestVersion
				releaseUrl = message.releaseUrl
				if (!currentVersion && message.currentVersion) {
					currentVersion = message.currentVersion
				}
			}
		)

		socket.on("koboldcpp:isUpdateAvailable:error", (message: any) => {
			isCheckingUpdates = false
			toaster.error({
				title: "Failed to check for updates",
				description: message.error
			})
		})

		socket.on(
			"koboldcpp:setBaseUrl",
			(message: Sockets.KoboldCpp.SetBaseUrl.Response) => {
				isSavingBaseUrl = false
				if (message.success) {
					toaster.success({ title: "KoboldCPP URL updated successfully" })
				} else {
					toaster.error({ title: "Failed to update KoboldCPP URL" })
				}
			}
		)

		checkVersion()
		checkForUpdates()
	})

	onDestroy(() => {
		socket.off("koboldcpp:version")
		socket.off("koboldcpp:version:error")
		socket.off("koboldcpp:isUpdateAvailable")
		socket.off("koboldcpp:isUpdateAvailable:error")
		socket.off("koboldcpp:setBaseUrl")
	})
</script>

<div class="space-y-6 p-4">
	<!-- Header -->
	<div class="mt-4 text-center">
		<Icons.Cpu class="text-muted-foreground mx-auto mb-4 h-16 w-16" />
		<span class="h5">KoboldCPP</span>
		<div class="mb-6 flex items-center justify-center gap-4">
			<a
				href="https://github.com/LostRuins/koboldcpp/wiki"
				target="_blank"
				rel="noopener noreferrer"
				class="text-muted-foreground hover:text-primary-500 flex items-center gap-1 text-xs transition-colors"
			>
				<Icons.BookOpen class="h-3 w-3" />
				Documentation
			</a>
			<div class="text-muted-foreground">•</div>
			<a
				href="https://github.com/LostRuins/koboldcpp"
				target="_blank"
				rel="noopener noreferrer"
				class="text-muted-foreground hover:text-primary-500 flex items-center gap-1 text-xs transition-colors"
			>
				<Icons.Github class="h-3 w-3" />
				GitHub
			</a>
		</div>
	</div>

	<!-- Base URL -->
	<div class="card bg-surface-100-800 flex flex-col gap-4 p-4">
		<div>
			<label class="block text-sm font-medium" for="koboldBaseUrl">
				KoboldCPP Base URL
			</label>
			<div class="flex gap-2">
				<input
					id="koboldBaseUrl"
					name="koboldBaseUrl"
					type="url"
					class="input flex-1"
					placeholder="http://localhost:5001"
					bind:value={baseUrlField}
				/>
				<button
					class="btn preset-filled-primary-500"
					onclick={saveBaseUrl}
					disabled={isSavingBaseUrl}
					aria-label="Save KoboldCPP base URL"
				>
					<Icons.Save size={14} aria-hidden="true" />
					Save
				</button>
			</div>
			<p class="text-surface-500 mt-1 text-xs">
				The URL where KoboldCPP is running. Usually http://localhost:5001
			</p>
		</div>

		<!-- Version info -->
		<div class="space-y-3">
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<span class="text-surface-600">Current Version:</span>
					<span class="font-mono">{currentVersion || "—"}</span>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-surface-600">Latest Version:</span>
					<span class="text-warning-500 font-mono">{latestVersion || "—"}</span>
				</div>
			</div>

			{#if isUpdateAvailable}
				<div
					class="bg-warning-100 dark:bg-warning-900 border-warning-300 dark:border-warning-700 rounded-lg border p-3"
				>
					<div class="mb-2 flex items-center gap-2">
						<Icons.AlertTriangle size={16} class="text-warning-600" />
						<span class="text-warning-800 dark:text-warning-200 font-medium">
							Update Available
						</span>
					</div>
					<p class="text-warning-700 dark:text-warning-300 mb-3 text-sm">
						A new version of KoboldCPP is available.
					</p>
					<a
						href={releaseUrl || "https://github.com/LostRuins/koboldcpp/releases"}
						target="_blank"
						rel="noopener noreferrer"
						class="btn btn-sm preset-filled-warning-500"
					>
						<Icons.Download size={14} />
						Download Update
					</a>
				</div>
			{:else if currentVersion}
				<div
					class="bg-success-100 dark:bg-success-900 border-success-300 dark:border-success-700 rounded-lg border p-3"
				>
					<div class="flex items-center gap-2">
						<Icons.Check size={16} class="text-success-600" />
						<span class="text-success-800 dark:text-success-200 font-medium">
							You're up to date
						</span>
					</div>
				</div>
			{/if}

			<div class="flex gap-2">
				<button
					class="btn btn-sm preset-filled-surface-500"
					onclick={checkVersion}
					disabled={isCheckingVersion}
					aria-label="Check current KoboldCPP version"
				>
					{#if isCheckingVersion}
						<Icons.Loader2 size={14} class="animate-spin" aria-hidden="true" />
					{:else}
						<Icons.RefreshCw size={14} aria-hidden="true" />
					{/if}
					Check Version
				</button>
				<button
					class="btn btn-sm preset-filled-surface-500"
					onclick={checkForUpdates}
					disabled={isCheckingUpdates}
					aria-label="Check for KoboldCPP updates"
				>
					{#if isCheckingUpdates}
						<Icons.Loader2 size={14} class="animate-spin" aria-hidden="true" />
						Checking...
					{:else}
						<Icons.Search size={14} aria-hidden="true" />
						Check for Updates
					{/if}
				</button>
			</div>
		</div>
	</div>
</div>
