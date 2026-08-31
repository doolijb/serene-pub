<script lang="ts">
	/**
	 * The post-authentication setup steps (plan 27 §1).
	 *
	 * Rendered instead of the app, not inside it: the server refuses every
	 * handler outside a small allowlist until these are done, so an app shell
	 * here would be a screen of failing requests.
	 *
	 * Steps arrive ordered — password before two-factor — because someone handed
	 * an account invite has neither a password nor an authenticator, and only
	 * the password step can be satisfied first.
	 */
	import { onDestroy, onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import QrCode from "./QrCode.svelte"

	let { onDone }: { onDone: () => void } = $props()

	const socket = useTypedSocket()

	let pending = $state<("password" | "twoFactor")[]>([])
	let twoFactorRequired = $state(false)
	let ready = $state(false)
	let busy = $state(false)
	let error = $state<string | null>(null)

	let passphrase = $state("")
	let confirm = $state("")

	let enrolling = $state<Sockets.Totp.EnrollBegin.Response | null>(null)
	let code = $state("")
	let recoveryCodes = $state<string[] | null>(null)

	const step = $derived(pending[0] ?? null)

	function handleState(res: Sockets.Account.SetupState.Response) {
		pending = res.pending
		twoFactorRequired = res.twoFactorRequired
		ready = true
		busy = false
		if (pending[0] === "twoFactor" && !enrolling && !recoveryCodes) {
			socket.emit("totp:enroll:begin", {})
		}
	}
	function handlePassword(res: Sockets.Account.SetPassword.Response) {
		pending = res.pending
		busy = false
		passphrase = ""
		confirm = ""
		if (!pending.length) onDone()
		// Ask what kind of two-factor step this is rather than assuming
		// enrolment — see `alreadyEnrolled`.
		else if (pending[0] === "twoFactor") socket.emit("totp:status", {})
	}
	function handleBegin(res: Sockets.Totp.EnrollBegin.Response) {
		enrolling = res
		busy = false
	}
	function handleConfirmed(res: Sockets.Totp.EnrollConfirm.Response) {
		recoveryCodes = res.recoveryCodes
		enrolling = null
		busy = false
	}
	function handleError(res: Sockets.ErrorResponse) {
		busy = false
		error = res.error
	}

	const ERRORS = [
		"account:setupState:error",
		"account:setPassword:error",
		"totp:enroll:begin:error",
		"totp:enroll:confirm:error"
	] as const

	onMount(() => {
		socket.on("account:setupState", handleState)
		socket.on("account:setPassword", handlePassword)
		socket.on("totp:enroll:begin", handleBegin)
		socket.on("totp:enroll:confirm", handleConfirmed)
		for (const e of ERRORS) socket.on(e, handleError)
		socket.emit("account:setupState", {})
	})
	onDestroy(() => {
		socket.off("account:setupState", handleState)
		socket.off("account:setPassword", handlePassword)
		socket.off("totp:enroll:begin", handleBegin)
		socket.off("totp:enroll:confirm", handleConfirmed)
		for (const e of ERRORS) socket.off(e, handleError)
	})

	function submitPassword(event: Event) {
		event.preventDefault()
		error = null
		if (passphrase !== confirm) {
			error = "Those passphrases don't match."
			return
		}
		busy = true
		socket.emit("account:setPassword", { passphrase })
	}
</script>

<div class="flex min-h-screen items-center justify-center p-6">
	<div
		class="card preset-filled-surface-100-900 w-full max-w-md space-y-4 p-6"
	>
		{#if !ready}
			<p class="text-surface-600-400 text-sm">Loading…</p>
		{:else if recoveryCodes}
			<h1 class="flex items-center gap-2 text-lg font-semibold">
				<Icons.ShieldCheck size={20} /> Save your recovery codes
			</h1>
			<p class="text-surface-600-400 text-sm">
				Each works once, and they will not be shown again. They are the
				only way back in if you lose your authenticator.
			</p>
			<ul class="grid grid-cols-2 gap-1 font-mono text-sm">
				{#each recoveryCodes as rc (rc)}
					<li>{rc}</li>
				{/each}
			</ul>
			<button
				type="button"
				class="btn preset-filled-primary-500 w-full"
				onclick={onDone}
			>
				I've saved them — continue
			</button>
		{:else if step === "password"}
			<form class="space-y-4" onsubmit={submitPassword}>
				<div>
					<h1 class="text-lg font-semibold">Choose a password</h1>
					<p class="text-surface-600-400 text-sm">
						Set a password for your account to continue.
					</p>
				</div>
				<label class="label">
					<span class="label-text">New passphrase</span>
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
					disabled={busy || !passphrase}
				>
					Set password
				</button>
			</form>
		{:else if step === "twoFactor"}
			<div class="space-y-4">
				<div>
					<h1 class="flex items-center gap-2 text-lg font-semibold">
						<Icons.ShieldCheck size={20} /> Two-factor authentication
					</h1>
					<p class="text-surface-600-400 text-sm">
						{twoFactorRequired
							? "This instance requires a second factor on every account."
							: "Recommended. You can set this up later from settings."}
					</p>
				</div>
				{#if enrolling}
					<div class="flex justify-center">
						<QrCode
							value={enrolling.otpauthUri}
							label="Scan to add this account to your authenticator app"
						/>
					</div>
					<label class="label">
						<span class="label-text">
							Or enter this setup key manually
						</span>
						<input
							class="input font-mono"
							readonly
							value={enrolling.secret}
						/>
					</label>
					<label class="label">
						<span class="label-text">Code from your app</span>
						<input
							class="input"
							bind:value={code}
							placeholder="123456"
							autocomplete="one-time-code"
						/>
					</label>
					{#if error}
						<p class="text-error-500 text-sm" role="alert">
							{error}
						</p>
					{/if}
					<button
						type="button"
						class="btn preset-filled-primary-500 w-full"
						disabled={busy || !code.trim()}
						onclick={() => {
							busy = true
							error = null
							socket.emit("totp:enroll:confirm", {
								code: code.trim()
							})
						}}
					>
						Enable two-factor
					</button>
				{:else}
					<p class="text-surface-600-400 text-sm">Preparing…</p>
				{/if}
				{#if !twoFactorRequired}
					<button
						type="button"
						class="btn preset-tonal w-full"
						onclick={onDone}
					>
						Skip for now
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
