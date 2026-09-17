<script lang="ts">
	/**
	 * Two-factor enrolment and management for the signed-in account (26 §10).
	 *
	 * Enrolment is two steps on purpose: a secret is generated, and the factor
	 * only takes effect once the user has produced a code from it. Enabling on
	 * generation would lock people out with a secret their app never received.
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"

	const socket = useTypedSocket()

	let status = $state<Sockets.Totp.Status.Response | null>(null)
	let enrolling = $state<Sockets.Totp.EnrollBegin.Response | null>(null)
	let recoveryCodes = $state<string[] | null>(null)
	let code = $state("")
	let disableCode = $state("")
	let busy = $state(false)

	function handleStatus(res: Sockets.Totp.Status.Response) {
		status = res
		busy = false
	}
	function handleBegin(res: Sockets.Totp.EnrollBegin.Response) {
		enrolling = res
		busy = false
	}
	function handleCodes(
		res:
			| Sockets.Totp.EnrollConfirm.Response
			| Sockets.Totp.RegenerateCodes.Response
	) {
		// Shown exactly once — only hashes are stored, so there is no second
		// chance to display them.
		recoveryCodes = res.recoveryCodes
		enrolling = null
		code = ""
		busy = false
	}
	function handleDisabled() {
		recoveryCodes = null
		disableCode = ""
		busy = false
		toaster.success({ title: "Two-factor authentication disabled" })
	}
	function handleError(res: Sockets.ErrorResponse) {
		busy = false
		toaster.error({ title: res.error })
	}

	const ERRORS = [
		"totp:status:error",
		"totp:enroll:begin:error",
		"totp:enroll:confirm:error",
		"totp:regenerateCodes:error",
		"totp:disable:error"
	] as const

	/**
	 * All ten keys BARE — no `totp:` event is in `SCOPED_EVENTS`; every one is
	 * about the signed-in account and there is nothing to narrow to. Standing
	 * rather than one-shot because `totp:status` is a cascade target: enrolling,
	 * regenerating codes and disabling each re-send it, which is how the panel
	 * swaps between its enrolled and not-enrolled halves without asking again.
	 */
	useInterest<"totp:status">("totp:status", handleStatus)
	useInterest<"totp:enroll:begin">("totp:enroll:begin", handleBegin)
	useInterest<"totp:enroll:confirm">("totp:enroll:confirm", handleCodes)
	useInterest<"totp:regenerateCodes">("totp:regenerateCodes", handleCodes)
	useInterest<"totp:disable">("totp:disable", handleDisabled)

	/**
	 * The five refusals, one `useInterest` per key so each gets its own effect
	 * and releases with the component. Errors are never gated (plan ruling 2);
	 * the registry is simply the only listener path now.
	 */
	for (const e of ERRORS) {
		useInterest<"totp:status:error">(e, handleError)
	}

	onMount(() => {
		socket.emit("totp:status", {})
	})

	const lowOnCodes = $derived(!!status?.enabled && status.remainingCodes <= 2)

	async function copyCodes() {
		if (!recoveryCodes) return
		await navigator.clipboard.writeText(recoveryCodes.join("\n"))
		toaster.success({ title: "Recovery codes copied" })
	}

	function downloadCodes() {
		if (!recoveryCodes) return
		// A wall of codes with no way to keep them is a wall of codes nobody
		// saves.
		const blob = new Blob(
			[
				"Serene Pub recovery codes\n",
				"Each code works once. Keep them somewhere you can reach without this app.\n\n",
				recoveryCodes.join("\n"),
				"\n"
			],
			{ type: "text/plain" }
		)
		const url = URL.createObjectURL(blob)
		const a = document.createElement("a")
		a.href = url
		a.download = "serene-pub-recovery-codes.txt"
		a.click()
		URL.revokeObjectURL(url)
	}
</script>

