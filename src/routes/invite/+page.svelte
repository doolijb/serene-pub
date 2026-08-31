<script lang="ts">
	/**
	 * Invite redemption (plan 27 §3).
	 *
	 * Deliberately outside the app shell and outside the socket layer: this runs
	 * before any session exists. The invite's kind decides which form appears —
	 * a registration form for `register`, a password-set form for `account`.
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { page } from "$app/state"

	let loading = $state(true)
	let valid = $state(false)
	let kind = $state<"register" | "account" | null>(null)
	let existingUsername = $state<string | null>(null)
	let error = $state<string | null>(null)
	let busy = $state(false)

	let username = $state("")
	let passphrase = $state("")
	let confirm = $state("")

	const token = $derived(page.url.searchParams.get("token") ?? "")

	onMount(async () => {
		const res = await fetch(
			`/api/invite?token=${encodeURIComponent(token)}`
		).then((r) => r.json())
		valid = !!res.valid
		kind = res.kind ?? null
		existingUsername = res.username ?? null
		error = res.error ?? null
		loading = false
	})

	async function submit(event: Event) {
		event.preventDefault()
		error = null
		if (passphrase !== confirm) {
			error = "Those passphrases don't match."
			return
		}
		busy = true
		const res = await fetch("/api/invite", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token, username, passphrase })
		}).then((r) => r.json())
		busy = false
		if (res.error) {
			error = res.error
			return
		}
		// Signed in by redemption — a full load picks up the new session and
		// lands on the setup gate if anything remains.
		window.location.href = "/"
	}
</script>

<div class="flex min-h-screen items-center justify-center p-6">
	<div
		class="card preset-filled-surface-100-900 w-full max-w-md space-y-4 p-6"
	>
		{#if loading}
			<p class="text-surface-600-400 text-sm">Checking invite…</p>
		{:else if !valid}
			<h1 class="flex items-center gap-2 text-lg font-semibold">
				<Icons.TriangleAlert size={20} /> Invite unavailable
			</h1>
			<p class="text-surface-600-400 text-sm">{error}</p>
			<a class="btn preset-tonal w-full" href="/">Go to sign in</a>
		{:else}
			<form class="space-y-4" onsubmit={submit}>
				<div>
					<h1 class="text-lg font-semibold">
						{kind === "register"
							? "Create your account"
							: "Set a new password"}
					</h1>
					<p class="text-surface-600-400 text-sm">
						{#if kind === "register"}
							Choose a username and password to finish joining.
						{:else}
							You're taking over <strong>
								{existingUsername}
							</strong>
							. Setting a new password signs out any other sessions
							and removes existing two-factor credentials.
						{/if}
					</p>
				</div>

				{#if kind === "register"}
					<label class="label">
						<span class="label-text">Username</span>
						<input
							class="input"
							type="text"
							bind:value={username}
							autocomplete="username"
							minlength="3"
						/>
					</label>
				{/if}

				<label class="label">
					<span class="label-text">Passphrase</span>
					<input
						class="input"
						type="password"
						bind:value={passphrase}
					/>
				</label>
				<label class="label">
					<span class="label-text">Confirm passphrase</span>
					<input class="input" type="password" bind:value={confirm} />
				</label>

				{#if error}
					<p class="text-error-500 text-sm" role="alert">{error}</p>
				{/if}

				<button
					type="submit"
					class="btn preset-filled-primary-500 w-full"
					disabled={busy ||
						!passphrase ||
						(kind === "register" && username.trim().length < 3)}
				>
					{busy ? "Working…" : "Continue"}
				</button>
			</form>
		{/if}
	</div>
</div>
