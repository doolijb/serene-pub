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
			/ <strong>{user?.username ?? "…"}</strong>
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
		class="card preset-tonal text-surface-600-400 px-3 py-8 text-center text-sm"
	>
		This user no longer exists.
		<a class="underline" href="/admin/users">Back to the list</a>.
	</div>
{:else}
	{#key id}
		<div
			class="form-max card preset-tonal p-4 shadow-sm"
		>
			<UserForm {user} onSave={done} onCancel={done} />
		</div>
	{/key}
{/if}

<style>
	.form-max {
		max-width: 40rem;
	}
</style>
