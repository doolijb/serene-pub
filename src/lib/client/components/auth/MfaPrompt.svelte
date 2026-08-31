<script lang="ts">
	/**
	 * The second-factor step at sign-in (plan 26 §10).
	 *
	 * Rendered instead of the app, not inside it: the session is authenticated
	 * by password but the server refuses every handler outside a small
	 * allowlist until a code is submitted, so an app shell here would be a
	 * screen full of failing requests.
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	let { onDone }: { onDone: () => void } = $props()

	const socket = useTypedSocket()

	let code = $state("")
	let error = $state<string | null>(null)
	let busy = $state(false)
	let input = $state<HTMLInputElement | null>(null)

	function handleVerified(res: Sockets.Totp.Verify.Response) {
		busy = false
		if (res.usedRecoveryCode) {
			// Consuming a code means the authenticator is probably gone. The
			// count is the only warning anyone gets before running out.
			console.warn(
				`Recovery code used — ${res.remainingCodes} remaining.`
			)
		}
		onDone()
	}

	function handleError(res: Sockets.ErrorResponse) {
		busy = false
		error = res.error
		code = ""
		input?.focus()
	}

	onMount(() => {
		socket.on("totp:verify", handleVerified)
		socket.on("totp:verify:error", handleError)
		input?.focus()
		return () => {
			socket.off("totp:verify", handleVerified)
			socket.off("totp:verify:error", handleError)
		}
	})

	function submit(event: Event) {
		event.preventDefault()
		if (busy || !code.trim()) return
		busy = true
		error = null
		socket.emit("totp:verify", { code: code.trim() })
	}
</script>

<form class="space-y-4" onsubmit={submit}>
	<div class="space-y-1">
		<h1 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.ShieldCheck size={20} /> Two-factor authentication
		</h1>
		<p class="text-surface-600-400 text-sm">
			Enter the 6-digit code from your authenticator app, or one of your
			recovery codes.
		</p>
	</div>

	<label class="label">
		<span class="label-text">Code</span>
		<input
			bind:this={input}
			bind:value={code}
			class="input"
			type="text"
			autocomplete="one-time-code"
			inputmode="text"
			placeholder="123456"
			disabled={busy}
		/>
	</label>

	{#if error}
		<p class="text-error-500 text-sm" role="alert">{error}</p>
	{/if}

	<button
		type="submit"
		class="btn preset-filled-primary-500 w-full"
		disabled={busy || !code.trim()}
	>
		{busy ? "Checking…" : "Verify"}
	</button>

	<p class="text-surface-600-400 text-xs">
		Lost your authenticator and your recovery codes? An administrator can
		clear two-factor for your account. If you are the only administrator,
		see the account-recovery section of
		<code>.env.example</code>
		.
	</p>
</form>
