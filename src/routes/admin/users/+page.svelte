<script lang="ts">
	/**
	 * Users — the Django-style changelist over accounts. New and Edit navigate
	 * to dedicated change pages built on `UserForm` (the same form the Users
	 * panel renders — one source of truth). The full (small) list arrives
	 * once; search filters it as you type, client-side.
	 */
	import { getContext, onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"

	const socket = useTypedSocket()
	let userCtx: UserCtx = getContext("userCtx")

	type Row = SelectUser
	let rows: Row[] = $state([])
	let loading = $state(true)

	function handleList(res: Sockets.Users.List.Response) {
		rows = res.users
		loading = false
	}

	onMount(() => {
		socket.on("users:list", handleList)
		socket.emit("users:list", {})
	})
	onDestroy(() => {
		socket.off("users:list", handleList)
	})

	const columns: AdminColumn<Row>[] = [
		{ key: "username", label: "Username", value: (r) => r.username },
		{
			key: "displayName",
			label: "Display name",
			value: (r) => r.displayName
		},
		{ key: "role", label: "Role", value: (r) => (r.isAdmin ? 0 : 1) },
		{ key: "createdAt", label: "Created", value: (r) => r.createdAt ?? "" },
		{ key: "actions", label: "", class: "w-px text-right" }
	]
</script>

<div class="mb-4 flex flex-wrap items-start gap-3">
	<div class="flex-1">
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Users size={20} /> Users
		</h2>
		<p class="text-surface-600-400 text-sm">
			Accounts on this instance and their roles.
		</p>
	</div>
	<a class="btn btn-sm preset-filled-primary-500" href="/admin/users/new">
		<Icons.Plus size={16} /> New user
	</a>
</div>

<AdminList
	{rows}
	{columns}
	{loading}
	searchText={(r) => `${r.username} ${r.displayName ?? ""}`}
	searchPlaceholder="Search users…"
	defaultSort="username"
	storageKey="serene-pub:adminView:users"
	emptyMessage="No users."
	onRowClick={(r) => goto(`/admin/users/${r.id}`)}
>
	{#snippet cell(row, col)}
		{#if col.key === "username"}
			<span class="font-semibold">{row.username}</span>
			{#if row.id === userCtx.user?.id}
				<span class="text-surface-600-400 ml-1.5 text-xs">(you)</span>
			{/if}
		{:else if col.key === "displayName"}
			<span class="text-surface-700-300">{row.displayName ?? "—"}</span>
		{:else if col.key === "role"}
			{#if row.isAdmin}
				<span
					class="preset-tonal-primary rounded-full px-2 py-0.5 text-xs font-medium"
					>Admin</span
				>
			{:else}
				<span
					class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs"
					>Member</span
				>
			{/if}
		{:else if col.key === "createdAt"}
			<span class="text-surface-700-300 text-xs">{row.createdAt ?? "—"}</span>
		{:else if col.key === "actions"}
			<a
				class="btn btn-sm preset-tonal-surface"
				href="/admin/users/{row.id}"
				onclick={(e) => e.stopPropagation()}
			>
				<Icons.Pencil size={13} /> Edit
			</a>
		{/if}
	{/snippet}
</AdminList>
