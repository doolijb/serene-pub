<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { announce } from "$lib/client/accessibility/state.svelte"

	const socket = useTypedSocket()
	const userId = $derived(Number(page.params.id))
	let userCtx: UserCtx = getContext("userCtx")

	let username = $state("")
	let displayName = $state("")
	let isAdmin = $state(false)
	let passphrase = $state("")
	let loaded = $state(false)
	let notFound = $state(false)
	let error = $state("")
	let saving = $state(false)
	let deleting = $state(false)

	function load() {
		loaded = false
		notFound = false
		socket.emit("users:list", {})
	}

	function submit(event: SubmitEvent) {
		event.preventDefault()
		error = ""
		if (!username.trim()) {
			error = "Username is required."
			announce(error)
			return
		}
		saving = true
		socket.emit("users:update", {
			id: userId,
			username: username.trim(),
			displayName: displayName.trim() || undefined,
			isAdmin,
			passphrase: passphrase.trim() || undefined
		})
	}

	function deleteUser() {
		if (!confirm("Delete this user? This cannot be undone.")) return
		deleting = true
		socket.emit("users:delete", { id: userId })
	}

	onMount(() => {
		socket.on("users:list", (msg) => {
			loaded = true
			const found = (msg.users || []).find((u) => u.id === userId)
			if (!found) {
				notFound = true
				return
			}
			username = found.username
			displayName = found.displayName || ""
			isAdmin = found.isAdmin
		})
		socket.on("users:update", (msg) => {
			saving = false
			if (msg.user) goto("/document-view/settings/users")
		})
		socket.on("users:update:error", (msg: { error?: string }) => {
			saving = false
			error = msg.error || "Failed to save user."
			announce(error)
		})
		socket.on("users:delete", () => {
			goto("/document-view/settings/users")
		})
		socket.on("users:delete:error", (msg: { error?: string }) => {
			deleting = false
			error = msg.error || "Failed to delete user."
			announce(error)
		})
		load()
		return () => {
			socket.off("users:list")
			socket.off("users:update")
			socket.off("users:update:error")
			socket.off("users:delete")
			socket.off("users:delete:error")
		}
	})
</script>

<svelte:head>
	<title>Edit User — Document View — Serene Pub</title>
</svelte:head>

<h1>Edit User</h1>
<p><a href="/document-view/settings/users">Back to Users</a></p>

{#if !userCtx.user?.isAdmin}
	<p>Admin access required.</p>
{:else if !loaded}
	<p>Loading…</p>
{:else if notFound}
	<p>User not found.</p>
{:else}
	{#if error}
		<div class="a11y-status a11y-status-error" role="alert">
			<p class="a11y-error-text">{error}</p>
		</div>
	{/if}

	<form onsubmit={submit}>
		<div class="a11y-field">
			<label for="a11y-user-username">Username</label>
			<input
				id="a11y-user-username"
				type="text"
				required
				bind:value={username}
				disabled={saving}
			/>
		</div>
		<div class="a11y-field">
			<label for="a11y-user-display-name">Display Name</label>
			<input
				id="a11y-user-display-name"
				type="text"
				bind:value={displayName}
				disabled={saving}
			/>
		</div>
		<div class="a11y-field">
			<label for="a11y-user-passphrase">New Passphrase</label>
			<p class="a11y-hint">Leave blank to keep the current passphrase.</p>
			<input
				id="a11y-user-passphrase"
				type="password"
				autocomplete="new-password"
				bind:value={passphrase}
				disabled={saving}
			/>
		</div>
		<div class="a11y-checkbox-field">
			<input
				id="a11y-user-is-admin"
				type="checkbox"
				bind:checked={isAdmin}
				disabled={saving}
			/>
			<label for="a11y-user-is-admin">Admin</label>
		</div>
		<button type="submit" class="a11y-btn" disabled={saving}>
			{saving ? "Saving…" : "Save Changes"}
		</button>
		<button
			type="button"
			class="a11y-btn a11y-btn-danger"
			onclick={deleteUser}
			disabled={deleting}
		>
			{deleting ? "Deleting…" : "Delete User"}
		</button>
	</form>
{/if}
