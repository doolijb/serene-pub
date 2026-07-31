<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import OllamaForm from "$lib/client/connectionForms/OllamaForm.svelte"
	import OpenAIForm from "$lib/client/connectionForms/OpenAIForm.svelte"
	import LmStudioForm from "$lib/client/connectionForms/LMStudioForm.svelte"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import LlamaCppForm from "$lib/client/connectionForms/LlamaCppForm.svelte"
	import KoboldCppForm from "$lib/client/connectionForms/KoboldCppForm.svelte"
	import KoboldCppManagedForm from "$lib/client/connectionForms/KoboldCppManagedForm.svelte"
	import AnthropicForm from "$lib/client/connectionForms/AnthropicForm.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import {
		CONNECTION_DEFAULTS,
		OPENAI_CHAT_PRESETS,
		stableStringify
	} from "$lib/shared/utils/connectionDefaults"
	import EmbeddingConnectionPanel from "./EmbeddingConnectionPanel.svelte"
	import ConnectionServicePicker from "./ConnectionServicePicker.svelte"
	import type { ConnectionServiceItem } from "$lib/shared/utils/connectionServiceItems"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let panelsCtx: PanelsCtx = getContext("panelsCtx")
	let koboldCppSettingsCtx: KoboldCppSettingsCtx = getContext(
		"koboldCppSettingsCtx"
	)

	const socket = useTypedSocket()

	// ── View state ──────────────────────────────────────────────────────────
	// "connections" (LLM/Text Generation) and "embedding" are categories under
	// one Connections sidebar, mirroring PromptsSidebar's card-list pattern.
	type View = "index" | "connections" | "embedding"
	let view = $state<View>("index")

	// --- State ---
	let connectionsList: Partial<SelectConnection>[] = $state([])
	let isLoading = $state(true)
	let connection: any = $state()
	let originalConnection: any = $state()
	let unsavedChanges = $derived.by(() => {
		if (!connection || !originalConnection) return false
		// stableStringify (not JSON.stringify) so two logically-identical
		// connections with differently-ordered object keys — e.g. because a
		// form rebuilt extraJson from its own fields — don't register as a
		// false "unsaved changes."
		return (
			stableStringify(connection) !== stableStringify(originalConnection)
		)
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
	let newConnectionService: ConnectionServiceItem | undefined = $state()
	let showDeleteModal = $state(false)

	// Screen reader announcements
	let announcements = $state("")

	// Which connection is currently shown in the form (local view state)
	let selectedConnectionId = $state<number | null>(null)
	// The system-wide default connection
	let defaultConnectionId = $derived(
		systemSettingsCtx.settings?.defaultConnectionId ?? null
	)
	// Shown as the "active" badge on the index screen's LLM/Text Generation card
	let defaultConnectionName = $derived(
		connectionsList.find((c) => c.id === defaultConnectionId)?.name ?? null
	)
	// A Managed KoboldCPP connection can't be set default while the manager is off
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
		const selected = connectionsList.find(
			(c) => c.id === selectedConnectionId
		)
		if (selected) announce(`Default connection set to: ${selected.name}`)
	}
	function handleNew() {
		newConnectionName = ""
		newConnectionService = undefined
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
		if (!newConnectionService) {
			toaster.error({ title: "Choose an AI service to connect to" })
			return
		}
		const { type, presetValue } = newConnectionService
		if (type === CONNECTION_TYPE.OPENAI_CHAT) {
			const preset = OPENAI_CHAT_PRESETS.find(
				(p) => p.value === presetValue
			)
			if (!preset) {
				toaster.error({ title: "Invalid OpenAI Chat preset" })
				return
			}
		}
		const newConn = {
			name: newConnectionName.trim(),
			type,
			enabled: true,
			...(type === CONNECTION_TYPE.OPENAI_CHAT
				? OPENAI_CHAT_PRESETS.find((p) => p.value === presetValue)
						?.connectionDefaults
				: CONNECTION_DEFAULTS[type] || {})
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
	function handleOnClose(): Promise<boolean> {
		// The embedding category has no bind-and-save-later fields (every
		// action there saves immediately), so only the connections category's
		// edit form needs an unsaved-changes guard.
		if (view !== "connections" || !unsavedChanges)
			return Promise.resolve(true)
		showConfirmModal = true
		return new Promise<boolean>((resolve) => {
			confirmResolve = resolve
		})
	}
	async function navigateBack() {
		if (!(await handleOnClose())) return
		view = "index"
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
		socket.emit("connections:refreshModels", { connection })
	}

	function handleConnectionsList(msg: Sockets.Connections.List.Response) {
		connectionsList = msg.connectionsList
			.slice()
			.sort((a, b) => a.name!.localeCompare(b.name!))
		isLoading = false
	}
	// The generic **:error listener in Layout.svelte already toasts this —
	// this just stops the spinner from spinning forever if the initial
	// fetch fails, so it settles into the (accurate enough) empty state.
	function handleConnectionsListError() {
		isLoading = false
	}
	function handleConnectionsRefreshModelsError() {
		refreshModelsResult = { error: "Failed to refresh models" }
	}
	function handleConnectionsGet(msg: Sockets.Connections.Get.Response) {
		// connections:get is emitToUser — broadcast to every open tab for
		// this user, not just the requester. Without this check, another
		// tab loading/saving a different connection silently overwrites
		// this tab's in-progress edit.
		if (msg.connection?.id !== selectedConnectionId) return
		connection = { ...msg.connection }
		originalConnection = { ...msg.connection }
	}
	function handleConnectionsTest(msg: Sockets.Connections.Test.Response) {
		if (msg.connectionId !== selectedConnectionId) return
		testResult = {
			ok: msg.ok,
			error: msg.error ?? undefined,
			models: msg.models
		}
	}
	function handleConnectionsRefreshModels(
		msg: Sockets.Connections.RefreshModels.Response
	) {
		if (msg.connectionId !== selectedConnectionId) return
		refreshModelsResult = {
			models: msg.models || [],
			error: msg.error ?? undefined
		}
	}
	function handleConnectionsUpdate(msg: Sockets.Connections.Update.Response) {
		if (msg.connection?.id !== selectedConnectionId) return
		// Reset the unsaved-changes baseline synchronously with the save's
		// own ack, same shape handleConnectionsGet uses — msg.connection is
		// now the same fully-processed (backfilled + decrypted) record
		// connections:get produces, safe to use directly. Without this, the
		// dirty flag only cleared via a second, incidental connections:get
		// broadcast the server happens to also send — a race that could show
		// the discard-changes modal right after a successful save.
		connection = { ...msg.connection }
		originalConnection = { ...msg.connection }
		toaster.success({ title: "Connection Updated" })
		announce(`Connection ${connection?.name} has been updated successfully`)
	}
	function handleConnectionsDelete(msg: Sockets.Connections.Delete.Response) {
		// Only react when the delete actually targeted the connection this
		// tab currently has open — otherwise an unrelated delete in another
		// tab would blow away this tab's in-progress edit and show a
		// misleading "deleted" toast for the wrong connection.
		if (msg.id !== selectedConnectionId) return
		const deletedName = connection?.name
		toaster.success({ title: "Connection Deleted" })
		announce(`Connection ${deletedName} has been permanently deleted`)
		connection = undefined
		originalConnection = undefined
		// Fall back to viewing the default if one exists
		const fallbackId =
			defaultConnectionId && defaultConnectionId !== msg.id
				? defaultConnectionId
				: null
		selectedConnectionId = fallbackId
		if (fallbackId) socket.emit("connections:get", { id: fallbackId })
	}
	function handleConnectionsCreate(msg: Sockets.Connections.Create.Response) {
		toaster.success({ title: "Connection Created" })
		announce(
			`New connection ${msg.connection?.name} has been created successfully`
		)
		// View the newly created connection
		if (msg.connection?.id) {
			selectedConnectionId = msg.connection.id
			socket.emit("connections:get", { id: msg.connection.id })
		}
	}
	function handleConnectionsSetUserActive(
		msg: Sockets.Connections.SetUserActive.Response
	) {
		// Update local system settings context so the default indicator updates
		const s = systemSettingsCtx.settings
		if (s) {
			systemSettingsCtx.settings = {
				...s,
				defaultConnectionId: msg.id ?? null
			}
		}
		if (msg.id) toaster.success({ title: "Default connection updated" })
	}

	onMount(() => {
		socket.on("connections:list", handleConnectionsList)
		socket.on("connections:list:error", handleConnectionsListError)
		socket.on(
			"connections:refreshModels:error",
			handleConnectionsRefreshModelsError
		)
		socket.on("connections:get", handleConnectionsGet)
		socket.on("connections:test", handleConnectionsTest)
		socket.on("connections:refreshModels", handleConnectionsRefreshModels)
		socket.on("connections:update", handleConnectionsUpdate)
		socket.on("connections:delete", handleConnectionsDelete)
		socket.on("connections:create", handleConnectionsCreate)
		socket.on("connections:setUserActive", handleConnectionsSetUserActive)
		socket.emit("connections:list", {})
		// Seed the view: digest.connectionId (from external nav, e.g. Ollama
		// Manager's "open connection sidebar") always means "go straight to the
		// connections category," taking priority over the default. Otherwise
		// digest.connectionsView (set by System Settings' Embeddings toggle and
		// the onboarding wizard) routes straight to a specific category. If
		// neither is set, land on the index/category-picker screen.
		const digestId = panelsCtx.digest.connectionId ?? null
		const initialId =
			digestId ?? systemSettingsCtx.settings?.defaultConnectionId ?? null
		if (digestId) {
			panelsCtx.digest.connectionId = undefined
			view = "connections"
		} else if (panelsCtx.digest.connectionsView) {
			view = panelsCtx.digest.connectionsView
			panelsCtx.digest.connectionsView = undefined
		}
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
		socket.off("connections:list", handleConnectionsList)
		socket.off("connections:list:error", handleConnectionsListError)
		socket.off(
			"connections:refreshModels:error",
			handleConnectionsRefreshModelsError
		)
		socket.off("connections:get", handleConnectionsGet)
		socket.off("connections:test", handleConnectionsTest)
		socket.off(
			"connections:refreshModels",
			handleConnectionsRefreshModels
		)
		socket.off("connections:update", handleConnectionsUpdate)
		socket.off("connections:delete", handleConnectionsDelete)
		socket.off("connections:create", handleConnectionsCreate)
		socket.off(
			"connections:setUserActive",
			handleConnectionsSetUserActive
		)
		onclose = undefined
	})
</script>

{#if view === "index"}
	<div class="text-foreground flex h-full flex-col gap-3 p-4">
		<p class="text-muted-foreground text-sm">
			Select a connection category to view and edit its configurations.
		</p>

		<!-- LLM / Text Generation card -->
		<button
			class="card preset-tonal hover:preset-tonal-primary group w-full cursor-pointer rounded-xl p-4 text-left transition-all"
			onclick={() => (view = "connections")}
		>
			<div class="flex items-start gap-3">
				<div
					class="bg-primary-500/10 text-primary-500 mt-0.5 shrink-0 rounded-lg p-2"
				>
					<Icons.Cable size={20} />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-2">
						<span class="font-semibold">LLM / Text Generation</span>
						<Icons.ChevronRight
							size={16}
							class="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5"
						/>
					</div>
					<p class="text-muted-foreground mt-0.5 text-sm">
						Connections used for chat, summarization, and narration.
					</p>
					{#if defaultConnectionName}
						<div class="mt-2 flex items-center gap-1.5">
							<Icons.CheckCircle
								size={12}
								class="text-success-500 shrink-0"
							/>
							<span
								class="text-success-600 dark:text-success-400 truncate text-xs font-medium"
							>
								{defaultConnectionName}
							</span>
						</div>
					{/if}
				</div>
			</div>
		</button>

		<!-- Embedding card — hidden until an admin has actually enabled
		     embeddings (via System Settings or the onboarding wizard), both of
		     which route straight into this category via digest.connectionsView
		     rather than through this card. -->
		{#if systemSettingsCtx.settings?.vectorizationEnabled}
			<button
				class="card preset-tonal hover:preset-tonal-primary group w-full cursor-pointer rounded-xl p-4 text-left transition-all"
				onclick={() => (view = "embedding")}
			>
				<div class="flex items-start gap-3">
					<div
						class="bg-primary-500/10 text-primary-500 mt-0.5 shrink-0 rounded-lg p-2"
					>
						<Icons.Zap size={20} />
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-center justify-between gap-2">
							<span class="font-semibold">Embedding</span>
							<Icons.ChevronRight
								size={16}
								class="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5"
							/>
						</div>
						<p class="text-muted-foreground mt-0.5 text-sm">
							RAG embedding model, queue, and configuration.
						</p>
					</div>
				</div>
			</button>
		{/if}
	</div>
{:else if view === "embedding"}
	<div class="flex h-full flex-col">
		<div class="flex items-center gap-2 px-4 pt-4 pb-2">
			<button
				class="btn btn-sm preset-filled-surface-400-600 p-2"
				onclick={() => (view = "index")}
				title="Back"
				aria-label="Back to connection types"
			>
				<Icons.ChevronLeft size={16} />
			</button>
			<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">
				Embedding
			</h2>
		</div>
		<div class="min-h-0 flex-1 pt-2">
			<EmbeddingConnectionPanel />
		</div>
	</div>
{:else}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="text-foreground flex h-full flex-col"
		role="main"
		aria-label="AI Connections Management"
		onkeydown={handleKeydown}
	>
		<!-- Screen reader announcements -->
		<div aria-live="polite" aria-atomic="true" class="sr-only">
			{announcements}
		</div>
		<div class="flex items-center gap-2 px-4 pt-4 pb-2">
			<button
				class="btn btn-sm preset-filled-surface-400-600 p-2"
				onclick={navigateBack}
				title="Back"
				aria-label="Back to connection types"
			>
				<Icons.ChevronLeft size={16} />
			</button>
			<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">
				LLM / Text Generation
			</h2>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
			<div class="mb-2">
				<div
					class="flex justify-between gap-2"
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
							aria-describedby={unsavedChanges
								? "reset-help"
								: undefined}
						>
							<Icons.RefreshCcw size={16} aria-hidden="true" />
							Reset
						</button>
						{#if unsavedChanges}
							<div id="reset-help" class="sr-only">
								Resets all unsaved changes to the selected
								connection
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
			<div class="mb-4" class:hidden={!connectionsList.length}>
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
						{@const typeLabel =
							CONNECTION_TYPE.options.find(
								(t) => t.value === c.type
							)?.label ?? c.type}
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
									selectedConnectionId ===
										defaultConnectionId ||
									managedButDisabled}
								title={managedButDisabled
									? "KoboldCPP Manager must be enabled to use this connection"
									: selectedConnectionId ===
										  defaultConnectionId
										? "Already the default connection"
										: "Set as default connection"}
								aria-label="Set selected connection as default"
							>
								<Icons.Star
									size={14}
									aria-hidden="true"
									fill={selectedConnectionId ===
									defaultConnectionId
										? "currentColor"
										: "none"}
								/>
								{selectedConnectionId === defaultConnectionId
									? "Default"
									: "Set Default"}
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
					<Icons.Loader2
						size={20}
						class="text-surface-400 animate-spin"
					/>
				</div>
			{:else if !connectionsList.length}
				<EmptyState
					icon={Icons.Cable}
					message="No AI connections yet — create one to get started with AI conversations."
				/>
			{/if}
		</div>
	</div>
{/if}

<Dialog
	open={showConfirmModal}
	onOpenChange={(e) => (showConfirmModal = e.open)}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-lg space-y-6 p-6 shadow-xl"
			>
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
							Your connection has unsaved changes. Are you sure
							you want to discard them? This action cannot be
							undone.
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
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
<Dialog
	open={showNewConnectionModal}
	onOpenChange={(e) => (showNewConnectionModal = e.open)}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 max-h-[90vh] w-full max-w-2xl space-y-6 overflow-y-auto p-6 shadow-xl"
			>
				<div
					role="dialog"
					aria-labelledby="new-conn-title"
					aria-describedby="new-conn-desc"
				>
					<header class="mb-[1em] flex justify-between">
						<h2 id="new-conn-title" class="h2">
							Create New AI Connection
						</h2>
					</header>
					<div id="new-conn-desc" class="sr-only">
						Create a new connection to an AI service for
						conversations
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
									if (
										e.key === "Enter" &&
										newConnectionName.trim()
									) {
										handleNewConnectionConfirm()
									}
								}}
							/>
							<div id="name-help-new" class="sr-only">
								Enter a name to identify this AI connection
							</div>
						</div>
						<div>
							<ConnectionServicePicker
								label="AI Service"
								bind:selectedItem={newConnectionService}
							/>
						</div>
						{#if newConnectionService}
							<div
								class="bg-surface-500/25 mt-4 flex flex-col gap-2 rounded p-4"
							>
								<span class="preset-filled-primary-500 p-2">
									Difficulty: {newConnectionService.difficulty}
								</span>
								{@html newConnectionService.description}
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
							disabled={!newConnectionName.trim() ||
								!newConnectionService}
							aria-label={!newConnectionName.trim()
								? "Enter a name to create connection"
								: !newConnectionService
									? "Choose an AI service to create connection"
									: `Create connection named ${newConnectionName}`}
						>
							Create
						</button>
					</footer>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
<Dialog open={showDeleteModal} onOpenChange={(e) => (showDeleteModal = e.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-lg space-y-6 p-6 shadow-xl"
			>
				<div
					role="alertdialog"
					aria-labelledby="delete-title"
					aria-describedby="delete-desc"
				>
					<header class="flex justify-between">
						<h2 id="delete-title" class="h2">
							Delete AI Connection
						</h2>
					</header>
					<article>
						<p id="delete-desc" class="opacity-60">
							Are you sure you want to delete the connection "{connection?.name}"?
							This action cannot be undone and will permanently
							remove this AI connection.
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
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
