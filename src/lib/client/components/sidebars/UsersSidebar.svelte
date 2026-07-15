<script lang="ts">
	import { getContext, onDestroy, onMount } from "svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import UserForm from "../userForms/UserForm.svelte"
	import UserViewPanel from "../userForms/UserViewPanel.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const socket = useTypedSocket()
	const userCtx: { user: SelectUser } = $state(getContext("userCtx"))

	let userList: SelectUser[] = $state([])
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

	onMount(() => {
		// Register listeners BEFORE emitting
		socket.on("users:list", (response) => {
			userList = response.users
			isLoading = false
		})

		socket.on("users:create", (response) => {
			userList = [...userList, response.user]
			resetForm()
			toaster.success({
				title: "User Created",
				description: `User "${response.user.username}" has been created successfully.`
			})
		})

		socket.on("users:update", (response) => {
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
		})

		socket.on("users:delete", (_response) => {
			if (userToDelete) {
				userList = userList.filter((u) => u.id !== userToDelete!.id)
				if (viewingUser?.id === userToDelete.id) viewingUser = undefined
				toaster.success({
					title: "User Deleted",
					description: `User has been deleted successfully.`
				})
			}
		})

		isMounted = true
		loadUsers()
	})

	onDestroy(() => {
		socket.off("users:list")
		socket.off("users:create")
		socket.off("users:update")
		socket.off("users:delete")
	})
</script>

<div class="flex h-full flex-col p-4">
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
				onBack={() => (viewingUser = undefined)}
				onEdit={handleEditFromView}
			/>
		{/key}
	{:else}
		<!-- Header -->
		<div class="mb-2 flex gap-2">
			{#if isCurrentUserAdmin}
				<button
					class="btn btn-sm preset-filled-primary-500"
					onclick={startCreate}
					title="Create new user"
				>
					<Icons.Plus size={16} />
					New
				</button>
			{/if}
		</div>

		<!-- Search -->
		<div class="relative mb-4">
			<Icons.Search
				size={16}
				class="text-surface-500 absolute top-1/2 left-3 -translate-y-1/2"
			/>
			<input
				type="text"
				bind:value={search}
				placeholder="Search users..."
				class="input w-full pl-10"
			/>
		</div>

		<!-- User List -->
		<div class="flex-1 overflow-y-auto">
			{#if isLoading}
				<div class="flex items-center justify-center py-8">
					<Icons.Loader2 size={20} class="text-surface-400 animate-spin" />
				</div>
			{:else if filteredUsers.length === 0}
				<div class="text-surface-500 py-8 text-center text-sm">
					{search ? `No users matching "${search}".` : "No users found."}
				</div>
			{:else}
				<div class="space-y-2">
					{#each filteredUsers as user}
						<div
							class="bg-surface-100-900 hover:bg-surface-200-800 flex w-full items-center justify-between rounded-lg p-3 transition-colors"
							role="listitem"
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
									<span class="text-surface-500 shrink-0 text-xs">
										@{user.username}
									</span>
								{/if}
								{#if user.isAdmin}
									<span class="preset-filled-primary-500 shrink-0 rounded px-1.5 py-0.5 text-xs">
										Admin
									</span>
								{/if}
							</button>

							{#if isCurrentUserAdmin && user.id !== userCtx.user?.id}
								<div
									class="ml-2 flex shrink-0 gap-1"
									role="group"
									aria-label="Actions for {user.displayName || user.username}"
								>
									<button
										class="btn btn-sm preset-filled-surface-400-600"
										onclick={(e) => { e.stopPropagation(); startEdit(user) }}
										title="Edit user"
										type="button"
									>
										<Icons.Pencil size={14} />
										Edit
									</button>
									<button
										class="btn btn-sm preset-tonal-error"
										onclick={(e) => { e.stopPropagation(); confirmDelete(user) }}
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
	{/if}
</div>

<!-- Delete Confirmation Modal -->
<Modal
	open={showDeleteModal}
	onOpenChange={(e) => {
		if (!e.open) {
			showDeleteModal = false
			userToDelete = undefined
		}
	}}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<div class="p-6">
			<h3 class="mb-4 text-lg font-semibold">Delete User</h3>
			<p class="text-surface-500 mb-6">
				Are you sure you want to delete "{userToDelete?.displayName ||
					userToDelete?.username}"? This action cannot be undone.
			</p>
			<div class="flex justify-end gap-2">
				<button
					class="btn btn-sm preset-filled-surface-500"
					onclick={() => { showDeleteModal = false; userToDelete = undefined }}
				>
					Cancel
				</button>
				<button class="btn btn-sm preset-filled-error-500" onclick={deleteUser}>
					Delete
				</button>
			</div>
		</div>
	{/snippet}
</Modal>
