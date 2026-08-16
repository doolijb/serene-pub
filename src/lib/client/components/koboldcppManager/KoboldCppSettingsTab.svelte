<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		isManaged?: boolean
		onReset?: () => void
		onUpdateBinary?: () => void
	}
	let { isManaged = false, onReset, onUpdateBinary }: Props = $props()

	const socket = useTypedSocket()

	let koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx")
	)

	// --- Version / update state ---
	let currentVersion = $state("")
	let capabilities = $state<Sockets.KoboldCPP.Version.Capabilities | null>(
		null
	)
	let isCheckingVersion = $state(false)
	let versionCheckFailed = $state(false)
	let isUpdateAvailable = $state(false)
	let latestVersion = $state("")
	let releaseUrl = $state("")
	let isCheckingUpdates = $state(false)
	let updateCheckFailed = $state(false)
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
	let ttlDraft = $state(
		String(
			koboldCppSettingsCtx.settings?.koboldCppManagedModelTtlSecs ?? 300
		)
	)
	let savingTtl = $state(false)
	let subprocessTimeoutDraft = $state(
		String(
			koboldCppSettingsCtx.settings
				?.koboldCppManagedSubprocessTimeoutSecs ?? 1800
		)
	)
	let savingSubprocessTimeout = $state(false)
	let portDraft = $state(
		String(koboldCppSettingsCtx.settings?.koboldCppManagedPort ?? 5001)
	)
	let savingPort = $state(false)

	// --- External mode: admin credentials for the user's own instance ---
	// adminDirField mirrors the stored value (same field koboldCppManagedBinaryDir
	// uses in Managed mode for the binary's own dir, doing double duty here as
	// the --admindir the user's instance was launched with). adminPasswordField
	// never gets pre-filled from settings — the real password never reaches the
	// client at all (see systemSettingsGet) — so it always starts blank; the
	// input's placeholder shows bullets when koboldCppManagedAdminPasswordSet is
	// true, purely as a "something is saved" hint, not the actual value.
	let adminDirField = $state("")
	let savingAdminDir = $state(false)
	let adminPasswordField = $state("")
	let savingAdminPassword = $state(false)

	$effect(() => {
		baseUrlField =
			koboldCppSettingsCtx.settings?.koboldCppManagerBaseUrl ?? ""
		modelsDirField =
			koboldCppSettingsCtx.settings?.koboldCppManagerModelsDir ?? ""
		adminDirField =
			koboldCppSettingsCtx.settings?.koboldCppManagedBinaryDir ?? ""
	})

	// In Managed mode, everything (health checks, capability display,
	// generation) talks to koboldCppManagerBaseUrl — but the subprocess Serene
	// Pub actually spawns/owns always listens on koboldCppManagedPort. These
	// are normally kept in sync automatically, but koboldCppManagerBaseUrl can
	// also be edited independently from Settings > System, silently pointing
	// the whole app at a different instance than the one it's managing.
	let portMismatch = $derived.by(() => {
		if (!isManaged) return false
		const managedPort = koboldCppSettingsCtx.settings?.koboldCppManagedPort
		const baseUrl = koboldCppSettingsCtx.settings?.koboldCppManagerBaseUrl
		if (!managedPort || !baseUrl) return false
		try {
			const urlPort = Number(new URL(baseUrl).port) || 80
			return urlPort !== managedPort
		} catch {
			return false
		}
	})

	function checkVersion() {
		isCheckingVersion = true
		versionCheckFailed = false
		socket.emit("koboldcpp:version", {})
	}

	function checkForUpdates() {
		isCheckingUpdates = true
		updateCheckFailed = false
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

	function saveAdminDir() {
		savingAdminDir = true
		socket.emit("koboldcpp:setManagedBinaryDir", {
			dir: adminDirField.trim()
		})
	}

	function saveAdminPassword() {
		if (!adminPasswordField.trim()) {
			toaster.error({ title: "Admin password cannot be empty" })
			return
		}
		savingAdminPassword = true
		socket.emit("koboldcpp:setManagedAdminPassword", {
			password: adminPasswordField.trim()
		})
	}

	onMount(() => {
		socket.on(
			"koboldcpp:version",
			(message: Sockets.KoboldCPP.Version.Response) => {
				isCheckingVersion = false
				versionCheckFailed = false
				currentVersion = message.version || "Unknown"
				capabilities = message.capabilities
			}
		)
		socket.on("koboldcpp:version:error", () => {
			// Not reachable is a common, often-transient state in both modes
			// (subprocess/instance not started yet, briefly restarting, etc.)
			// — this fires eagerly on every mount, so a toast here would pop
			// up immediately just from opening the tab. Surfaced instead as a
			// quiet inline indicator next to the version fields below.
			isCheckingVersion = false
			versionCheckFailed = true
			currentVersion = ""
			capabilities = null
		})
		socket.on(
			"koboldcpp:isUpdateAvailable",
			(message: Sockets.KoboldCPP.IsUpdateAvailable.Response) => {
				isCheckingUpdates = false
				updateCheckFailed = false
				isUpdateAvailable = message.isUpdateAvailable
				latestVersion = message.latestVersion ?? ""
				releaseUrl = message.releaseUrl ?? ""
				if (!currentVersion && message.currentVersion)
					currentVersion = message.currentVersion
			}
		)
		socket.on("koboldcpp:isUpdateAvailable:error", () => {
			// Same reasoning as koboldcpp:version:error above — eager check,
			// quiet inline indicator instead of a toast.
			isCheckingUpdates = false
			updateCheckFailed = true
		})
		socket.on(
			"koboldcpp:setBaseUrl",
			(message: Sockets.KoboldCPP.SetBaseUrl.Response) => {
				isSavingBaseUrl = false
				if (message.success)
					toaster.success({
						title: "KoboldCPP URL updated successfully"
					})
				else toaster.error({ title: "Failed to update KoboldCPP URL" })
			}
		)
		socket.on(
			"koboldcpp:setModelsDir",
			(message: Sockets.KoboldCPP.SetModelsDir.Response) => {
				isSavingModelsDir = false
				if (message.success)
					toaster.success({ title: "Models directory saved" })
				else toaster.error({ title: "Failed to save models directory" })
			}
		)

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
				(msg: Sockets.KoboldCPP.CheckManagedBinaryUpdate.Response) => {
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
			// Also check the live instance's own reported version/capabilities —
			// distinct from checkManagedBinaryUpdate's GitHub-release check above.
			// Harmless if the subprocess isn't running yet (error is swallowed
			// above rather than toasted for this mode).
			checkVersion()
		} else {
			socket.on(
				"koboldcpp:setManagedBinaryDir",
				(message: Sockets.KoboldCPP.SetManagedBinaryDir.Response) => {
					savingAdminDir = false
					if (message.success)
						toaster.success({ title: "Admin directory saved" })
					else
						toaster.error({
							title: "Failed to save admin directory"
						})
				}
			)
			socket.on(
				"koboldcpp:setManagedAdminPassword",
				(
					message: Sockets.KoboldCPP.SetManagedAdminPassword.Response
				) => {
					savingAdminPassword = false
					if (message.success) {
						toaster.success({ title: "Admin password saved" })
						// Never leave the just-typed password sitting in the field —
						// the placeholder will show bullets now that it's stored.
						adminPasswordField = ""
					} else {
						toaster.error({
							title: "Failed to save admin password"
						})
					}
				}
			)
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
		} else {
			socket.off("koboldcpp:setManagedBinaryDir")
			socket.off("koboldcpp:setManagedAdminPassword")
		}
	})

	const capabilityLabels: Record<
		keyof Sockets.KoboldCPP.Version.Capabilities,
		string
	> = {
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

<div class="space-y-6 py-4">
	<!-- Header -->
	<div class="mt-4 text-center">
		<img
			src="/koboldcpp/koboldcpp-logo.png"
			alt="KoboldCPP"
			class="mx-auto mb-4 h-20 w-auto"
		/>
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
		<div
			class="card bg-surface-100-800 flex items-center justify-between gap-3 p-4"
		>
			<div>
				<p class="text-sm font-medium">
					{isManaged ? "Managed mode" : "External mode"}
				</p>
				<p class="text-surface-700-300 text-xs">
					Switch to a different setup
				</p>
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
					<span
						class="badge preset-filled-warning-500 rounded-full px-2 py-0.5 text-xs font-medium"
					>
						Update available
					</span>
				{/if}
			</div>

			<div class="space-y-1 text-sm">
				<div class="flex items-center justify-between">
					<span class="text-surface-700-300 text-xs">Variant</span>
					<span class="font-mono text-xs">
						{koboldCppSettingsCtx.settings
							.koboldCppManagedBinaryVariant}
					</span>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-surface-700-300 text-xs">
						Installed version
					</span>
					<span class="font-mono text-xs">
						{managedInstalledTag ??
							koboldCppSettingsCtx.settings
								.koboldCppManagedReleaseTag ??
							"—"}
					</span>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-surface-700-300 text-xs">
						Running version
					</span>
					<span class="font-mono text-xs">
						{#if isCheckingVersion}
							<Icons.Loader2
								size={12}
								class="inline animate-spin"
							/>
						{:else}
							{currentVersion || "Not running"}
						{/if}
					</span>
				</div>
				{#if managedLatestTag}
					<div class="flex items-center justify-between">
						<span class="text-surface-700-300 text-xs">
							Latest version
						</span>
						<span
							class="font-mono text-xs {managedUpdateAvailable
								? 'text-warning-500'
								: ''}"
						>
							{managedLatestTag}
						</span>
					</div>
				{/if}
			</div>

			{#if managedUpdateAvailable}
				<div
					class="bg-warning-50 dark:bg-warning-950 border-warning-200 dark:border-warning-800 rounded-lg border p-3 text-sm"
				>
					<p class="text-warning-700 dark:text-warning-300 mb-2">
						Version {managedLatestTag} is available.
					</p>
					<button
						class="btn btn-sm preset-filled-warning-500"
						onclick={onUpdateBinary}
					>
						<Icons.Download size={14} />
						Update Binary
					</button>
				</div>
			{/if}

			<div class="panel-actions">
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
				<button
					class="btn btn-sm preset-filled-surface-400-600 text-xs"
					onclick={onUpdateBinary}
				>
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
				<label
					class="text-surface-700-300 mb-2 text-xs font-semibold tracking-wide uppercase"
					for="ttlInput"
				>
					Model unload timer
				</label>
				<div class="panel-actions">
					<input
						id="ttlInput"
						type="number"
						min="0"
						step="60"
						bind:value={ttlDraft}
						class="input w-24 text-sm"
						placeholder="300"
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

			<div>
				<label
					class="text-surface-700-300 mb-2 text-xs font-semibold tracking-wide uppercase"
					for="subprocessTimeoutInput"
				>
					Subprocess idle timeout
				</label>
				<div class="panel-actions">
					<input
						id="subprocessTimeoutInput"
						type="number"
						min="0"
						step="60"
						bind:value={subprocessTimeoutDraft}
						class="input w-24 text-sm"
						placeholder="1800"
					/>
					<span class="text-surface-700-300 text-xs">seconds</span>
					<button
						class="btn btn-sm preset-filled-surface-400-600 text-xs"
						onclick={saveSubprocessTimeout}
						disabled={savingSubprocessTimeout}
					>
						{#if savingSubprocessTimeout}<Icons.Loader2
								size={12}
								class="animate-spin"
							/>{:else}Save{/if}
					</button>
				</div>
				<p class="text-surface-700-300 mt-1 text-xs">
					{subprocessTimeoutDraft === "0" ||
					subprocessTimeoutDraft === ""
						? "Subprocess stays running until manually stopped."
						: `Shut down the subprocess after ${subprocessTimeoutDraft}s of inactivity (default: 30 minutes).`}
				</p>
			</div>

			<div>
				<label
					class="text-surface-700-300 mb-2 text-xs font-semibold tracking-wide uppercase"
					for="portInput"
				>
					Port
				</label>
				<div class="panel-actions">
					<input
						id="portInput"
						type="number"
						min="1024"
						max="65535"
						bind:value={portDraft}
						class="input w-24 text-sm"
						placeholder="5001"
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
				{#if portMismatch}
					<div
						class="border-warning-500 bg-warning-500/10 mt-2 flex items-start gap-2 rounded-lg border p-3"
					>
						<Icons.AlertTriangle
							size={16}
							class="text-warning-700-300 mt-0.5 shrink-0"
						/>
						<p class="text-warning-700-300 text-sm">
							This port doesn't match the KoboldCPP Server URL in
							Settings &gt; System ({koboldCppSettingsCtx.settings
								?.koboldCppManagerBaseUrl}). Everything (health
							checks, model list, generation) talks to that URL,
							not this port — the subprocess running here may be
							orphaned. Update one to match the other.
						</p>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Base URL (hidden in managed mode — auto-set) -->
	{#if !isManaged}
		<div class="card bg-surface-100-800 flex flex-col gap-4 p-4">
			<div>
				<label class="block text-sm font-medium" for="koboldBaseUrl">
					KoboldCPP Base URL
				</label>
				<div class="panel-actions">
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
				<p class="text-surface-700-300 mt-1 text-xs">
					The URL where KoboldCPP is running. Usually
					http://localhost:5001
				</p>
			</div>

			<!-- Version info -->
			<div class="space-y-3">
				<div class="flex flex-col gap-2">
					<div class="flex items-center justify-between">
						<span class="text-surface-600">Current Version:</span>
						{#if isCheckingVersion}
							<span
								class="text-surface-700-300 flex items-center gap-1 font-mono text-xs"
							>
								<Icons.Loader2 size={12} class="animate-spin" />
								Checking...
							</span>
						{:else if versionCheckFailed}
							<span
								class="text-warning-600 dark:text-warning-400 flex items-center gap-1 text-xs"
							>
								<Icons.AlertTriangle size={12} />
								Not reachable
							</span>
						{:else}
							<span class="font-mono">
								{currentVersion || "—"}
							</span>
						{/if}
					</div>
					<div class="flex items-center justify-between">
						<span class="text-surface-600">Latest Version:</span>
						{#if updateCheckFailed}
							<span class="text-surface-700-300 text-xs">
								Couldn't check
							</span>
						{:else}
							<span class="text-warning-500 font-mono">
								{latestVersion || "—"}
							</span>
						{/if}
					</div>
				</div>

				{#if isUpdateAvailable}
					<div
						class="bg-warning-100 dark:bg-warning-900 border-warning-300 dark:border-warning-700 rounded-lg border p-3"
					>
						<div class="mb-2 flex items-center gap-2">
							<Icons.AlertTriangle
								size={16}
								class="text-warning-600"
							/>
							<span
								class="text-warning-800 dark:text-warning-200 font-medium"
							>
								Update Available
							</span>
						</div>
						<p
							class="text-warning-700 dark:text-warning-300 mb-3 text-sm"
						>
							A new version of KoboldCPP is available.
						</p>
						<a
							href={releaseUrl ||
								"https://github.com/LostRuins/koboldcpp/releases"}
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
						<div class="panel-actions">
							<Icons.Check size={16} class="text-success-600" />
							<span
								class="text-success-800 dark:text-success-200 font-medium"
							>
								You're up to date
							</span>
						</div>
					</div>
				{/if}

				<div class="panel-actions">
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

	<!-- Admin credentials (external mode only): let the Manager drive model
	     switching and other admin-API actions against an instance the user
	     started themselves, by telling it what --adminpassword/--admindir
	     that instance was launched with. Without these, every admin call is
	     rejected as a credentials mismatch even when --admin is genuinely
	     enabled on the target. -->
	{#if !isManaged}
		<div class="card bg-surface-100-800 flex flex-col gap-4 p-4">
			<div>
				<h3 class="text-sm font-semibold">Admin API Credentials</h3>
				<p class="text-surface-700-300 mt-1 text-xs">
					Needed for model switching and other admin actions. Must
					match the <code>--adminpassword</code>
					and
					<code>--admindir</code>
					your instance was started with.
				</p>
			</div>
			<div>
				<label
					class="block text-sm font-medium"
					for="koboldAdminPassword"
				>
					Admin Password
				</label>
				<div class="panel-actions">
					<input
						id="koboldAdminPassword"
						name="koboldAdminPassword"
						type="password"
						autocomplete="off"
						class="input flex-1"
						placeholder={koboldCppSettingsCtx.settings
							?.koboldCppManagedAdminPasswordSet
							? "••••••••"
							: "Matches --adminpassword"}
						bind:value={adminPasswordField}
					/>
					<button
						class="btn preset-filled-primary-500"
						onclick={saveAdminPassword}
						disabled={savingAdminPassword}
					>
						{#if savingAdminPassword}
							<Icons.Loader2 size={14} class="animate-spin" />
						{:else}
							<Icons.Save size={14} aria-hidden="true" />
						{/if}
						Save
					</button>
				</div>
				{#if koboldCppSettingsCtx.settings?.koboldCppManagedAdminPasswordSet}
					<p class="text-surface-700-300 mt-1 text-xs">
						A password is already saved. Type a new value and click
						Save to replace it — the existing one is never shown
						here.
					</p>
				{/if}
			</div>
			<div>
				<label class="block text-sm font-medium" for="koboldAdminDir">
					Admin Directory
				</label>
				<div class="panel-actions">
					<input
						id="koboldAdminDir"
						name="koboldAdminDir"
						type="text"
						class="input flex-1 font-mono text-sm"
						placeholder="Matches --admindir"
						bind:value={adminDirField}
					/>
					<button
						class="btn preset-filled-primary-500"
						onclick={saveAdminDir}
						disabled={savingAdminDir}
					>
						{#if savingAdminDir}
							<Icons.Loader2 size={14} class="animate-spin" />
						{:else}
							<Icons.Save size={14} aria-hidden="true" />
						{/if}
						Save
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Directory paths -->
	<div class="card bg-surface-100-800 flex flex-col gap-4 p-4">
		<div>
			<label class="block text-sm font-medium" for="koboldModelsDir">
				Models Directory
			</label>
			<div class="flex gap-2">
				<input
					id="koboldModelsDir"
					name="koboldModelsDir"
					type="text"
					class="input flex-1 font-mono text-sm"
					placeholder="<app data dir>/models/llm"
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
			<p class="text-surface-700-300 mt-1 text-xs">
				Server-side path where GGUF model files are stored and
				downloaded to.
			</p>
		</div>
	</div>

	<!-- Capabilities -->
	{#if capabilities}
		<div class="card bg-surface-100-800 p-4">
			<h3 class="mb-3 text-sm font-semibold">Active Capabilities</h3>
			<div class="flex flex-wrap gap-2">
				{#each Object.entries(capabilityLabels) as [key, label]}
					{@const enabled =
						capabilities[
							key as keyof Sockets.KoboldCPP.Version.Capabilities
						]}
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
		KoboldCPP is developed and owned by <a
			href="https://github.com/LostRuins/koboldcpp"
			target="_blank"
			rel="noopener noreferrer"
			class="hover:text-primary-500 underline"
		>
			LostRuins
		</a>
		. Serene Pub's KoboldCPP Manager is an independent integration and is not
		affiliated with or endorsed by the KoboldCPP project.
	</p>
</div>
