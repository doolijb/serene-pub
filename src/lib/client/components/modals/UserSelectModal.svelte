<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onMount } from "svelte"
	import { getContext } from "svelte"

	interface Props {
		open: boolean
		excludeUserIds?: number[]
		onclose: () => void
		onSelect: (userId: number) => void
		title?: string
		description?: string
		multiSelect?: boolean
		onMultiSelect?: (userIds: number[]) => void
	}

	let {
		open = $bindable(),
		excludeUserIds = [],
		onclose,
		onSelect,
		onMultiSelect,
		title = "Select User",
		description,
		multiSelect = false
	}: Props = $props()

	const socket = useTypedSocket()
	let userCtx: UserCtx = getContext("userCtx")
	let users: SelectUser[] = $state([])
	let search = $state("")
	let selectedUserIds: Set<number> = $state(new Set())

	let availableUsers = $derived.by(() => {
		// Exclude current user and any other excluded users
		const currentUserId = userCtx.user?.id
		if (!users || users.length === 0) return []
		return users.filter((u) => {
			// Check if user should be excluded
			if (!u.id) return false

			// Always exclude the current user
			if (currentUserId && u.id === currentUserId) return false

			// Check against the exclude list
			if (excludeUserIds.includes(u.id)) return false

			return true
		})
	})

	let filtered = $derived.by(() => {
		if (!search.trim()) return availableUsers
		return availableUsers.filter((u) =>
			u.username!.toLowerCase().includes(search.toLowerCase())
		)
	})

	function handleUserSelect(userId: number) {
		if (multiSelect) {
			if (selectedUserIds.has(userId)) {
				selectedUserIds.delete(userId)
			} else {
				selectedUserIds.add(userId)
			}
			selectedUserIds = new Set(selectedUserIds)
		} else {
			onSelect(userId)
			onclose()
		}
	}

	function handleConfirmMultiSelect() {
		if (onMultiSelect) {
			onMultiSelect(Array.from(selectedUserIds))
		}
		onclose()
	}

	onMount(() => {
		// Fetch all users
		socket.emit("users:list", {})

		socket.on("users:list", (msg: Sockets.Users.List.Response) => {
			users = msg.users || []
		})

		return () => {
			socket.off("users:list")
		}
	})

	// Reset selection when modal opens
	$effect(() => {
		if (open) {
			selectedUserIds = new Set()
		}
	})
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!e.open) onclose()
	}}
>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-h-[95dvh] relative overflow-hidden w-[min(95vw,800px)]">
		<header class="flex items-center justify-between">
			<h2 class="h2">{title}</h2>
			<button class="btn btn-sm" aria-label="Close" onclick={onclose}>
				<Icons.X size={20} />
			</button>
		</header>
		{#if description}
			<p class="text-surface-600-400">{description}</p>
		{/if}
		<input
			class="input w-full"
			type="text"
			placeholder="Search users..."
			bind:value={search}
		/>
		<div class="max-h-[60dvh] min-h-0 overflow-y-auto">
			<div class="relative flex flex-col gap-2 pr-2">
				{#if filtered.length === 0}
					<div class="text-surface-700-300 text-center">
						No users found
					</div>
				{/if}
				{#each filtered as user}
					{#if user.id}
						<button
							class="preset-outlined-surface-400-600 hover:preset-filled-surface-500 relative flex w-full items-center gap-3 overflow-hidden rounded p-3 {multiSelect &&
							selectedUserIds.has(user.id)
								? 'preset-filled-primary-500'
								: ''}"
							onclick={() => handleUserSelect(user.id!)}
						>
							<div class="flex flex-1 items-center gap-3">
								<Icons.User size={20} />
								<div class="text-left">
									<div class="font-semibold">
										{user.username}
									</div>
									{#if user.isAdmin}
										<div
											class="text-surface-600-400 text-xs"
										>
											Admin
										</div>
									{/if}
								</div>
							</div>
							{#if multiSelect && selectedUserIds.has(user.id)}
								<Icons.Check size={20} />
							{/if}
						</button>
					{/if}
				{/each}
			</div>
		</div>
		{#if multiSelect}
			<footer class="flex justify-end gap-2">
				<button class="btn preset-filled-surface-500" onclick={onclose}>
					Cancel
				</button>
				<button
					class="btn preset-filled-primary-500"
					onclick={handleConfirmMultiSelect}
					disabled={selectedUserIds.size === 0}
				>
					Add {selectedUserIds.size} Guest{selectedUserIds.size !== 1
						? "s"
						: ""}
				</button>
			</footer>
		{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
