<script lang="ts">
	import { getContext, onMount } from "svelte"
	import InvitePanel from "$lib/client/components/userForms/InvitePanel.svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import UserForm from "../userForms/UserForm.svelte"
	import UserViewPanel from "../userForms/UserViewPanel.svelte"
	import PanelFilterInput from "../panels/PanelFilterInput.svelte"
	import PanelSplit from "../panels/PanelSplit.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import type { SocketEventMap } from "$lib/client/sockets/typedSocket"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()
	const userCtx: { user: SelectUser } = $state(getContext("userCtx"))
	// Measures the view's own box, not the window: the same view is 400px in
	// the dock and ~1376px full page, and both must land in the right shape.
	const vm = new ViewModeTracker()

	let userList: SelectUser[] = $state([])
	/** The invite panel is opt-in here — the roster is what this sidebar is for. */
	let showInvites = $state(false)
	let search = $state("")
	let viewingUser: SelectUser | undefined = $state()
	let selectedUser: SelectUser | undefined = $state()
	let returnToViewUser: SelectUser | undefined = $state()
	let isCreating = $state(false)
	let isEditing = $state(false)
	let showDeleteModal = $state(false)
	let userToDelete: SelectUser | undefined = $state(undefined)
	let isMounted = $state(false)
	let isLoading = $state(true)

	let isCurrentUserAdmin = $derived(userCtx.user?.isAdmin ?? false)

	/**
	 * The row whose detail is showing beside the list in desk mode — the one
	 * being viewed, or the one being edited (editing is entered from a row, so
	 * the row it came from stays marked).
	 */
	let selectedUserId = $derived(viewingUser?.id ?? selectedUser?.id)

	let filteredUsers: SelectUser[] = $derived.by(() => {
		if (!search) return userList
		const lower = search.toLowerCase()
		return userList.filter(
			(u) =>
				u.username.toLowerCase().includes(lower) ||
				(u.displayName?.toLowerCase().includes(lower) ?? false)
		)
	})

	function resetForm() {
		isCreating = false
		isEditing = false
		selectedUser = undefined
		const returnId = returnToViewUser
		returnToViewUser = undefined
		if (returnId) viewingUser = returnId
	}

	function startCreate() {
		viewingUser = undefined
		selectedUser = undefined
		returnToViewUser = undefined
		isCreating = true
	}

	function startEdit(user: SelectUser) {
		selectedUser = user
		isEditing = true
	}

	function handleViewClick(user: SelectUser) {
		viewingUser = user
	}

	function handleEditFromView() {
		returnToViewUser = viewingUser
		selectedUser = viewingUser
		viewingUser = undefined
		isEditing = true
	}

	function confirmDelete(user: SelectUser) {
		userToDelete = user
		showDeleteModal = true
	}

	function deleteUser() {
		if (userToDelete) {
			socket.emit("users:delete", { id: userToDelete.id })
		}
		showDeleteModal = false
		userToDelete = undefined
	}

	function loadUsers() {
		socket.emit("users:list", { search: search || undefined })
	}

	// Re-fetch when search changes (only after mount)
	$effect(() => {
		if (!isMounted) return
		void search
		loadUsers()
	})

	// Declared through the interest registry below, which counts subscribers
	// per key and releases only this sidebar's. The hazard that replaces is a
	// bare `socket.off("users:list")`, which removes EVERY listener for that
	// event — including any other open users UI.
	function handleUsersList(
		response: SocketEventMap["users:list"]["response"]
	) {
		userList = response.users
		isLoading = false
	}

	function handleUsersCreate(
		response: SocketEventMap["users:create"]["response"]
	) {
		userList = [...userList, response.user]
		resetForm()
		toaster.success({
			title: "User Created",
			description: `User "${response.user.username}" has been created successfully.`
		})
	}

	function handleUsersUpdate(
		response: SocketEventMap["users:update"]["response"]
	) {
		userList = userList.map((u) =>
			u.id === response.user.id ? response.user : u
		)
		if (viewingUser?.id === response.user.id) {
			viewingUser = response.user
		}
		resetForm()
		toaster.success({
			title: "User Updated",
			description: `User "${response.user.username}" has been updated successfully.`
		})
	}

	function handleUsersDelete(
		_response: SocketEventMap["users:delete"]["response"]
	) {
		if (userToDelete) {
			userList = userList.filter((u) => u.id !== userToDelete!.id)
			if (viewingUser?.id === userToDelete.id) viewingUser = undefined
			toaster.success({
				title: "User Deleted",
				description: `User has been deleted successfully.`
			})
		}
	}

	/**
	 * The roster and its three write replies — all BARE (no `users:` event is
	 * in `SCOPED_EVENTS`; this sidebar wants the whole list) and all STANDING,
	 * because a sidebar that can create, edit and delete has to hold the keys
	 * its own writes answer on for as long as it is open.
	 *
	 * Declared here, at init scope, which is strictly earlier than the
	 * `loadUsers()` the `isMounted` effect below fires — and the typed `emit`
	 * flushes the interest sync ahead of any request regardless.
	 */
	useInterest<"users:list">("users:list", handleUsersList)
	useInterest<"users:create">("users:create", handleUsersCreate)
	useInterest<"users:update">("users:update", handleUsersUpdate)
	useInterest<"users:delete">("users:delete", handleUsersDelete)

	onMount(() => {
		// Setting isMounted here is enough to trigger the $effect above (it
		// reads isMounted as a dependency) — an explicit loadUsers() call here
		// too would double-fire it, since the effect re-runs the instant this
		// flips true.
		isMounted = true
	})
