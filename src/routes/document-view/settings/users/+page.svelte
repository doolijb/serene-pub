<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	const socket = useTypedSocket()
	let userCtx: UserCtx = getContext("userCtx")

	let users: SelectUser[] = $state([])
	let loaded = $state(false)

	function deleteUser(id: number, name: string) {
		if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return
		socket.emit("users:delete", { id })
	}

	onMount(() => {
		socket.on("users:list", (msg) => {
			users = msg.users || []
			loaded = true
		})
		socket.on("users:delete", () => {
			socket.emit("users:list", {})
		})
		socket.emit("users:list", {})
		return () => {
			socket.off("users:list")
			socket.off("users:delete")
		}
	})
</script>

<svelte:head>
	<title>Users — Document View — Serene Pub</title>
</svelte:head>

<h1>Users</h1>

{#if !userCtx.user?.isAdmin}
	<p>Admin access required.</p>
{:else}
	<p>
		<a href="/document-view/settings/users/new" class="a11y-btn">
			Add a new user
		</a>
	</p>

	{#if !loaded}
		<p>Loading…</p>
	{:else}
		<ul class="a11y-list">
			{#each users as u (u.id)}
				<li class="a11y-list-item">
					<h2>
						{u.displayName || u.username}
						{u.isAdmin ? "(Admin)" : ""}
					</h2>
					<p>Username: {u.username}</p>
					{#if u.id !== userCtx.user?.id}
						<div class="a11y-list-item-actions">
							<a
								href="/document-view/settings/users/{u.id}/edit"
								class="a11y-btn a11y-btn-small"
							>
								Edit
							</a>
							<button
								type="button"
								class="a11y-btn a11y-btn-danger a11y-btn-small"
								onclick={() =>
									deleteUser(
										u.id,
										u.displayName || u.username
									)}
							>
								Delete
							</button>
						</div>
					{:else}
						<p class="a11y-hint">This is you.</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/if}
