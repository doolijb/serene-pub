<script lang="ts">
	import { getContext, onMount } from "svelte"
	import { avatarSrc } from "$lib/client/utils/media"
	import InvitePanel from "$lib/client/components/userForms/InvitePanel.svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import UserForm from "../userForms/UserForm.svelte"
	import UserViewPanel from "../userForms/UserViewPanel.svelte"
	import PanelFilterInput from "../panels/PanelFilterInput.svelte"
	import ViewToolbar from "../panels/ViewToolbar.svelte"
	import { toolbarButtonClass } from "../panels/toolbarButton"
	import PanelSplit from "../panels/PanelSplit.svelte"
	import MetaLine from "../panels/MetaLine.svelte"
	import SidebarListItem from "../SidebarListItem.svelte"
	import RowMenu from "../menus/RowMenu.svelte"
	import Avatar from "../Avatar.svelte"
	import EmptyState from "../EmptyState.svelte"
	import LoadingState from "../LoadingState.svelte"
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

	/**
	 * Whether this admin may edit or delete `user` from a row or the detail's
	 * menu. Never their own account: the server refuses deleting it, and
	 * their own edit is the detail's Edit.
	 */
	function canManage(user: SelectUser): boolean {
		return isCurrentUserAdmin && user.id !== userCtx.user?.id
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
			title: "User created",
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
			title: "User updated",
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
				title: "User deleted",
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

<div class="flex h-full min-h-0 flex-col" use:vm.observe>
	<!-- `listFills` (L7, 2026-10-24): nothing open, the list sits centred at
	     its own 560px instead of beside an empty pane. -->
	<PanelSplit
		mode={vm.mode}
		hasDetail={isCreating || isEditing || viewingUser != null}
		listFills
		fillWidth="list"
		emptyMessage="Pick a user to see their account."
	>
		{#snippet detail()}
			{#if isCreating || isEditing}
				<UserForm
					user={selectedUser}
					onSave={resetForm}
					onCancel={resetForm}
					showBack={vm.mode === "compact"}
				/>
			{:else if viewingUser}
				{@const shown = viewingUser}
				{#key shown.id}
					<UserViewPanel
						user={shown}
						{isCurrentUserAdmin}
						onBack={vm.mode === "compact"
							? () => (viewingUser = undefined)
							: undefined}
						onEdit={handleEditFromView}
						onDelete={canManage(shown)
							? () => confirmDelete(shown)
							: undefined}
					/>
				{/key}
			{/if}
		{/snippet}

		{#snippet toolbar()}
			<!-- The view toolbar (STYLE-GUIDE §6.3): New is the primary;
			     Invite is a secondary toggle, tonal primary while its panel
			     is open — pressed is tonal, never filled. -->
			<ViewToolbar
				label="Users"
				primary={isCurrentUserAdmin ? newUserButton : undefined}
				actions={isCurrentUserAdmin ? inviteToggle : undefined}
			>
				{#snippet filter()}
					<!-- The same `search` the `users:list` effect re-requests
					     on — the box changed, the round-trip did not. -->
					<PanelFilterInput
						bind:value={search}
						placeholder="users"
						singular="user"
						count={userList.length}
						aria-label="Filter users by name or username"
					/>
				{/snippet}
			</ViewToolbar>
		{/snippet}

		{#snippet list()}
			{#if isCurrentUserAdmin && showInvites}
				<!-- Same component the Users admin page renders, so the two
				     cannot drift; `compact` only trims it for this width. -->
				<div class="panel-card mb-3">
					<InvitePanel compact />
				</div>
			{/if}

			{#if isLoading}
				<LoadingState message="Loading users…" />
			{:else if filteredUsers.length === 0}
				<EmptyState
					icon={Icons.Users}
					message={search
						? `No users match "${search}".`
						: "No users yet."}
					ctaLabel={isCurrentUserAdmin && !search
						? "New user"
						: undefined}
					onCta={isCurrentUserAdmin && !search
						? startCreate
						: undefined}
				/>
			{:else}
				<div class="flex flex-col gap-2" role="list" aria-label="Users">
					{#each filteredUsers as user (user.id)}
						{@const name = user.displayName || user.username}
						<SidebarListItem
							onclick={() => handleViewClick(user)}
							contentTitle={name}
							itemType={user.isAdmin ? "Administrator" : "User"}
							showIndex={false}
							active={vm.mode === "desk" &&
								selectedUserId === user.id}
						>
							{#snippet content()}
								<!-- The row's anatomy (§6.4, L6): the 44px face
								     (the account's avatar, else the name's
								     initial), the name, one meta line. -->
								<Avatar
									src={avatarSrc(user)}
									{name}
									fallback="initial"
									size="md"
									decorative
								/>
								<div
									class="flex min-w-0 flex-1 items-center gap-2"
								>
									<div class="min-w-0 flex-1 text-left">
										<div
											class="truncate text-lead font-medium"
										>
											{name}
										</div>
										<MetaLine>@{user.username}</MetaLine>
									</div>
									{#if user.isAdmin}
										<!-- A fact about the row, not an action:
										     the neutral chip, never filled. -->
										<span
											class="preset-tonal-surface text-surface-700-300 shrink-0 rounded px-1.5 py-0.5 text-meta font-medium"
										>
											Admin
										</span>
									{/if}
								</div>
							{/snippet}
							{#snippet controls()}
								{#if canManage(user)}
									<RowMenu
										label="User"
										triggerClass="btn btn-sm hover:bg-surface-200-800 data-[state=open]:bg-surface-200-800 shrink-0 p-3"
										items={[
											{
												label: "Edit",
												icon: Icons.Pencil,
												onSelect: () => startEdit(user)
											},
											{ separator: true },
											{
												label: "Delete",
												icon: Icons.Trash2,
												destructive: true,
												onSelect: () =>
													confirmDelete(user)
											}
										]}
									/>
								{/if}
							{/snippet}
						</SidebarListItem>
					{/each}
				</div>
			{/if}
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
				class="card bg-surface-100-900 border-surface-200-800 max-w-[95vw] space-y-4 border p-4 shadow-xl"
			>
				<div class="p-6">
					<h3 class="mb-4 text-lg font-semibold">Delete user?</h3>
					<p class="text-surface-700-300 mb-6">
						Are you sure you want to delete "{userToDelete?.displayName ||
							userToDelete?.username}"? This action cannot be
						undone.
					</p>
					<div class="flex justify-end gap-2">
						<button
							class="btn btn-sm preset-tonal-surface"
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

<!-- The admin's two toolbar actions, handed to ViewToolbar only for an admin. -->
{#snippet newUserButton()}
	<button
		type="button"
		class="btn btn-sm preset-filled-primary-500 shrink-0"
		onclick={startCreate}
		title="Create new user"
	>
		<Icons.Plus size={16} aria-hidden="true" />
		New
	</button>
{/snippet}
{#snippet inviteToggle()}
	<button
		type="button"
		class={toolbarButtonClass(showInvites)}
		onclick={() => (showInvites = !showInvites)}
		aria-pressed={showInvites}
		title="Invite links"
		aria-label="Invite links"
	>
		<Icons.UserPlus size={16} aria-hidden="true" />
	</button>
{/snippet}
