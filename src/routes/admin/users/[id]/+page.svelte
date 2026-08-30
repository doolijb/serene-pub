<script lang="ts">
	/**
	 * One account's dedicated change page: `UserForm` — the same form the
	 * Users panel renders — pointed at this row. The list arrives over the
	 * same admin-gated `users:list` the changelist uses.
	 */
	import { onDestroy, onMount } from "svelte"
	import { goto } from "$app/navigation"
	import { page } from "$app/state"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import UserForm from "$lib/client/components/userForms/UserForm.svelte"

	const socket = useTypedSocket()

	let clearingTotp = $state(false)

	function clearTotp() {
		if (
			!confirm(
				"Clear two-factor authentication for this user and sign out all of their sessions?"
			)
		)
			return
		clearingTotp = true
		socket.emit("totp:adminClear", { userId: Number(id) })
	}
	let id = $derived(Number(page.params.id))

	let users: SelectUser[] = $state([])
	let loading = $state(true)
	let user = $derived(users.find((u) => u.id === id))

	function handleList(res: Sockets.Users.List.Response) {
		users = res.users
		loading = false
	}

	onMount(() => {
		socket.on("users:list", handleList)
		socket.emit("users:list", {})
	})
	onDestroy(() => {
		socket.off("users:list", handleList)
	})

	const done = () => goto("/admin/users")
</script>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href="/admin/users" class="hover:underline">Users</a>
			/
			<strong>{user?.username ?? "…"}</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Users size={20} /> Edit user
		</h2>
	</div>
	<a class="btn btn-sm preset-tonal-surface" href="/admin/users">
		<Icons.ArrowLeft size={16} /> Back to list
	</a>
</div>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else if !user}
	<div
		class="card preset-filled-surface-100-900 text-surface-600-400 px-3 py-8 text-center text-sm"
	>
		This user no longer exists.
		<a class="underline" href="/admin/users">Back to the list</a>
		.
	</div>
{:else}
	{#key id}
		<div class="form-max card preset-filled-surface-100-900 p-4 shadow-sm">
			<UserForm {user} onSave={done} onCancel={done} />
		</div>

		<!-- Tier 2 recovery (26 §10): the ordinary "lost my phone and my
		     codes" case, which should not need filesystem access. -->
		<div class="form-max card preset-filled-surface-100-900 mt-4 space-y-2 p-4">
			<h3 class="text-sm font-semibold">Two-factor authentication</h3>
			<p class="text-surface-600-400 text-sm">
				If this user has lost both their authenticator and their
				recovery codes, clearing their second factor lets them sign in
				with their password alone. All of their sessions are signed out
				at the same time — leaving them active would keep them
				authenticated under a guarantee that no longer holds.
			</p>
			<button
				type="button"
				class="btn btn-sm preset-tonal-error"
				disabled={clearingTotp}
				onclick={clearTotp}
			>
				Clear two-factor for this user
			</button>
		</div>
	{/key}
{/if}

<style>
	.form-max {
		max-width: 40rem;
	}
</style>
