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
	import ImageConnectionForm from "$lib/client/connectionForms/ImageConnectionForm.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import {
		CONNECTION_DEFAULTS,
		OPENAI_CHAT_PRESETS,
		stableStringify
	} from "$lib/shared/utils/connectionDefaults"
	import ConnectionCapabilities from "$lib/client/components/connections/ConnectionCapabilities.svelte"
	import EmbeddingConnectionPanel from "./EmbeddingConnectionPanel.svelte"
	import ConnectionServicePicker from "./ConnectionServicePicker.svelte"
	import {
		isKoboldCppManagedType,
		type ConnectionServiceItem
	} from "$lib/shared/utils/connectionServiceItems"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
		/** Deep-link: open the new-connection flow on mount (admin create page).
		 *  Selecting a specific connection rides `panelsCtx.digest.connectionId`,
		 *  the mechanism that already exists for it. */
		startNew?: boolean
	}

	let { onclose = $bindable(), startNew = false }: Props = $props()
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

	// Which modality the "connections" view is managing — text (LLMs) or image
	// generation. The two share one management view, filtered by this; the index
	// cards set it. Image connections never take part in the text default.
	let connectionModality = $state<"text-gen" | "image-gen">("text-gen")
	let isImageView = $derived(connectionModality === "image-gen")
	function openCategory(m: "text-gen" | "image-gen") {
		connectionModality = m
		view = "connections"
	}

	// --- State ---
	let connectionsList: Partial<SelectConnection>[] = $state([])
	// The connections shown in the current category view (text vs image).
	let viewConnections = $derived(
		connectionsList.filter(
			(c) =>
				CONNECTION_TYPE.modalityOf(c.type as string) ===
				connectionModality
		)
	)
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
	// Set only when this panel was opened pointing AT a connection (the digest
	// seeding in onMount), and consumed by the first connections:get for that
	// id — see handleConnectionsGet. Not $state: nothing renders from it.
	let deepLinkedConnectionId: number | null = null
	/**
	 * Which capability this category's star registers.
	 *
	 * The star used to mean "the default connection", full stop — one starred
	 * row the app used for whatever it happened to need. There is no such
	 * thing: one KoboldCPP row does chat, vision, image generation, speech and
	 * transcription from one process, so starring it said nothing about which
	 * of the five was meant. The category the user is standing in is what says
	 * it, which is why this is derived from the modality and not from the
	 * connection.
	 */
	let starCapability = $derived(isImageView ? "text->image" : "text->text")
	// The instance default for THIS category's capability. Read from
	// `capabilityDefaults` — the only place a default lives since 0181 — never
	// from a column on the settings row.
	let defaultConnectionId = $derived(
		systemSettingsCtx.capabilityDefaults?.[starCapability]?.connectionId ??
			null
	)
	// Shown as the "active" badge on the index screen's LLM/Text Generation
	// card. Always the CHAT default, whichever category is open: the card is
	// the text one, and reading `defaultConnectionId` here would blank it the
	// moment somebody browsed the image category.
	let defaultConnectionName = $derived(
		connectionsList.find(
			(c) =>
				c.id ===
				(systemSettingsCtx.capabilityDefaults?.["text->text"]
					?.connectionId ?? null)
		)?.name ?? null
	)
	// A Managed KoboldCPP connection can't be set default while the manager is
	// off — the image one no less than the text one. Both name a file in the
	// Manager's models directory and are loaded through its admin API, so with
	// the Manager switched off neither can generate anything.
	let managedButDisabled = $derived(
		isKoboldCppManagedType(connection?.type) &&
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

	/**
	 * Register the selected connection as this category's default.
	 *
	 * The compensation for deleting the auto-star, and the reason it is one
	 * click rather than a trip to Admin → Defaults: nothing picks a connection
	 * because it exists any more, so the first Send after creating one used to
	 * work by accident and now fails by design. A button that says "use this
	 * for chat" on the screen where the connection was just made is what keeps
	 * that from reading as a regression.
	 *
	 * `capability` is a REQUIRED param and is not derivable from the
	 * connection — see the socket type. The category supplies it.
	 */
	function handleSetDefault() {
		if (!selectedConnectionId) return
		socket.emit("connections:setDefault", {
			capability: starCapability,
			id: selectedConnectionId
		})
		const selected = connectionsList.find(
			(c) => c.id === selectedConnectionId
		)
		if (selected)
			announce(
				`${selected.name} will be used for ${isImageView ? "image generation" : "chat"}`
			)
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
		const { type, presetValue, presetSlug } = newConnectionService
		if (type === CONNECTION_TYPE.OPENAI_CHAT) {
			const preset = OPENAI_CHAT_PRESETS.find(
				(p) => p.value === presetValue
			)
			if (!preset) {
				toaster.error({ title: "Invalid OpenAI Session preset" })
				return
			}
		}
		const newConn = {
			name: newConnectionName.trim(),
			type,
			enabled: true,
			// Which named service this is, so capability resolution has a preset
			// layer to consult. Undefined for a native type and for the custom
			// entry, and undefined is the right answer there: NULL means custom.
			preset: presetSlug,
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
	async function handleModalDiscard() {
		showConfirmModal = false
		// Resolving confirmResolve is what lets Layout.svelte's closePanel()
		// proceed to unmount this whole component (the caller awaits
		// onLeftPanelClose(), then swaps the panel). Traced the actual
		// "derived_inert" warning this used to log (via a console.warn hook
		// capturing a stack trace, not guessed) to Skeleton UI's Dialog
		// FocusTrap — closing the dialog schedules its own async
		// return-focus bookkeeping (setReturnFocus, inside its Svelte
		// adapter), which runs on the *library's* timing, not a Svelte
		// effect flush — a plain tick() here doesn't wait for it. If this
		// component (including the dialog) gets unmounted first, that
		// bookkeeping reads a derived value whose owning effect is already
		// gone. A double rAF reliably lands after that pending frame of
		// work has run, same as the well-known "wait two frames for
		// third-party layout/focus code to settle" pattern elsewhere.
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		)
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
		// Follow a DEEP-LINKED connection into its own category. Arriving with
		// one from the other modality is only possible that way (the picker
		// below offers the current modality only), and left on text-gen the
		// picker would have no <option> matching it — rendering blank — while
		// Set Default would offer to star an image connection as the system's
		// text default.
		//
		// Scoped to that one id, and cleared, deliberately: applying it to
		// every load would let the ordinary mount-time fetch of the text
		// default land AFTER the user has picked the Image category and yank
		// them back to the text list.
		if (msg.connection.id === deepLinkedConnectionId) {
			deepLinkedConnectionId = null
			connectionModality = CONNECTION_TYPE.modalityOf(msg.connection.type)
		}
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
	function handleConnectionsSetDefault(
		msg: Sockets.Connections.SetDefault.Response
	) {
		// Patch the local copy so the star moves on this frame rather than when
		// the server's systemSettings:get push lands. It patches
		// `capabilityDefaults` and NOT a settings column — patching the settings
		// row is what this whole change removes, and a patch of the wrong copy
		// would look like a working optimistic update that never actually
		// applies.
		//
		// Merged per capability, never replaced wholesale: the response carries
		// one capability, and writing `{[capability]: …}` alone would drop every
		// other registration from the client's copy until the next full push.
		systemSettingsCtx.capabilityDefaults = {
			...systemSettingsCtx.capabilityDefaults,
			[msg.capability]: {
				...(systemSettingsCtx.capabilityDefaults?.[msg.capability] ?? {
					connectionId: null,
					samplingConfigId: null
				}),
				connectionId: msg.id ?? null
			}
		}
		if (msg.id) toaster.success({ title: "Default connection updated" })
	}

	// ── Stop guards on this connection (18 §4b) ─────────────────────────────
	// Loaded per selected connection; attach/detach answer with the refreshed
	// pair of lists, so the two can never disagree.
	let connScripts = $state<Sockets.Connections.Scripts.Response | null>(null)
	const handleConnScripts = (res: Sockets.Connections.Scripts.Response) => {
		connScripts = res
	}
	const handleConnScriptsError = (res: { error?: string }) => {
		if (res.error) toaster.error({ title: res.error })
	}
	$effect(() => {
		if (selectedConnectionId != null) {
			connScripts = null
			socket.emit("connections:scripts", { id: selectedConnectionId })
		}
	})

	onMount(() => {
		socket.on("connections:list", handleConnectionsList)
		socket.on("connections:list:error", handleConnectionsListError)
		socket.on("connections:scripts", handleConnScripts)
		socket.on("connections:attachScript", handleConnScripts)
		socket.on("connections:detachScript", handleConnScripts)
		socket.on("connections:scripts:error", handleConnScriptsError)
		socket.on("connections:attachScript:error", handleConnScriptsError)
		socket.on("connections:detachScript:error", handleConnScriptsError)
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
		socket.on("connections:setDefault", handleConnectionsSetDefault)
		socket.emit("connections:list", {})
		// Seed the view: digest.connectionId (from external nav, e.g. Ollama
		// Manager's "open connection sidebar") always means "go straight to the
		// connections category," taking priority over the default. Otherwise
		// digest.connectionsView (set by System Settings' Embeddings toggle and
		// the onboarding wizard) routes straight to a specific category. If
		// neither is set, land on the index/category-picker screen.
		const digestId = panelsCtx.digest.connectionId ?? null
		// The CHAT default, spelled out rather than read through
		// `defaultConnectionId`: this runs on mount, before any category has
		// been opened, so the derived value would be whatever `isImageView`
		// happens to be at that instant. Landing on the text connection is what
		// this has always done.
		const initialId =
			digestId ??
			systemSettingsCtx.capabilityDefaults?.["text->text"]
				?.connectionId ??
			null
		if (digestId) {
			panelsCtx.digest.connectionId = undefined
			deepLinkedConnectionId = digestId
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

		// Admin create page deep-link: open the new-connection flow at once.
		if (startNew) handleNew()
	})

	onDestroy(() => {
		socket.off("connections:list", handleConnectionsList)
		socket.off("connections:list:error", handleConnectionsListError)
		socket.off("connections:scripts", handleConnScripts)
		socket.off("connections:attachScript", handleConnScripts)
		socket.off("connections:detachScript", handleConnScripts)
		socket.off("connections:scripts:error", handleConnScriptsError)
		socket.off("connections:attachScript:error", handleConnScriptsError)
		socket.off("connections:detachScript:error", handleConnScriptsError)
		socket.off(
			"connections:refreshModels:error",
			handleConnectionsRefreshModelsError
		)
		socket.off("connections:get", handleConnectionsGet)
		socket.off("connections:test", handleConnectionsTest)
		socket.off("connections:refreshModels", handleConnectionsRefreshModels)
		socket.off("connections:update", handleConnectionsUpdate)
		socket.off("connections:delete", handleConnectionsDelete)
		socket.off("connections:create", handleConnectionsCreate)
		socket.off("connections:setDefault", handleConnectionsSetDefault)
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
			class="card preset-filled-surface-100-900 hover:preset-tonal-primary group w-full cursor-pointer rounded-xl p-4 text-left transition-all"
			onclick={() => openCategory("text-gen")}
		>
			<div class="flex items-start gap-3">
				<div
					class="bg-primary-500/10 text-primary-500 mt-0.5 shrink-0 rounded-lg p-2"
				>
					<Icons.Cable size={20} />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-2">
						<span class="font-semibold">Large Language Models</span>
						<Icons.ChevronRight
							size={16}
							class="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5"
						/>
					</div>
					<p class="text-muted-foreground mt-0.5 text-sm">
						Connections used for session, summarization, and
						narration.
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

		<!-- Image Generation card -->
		<button
			class="card preset-filled-surface-100-900 hover:preset-tonal-primary group w-full cursor-pointer rounded-xl p-4 text-left transition-all"
			onclick={() => openCategory("image-gen")}
		>
			<div class="flex items-start gap-3">
				<div
					class="bg-primary-500/10 text-primary-500 mt-0.5 shrink-0 rounded-lg p-2"
				>
					<Icons.Image size={20} />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center justify-between gap-2">
						<span class="font-semibold">Image Generation</span>
						<Icons.ChevronRight
							size={16}
							class="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5"
						/>
					</div>
					<p class="text-muted-foreground mt-0.5 text-sm">
						Local image backends (KoboldCPP, A1111, …) for portraits
						and scene art.
					</p>
				</div>
			</div>
		</button>

		<!-- Embedding card — hidden until an admin has actually enabled
		     embeddings (via System Settings or the onboarding wizard), both of
		     which route straight into this category via digest.connectionsView
		     rather than through this card. -->
		{#if systemSettingsCtx.settings?.vectorizationEnabled}
			<button
				class="card preset-filled-surface-100-900 hover:preset-tonal-primary group w-full cursor-pointer rounded-xl p-4 text-left transition-all"
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
				{isImageView ? "Image Generation" : "LLM / Text Generation"}
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
			<div class="mb-4" class:hidden={!viewConnections.length}>
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
					{#each viewConnections as c}
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
							<!-- One click to register this connection for the
							     category's capability — "Use for Chat" here,
							     "Use for Image generation" in the image list.
							     Rendered in BOTH categories now: nothing picks a
							     connection because it exists, so an image
							     backend that is never registered anywhere is an
							     image backend no run can reach. The named
							     capability is what makes this honest — the old
							     unqualified "Set Default" could only ever mean
							     text, which is why the image half had no button
							     at all. Everything else lives on
							     Admin → Defaults. -->
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
										? `Already used for ${isImageView ? "image generation" : "chat"}`
										: `Use this connection for ${isImageView ? "image generation" : "chat"}`}
								aria-label={`Use this connection for ${isImageView ? "image generation" : "chat"}`}
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
									? "In use"
									: isImageView
										? "Use for Images"
										: "Use for Chat"}
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
						{:else if CONNECTION_TYPE.isImage(connection.type)}
							<!-- One branch for every image backend: the form is
							     generated from what the adapter declares, so a new
							     one needs no case here and no component. -->
							<ImageConnectionForm bind:connection />
						{/if}

						{#if connection.id}
							<!-- Mounted once, here, rather than in each of the nine
							     forms above: this is the one place all nine share,
							     and nine pasted copies would be nine capability
							     sections that drift AND nine connections:test
							     subscriptions racing. It takes the id only —
							     everything it shows is its own fetch, so nothing it
							     does can dirty this form's unsaved-changes
							     baseline. -->
							<ConnectionCapabilities
								connectionId={connection.id}
							/>
							<!-- Stop guards ride the connection (18 §4b): model
							     knowledge — "this endpoint leaks template
							     tokens" — attaches once and reaches every
							     pipeline that runs against it. Order does not
							     matter: stop verdicts reduce to the earliest
							     index whatever their source. -->
							<div class="mt-4 flex flex-col gap-1">
								<span
									class="flex items-center gap-2 font-semibold"
								>
									<Icons.OctagonX
										size={14}
										aria-hidden="true"
									/>
									Stop scripts
								</span>
								<p class="text-muted text-xs">
									Guards that end a streamed reply early — a
									leaked template token, an echoed name. Every
									pipeline using this connection inherits
									them, and the run's receipt names which one
									fired.
								</p>
								{#if !connScripts}
									<p class="text-muted text-xs">Loading…</p>
								{:else}
									{#each connScripts.attached ?? [] as s (s.id)}
										<div
											class="border-surface-200-700 flex items-center gap-2 rounded-lg border px-2 py-1"
										>
											<span
												class="min-w-0 flex-1 truncate text-sm {s.enabled
													? ''
													: 'opacity-50'}"
											>
												{s.name}
											</span>
											{#if !s.enabled}
												<span
													class="text-muted text-[10px]"
													title="Disabled on the scripts page — attached, does nothing."
												>
													off
												</span>
											{/if}
											<button
												type="button"
												class="btn-icon btn-icon-sm preset-tonal-surface shrink-0"
												title="Detach from this connection (the script itself is kept)"
												onclick={() =>
													socket.emit(
														"connections:detachScript",
														{
															id: connection.id,
															scriptId: s.id
														}
													)}
											>
												<Icons.X size={12} />
											</button>
										</div>
									{/each}
									{#if !(connScripts.attached ?? []).length}
										<p class="text-muted text-xs italic">
											None attached.
										</p>
									{/if}
									{#if (connScripts.available ?? []).length}
										<select
											class="select"
											value=""
											onchange={(e) => {
												const v = parseInt(
													e.currentTarget.value,
													10
												)
												if (!Number.isNaN(v))
													socket.emit(
														"connections:attachScript",
														{
															id: connection.id,
															scriptId: v
														}
													)
												e.currentTarget.value = ""
											}}
										>
											<option value="" disabled>
												Attach a stop script…
											</option>
											{#each connScripts.available ?? [] as s (s.id)}
												<option value={String(s.id)}>
													{s.name}
												</option>
											{/each}
										</select>
									{:else}
										<p class="text-muted text-xs">
											Write stop scripts on the
											<a
												class="underline"
												href="/admin/scripts"
											>
												scripts page
											</a>
											.
										</p>
									{/if}
								{/if}
							</div>
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
			{:else if !viewConnections.length}
				<EmptyState
					icon={isImageView ? Icons.Image : Icons.Cable}
					message={isImageView
						? "No image connections yet — add one to generate images."
						: "No AI connections yet — create one to get started with AI conversations."}
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
								label={isImageView
									? "Image Service"
									: "AI Service"}
								initialModality={connectionModality}
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
