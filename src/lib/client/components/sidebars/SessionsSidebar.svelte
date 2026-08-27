<script lang="ts">
	import { getContext, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import EditSessionForm from "../sessionForms/EditSessionForm.svelte"
	import SessionViewPanel from "../sessionForms/SessionViewPanel.svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { goto } from "$app/navigation"
	import { toaster } from "$lib/client/utils/toaster"
	import { page } from "$app/state"
	import SessionListItem from "../listItems/SessionListItem.svelte"
	import SessionsUnsavedChangesModal from "../modals/SessionsUnsavedChangesModal.svelte"
	import EmptyState from "../EmptyState.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
		/** The chat currently open in the main view — pinned and highlighted. */
		sessionId?: number | null
	}
	let { onclose = $bindable(), sessionId = null }: Props = $props()

	let sessions: Sockets.Sessions.List.Response["sessionList"] = $state([])
	let isLoading = $state(true)
	let search = $state("")
	let showEditSessionForm = $state(false)
	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	let searchByCharacterId: number | null = $state(null)
	let searchByPersonaId: number | null = $state(null)
	// embedding/embeddingModel/vectorizedAt are deliberately excluded from
	// the "characters:get"/"personas:get" responses (see charactersGet/
	// personasGet's `columns` restrictions) — these types mirror that
	// rather than hand-declaring the full Select* shape.
	let searchCharacter: Sockets.Characters.Get.Response["character"] =
		$state(null)
	let searchPersona: Sockets.Personas.Get.Response["persona"] = $state(null)
	let editSessionId: number | null = $state(null)
	let viewingId: number | null = $state(null)
	let returnToViewId: number | null = $state(null)
	let sessionFormHasChanges = $state(false)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	const socket = useTypedSocket()

	// Filtered sessions derived from search
	let filteredSessions: Sockets.Sessions.List.Response["sessionList"] =
		$state([])

	// The open chat pinned to the top, so it is always at hand and never
	// scrolled past. Highlight rides along via `active` on each item.
	const orderedSessions = $derived.by(() => {
		if (sessionId == null) return filteredSessions
		const active = filteredSessions.filter((s) => s.id === sessionId)
		if (!active.length) return filteredSessions
		return [...active, ...filteredSessions.filter((s) => s.id !== sessionId)]
	})

	socket.on("sessions:list", (msg: Sockets.Sessions.List.Response) => {
		sessions = msg.sessionList || []
		isLoading = false
	})
	// The generic **:error listener in Layout.svelte already toasts this —
	// this just stops the spinner from spinning forever if the initial
	// fetch fails, so it settles into the (accurate enough) empty state.
	socket.on("sessions:list:error", () => {
		isLoading = false
	})

	async function handleOnClose() {
		if (sessionFormHasChanges) {
			showUnsavedChangesModal = true
			return new Promise<boolean>((resolve) => {
				confirmCloseSidebarResolve = resolve
			})
		} else {
			// Remove "sessions-by-characterId" and "sessions-by-personaId" from search params
			const url = new URL(window.location.href)
			url.searchParams.delete("sessions-by-characterId")
			url.searchParams.delete("sessions-by-personaId")
			goto(url.toString(), { replaceState: true })

			return true
		}
	}

	function handleCreateClick(
		event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }
	) {
		// Clear tutorial flag when user interacts with the highlighted button
		if (panelsCtx.digest.tutorial) {
			panelsCtx.digest.tutorial = false
		}

		showEditSessionForm = true
	}

	function handleEditClick(sessionId: number) {
		showEditSessionForm = true
		editSessionId = sessionId
		viewingId = null
	}

	function handleViewClick(sessionId: number) {
		viewingId = sessionId
	}

	function handleEditFromView() {
		returnToViewId = viewingId
		editSessionId = viewingId
		viewingId = null
		showEditSessionForm = true
	}

	function handleOpenSession(sessionId: number) {
		goto(`/sessions/${sessionId}`)
		panelsCtx.fullscreenPanel = null
		if (panelsCtx.isMobileMenuOpen) {
			panelsCtx.isMobileMenuOpen = false
		}
		if (panelsCtx.mobilePanel) {
			panelsCtx.mobilePanel = null
		}
	}

	function handleSessionClick(session: any) {
		// Clicking the already-open chat a second time opens *into* it in the
		// sidebar (its view panel: settings, participants, open) rather than
		// re-navigating to where you already are.
		if (session.id === sessionId) {
			handleViewClick(session.id)
			return
		}
		handleOpenSession(session.id)
	}

	function closeEditForm() {
		showEditSessionForm = false
		editSessionId = null
		sessionFormHasChanges = false
		const returnId = returnToViewId
		returnToViewId = null
		if (returnId) viewingId = returnId
	}

	let showDeleteModal = $state(false)
	let sessionToDelete: number | null = $state(null)
	let isDeleting = $state(false)

	function handleDeleteClick(sessionId: number) {
		sessionToDelete = sessionId
		showDeleteModal = true
	}
	function cancelDelete() {
		showDeleteModal = false
		sessionToDelete = null
	}
	function confirmDelete() {
		// Guard against double-submit (eg. an impatient re-click while the
		// previous delete is still in flight)
		if (isDeleting) return
		if (sessionToDelete != null) {
			if (page.params.id === sessionToDelete.toString()) {
				// If the current session is being deleted, navigate away
				goto("/")
				panelsCtx.fullscreenPanel = null
			}
			isDeleting = true
			socket.emit("sessions:delete", { id: sessionToDelete })
			showDeleteModal = false
			sessionToDelete = null
		}
	}
	socket.on("sessions:delete", (msg) => {
		isDeleting = false
		sessions = sessions.filter((c) => c.id !== msg.id)
		toaster.success({ title: "Session deleted" })
	})
	// Not shown to the user here - the generic onAny catch-all in Layout.svelte
	// already toasts on "sessions:delete:error"; this listener just clears the
	// in-flight guard so a failed delete doesn't leave the button stuck.
	socket.on("sessions:delete:error", () => {
		isDeleting = false
	})

	function handleCloseModalDiscard() {
		showUnsavedChangesModal = false
		// Clear search params when discarding changes and closing
		const url = new URL(window.location.href)
		url.searchParams.delete("sessions-by-characterId")
		url.searchParams.delete("sessions-by-personaId")
		goto(url.toString(), { replaceState: true })

		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(true)
	}

	function handleCloseModalCancel() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
	}

	function handleUnsavedChangesOnOpenChange(e: { open: boolean }) {
		if (!e.open) {
			showUnsavedChangesModal = false
			if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
		}
	}

	$effect(() => {
		const lower = search.toLowerCase()

		let filtered = [...sessions]

		// If searching by character ID, filter sessions that include that character
		if (searchByCharacterId) {
			filtered = filtered.filter((session) =>
				session.sessionCharacters?.some(
					(cc) => cc.character?.id === searchByCharacterId
				)
			)
		}

		// If searching by persona ID, filter sessions that include that persona
		if (searchByPersonaId) {
			filtered = filtered.filter((session) =>
				session.sessionPersonas?.some(
					(cp) => cp.persona?.id === searchByPersonaId
				)
			)
		}

		filteredSessions = filtered.filter((session) => {
			const sessionName = session.name?.toLowerCase() || ""
			const personaNames = (session.sessionPersonas || [])
				.map((cp) => cp.persona?.name?.toLowerCase() || "")
				.join(" ")
			const characterNames = (session.sessionCharacters || [])
				.map((cc) => cc.character?.name?.toLowerCase() || "")
				.join(" ")
			const tagNames = (session.sessionTags || [])
				.map((ct: any) => ct.tag?.name?.toLowerCase() || "")
				.join(" ")
			return (
				sessionName.includes(lower) ||
				personaNames.includes(lower) ||
				characterNames.includes(lower) ||
				tagNames.includes(lower)
			)
		})
	})

	$effect(() => {
		if (panelsCtx.digest.sessionId) {
			showEditSessionForm = true
			editSessionId = panelsCtx.digest.sessionId
			delete panelsCtx.digest.sessionId
			delete panelsCtx.digest.sessionCharacterId
			delete panelsCtx.digest.sessionPersonaId
		}
	})

	$effect(() => {
		if (panelsCtx.digest.sessionCharacterId) {
			searchByCharacterId = panelsCtx.digest.sessionCharacterId
		}
		if (panelsCtx.digest.sessionPersonaId) {
			searchByPersonaId = panelsCtx.digest.sessionPersonaId
		}
		delete panelsCtx.digest.sessionCharacterId
		delete panelsCtx.digest.sessionPersonaId
	})

	$effect(() => {
		if (searchByCharacterId) {
			const requestedId = searchByCharacterId
			// TypedSocket has no `.once()` — self-unsubscribe after the first
			// response to replicate the same "fire once" semantics. Also
			// guards against a stale response: if searchByCharacterId changes
			// again before this response arrives, a second listener for a
			// different id registers alongside this one — without the id
			// check, whichever response lands first (or last) can overwrite
			// searchCharacter with data for the wrong id.
			const handleCharacterGet = (
				msg: Sockets.Characters.Get.Response
			) => {
				socket.off("characters:get", handleCharacterGet)
				if (msg.character?.id !== requestedId) return
				searchCharacter = msg.character
			}
			socket.on("characters:get", handleCharacterGet)
			const charIdReq: Sockets.Characters.Get.Params = {
				id: searchByCharacterId
			}
			socket.emit("characters:get", charIdReq)

			// Covers the case where searchByCharacterId changes again (or the
			// component unmounts) before a response ever arrives — the
			// self-unsub above only fires on a real response.
			return () => socket.off("characters:get", handleCharacterGet)
		}
	})

	$effect(() => {
		if (searchByPersonaId) {
			const requestedId = searchByPersonaId
			// Same staleness guard + always-cleanup as the character search
			// effect above.
			const handlePersonaGet = (msg: Sockets.Personas.Get.Response) => {
				socket.off("personas:get", handlePersonaGet)
				if (msg.persona?.id !== requestedId) return
				searchPersona = msg.persona
			}
			socket.on("personas:get", handlePersonaGet)
			const personaIdReq: Sockets.Personas.Get.Params = {
				id: searchByPersonaId
			}
			socket.emit("personas:get", personaIdReq)

			return () => socket.off("personas:get", handlePersonaGet)
		}
	})

	$effect(() => {
		if (editSessionId && !showEditSessionForm) {
			editSessionId = null
		}
	})

	onMount(() => {
		socket.emit("sessions:list", {})
		onclose = handleOnClose
	})