</script>

<div use:vm.observe class="flex h-full min-h-0 flex-col">
	<PanelSplit
		mode={vm.mode}
		hasDetail={isCreating || isEditing || viewingUser != null}
		emptyMessage="Pick a user to see their account."
	>
		{#snippet detail()}
			{#if isCreating || isEditing}
				<UserForm
					user={selectedUser}
					onSave={resetForm}
					onCancel={resetForm}
				/>
			{:else if viewingUser}
				{#key viewingUser.id}
					<UserViewPanel
						user={viewingUser}
						{isCurrentUserAdmin}
						onBack={vm.mode === "desk"
							? undefined
							: () => (viewingUser = undefined)}
						onEdit={handleEditFromView}
					/>
				{/key}
			{/if}
		{/snippet}

		{#snippet list()}
			<!-- Header -->
			<div class="mb-2 flex flex-wrap gap-2">
				{#if isCurrentUserAdmin}
					<button
						class="btn btn-sm preset-filled-primary-500"
						onclick={startCreate}
						title="Create new user"
					>
						<Icons.Plus size={16} />
						New
					</button>
					<!-- Pressed is tonal, never filled primary: a filled
					     primary background is this app's call to action, and a
					     toggle that is merely ON is not one. -->
					<button
						class="btn btn-sm {showInvites
							? 'preset-tonal-primary'
							: 'preset-filled-surface-400-600'}"
						onclick={() => (showInvites = !showInvites)}
						aria-pressed={showInvites}
						title="Create an invite link"
					>
						<Icons.UserPlus size={16} />
						Invite
					</button>
				{/if}
			</div>

			{#if isCurrentUserAdmin && showInvites}
				<!-- Same component the Users admin page renders, so the two
				     cannot drift; `compact` only trims it for this width. -->
				<div class="card preset-filled-surface-100-900 mb-4 p-3">
					<InvitePanel compact />
				</div>
			{/if}

			<!-- Search. The same `search` the `users:list` effect re-requests
			     on — the box changed, the round-trip did not. -->
			<div class="mb-4">
				<PanelFilterInput
					bind:value={search}
					placeholder="users"
					count={userList.length}
					aria-label="Filter users by name or username"
				/>
			</div>

			<!-- User List -->
			<div class="min-h-0 flex-1 overflow-y-auto">
				{#if isLoading}
					<div class="flex items-center justify-center py-8">
						<Icons.Loader2
							size={20}
							class="text-surface-400 animate-spin"
						/>
					</div>
				{:else if filteredUsers.length === 0}
					<div class="text-surface-700-300 py-8 text-center text-sm">
						{search
							? `No users matching "${search}".`
							: "No users found."}
					</div>
				{:else}
					<div class="space-y-2">
						{#each filteredUsers as user}
							{@const isSelected =
								vm.mode === "desk" &&
								selectedUserId === user.id}
							<div
								class="card {isSelected
									? 'sidebar-row-active'
									: 'preset-filled-surface-100-900 hover:preset-tonal-primary'} flex w-full items-center justify-between p-3 transition-colors"
								role="listitem"
								aria-current={isSelected ? "true" : undefined}
							>
								<button
									class="flex min-w-0 flex-1 items-center gap-2 text-left"
									onclick={() => handleViewClick(user)}
									type="button"
								>
									<span class="truncate font-medium">
										{user.displayName || user.username}
									</span>
									{#if user.displayName}
										<span
											class="text-surface-700-300 shrink-0 text-xs"
										>
											@{user.username}
										</span>
									{/if}
									{#if user.isAdmin}
										<!-- Tonal, not filled: this is a
										     3.6:1 pill of body text when
										     filled, and it is a fact about the
										     row rather than an action. -->
										<span
											class="preset-tonal-primary shrink-0 rounded px-1.5 py-0.5 text-xs"
										>
											Admin
										</span>
									{/if}
								</button>

								{#if isCurrentUserAdmin && user.id !== userCtx.user?.id}
									<div
										class="ml-2 flex shrink-0 gap-1"
										role="group"
										aria-label="Actions for {user.displayName ||
											user.username}"
									>
										<button
											class="btn btn-sm preset-filled-surface-400-600"
											onclick={(e) => {
												e.stopPropagation()
												startEdit(user)
											}}
											title="Edit user"
											type="button"
										>
											<Icons.Pencil size={14} />
											Edit
										</button>
										<button
											class="btn btn-sm preset-tonal-error"
											onclick={(e) => {
												e.stopPropagation()
												confirmDelete(user)
											}}
											title="Delete user"
											type="button"
										>
											<Icons.Trash2 size={14} />
											Delete
										</button>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/snippet}
	</PanelSplit>
</div>

<!-- Delete Confirmation Modal -->
<Dialog
	open={showDeleteModal}
	onOpenChange={(e) => {
		if (!e.open) {
			showDeleteModal = false
			userToDelete = undefined
		}
	}}
>
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
					<h3 class="mb-4 text-lg font-semibold">Delete User</h3>
					<p class="text-surface-700-300 mb-6">
						Are you sure you want to delete "{userToDelete?.displayName ||
							userToDelete?.username}"? This action cannot be
						undone.
					</p>
					<div class="flex justify-end gap-2">
						<button
							class="btn btn-sm preset-filled-surface-500"
							onclick={() => {
								showDeleteModal = false
								userToDelete = undefined
							}}
						>
							Cancel
						</button>
						<button
							class="btn btn-sm preset-filled-error-500"
							onclick={deleteUser}
						>
							Delete
						</button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
