<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { onMount } from "svelte"
	import { getContext, untrack } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { resolveUserHandle } from "$lib/shared/utils/resolveCharacterName"

	interface Props {
		open: boolean
		excludeUserIds?: number[]
		onclose: () => void
		onSelect: (userId: number) => void
		title?: string
		description?: string
		multiSelect?: boolean
		/** The picked ids, and their rows — a caller holding the pick as a
		 *  pending change needs the names before the server has them. */
		onMultiSelect?: (
			userIds: number[],
			users: SelectUser[],
			name?: string
		) => void
		/**
		 * Where the roster comes from. `users:list` (default) is the admin
		 * roster; `conversations:people` is every other account as a member
		 * sees it (PLAN-private-messages §6.5) — the one a non-admin may
		 * read. Its rows carry only `id`, `username`, `displayName` and
		 * `isAdmin`.
		 */
		source?: "users:list" | "conversations:people"
		/** The multi-select confirm's words for `count` picked. */
		confirmLabel?: (count: number) => string
		/**
		 * Multi-select: once more than one person is picked, offer an
		 * optional **Name** (a group conversation's), passed to
		 * `onMultiSelect` as its third argument.
		 */
		askName?: boolean
	}

	let {
		open = $bindable(),
		excludeUserIds = [],
		onclose,
		onSelect,
		onMultiSelect,
		title = "Select user",
		description,
		multiSelect = false,
		source = "users:list",
		confirmLabel = (count: number) =>
			`Add ${count} guest${count !== 1 ? "s" : ""}`,
		askName = false
	}: Props = $props()

	let userCtx: UserCtx = getContext("userCtx")
	let users: SelectUser[] = $state([])
	let search = $state("")
	const selectedUserIds = new SvelteSet<number>()
	let groupName = $state("")

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
		const term = search.toLowerCase()
		return availableUsers.filter(
			(u) =>
				u.username!.toLowerCase().includes(term) ||
				u.displayName?.toLowerCase().includes(term)
		)
	})

	function handleUserSelect(userId: number) {
		if (multiSelect) {
			if (selectedUserIds.has(userId)) {
				selectedUserIds.delete(userId)
			} else {
				selectedUserIds.add(userId)
			}
		} else {
			onSelect(userId)
			onclose()
		}
	}

	function handleConfirmMultiSelect() {
		if (onMultiSelect) {
			const ids = Array.from(selectedUserIds)
			const name =
				askName && ids.length > 1 && groupName.trim()
					? groupName.trim()
					: undefined
			onMultiSelect(
				ids,
				users.filter((u) => u.id != null && selectedUserIds.has(u.id)),
				name
			)
		}
		onclose()
	}

	// Declared through the interest registry below, which counts subscribers
	// per key and releases only this modal's. The hazard that replaces is a
	// bare `socket.off("users:list")`, which removes EVERY listener for that
	// event across the whole app.
	function handleUsersList(msg: Sockets.Users.List.Response) {
		users = msg.users || []
	}

	/** The member-facing roster: the same rows, fewer columns. */
	function handlePeople(msg: { people: SelectUser[] | unknown[] }) {
		users = (msg.people as SelectUser[]) || []
	}

	onMount(() => {
		// BARE — `users:list` has no entry in `SCOPED_EVENTS`; this is the
		// whole roster and the picker wants all of it. Declared and asked for
		// in one call so the key is on the wire before the request, and held
		// while the modal is open: the roster is a cascade target, so a user
		// added elsewhere shows up here without reopening.
		if (source === "conversations:people")
			return requestWithInterest(
				"conversations:people",
				{},
				handlePeople
			)
		return requestWithInterest("users:list", {}, handleUsersList)
	})

	// Reset selection when modal opens
	$effect(() => {
		if (open) {
			// Untracked: `clear()` reads the set, and an effect that read it
			// would clear every pick the moment it was made.
			untrack(() => {
				selectedUserIds.clear()
				groupName = ""
			})
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
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 relative max-h-[95dvh] w-[min(95vw,800px)] space-y-6 overflow-hidden p-6 shadow-xl"
			>
				<header class="flex items-center justify-between">
					<h2 class="h2">{title}</h2>
					<button
						class="btn btn-sm"
						aria-label="Close"
						onclick={onclose}
					>
						<Icons.X size={20} aria-hidden="true" />
					</button>
				</header>
				{#if description}
					<p class="text-surface-600-400">{description}</p>
				{/if}
				<input
					class="input w-full"
					type="text"
					placeholder="Search users…"
					aria-label="Search users"
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
									class="preset-outlined-surface-400-600 hover:bg-surface-200-800 relative flex w-full items-center gap-3 overflow-hidden rounded p-3 {multiSelect &&
									selectedUserIds.has(user.id)
										? 'sidebar-row-active'
										: ''}"
									aria-pressed={multiSelect
										? selectedUserIds.has(user.id)
										: undefined}
									onclick={() => handleUserSelect(user.id!)}
								>
									<div class="flex flex-1 items-center gap-3">
										<Icons.User size={20} />
										<div class="text-left">
											<div class="font-semibold">
												{resolveUserHandle(user)}
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
				{#if multiSelect && askName && selectedUserIds.size > 1}
					<label class="block space-y-1">
						<span class="text-sm font-medium">Name</span>
						<input
							class="input w-full"
							type="text"
							maxlength="80"
							placeholder="Optional — the names joined if left empty"
							bind:value={groupName}
						/>
					</label>
				{/if}
				{#if multiSelect}
					<footer class="flex justify-end gap-2">
						<button
							class="btn preset-tonal-surface"
							onclick={onclose}
						>
							Cancel
						</button>
						<button
							class="btn preset-filled-primary-500"
							onclick={handleConfirmMultiSelect}
							disabled={selectedUserIds.size === 0}
						>
							{confirmLabel(selectedUserIds.size)}
						</button>
					</footer>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