</script>

<div class="text-foreground flex h-full flex-col p-4">
	{#if showEditSessionForm}
		<EditSessionForm
			bind:showEditSessionForm
			bind:editSessionId
			bind:hasChanges={sessionFormHasChanges}
			onClose={closeEditForm}
		/>
	{:else if viewingId}
		{#key viewingId}
			<SessionViewPanel
				sessionId={viewingId}
				onBack={() => (viewingId = null)}
				onEdit={handleEditFromView}
				onOpen={() => handleOpenSession(viewingId!)}
			/>
		{/key}
	{:else}
		<div class="mb-2 flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500 {panelsCtx.digest
					.tutorial
					? 'ring-primary-500/50 animate-pulse ring-4'
					: ''}"
				onclick={handleCreateClick}
				title="Create New Session"
			>
				<Icons.Plus size={16} />
				New
			</button>
		</div>
		<div class="mb-4 flex items-center gap-2">
			<input
				class="input w-full"
				type="text"
				placeholder="Search sessions, personas, characters, tags..."
				aria-label="Search sessions"
				bind:value={search}
			/>
		</div>
		{#if searchCharacter}
			<button
				class="btn btn-sm preset-filled-secondary-500 mb-2"
				onclick={() => {
					searchByCharacterId = null
					searchCharacter = null
					page.url.searchParams.delete("sessions-by-characterId")
				}}
			>
				<Icons.X size={16} />
				{searchCharacter.nickname || searchCharacter.name}
			</button>
		{/if}
		{#if searchPersona}
			<button
				class="btn btn-sm preset-filled-secondary-500 mb-2"
				onclick={() => {
					searchByPersonaId = null
					searchPersona = null
					page.url.searchParams.delete("sessions-by-personaId")
				}}
			>
				<Icons.X size={16} />
				{searchPersona.name}
			</button>
		{/if}
		<div class="flex-1 overflow-y-auto">
			{#if isLoading}
				<div class="flex items-center justify-center py-8">
					<Icons.Loader2
						size={20}
						class="text-surface-400 animate-spin"
					/>
				</div>
			{:else if filteredSessions.length === 0}
				<EmptyState
					icon={Icons.MessageSquareText}
					message={search || searchByCharacterId || searchByPersonaId
						? "No sessions found matching your filters."
						: "No sessions yet — start one to get roleplaying."}
					ctaLabel={search || searchByCharacterId || searchByPersonaId
						? undefined
						: "New Session"}
					onCta={search || searchByCharacterId || searchByPersonaId
						? undefined
						: () => (showEditSessionForm = true)}
				/>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each orderedSessions as session (session.id)}
						<SessionListItem
							{session}
							active={session.id === sessionId}
							onclick={handleSessionClick}
							onEdit={handleEditClick}
							onDelete={handleDeleteClick}
						/>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<Dialog open={showDeleteModal} onOpenChange={(e) => (showDeleteModal = e.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
			>
				<div class="p-6">
					<h2 class="mb-2 text-lg font-bold">Delete Session?</h2>
					<p class="mb-4">
						Are you sure you want to delete this session and all of
						its messages? This action cannot be undone.
					</p>
					<div class="flex justify-end gap-2">
						<button
							class="btn preset-filled-surface-500"
							onclick={cancelDelete}
							disabled={isDeleting}
						>
							Cancel
						</button>
						<button
							class="btn preset-filled-error-500"
							onclick={confirmDelete}
							disabled={isDeleting}
						>
							{#if isDeleting}
								<Icons.Loader2
									size={16}
									class="animate-spin"
									aria-hidden="true"
								/>
							{/if}
							Delete
						</button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

{#if showUnsavedChangesModal}
	<SessionsUnsavedChangesModal
		open={showUnsavedChangesModal}
		onOpenChange={handleUnsavedChangesOnOpenChange}
		onConfirm={handleCloseModalDiscard}
		onCancel={handleCloseModalCancel}
	/>
{/if}
