<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import * as skio from "sveltekit-io"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		isManaged?: boolean
		onReset?: () => void
		onUpdateBinary?: () => void
	}
	let { isManaged = false, onReset, onUpdateBinary }: Props = $props()

	const socket = skio.get()

	let koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(getContext("koboldCppSettingsCtx"))

	// --- Version / update state ---
	let currentVersion = $state("")
	let capabilities = $state<Sockets.KoboldCpp.Version.Capabilities | null>(null)
	let isCheckingVersion = $state(false)
	let isUpdateAvailable = $state(false)
	let latestVersion = $state("")
	let releaseUrl = $state("")
	let isCheckingUpdates = $state(false)
	let isSavingBaseUrl = $state(false)
	let isSavingModelsDir = $state(false)
	let baseUrlField = $state("")
	let modelsDirField = $state("")

	// --- Managed binary update ---
	let managedUpdateAvailable = $state(false)
	let managedInstalledTag = $state<string | null>(null)
	let managedLatestTag = $state("")
	let managedReleaseUrl = $state("")
	let isCheckingManagedUpdate = $state(false)

	function checkManagedBinaryUpdate() {
		isCheckingManagedUpdate = true
		socket.emit("koboldcpp:checkManagedBinaryUpdate", {})
	}

	// --- Managed settings ---
	let ttlDraft = $state(String(koboldCppSettingsCtx.settings?.koboldCppManagedModelTtlSecs ?? 300))
	let savingTtl = $state(false)
	let subprocessTimeoutDraft = $state(String(koboldCppSettingsCtx.settings?.koboldCppManagedSubprocessTimeoutSecs ?? 1800))
	let savingSubprocessTimeout = $state(false)
	let portDraft = $state(String(koboldCppSettingsCtx.settings?.koboldCppManagedPort ?? 5001))
	let savingPort = $state(false)

	$effect(() => {
		baseUrlField = koboldCppSettingsCtx.settings?.koboldCppManagerBaseUrl ?? ""
		modelsDirField = koboldCppSettingsCtx.settings?.koboldCppManagerModelsDir ?? ""
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

	function saveModelsDir() {
		isSavingModelsDir = true
		socket.emit("koboldcpp:setModelsDir", { dir: modelsDirField.trim() })
	}

	function saveTtl() {
		const v = parseInt(ttlDraft)
		if (isNaN(v) || v < 0) return
		savingTtl = true
		socket.emit("koboldcpp:setModelTtl", { ttlSecs: v })
	}

	function saveSubprocessTimeout() {
		const v = parseInt(subprocessTimeoutDraft)
		if (isNaN(v) || v < 0) return
		savingSubprocessTimeout = true
		socket.emit("koboldcpp:setSubprocessTimeout", { timeoutSecs: v })
	}

	function savePort() {
		const v = parseInt(portDraft)
		if (isNaN(v) || v < 1024 || v > 65535) return
		savingPort = true
		socket.emit("koboldcpp:setManagedPort", { port: v })
	}

	onMount(() => {
		socket.on("koboldcpp:version", (message: Sockets.KoboldCpp.Version.Response) => {
			isCheckingVersion = false
			currentVersion = message.version || "Unknown"
			capabilities = message.capabilities
		})
		socket.on("koboldcpp:version:error", (message: any) => {
			isCheckingVersion = false
			toaster.error({ title: "Cannot reach KoboldCPP", description: message.error })
		})
		socket.on("koboldcpp:isUpdateAvailable", (message: Sockets.KoboldCpp.IsUpdateAvailable.Response) => {
			isCheckingUpdates = false
			isUpdateAvailable = message.isUpdateAvailable
			latestVersion = message.latestVersion ?? ""
			releaseUrl = message.releaseUrl ?? ""
			if (!currentVersion && message.currentVersion) currentVersion = message.currentVersion
		})
		socket.on("koboldcpp:isUpdateAvailable:error", (message: any) => {
			isCheckingUpdates = false
			toaster.error({ title: "Failed to check for updates", description: message.error })
		})
		socket.on("koboldcpp:setBaseUrl", (message: Sockets.KoboldCpp.SetBaseUrl.Response) => {
			isSavingBaseUrl = false
			if (message.success) toaster.success({ title: "KoboldCPP URL updated successfully" })
			else toaster.error({ title: "Failed to update KoboldCPP URL" })
		})
		socket.on("koboldcpp:setModelsDir", (message: Sockets.KoboldCpp.SetModelsDir.Response) => {
			isSavingModelsDir = false
			if (message.success) toaster.success({ title: "Models directory saved" })
			else toaster.error({ title: "Failed to save models directory" })
		})

		if (isManaged) {
			socket.on("koboldcpp:setModelTtl", () => {
				savingTtl = false
				toaster.success({ title: "TTL updated" })
			})
			socket.on("koboldcpp:setSubprocessTimeout", () => {
				savingSubprocessTimeout = false
				toaster.success({ title: "Startup timeout updated" })
			})
			socket.on("koboldcpp:setManagedPort", () => {
				savingPort = false
				toaster.success({ title: "Port updated — restart required" })
			})
			socket.on(
				"koboldcpp:checkManagedBinaryUpdate",
				(msg: Sockets.KoboldCpp.CheckManagedBinaryUpdate.Response) => {
					isCheckingManagedUpdate = false
					managedUpdateAvailable = msg.isUpdateAvailable
					managedInstalledTag = msg.installedTag
					managedLatestTag = msg.latestTag
					managedReleaseUrl = msg.releaseUrl
				}
			)
			socket.on("koboldcpp:checkManagedBinaryUpdate:error", () => {
				isCheckingManagedUpdate = false
			})
			checkManagedBinaryUpdate()
		} else {
			checkVersion()
			checkForUpdates()
		}
	})

	onDestroy(() => {
		socket.off("koboldcpp:version")
		socket.off("koboldcpp:version:error")
		socket.off("koboldcpp:isUpdateAvailable")
		socket.off("koboldcpp:isUpdateAvailable:error")
		socket.off("koboldcpp:setBaseUrl")
		socket.off("koboldcpp:setModelsDir")
		if (isManaged) {
			socket.off("koboldcpp:setModelTtl")
			socket.off("koboldcpp:setSubprocessTimeout")
			socket.off("koboldcpp:setManagedPort")
			socket.off("koboldcpp:checkManagedBinaryUpdate")
			socket.off("koboldcpp:checkManagedBinaryUpdate:error")
		}
	})

	const capabilityLabels: Record<keyof Sockets.KoboldCpp.Version.Capabilities, string> = {
		txt2img: "Image Gen",
		vision: "Vision",
		tts: "TTS",
		transcribe: "Speech-to-Text",
		embeddings: "Embeddings",
		multiplayer: "Multiplayer",
		websearch: "Web Search",
		adminEnabled: "Admin API"
	}
</script>

<div class="space-y-6 p-4">
	<!-- Header -->
	<div class="mt-4 text-center">
		<img src="/koboldcpp/koboldcpp-logo.png" alt="KoboldCPP" class="mx-auto mb-4 h-20 w-auto" />
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

	<!-- Reconfigure / Reset -->
	{#if onReset}
		<div class="card bg-surface-100-800 flex items-center justify-between gap-3 p-4">
			<div>
				<p class="text-sm font-medium">{isManaged ? "Managed mode" : "External mode"}</p>
				<p class="text-surface-500 text-xs">Switch to a different setup</p>
			</div>
			<button class="btn btn-sm preset-tonal-warning" onclick={onReset}>
				<Icons.RefreshCw size={13} />
				Reconfigure
			</button>
		</div>
	{/if}

	<!-- Managed: binary info + update check -->
	{#if isManaged && koboldCppSettingsCtx.settings?.koboldCppManagedBinaryVariant}
		<div class="card bg-surface-100-800 flex flex-col gap-4 p-4">
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-semibold">Binary</h3>
				{#if managedUpdateAvailable}
					<span class="badge preset-filled-warning-500 rounded-full px-2 py-0.5 text-xs font-medium">
						Update available
					</span>
				{/if}
			</div>

			<div class="space-y-1 text-sm">
				<div class="flex items-center justify-between">
					<span class="text-surface-500 text-xs">Variant</span>
					<span class="font-mono text-xs">{koboldCppSettingsCtx.settings.koboldCppManagedBinaryVariant}</span>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-surface-500 text-xs">Installed version</span>
					<span class="font-mono text-xs">{managedInstalledTag ?? koboldCppSettingsCtx.settings.koboldCppManagedReleaseTag ?? "—"}</span>
				</div>
				{#if managedLatestTag}
					<div class="flex items-center justify-between">
						<span class="text-surface-500 text-xs">Latest version</span>
						<span class="font-mono text-xs {managedUpdateAvailable ? 'text-warning-500' : ''}">{managedLatestTag}</span>
					</div>
				{/if}
			</div>

			{#if managedUpdateAvailable}
				<div class="bg-warning-50 dark:bg-warning-950 border-warning-200 dark:border-warning-800 rounded-lg border p-3 text-sm">
					<p class="text-warning-700 dark:text-warning-300 mb-2">
						Version {managedLatestTag} is available.
					</p>
					<button class="btn btn-sm preset-filled-warning-500" onclick={onUpdateBinary}>
						<Icons.Download size={14} />
						Update Binary
					</button>
				</div>
			{/if}

			<div class="flex gap-2">
				<button
					class="btn btn-sm preset-filled-surface-400-600 text-xs"
					onclick={checkManagedBinaryUpdate}
					disabled={isCheckingManagedUpdate}
				>
					{#if isCheckingManagedUpdate}
						<Icons.Loader2 size={12} class="animate-spin" />
					{:else}
						<Icons.RefreshCw size={12} />
					{/if}
					Check for updates
				</button>
				<button class="btn btn-sm preset-filled-surface-400-600 text-xs" onclick={onUpdateBinary}>
					<Icons.Settings size={12} />
					Change binary
				</button>
			</div>
		</div>
	{/if}

	<!-- Managed: TTL, startup timeout, port -->
	{#if isManaged}
		<div class="card bg-surface-100-800 flex flex-col gap-4 p-4">
			<h3 class="text-sm font-semibold">Managed Settings</h3>

			<div>
				<label class="text-surface-500 mb-2 text-xs font-semibold uppercase tracking-wide" for="ttlInput">
					Model unload timer
				</label>
				<div class="flex items-center gap-2">
					<input
						id="ttlInput"
						type="number"
						min="0"
						step="60"
						bind:value={ttlDraft}
						class="input w-24 text-sm"
						placeholder="300"
					/>
					<span class="text-surface-500 text-xs">seconds</span>
					<button class="btn btn-sm preset-filled-surface-400-600 text-xs" onclick={saveTtl} disabled={savingTtl}>
						{#if savingTtl}<Icons.Loader2 size={12} class="animate-spin" />{:else}Save{/if}
					</button>
				</div>
				<p class="text-surface-500 mt-1 text-xs">
					{ttlDraft === "0" || ttlDraft === ""
						? "Model stays loaded until manually unloaded."
						: `Unload model after ${ttlDraft}s of inactivity.`}
				</p>
			</div>

			<div>
				<label class="text-surface-500 mb-2 text-xs font-semibold uppercase tracking-wide" for="subprocessTimeoutInput">
					Subprocess idle timeout
				</label>
				<div class="flex items-center gap-2">
					<input
						id="subprocessTimeoutInput"
						type="number"
						min="0"
						step="60"
						bind:value={subprocessTimeoutDraft}
						class="input w-24 text-sm"
						placeholder="1800"
					/>
					<span class="text-surface-500 text-xs">seconds</span>
					<button class="btn btn-sm preset-filled-surface-400-600 text-xs" onclick={saveSubprocessTimeout} disabled={savingSubprocessTimeout}>
						{#if savingSubprocessTimeout}<Icons.Loader2 size={12} class="animate-spin" />{:else}Save{/if}
					</button>
				</div>
				<p class="text-surface-500 mt-1 text-xs">
					{subprocessTimeoutDraft === "0" || subprocessTimeoutDraft === ""
						? "Subprocess stays running until manually stopped."
						: `Shut down the subprocess after ${subprocessTimeoutDraft}s of inactivity (default: 30 minutes).`}
				</p>
			</div>

			<div>
				<label class="text-surface-500 mb-2 text-xs font-semibold uppercase tracking-wide" for="portInput">
					Port
				</label>
				<div class="flex items-center gap-2">
					<input
						id="portInput"
						type="number"
						min="1024"
						max="65535"
						bind:value={portDraft}
						class="input w-24 text-sm"
						placeholder="5001"
					/>
					<button class="btn btn-sm preset-filled-surface-400-600 text-xs" onclick={savePort} disabled={savingPort}>
						{#if savingPort}<Icons.Loader2 size={12} class="animate-spin" />{:else}Save{/if}
					</button>
				</div>
				<p class="text-surface-500 mt-1 text-xs">Requires restart to take effect.</p>
			</div>
		</div>
	{/if}

	<!-- Base URL (hidden in managed mode — auto-set) -->
	{#if !isManaged}
		<div class="card bg-surface-100-800 flex flex-col gap-4 p-4">
			<div>
				<label class="block text-sm font-medium" for="koboldBaseUrl">KoboldCPP Base URL</label>
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
					<div class="bg-warning-100 dark:bg-warning-900 border-warning-300 dark:border-warning-700 rounded-lg border p-3">
						<div class="mb-2 flex items-center gap-2">
							<Icons.AlertTriangle size={16} class="text-warning-600" />
							<span class="text-warning-800 dark:text-warning-200 font-medium">Update Available</span>
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
					<div class="bg-success-100 dark:bg-success-900 border-success-300 dark:border-success-700 rounded-lg border p-3">
						<div class="flex items-center gap-2">
							<Icons.Check size={16} class="text-success-600" />
							<span class="text-success-800 dark:text-success-200 font-medium">You're up to date</span>
						</div>
					</div>
				{/if}

				<div class="flex gap-2">
					<button
						class="btn btn-sm preset-filled-surface-500"
						onclick={checkVersion}
						disabled={isCheckingVersion}
					>
						{#if isCheckingVersion}
							<Icons.Loader2 size={14} class="animate-spin" />
						{:else}
							<Icons.RefreshCw size={14} />
						{/if}
						Check Version
					</button>
					<button
						class="btn btn-sm preset-filled-surface-500"
						onclick={checkForUpdates}
						disabled={isCheckingUpdates}
					>
						{#if isCheckingUpdates}
							<Icons.Loader2 size={14} class="animate-spin" />
							Checking...
						{:else}
							<Icons.Search size={14} />
							Check for Updates
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Directory paths -->
	<div class="card bg-surface-100-800 flex flex-col gap-4 p-4">
		<div>
			<label class="block text-sm font-medium" for="koboldModelsDir">Models Directory</label>
			<div class="flex gap-2">
				<input
					id="koboldModelsDir"
					name="koboldModelsDir"
					type="text"
					class="input flex-1 font-mono text-sm"
					placeholder="/home/user/koboldcpp/models"
					bind:value={modelsDirField}
				/>
				<button
					class="btn preset-filled-primary-500"
					onclick={saveModelsDir}
					disabled={isSavingModelsDir}
				>
					<Icons.Save size={14} />
					Save
				</button>
			</div>
			<p class="text-surface-500 mt-1 text-xs">
				Server-side path where GGUF model files are stored and downloaded to.
			</p>
		</div>

	</div>

	<!-- Capabilities -->
	{#if capabilities}
		<div class="card bg-surface-100-800 p-4">
			<h3 class="mb-3 text-sm font-semibold">Active Capabilities</h3>
			<div class="flex flex-wrap gap-2">
				{#each Object.entries(capabilityLabels) as [key, label]}
					{@const enabled = capabilities[key as keyof Sockets.KoboldCpp.Version.Capabilities]}
					<span
						class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium {enabled
							? 'bg-success-100 dark:bg-success-900 text-success-800 dark:text-success-200'
							: 'bg-surface-200 dark:bg-surface-700 text-muted-foreground'}"
					>
						{#if enabled}
							<Icons.Check size={10} />
						{:else}
							<Icons.Minus size={10} />
						{/if}
						{label}
					</span>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Attribution -->
	<p class="text-muted-foreground text-center text-xs">
		KoboldCPP is developed and owned by <a href="https://github.com/LostRuins/koboldcpp" target="_blank" rel="noopener noreferrer" class="hover:text-primary-500 underline">LostRuins</a>.
		Serene Pub's KoboldCpp Manager is an independent integration and is not affiliated with or endorsed by the KoboldCPP project.
	</p>
</div>
