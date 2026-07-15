<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import OllamaForm from "$lib/client/connectionForms/OllamaForm.svelte"
	import OpenAIForm from "$lib/client/connectionForms/OpenAIForm.svelte"
	import LmStudioForm from "$lib/client/connectionForms/LMStudioForm.svelte"
	import {
		CONNECTION_TYPE,
		CONNECTION_TYPES
	} from "$lib/shared/constants/ConnectionTypes"
	import LlamaCppForm from "$lib/client/connectionForms/LlamaCppForm.svelte"
	import KoboldCppForm from "$lib/client/connectionForms/KoboldCppForm.svelte"
	import KoboldCppManagedForm from "$lib/client/connectionForms/KoboldCppManagedForm.svelte"
	import AnthropicForm from "$lib/client/connectionForms/AnthropicForm.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import {
		CONNECTION_DEFAULTS,
		OPENAI_CHAT_PRESETS
	} from "$lib/shared/utils/connectionDefaults"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	let panelsCtx: PanelsCtx = getContext("panelsCtx")
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = getContext("koboldCppSettingsCtx")

	const socket = useTypedSocket()

	// --- State ---
	let connectionsList: SelectConnection[] = $state([])
	let isLoading = $state(true)
	let connection: any = $state()
	let originalConnection = $state()
	let unsavedChanges = $derived.by(() => {
		if (!connection || !originalConnection) return false
		return JSON.stringify(connection) !== JSON.stringify(originalConnection)
	})
	let editingField: string | null = $state(null)
	let showConfirmModal = $state(false)
	let confirmResolve: ((v: boolean) => void) | null = null
	let testResult: { ok: boolean; error?: string; models?: any[] } | null =
		$state(null)
	let refreshModelsResult: { models?: any[]; error?: string } | null =
		$state(null)
	let showNewConnectionModal = $state(false)
	let newConnectionName = $state("")
	let newConnectionType = $state(CONNECTION_TYPES[0].value)
	let newConnectionOAIChatPreset: number | undefined = $state()
	let showDeleteModal = $state(false)

	// Screen reader announcements
	let announcements = $state("")

	// Which connection is currently shown in the form (local view state)
	let selectedConnectionId = $state<number | null>(null)
	// The system-wide default connection
	let defaultConnectionId = $derived(systemSettingsCtx.settings?.defaultConnectionId ?? null)
	// A Managed KoboldCpp connection can't be set default while the manager is off
	let managedButDisabled = $derived(
		connection?.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED &&
			!koboldCppSettingsCtx?.settings?.koboldCppManagerEnabled
	)

	function announce(message: string) {
		announcements = message
		// Clear after screen reader has time to read
		setTimeout(() => (announcements = ""), 1000)
	}

	// Focus management
	function focusConnectionSelect() {
		const select = document.getElementById("connection-select")
		if (select) select.focus()
	}

	function focusNewConnectionName() {
		const input = document.getElementById("newConnName")
		if (input) input.focus()
	}

	// Keyboard shortcuts
	function handleKeydown(e: KeyboardEvent) {
		// Ctrl/Cmd + N to create new connection
		if ((e.ctrlKey || e.metaKey) && e.key === "n") {
			e.preventDefault()
			handleNew()
		}
		// Escape to close modals
		if (e.key === "Escape") {
			if (showNewConnectionModal) {
				handleNewConnectionCancel()
			} else if (showDeleteModal) {
				handleDeleteModalCancel()
			} else if (showConfirmModal) {
				handleModalCancel()
			}
		}
	}

	function handleSelectChange(e: Event) {
		const id = +(e.target as HTMLSelectElement).value
		selectedConnectionId = id
		socket.emit("connections:get", { id })
	}

	function handleSetDefault() {
		if (!selectedConnectionId) return
		socket.emit("connections:setUserActive", { id: selectedConnectionId })
		const selected = connectionsList.find((c) => c.id === selectedConnectionId)
		if (selected) announce(`Default connection set to: ${selected.name}`)
	}
	function handleNew() {
		newConnectionName = ""
		newConnectionType = CONNECTION_TYPES[0].value
		showNewConnectionModal = true
		// Clear tutorial flag when user interacts with the highlighted button
		if (panelsCtx.digest.tutorial) {
			panelsCtx.digest.tutorial = false
		}
		// Focus the name input after modal opens
		setTimeout(focusNewConnectionName, 100)
	}
	function handleNewConnectionConfirm() {
		if (!newConnectionName.trim()) {
			toaster.error({ title: "Connection name is required" })
			return
		}
		if (newConnectionType === CONNECTION_TYPE.OPENAI_CHAT) {
			const preset = OPENAI_CHAT_PRESETS.find(
				(p) => p.value === newConnectionOAIChatPreset
			)
			if (!preset) {
				toaster.error({ title: "Invalid OpenAI Chat preset" })
				return
			}
		}
		const newConn = {
			name: newConnectionName.trim(),
			type: newConnectionType,
			enabled: true,
			...(newConnectionType === CONNECTION_TYPE.OPENAI_CHAT
				? OPENAI_CHAT_PRESETS.find(
						(p) => p.value === newConnectionOAIChatPreset
					)?.connectionDefaults
				: CONNECTION_DEFAULTS[newConnectionType] || {})
		}
		socket.emit("connections:create", { connection: newConn })
		showNewConnectionModal = false
	}
	function handleNewConnectionCancel() {
		showNewConnectionModal = false
	}
	function handleUpdate() {
		socket.emit("connections:update", { connection })
	}
	function handleReset() {
		connection = { ...originalConnection }
	}
	function handleDelete() {
		showDeleteModal = true
	}
	function handleDeleteModalConfirm() {
		if (connection) {
			socket.emit("connections:delete", { id: connection.id })
		}
		showDeleteModal = false
	}
	function handleDeleteModalCancel() {
		showDeleteModal = false
	}
	function handleOnClose() {
		if (!unsavedChanges) return true
		showConfirmModal = true
		return new Promise<boolean>((resolve) => {
			confirmResolve = resolve
		})
	}
	function handleModalDiscard() {
		showConfirmModal = false
		if (confirmResolve) confirmResolve(true)
	}
	function handleModalCancel() {
		showConfirmModal = false
		if (confirmResolve) confirmResolve(false)
	}
	function handleRefreshModels() {
		refreshModelsResult = null
		socket.emit("connections:refreshModels", {
			baseUrl: connection?.baseUrl
		})
	}

	onMount(() => {
		socket.on("connections:list", (msg) => {
			connectionsList = msg.connectionsList
				.slice()
				.sort((a, b) => a.name!.localeCompare(b.name!))
			isLoading = false
		})
		// The generic **:error listener in Layout.svelte already toasts this —
		// this just stops the spinner from spinning forever if the initial
		// fetch fails, so it settles into the (accurate enough) empty state.
		socket.on("connections:list:error", () => {
			isLoading = false
		})
		socket.on("connections:refreshModels:error", () => {
			refreshModelsResult = { error: "Failed to refresh models" }
		})
		socket.on("connections:get", (msg) => {
			connection = { ...msg.connection }
			originalConnection = { ...msg.connection }
		})
		socket.on("connections:test", (msg) => {
			testResult = msg
		})
		socket.on("connections:refreshModels", (msg) => {
			refreshModelsResult = msg.models || []
		})
		socket.on("connections:update", (msg) => {
			toaster.success({ title: "Connection Updated" })
			announce(
				`Connection ${connection?.name} has been updated successfully`
			)
		})
		socket.on("connections:delete", (msg) => {
			const deletedName = connection?.name
			toaster.success({ title: "Connection Deleted" })
			announce(`Connection ${deletedName} has been permanently deleted`)
			connection = undefined
			originalConnection = undefined
			// Fall back to viewing the default if one exists
			const fallbackId = defaultConnectionId && defaultConnectionId !== msg.id ? defaultConnectionId : null
			selectedConnectionId = fallbackId
			if (fallbackId) socket.emit("connections:get", { id: fallbackId })
		})
		socket.on("connections:create", (msg) => {
			toaster.success({ title: "Connection Created" })
			announce(`New connection ${msg.connection?.name} has been created successfully`)
			// View the newly created connection
			if (msg.connection?.id) {
				selectedConnectionId = msg.connection.id
				socket.emit("connections:get", { id: msg.connection.id })
			}
		})
		socket.on("connections:setUserActive", (msg) => {
			// Update local system settings context so the default indicator updates
			const s = systemSettingsCtx.settings
			if (s) {
				systemSettingsCtx.settings = { ...s, defaultConnectionId: msg.id ?? null }
			}
			if (msg.id) toaster.success({ title: "Default connection updated" })
		})
		socket.emit("connections:list", {})
		// Seed the view: digest.connectionId (from external nav) takes priority over the default
		const digestId = panelsCtx.digest.connectionId ?? null
		const initialId = digestId ?? systemSettingsCtx.settings?.defaultConnectionId ?? null
		if (digestId) panelsCtx.digest.connectionId = undefined
		selectedConnectionId = initialId
		if (initialId) {
			socket.emit("connections:get", { id: initialId })
		}
		onclose = handleOnClose

		if (connection?.type === "ollama" && connection.baseUrl) {
			handleRefreshModels()
		}
	})

	onDestroy(() => {
		socket.off("connections:list")
		socket.off("connections:list:error")
		socket.off("connections:refreshModels:error")
		socket.off("connections:get")
		socket.off("connections:test")
		socket.off("connections:refreshModels")
		socket.off("connections:update")
		socket.off("connections:delete")
		socket.off("connections:create")
		socket.off("connections:setUserActive")
		onclose = undefined
	})
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="text-foreground p-4"
	role="main"
	aria-label="AI Connections Management"
	onkeydown={handleKeydown}
