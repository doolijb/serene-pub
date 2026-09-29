<script lang="ts">
	import { getContext } from "svelte"
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { announce } from "$lib/client/accessibility/state.svelte"

	const socket = useTypedSocket()
	let userCtx: UserCtx = getContext("userCtx")

	let username = $state("")
	let displayName = $state("")
	let isAdmin = $state(false)
	let passphrase = $state("")
	let error = $state("")
	let saving = $state(false)

	function submit(event: SubmitEvent) {
		event.preventDefault()
		error = ""
		if (!username.trim()) {
			error = "Username is required."
			announce(error)
			return
		}
		if (!passphrase.trim()) {
			error = "Passphrase is required."
			announce(error)
			return
		}
		saving = true
		socket.emit("users:create", {
			username: username.trim(),
			displayName: displayName.trim() || undefined,
			isAdmin,
			passphrase
		})
	}

	function handleUsersCreate(msg: any) {
		saving = false
		if (msg.user) goto("/document-view/settings/users")
	}
	function handleUsersCreateError(msg: { error?: string }) {
		saving = false
		error = msg.error || "Failed to create user."
		announce(error)
	}

	/**
	 * The create's answer and its refusal, both BARE and both STANDING: they
	 * land when the person submits, not in reply to anything asked at mount.
	 * `:error` events are never gated (plan ruling 2).
	 */
	useInterest<"users:create">("users:create", handleUsersCreate)
	useInterest<"users:create:error">(
		"users:create:error",
		handleUsersCreateError
	)
</script>

<svelte:head>
	<title>New user — Document View — Serene Pub</title>
</svelte:head>

<h1>New user</h1>
<p><a href="/document-view/settings/users">Back to Users</a></p>

{#if !userCtx.user?.isAdmin}
	<p>Admin access required.</p>
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
			<label for="a11y-user-display-name">Display name</label>
			<p class="a11y-hint">
				Optional. Shown instead of the username where set.
			</p>
			<input
				id="a11y-user-display-name"
				type="text"
				bind:value={displayName}
				disabled={saving}
			/>
		</div>
		<div class="a11y-field">
			<label for="a11y-user-passphrase">Passphrase</label>
			<input
				id="a11y-user-passphrase"
				type="password"
				autocomplete="new-password"
				required
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
			{saving ? "Creating…" : "Create user"}
		</button>
	</form>
{/if}