<div class="card preset-filled-surface-100-900 space-y-4 p-4">
	<div>
		<h3 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.ShieldCheck size={18} /> Two-factor authentication
		</h3>
		<p class="text-surface-600-400 text-sm">
			Require a code from an authenticator app when signing in.
		</p>
	</div>

	{#if recoveryCodes}
		<!-- Displayed once, immediately after they are issued. -->
		<div class="border-warning-500 space-y-3 rounded-lg border p-3">
			<p class="text-sm font-semibold">
				Save these recovery codes now — they will not be shown again.
			</p>
			<p class="text-surface-600-400 text-sm">
				Each one works once, and they are the only way back in if you
				lose your authenticator.
			</p>
			<ul
				class="grid grid-cols-1 gap-1 font-mono text-sm @lg/view:grid-cols-2"
			>
				{#each recoveryCodes as rc (rc)}
					<li>{rc}</li>
				{/each}
			</ul>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-sm preset-tonal"
					onclick={copyCodes}
				>
					<Icons.Copy size={14} /> Copy
				</button>
				<button
					type="button"
					class="btn btn-sm preset-tonal"
					onclick={downloadCodes}
				>
					<Icons.Download size={14} /> Download
				</button>
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500 ml-auto"
					onclick={() => (recoveryCodes = null)}
				>
					I've saved them
				</button>
			</div>
		</div>
	{:else if enrolling}
		<div class="space-y-3">
			<p class="text-sm">
				Add this account to your authenticator app, then enter the code
				it shows to finish.
			</p>
			<label class="label">
				<span class="label-text">Setup key</span>
				<input
					class="input font-mono"
					readonly
					value={enrolling.secret}
				/>
			</label>
			<p class="text-surface-600-400 text-xs break-all">
				Or use this setup URI:
				<code class="break-all whitespace-normal">
					{enrolling.otpauthUri}
				</code>
			</p>
			<label class="label">
				<span class="label-text">Code from your app</span>
				<input
					class="input"
					bind:value={code}
					placeholder="123456"
					autocomplete="one-time-code"
				/>
			</label>
			<div class="flex gap-2">
				<button
					type="button"
					class="btn preset-filled-primary-500"
					disabled={busy || !code.trim()}
					onclick={() => {
						busy = true
						socket.emit("totp:enroll:confirm", {
							code: code.trim()
						})
					}}
				>
					Enable
				</button>
				<button
					type="button"
					class="btn preset-tonal"
					onclick={() => {
						enrolling = null
						code = ""
					}}
				>
					Cancel
				</button>
			</div>
		</div>
	{:else if status?.enabled}
		<div class="space-y-3">
			<p class="text-success-500 flex items-center gap-2 text-sm">
				<Icons.Check size={16} /> Enabled
			</p>
			<p class="text-sm {lowOnCodes ? 'text-warning-600-400' : ''}">
				{status.remainingCodes} recovery code{status.remainingCodes ===
				1
					? ""
					: "s"} remaining.
				{#if lowOnCodes}
					Generate a new set before you run out — running out is how
					people get locked out.
				{/if}
			</p>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-sm preset-tonal"
					disabled={busy}
					onclick={() => {
						busy = true
						socket.emit("totp:regenerateCodes", {})
					}}
				>
					Generate new recovery codes
				</button>
			</div>
			<div class="border-surface-300-700 space-y-2 border-t pt-3">
				<label class="label">
					<span class="label-text">
						Enter a current code to turn two-factor off
					</span>
					<input
						class="input"
						bind:value={disableCode}
						placeholder="123456"
						autocomplete="one-time-code"
					/>
				</label>
				<button
					type="button"
					class="btn btn-sm preset-tonal-error"
					disabled={busy || !disableCode.trim()}
					onclick={() => {
						busy = true
						socket.emit("totp:disable", {
							code: disableCode.trim()
						})
					}}
				>
					Disable two-factor
				</button>
			</div>
		</div>
	{:else}
		<button
			type="button"
			class="btn preset-filled-primary-500"
			disabled={busy}
			onclick={() => {
				busy = true
				socket.emit("totp:enroll:begin", {})
			}}
		>
			Set up two-factor authentication
		</button>
	{/if}
</div>
