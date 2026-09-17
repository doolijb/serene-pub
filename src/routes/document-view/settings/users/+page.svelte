<script lang="ts">
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"

	const socket = useTypedSocket()
	let userCtx: UserCtx = getContext("userCtx")

	let users: SelectUser[] = $state([])
	let loaded = $state(false)

	function deleteUser(id: number, name: string) {
		if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return
		socket.emit("users:delete", { id })
	}

	function handleUsersList(msg: any) {
		users = msg.users || []
		loaded = true
	}
	function handleUsersDelete() {
		socket.emit("users:list", {})
	}

	/**
	 * The roster, asked for and listened for in one, and the delete's answer —
	 * a STANDING key, since it lands whenever somebody presses Delete rather
	 * than in reply to anything asked here. Both BARE: `users:` has no
	 * `SCOPED_EVENTS` entry, so a key naming an id would match nothing.
	 *
	 * `users:delete` is declared ahead of the request below so the key exists
	 * before either goes out.
	 */
	useInterest<"users:delete">("users:delete", handleUsersDelete)
	$effect(() => requestWithInterest("users:list", {}, handleUsersList))
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