>
	<!-- Screen reader announcements -->
	<div aria-live="polite" aria-atomic="true" class="sr-only">
		{announcements}
	</div>
	<div class="mb-2">
		<h2 class="sr-only">Connection Management</h2>
		<div
			class="mt-2 mb-2 flex justify-between gap-2 sm:mt-0"
			role="toolbar"
			aria-label="Connection actions"
		>
			<div class="gap-2">
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500 {panelsCtx
						.digest.tutorial
						? 'ring-primary-500/50 animate-pulse ring-4'
						: ''}"
					onclick={handleNew}
					aria-label="Create new AI connection (Ctrl+N)"
					title="Create new AI connection (Ctrl+N)"
				>
					<Icons.Plus size={16} aria-hidden="true" />
					New
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-secondary-500"
					onclick={handleReset}
					disabled={!unsavedChanges}
					aria-label={unsavedChanges
						? "Reset unsaved changes"
						: "No changes to reset"}
					aria-describedby={unsavedChanges ? "reset-help" : undefined}
				>
					<Icons.RefreshCcw size={16} aria-hidden="true" />
					Reset
				</button>
				{#if unsavedChanges}
					<div id="reset-help" class="sr-only">
						Resets all unsaved changes to the selected connection
					</div>
				{/if}
				<button
					type="button"
					class="btn btn-sm preset-filled-error-500"
					onclick={handleDelete}
					disabled={!connection}
					aria-label={connection
						? `Delete connection ${connection.name}`
						: "No connection selected to delete"}
				>
					<Icons.X size={16} aria-hidden="true" />
					Delete
				</button>
			</div>
		</div>
	</div>
	<div
		class="mb-4"
		class:hidden={!connectionsList.length}
	>
		<label for="connection-select" class="sr-only">
			Select AI connection to view
		</label>
		<select
			id="connection-select"
			class="select bg-background border-muted w-full rounded border"
			onchange={handleSelectChange}
			value={selectedConnectionId}
			disabled={unsavedChanges}
			aria-label="Select AI connection to view"
			aria-describedby="connection-help"
		>
			{#each connectionsList as c}
				{@const typeLabel = CONNECTION_TYPE.options.find((t) => t.value === c.type)?.label ?? c.type}
				{@const isDefault = c.id === defaultConnectionId}
				<option value={c.id}>
					{isDefault ? "★ " : ""}{c.name} ({typeLabel})
				</option>
			{/each}
		</select>
		<div id="connection-help" class="sr-only">
			{unsavedChanges
				? "Save or reset changes before switching connections"
				: "Select a connection to view or edit its settings"}
		</div>
	</div>
	{#if !!connection}
		{#key connection.id}
			<section aria-labelledby="connection-details">
				<h3 id="connection-details" class="sr-only">
					Connection Details for {connection.name}
				</h3>
				<div class="my-4 flex gap-2">
					<button
						type="button"
						class="btn btn-sm preset-filled-success-500 flex-1"
						onclick={handleUpdate}
						disabled={!unsavedChanges}
						aria-label={unsavedChanges
							? `Save changes to ${connection.name}`
							: "No changes to save"}
						aria-describedby="save-status"
					>
						<Icons.Save size={16} aria-hidden="true" />
						Update
					</button>
					<button
						type="button"
						class="btn btn-sm preset-filled-warning-500 shrink-0"
						onclick={handleSetDefault}
						disabled={!selectedConnectionId ||
							selectedConnectionId === defaultConnectionId ||
							managedButDisabled}
						title={managedButDisabled
							? "KoboldCpp Manager must be enabled to use this connection"
							: selectedConnectionId === defaultConnectionId
								? "Already the default connection"
								: "Set as default connection"}
						aria-label="Set selected connection as default"
					>
						<Icons.Star size={14} aria-hidden="true" />
						Set Default
					</button>
				</div>
				<div id="save-status" class="sr-only">
					{unsavedChanges
						? "You have unsaved changes"
						: "All changes saved"}
				</div>
				<div class="flex flex-col gap-1">
					<label class="font-semibold" for="connection-name">
						Connection Name
					</label>
					<input
						id="connection-name"
						type="text"
						bind:value={connection.name}
						class="input"
						aria-describedby="name-help"
						aria-required="true"
					/>
					<div id="name-help" class="sr-only">
						Enter a descriptive name for this AI connection
					</div>
				</div>
				{#if connection.type === CONNECTION_TYPE.OLLAMA}
					<OllamaForm bind:connection />
				{:else if connection.type === CONNECTION_TYPE.OPENAI_CHAT}
					<OpenAIForm bind:connection />
				{:else if connection.type === CONNECTION_TYPE.LM_STUDIO}
					<LmStudioForm bind:connection />
				{:else if connection.type === CONNECTION_TYPE.LLAMACPP_COMPLETION}
					<LlamaCppForm bind:connection />
				{:else if connection.type === CONNECTION_TYPE.KOBOLDCPP}
					<KoboldCppForm bind:connection />
				{:else if connection.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED}
					<KoboldCppManagedForm bind:connection />
				{:else if connection.type === CONNECTION_TYPE.ANTHROPIC}
					<AnthropicForm bind:connection />
				{/if}
			</section>
		{/key}
	{/if}
	{#if isLoading}
		<div class="flex items-center justify-center py-8">
			<Icons.Loader2 size={20} class="text-surface-400 animate-spin" />
		</div>
	{:else if !connectionsList.length}
		<div
			class="text-muted-foreground py-8 text-center"
			role="status"
			aria-live="polite"
		>
			<p>No AI connections found.</p>
			<p>Create a new connection to get started with AI conversations.</p>
		</div>
	{/if}
</div>

<Modal
	open={showConfirmModal}
	onOpenChange={(e) => (showConfirmModal = e.open)}
	contentBase="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-w-lg w-full"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<div
			role="dialog"
			aria-labelledby="confirm-title"
			aria-describedby="confirm-desc"
		>
			<header class="flex justify-between">
				<h2 id="confirm-title" class="h2">Confirm Action</h2>
			</header>
			<article>
				<p id="confirm-desc" class="opacity-60">
					Your connection has unsaved changes. Are you sure you want
					to discard them? This action cannot be undone.
				</p>
			</article>
			<footer class="flex justify-end gap-4">
				<button
					class="btn preset-filled-surface-500"
					onclick={handleModalCancel}
					aria-label="Cancel and keep unsaved changes"
				>
					Cancel
				</button>
				<button
					class="btn preset-filled-error-500"
					onclick={handleModalDiscard}
					aria-label="Discard all unsaved changes"
				>
					Discard
				</button>
			</footer>
		</div>
	{/snippet}
</Modal>
<Modal
	open={showNewConnectionModal}
	onOpenChange={(e) => (showNewConnectionModal = e.open)}
	contentBase="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<div
			role="dialog"
			aria-labelledby="new-conn-title"
			aria-describedby="new-conn-desc"
		>
			<header class="flex justify-between">
				<h2 id="new-conn-title" class="h2">Create New AI Connection</h2>
			</header>
			<div id="new-conn-desc" class="sr-only">
				Create a new connection to an AI service for conversations
			</div>
			<form
				class="flex flex-col gap-2"
				onsubmit={(e) => {
					e.preventDefault()
					handleNewConnectionConfirm()
				}}
			>
				<div>
					<label class="font-semibold" for="newConnName">
						Connection Name
					</label>
					<input
						id="newConnName"
						type="text"
						class="input w-full"
						bind:value={newConnectionName}
						placeholder="Enter a descriptive name..."
						aria-required="true"
						aria-describedby="name-help-new"
						onkeydown={(e) => {
							if (e.key === "Enter" && newConnectionName.trim()) {
								handleNewConnectionConfirm()
							}
						}}
					/>
					<div id="name-help-new" class="sr-only">
						Enter a name to identify this AI connection
					</div>
				</div>
				<div>
					<label class="font-semibold" for="newConnType">
						Connection Type
					</label>
					<select
						id="newConnType"
						class="select w-full"
						bind:value={newConnectionType}
						aria-describedby="type-help"
					>
						{#each CONNECTION_TYPES as t}
							<option
								value={t.value}
								disabled={t.value === CONNECTION_TYPE.KOBOLDCPP_MANAGED &&
									!koboldCppSettingsCtx?.settings?.koboldCppManagerEnabled}
							>
								{t.label}{t.value === CONNECTION_TYPE.KOBOLDCPP_MANAGED &&
								!koboldCppSettingsCtx?.settings?.koboldCppManagerEnabled
									? " (Manager disabled)"
									: ""}
							</option>
						{/each}
					</select>
					<div id="type-help" class="sr-only">
						Choose the type of AI service to connect to
					</div>
				</div>
				{#if newConnectionType === CONNECTION_TYPE.OPENAI_CHAT}
					<div class="mt-2">
						<label class="font-semibold" for="oaiChatPreset">
							Service Preset
						</label>
						<select
							id="oaiChatPreset"
							class="select w-full"
							bind:value={newConnectionOAIChatPreset}
							aria-describedby="preset-help"
						>
							{#each OPENAI_CHAT_PRESETS as preset}
								<option value={preset.value}>
									{preset.name}
								</option>
							{/each}
						</select>
						<div id="preset-help" class="sr-only">
							Choose a preset configuration for this AI service
						</div>
					</div>
				{/if}
				{#if !!newConnectionType}
					{@const connectionType = CONNECTION_TYPES.find(
						(t) => t.value === newConnectionType
					)}
					<div
						class="bg-surface-500/25 mt-4 flex flex-col gap-2 rounded p-4"
					>
						<span class="preset-filled-primary-500 p-2">
							Difficulty: {connectionType?.difficulty}
						</span>
						{@html connectionType?.description}
					</div>
				{/if}
			</form>
			<footer class="mt-4 flex justify-end gap-4">
				<button
					type="button"
					class="btn preset-filled-surface-500"
					onclick={handleNewConnectionCancel}
					aria-label="Cancel connection creation"
				>
					Cancel
				</button>
				<button
					type="submit"
					class="btn preset-filled-primary-500"
					onclick={handleNewConnectionConfirm}
					disabled={!newConnectionName.trim()}
					aria-label={newConnectionName.trim()
						? `Create connection named ${newConnectionName}`
						: "Enter a name to create connection"}
				>
					Create
				</button>
			</footer>
		</div>
	{/snippet}
</Modal>
<Modal
	open={showDeleteModal}
	onOpenChange={(e) => (showDeleteModal = e.open)}
	contentBase="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-w-lg w-full"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<div
			role="alertdialog"
			aria-labelledby="delete-title"
			aria-describedby="delete-desc"
		>
			<header class="flex justify-between">
				<h2 id="delete-title" class="h2">Delete AI Connection</h2>
			</header>
			<article>
				<p id="delete-desc" class="opacity-60">
					Are you sure you want to delete the connection "{connection?.name}"?
					This action cannot be undone and will permanently remove
					this AI connection.
				</p>
			</article>
			<footer class="flex justify-end gap-4">
				<button
					type="button"
					class="btn preset-filled-surface-500"
					onclick={handleDeleteModalCancel}
					aria-label="Cancel deletion and keep the connection"
				>
					Cancel
				</button>
				<button
					type="button"
					class="btn preset-filled-error-500"
					onclick={handleDeleteModalConfirm}
					aria-label="Permanently delete this AI connection"
				>
					Delete Connection
				</button>
			</footer>
		</div>
	{/snippet}
</Modal>
