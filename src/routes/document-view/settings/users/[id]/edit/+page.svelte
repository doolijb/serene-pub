<script lang="ts">
	import { onMount, getContext } from "svelte"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
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

	function handleUsersList(msg: any) {
		loaded = true
		const found = (msg.users || []).find((u: any) => u.id === userId)
		if (!found) {
			notFound = true
			return
		}
		username = found.username
		displayName = found.displayName || ""
		isAdmin = found.isAdmin
	}
	function handleUsersUpdate(msg: any) {
		saving = false
		if (msg.user) goto("/document-view/settings/users")
	}
	function handleUsersUpdateError(msg: { error?: string }) {
		saving = false
		error = msg.error || "Failed to save user."
		announce(error)
	}
	function handleUsersDelete() {
		goto("/document-view/settings/users")
	}
	function handleUsersDeleteError(msg: { error?: string }) {
		deleting = false
		error = msg.error || "Failed to delete user."
		announce(error)
	}

	/**
	 * The roster this form picks its row out of, and the two writes it sends.
	 * All BARE — `users:` has no `SCOPED_EVENTS` entry, so a key naming the id
	 * would match no payload at all; the `find` in `handleUsersList` is the
	 * filter — and all STANDING, exactly what the `onMount` pair they replace
	 * held: `users:list` is re-emitted by the server after every account
	 * write, and the update and delete answer whenever the person submits.
	 * Both `:error` halves are never gated (plan ruling 2).
	 *
	 * Declared at init so every key is held before `load()` asks: the typed
	 * `emit` flushes the interest sync ahead of the request (plan ruling 3).
	 */
	useInterest<"users:list">("users:list", handleUsersList)
	useInterest<"users:update">("users:update", handleUsersUpdate)
	useInterest<"users:update:error">(
		"users:update:error",
		handleUsersUpdateError
	)
	useInterest<"users:delete">("users:delete", handleUsersDelete)
	useInterest<"users:delete:error">(
		"users:delete:error",
		handleUsersDeleteError
	)

	onMount(() => {
		// Every listener on this page is an interest, declared above.
		load()
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
