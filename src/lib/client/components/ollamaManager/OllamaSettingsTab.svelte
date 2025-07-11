<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import * as skio from "sveltekit-io"
	import { onMount, onDestroy, getContext } from "svelte"
	import OllamaIcon from "../icons/OllamaIcon.svelte"

	interface OllamaModel {
		name: string
		size: number
		digest: string
		modified_at: string
		details?: {
			parameter_size: string
			quantization_level: string
		}
	}

	const socket = skio.get()

	// State
	let currentVersion = $state("")
	let updateAvailable = $state(false)
	let latestVersion = $state("")
	let isCheckingUpdates = $state(false)
	let isSavingBaseUrl = $state(false)
	let showDeleteModal = $state(false)
	let modelToDelete: OllamaModel | null = $state(null)
	let baseUrlField = $state("")

	// Context
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)

	$effect(() => {
		// Update baseUrl when system settings change
		baseUrlField = systemSettingsCtx.settings.ollamaManagerBaseUrl
	})

	// Settings functions
	function checkOllamaVersion() {
		socket.emit("ollamaVersion", {})
	}

	function checkForUpdates() {
		isCheckingUpdates = true
		socket.emit("ollamaIsUpdateAvailable", {})
	}

	function saveBaseUrl() {
		if (!baseUrlField.trim()) {
			toaster.error({ title: "Base URL cannot be empty" })
			return
		}

		isSavingBaseUrl = true
		socket.emit("ollamaSetBaseUrl", { baseUrl: baseUrlField.trim() })
	}

	function handleSaveBaseUrl() {
		if (!baseUrlField.trim()) {
			toaster.error({ title: "Base URL cannot be empty" })
			return
		}
		saveBaseUrl()
	}

	// Model management functions
	function handleDeleteModel(model: OllamaModel) {
		modelToDelete = model
		showDeleteModal = true
	}

	function handleDeleteModalConfirm() {
		if (modelToDelete) {
			socket.emit("ollamaDeleteModel", { modelName: modelToDelete.name })
		}
		showDeleteModal = false
		modelToDelete = null
	}

	function handleDeleteModalCancel() {
		showDeleteModal = false
		modelToDelete = null
	}

	// Format file size
	function formatSize(bytes: number): string {
		const units = ["B", "KB", "MB", "GB", "TB"]
		let size = bytes
		let unitIndex = 0

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024
			unitIndex++
		}

		return `${size.toFixed(1)} ${units[unitIndex]}`
	}

	// Format date
	function formatDate(dateString: string): string {
		return new Date(dateString).toLocaleDateString()
	}

	onMount(() => {
		// Socket event listeners
		socket.on(
			"ollamaSetBaseUrl",
			(message: Sockets.OllamaSetBaseUrl.Response) => {
				isSavingBaseUrl = false
				if (message.success) {
					toaster.success({
						title: "Ollama URL updated successfully"
					})
				} else {
					toaster.error({ title: "Failed to update Ollama URL" })
				}
			}
		)

		socket.on(
			"ollamaVersion",
			(message: Sockets.OllamaVersion.Response) => {
				currentVersion = message.version || "Unknown"
			}
		)

		socket.on(
			"ollamaIsUpdateAvailable",
			(message: Sockets.OllamaIsUpdateAvailable.Response) => {
				isCheckingUpdates = false
				updateAvailable = message.updateAvailable
				latestVersion = message.latestVersion || ""

				if (message.error) {
					toaster.error({
						title: "Failed to check for updates",
						description: message.error
					})
				}
			}
		)

		// Load version info when component mounts
		checkOllamaVersion()
		checkForUpdates()
	})

	onDestroy(() => {
		socket.off("ollamaSetBaseUrl")
		socket.off("ollamaVersion")
		socket.off("ollamaIsUpdateAvailable")
	})
</script>

<div class="space-y-6 p-4">
	<!-- Version Information -->
	 <div class="text-center mt-8">
		<OllamaIcon class="text-muted-foreground mx-auto mb-4 h-16 w-16" />
		<span class="h5">Ollama</span>
		<!-- Links to documentation and GitHub -->
		<div class="flex items-center justify-center gap-4 mb-6">
			<a
				href="https://ollama.ai/docs"
				target="_blank"
				rel="noopener noreferrer"
				class="text-muted-foreground hover:text-primary-500 transition-colors text-xs flex items-center gap-1"
			>
				<Icons.BookOpen class="h-3 w-3" />
				Documentation
			</a>
			<div class="text-muted-foreground">•</div>
			<a
				href="https://github.com/ollama/ollama"
				target="_blank"
				rel="noopener noreferrer"
				class="text-muted-foreground hover:text-primary-500 transition-colors text-xs flex items-center gap-1"
			>
				<Icons.Github class="h-3 w-3" />
				GitHub
			</a>
		</div>
	 </div>
	<div class="card bg-surface-100-800 flex flex-col gap-4 p-4">
		<div>
			<label class="block text-sm font-medium" for="baseUrl">
				Ollama Base URL
			</label>
			<div class="flex gap-2">
				<input
					id="baseUrl"
					name="baseUrl"
					type="url"
					class="input flex-1"
					placeholder="http://localhost:11434"
					bind:value={baseUrlField}
				/>
				<button
					class="btn preset-filled-primary-500"
					onclick={handleSaveBaseUrl}
					disabled={isSavingBaseUrl}
				>
					<Icons.Save size={14} />
					Save
				</button>
			</div>
			<p class="text-surface-500 mt-1 text-xs">
				The URL where Ollama is running. Usually http://localhost:11434
			</p>
		</div>
		<div class="space-y-3">
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<span class="text-surface-600">Current Version:</span>
					<span class="font-mono">{currentVersion || "Unknown"}</span>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-surface-600">Latest Version:</span>
					<span class="text-warning-500 font-mono">
						{latestVersion}
					</span>
				</div>
			</div>
			{#if updateAvailable}
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
						A new version of Ollama is available. Download it to get
						the latest features and bug fixes.
					</p>
					<a
						href="https://github.com/ollama/ollama/releases/latest"
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
						<span
							class="text-success-800 dark:text-success-200 font-medium"
						>
							You're up to date
						</span>
					</div>
				</div>
			{/if}
			<div class="flex gap-2">
				<button
					class="btn btn-sm preset-filled-surface-500"
					onclick={checkOllamaVersion}
				>
					<Icons.RefreshCw size={14} />
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
</div>
