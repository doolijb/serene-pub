<script lang="ts">
	/**
	 * User accounts — the one-way switch to authentication and multi-user
	 * support. Turning it on first makes sure the admin has a passphrase, so
	 * the instance can never lock its only user out. The Network page links
	 * here (`#accounts`) because a tunnel cannot start without it.
	 */
	import { getContext } from "svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { z } from "zod"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import SettingSwitch from "./SettingSwitch.svelte"
	import { requireAdmin } from "./requireAdmin"
	import {
		passphraseSchema,
		PASSPHRASE_MIN_LENGTH
	} from "$lib/shared/validation/passphrase"


	const socket = useTypedSocket()
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let userCtx: UserCtx = $state(getContext("userCtx"))

	let showModal = $state(false)
	let hasPassphrase = $state(false)
	let passphrase = $state("")
	let confirmPassphrase = $state("")
	let passphraseError = $state("")
	let isSettingPassphrase = $state(false)

	const accountsOn = $derived(!!systemSettingsCtx.settings?.isAccountsEnabled)

	function handleEnableAccountsClick(event: { checked: boolean }) {
		if (!requireAdmin(userCtx.user)) return
		if (event.checked) {
			// Ask whether a passphrase exists first; the reply opens the dialog.
			socket?.emit("users:current:hasPassphrase", {})
		} else {
			socket?.emit("systemSettings:updateAccountsEnabled", {
				enabled: event.checked
			})
		}
	}

	function openModal() {
		showModal = true
		if (!hasPassphrase) {
			passphrase = ""
			confirmPassphrase = ""
			passphraseError = ""
		}
	}

	function validatePassphrase() {
		passphraseError = ""
		if (!passphrase) {
			passphraseError = "Passphrase is required"
			return false
		}
		if (passphrase !== confirmPassphrase) {
			passphraseError = "Passphrases do not match"
			return false
		}
		try {
			passphraseSchema.parse(passphrase)
			return true
		} catch (error) {
			if (error instanceof z.ZodError) {
				passphraseError = error.errors.map((e) => e.message).join(", ")
			}
			return false
		}
	}

	function confirmEnableAccounts() {
		if (!requireAdmin(userCtx.user)) return
		if (!hasPassphrase) {
			if (!validatePassphrase()) return
			isSettingPassphrase = true
			socket?.emit("users:current:setPassphrase", { passphrase })
		} else {
			socket?.emit("systemSettings:updateAccountsEnabled", {
				enabled: true
			})
			showModal = false
		}
	}

	function cancelEnableAccounts() {
		showModal = false
		passphrase = ""
		confirmPassphrase = ""
		passphraseError = ""
	}

	$effect(() => {
		if (!socket) return

		const handleAccountsEnabled = (message: any) => {
			if (message.success) {
				toaster.success({
					title: "User accounts turned on",
					description: "Authentication is now required for all users"
				})
			} else {
				toaster.error({ title: "Failed to turn on user accounts" })
			}
		}
		// The switch is bound to `systemSettingsCtx.settings`, which the
		// server only updates on success, so on failure it already reverts;
		// this only says why. `:error` events are never gated (ruling 2).
		const handleAccountsEnabledError = (message: { error?: string }) => {
			toaster.error({
				title: "Cannot turn on user accounts",
				description: message.error
			})
		}
		const handleHasPassphrase = (message: any) => {
			hasPassphrase = message.hasPassphrase
			openModal()
		}
		const handleSetPassphrase = (message: any) => {
			isSettingPassphrase = false
			if (message.success) {
				hasPassphrase = true
				passphrase = ""
				confirmPassphrase = ""
				passphraseError = ""
				toaster.success({ title: "Passphrase set" })
				socket?.emit("systemSettings:updateAccountsEnabled", {
					enabled: true
				})
				showModal = false
			} else {
				passphraseError = message.message || "Failed to set passphrase"
				toaster.error({
					title: "Failed to set passphrase",
					description: message.message
				})
			}
		}

		// BARE and standing: each is about this instance or this account,
		// and the switch can be pressed again while the page stays open. The
		// app-wide registry, as before the split — neither prefix is
		// restricted; the server's handlers hold the admin boundary.
		const releases = [
			declareInterest<"systemSettings:updateAccountsEnabled">(
				"systemSettings:updateAccountsEnabled",
				handleAccountsEnabled
			),
			declareInterest<"systemSettings:updateAccountsEnabled:error">(
				"systemSettings:updateAccountsEnabled:error",
				handleAccountsEnabledError
			),
			declareInterest<"users:current:hasPassphrase">(
				"users:current:hasPassphrase",
				handleHasPassphrase
			),
			declareInterest<"users:current:setPassphrase">(
				"users:current:setPassphrase",
				handleSetPassphrase
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})
</script>

<section
	id="accounts"
	class="panel-card flex scroll-mt-4 flex-col gap-3"
	aria-labelledby="accounts-heading"
>
	<h2 id="accounts-heading" class="text-sm font-medium">User accounts</h2>
	<p class="flex items-center gap-2 text-sm">
		<span
			class="size-2 shrink-0 rounded-full {accountsOn
				? 'bg-success-500'
				: 'bg-surface-500'}"
			aria-hidden="true"
		></span>
		{accountsOn ? "On — sign-in is required" : "Off — anyone who can reach this instance uses it as you"}
	</p>
	<SettingSwitch
		name="enable-accounts"
		label="User accounts"
		checked={accountsOn}
		disabled={accountsOn}
		onCheckedChange={handleEnableAccountsClick}
	/>
	<p class="text-surface-600-400 text-sm">
		{accountsOn
			? "User accounts are on. This setting cannot be reversed. Add and manage people in People › Users."
			: "Turns on sign-in and multi-user support. This is a permanent change, and it is required before a tunnel can make this instance public."}
	</p>
</section>

<Dialog open={showModal} onOpenChange={(e) => (showModal = e.open)}>
	<Portal>
		<Dialog.Backdrop class="bg-surface-950/60 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 max-w-lg space-y-6 p-6 shadow-xl">
				<header class="flex items-center justify-between">
					<Dialog.Title class="text-xl font-semibold">
						Turn on user accounts?
					</Dialog.Title>
					<button
						type="button"
						class="btn btn-icon preset-tonal-surface"
						aria-label="Close"
						onclick={cancelEnableAccounts}
					>
						<Icons.X class="h-5 w-5" />
					</button>
				</header>
				<article class="space-y-4">
					<div class="text-warning-600-400 flex items-center gap-2">
						<Icons.TriangleAlert class="h-5 w-5" />
						<span class="font-semibold">This cannot be reversed</span>
					</div>
					<p>
						User accounts turn on sign-in and multi-user support.
						Once on, they stay on.
					</p>
					<p class="text-surface-600-400 text-sm">
						After this, every new person needs an account, which you
						create in People › Users.
					</p>

					{#if !hasPassphrase}
						<div
							class="bg-warning-500/10 border-warning-500/20 space-y-3 rounded-lg border p-4"
						>
							<div class="text-warning-600-400 flex items-center gap-2">
								<Icons.Key class="h-4 w-4" />
								<span class="font-semibold">Passphrase required</span>
							</div>
							<p class="text-sm">
								Set a passphrase for your account to continue.
							</p>
							<div class="space-y-3">
								<div>
									<label class="mb-1 block text-xs text-surface-600-400" for="accounts-username">
										Username
									</label>
									<input
										id="accounts-username"
										value={userCtx.user!.username}
										class="input w-full"
										disabled
									/>
								</div>
								<div>
									<label class="mb-1 block text-xs text-surface-600-400" for="accounts-passphrase">
										Passphrase
									</label>
									<input
										id="accounts-passphrase"
										type="password"
										bind:value={passphrase}
										placeholder="Enter your passphrase"
										class="input w-full {passphraseError ? 'border-error-500' : ''}"
									/>
								</div>
								<div>
									<label class="mb-1 block text-xs text-surface-600-400" for="accounts-confirm-passphrase">
										Confirm passphrase
									</label>
									<input
										id="accounts-confirm-passphrase"
										type="password"
										bind:value={confirmPassphrase}
										placeholder="Confirm your passphrase"
										class="input w-full {passphraseError ? 'border-error-500' : ''}"
									/>
								</div>
								{#if passphraseError}
									<p class="text-error-600-400 text-sm">{passphraseError}</p>
								{/if}
								<div class="text-surface-600-400 text-xs">
									<p>Requirements:</p>
									<ul class="ml-2 list-inside list-disc space-y-1">
										<li>At least {PASSPHRASE_MIN_LENGTH} characters long</li>
										<li>At least one lowercase letter</li>
										<li>At least one uppercase letter</li>
										<li>At least one special character</li>
									</ul>
								</div>
							</div>
						</div>
					{/if}
				</article>
				<footer class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal-surface"
						onclick={cancelEnableAccounts}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						onclick={confirmEnableAccounts}
						disabled={isSettingPassphrase}
					>
						{#if isSettingPassphrase}
							<Icons.Loader2 class="h-4 w-4 animate-spin" />
							Setting up…
						{:else}
							<Icons.Shield class="h-4 w-4" />
							{hasPassphrase ? "Turn on accounts" : "Set passphrase and turn on"}
						{/if}
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
