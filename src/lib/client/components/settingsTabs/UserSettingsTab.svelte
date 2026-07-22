<script lang="ts">
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { getContext, onMount, onDestroy } from "svelte"
	import { goto } from "$app/navigation"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { enableAccessibility } from "$lib/client/accessibility/state.svelte"
	import { z } from "zod"
	import * as Icons from "@lucide/svelte"

	const socket = useTypedSocket()

	onMount(() => {
		socket.on("userSettings:updateShowAllCharacterFields", (message) => {
			if (message.success) {
				toaster.success({
					title: `Character fields display ${message.enabled ? "expanded" : "simplified"}`
				})
			} else {
				toaster.error({
					title: "Failed to update character fields setting"
				})
			}
		})

		socket.on("userSettings:updateEasyCharacterCreation", (message) => {
			if (message.success) {
				toaster.success({
					title: `Easy character creation ${message.enabled ? "enabled" : "disabled"}`
				})
			} else {
				toaster.error({
					title: "Failed to update easy character creation setting"
				})
			}
		})

		socket.on("userSettings:updateEasyPersonaCreation", (message) => {
			if (message.success) {
				toaster.success({
					title: `Easy persona creation ${message.enabled ? "enabled" : "disabled"}`
				})
			} else {
				toaster.error({
					title: "Failed to update easy persona creation setting"
				})
			}
		})

		socket.on("userSettings:updateShowHomePageBanner", (message) => {
			if (message.success) {
				toaster.success({
					title: `Home page banner ${message.enabled ? "shown" : "hidden"}`
				})
			} else {
				toaster.error({
					title: "Failed to update home page banner setting"
				})
			}
		})

		// Profile socket listeners
		socket.on("users:current:updateDisplayName", (message) => {
			isUpdatingDisplayName = false
			if (message.success) {
				toaster.success({
					title: "Display name updated",
					description: `Updated to "${message.displayName}"`
				})
				displayNameError = ""
			} else {
				toaster.error({ title: "Failed to update display name" })
			}
		})

		socket.on("users:current:changePassphrase", (message) => {
			isChangingPassword = false
			if (message.success) {
				toaster.success({
					title: "Passphrase changed successfully",
					description:
						message.message || "Your passphrase has been updated"
				})
				closeChangePasswordModal()
			} else {
				toaster.error({ title: "Failed to change passphrase" })
			}
		})

		socket.on("users:current:logout", (message) => {
			if (message.success) {
				toaster.success({
					title: "Logged out successfully"
				})
			} else {
				isLoggingOut = false
				toaster.error({ title: "Logout failed" })
			}
		})

		// Error events
		socket.on("users:current:updateDisplayName:error", (message) => {
			isUpdatingDisplayName = false
			displayNameError = message.error || "Failed to update display name"
			toaster.error({
				title: "Display Name Error",
				description: message.error || "Failed to update display name"
			})
		})

		socket.on("users:current:changePassphrase:error", (message) => {
			isChangingPassword = false
			passwordError = message.error || "Failed to change passphrase"
			toaster.error({
				title: "Passphrase Error",
				description: message.error || "Failed to change passphrase"
			})
		})

		socket.on("users:current:logout:error", (message) => {
			isLoggingOut = false
			toaster.error({
				title: "Logout Error",
				description: message.error || "Failed to logout"
			})
		})
	})

	onDestroy(() => {
		socket?.off("userSettings:updateShowAllCharacterFields")
		socket?.off("userSettings:updateEasyCharacterCreation")
		socket?.off("userSettings:updateEasyPersonaCreation")
		socket?.off("userSettings:updateShowHomePageBanner")
		socket?.off("users:current:updateDisplayName")
		socket?.off("users:current:changePassphrase")
		socket?.off("users:current:logout")
		socket?.off("users:current:updateDisplayName:error")
		socket?.off("users:current:changePassphrase:error")
		socket?.off("users:current:logout:error")
	})

	// Passphrase validation schema
	const passphraseSchema = z
		.string()
		.min(6, "Passphrase must be at least 6 characters long")
		.regex(/[a-z]/, "Passphrase must contain at least one lowercase letter")
		.regex(/[A-Z]/, "Passphrase must contain at least one uppercase letter")
		.regex(
			/[^a-zA-Z0-9]/,
			"Passphrase must contain at least one special character"
		)

	// Display name validation schema
	const displayNameSchema = z
		.string()
		.min(3, "Display name must be at least 3 characters long")
		.max(50, "Display name must not exceed 50 characters")
		.trim()

	let userSettingsCtx: UserSettingsCtx = $state(getContext("userSettingsCtx"))
	let userCtx: UserCtx = $state(getContext("userCtx"))
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)

	// Profile modal state
	let showChangePasswordModal = $state(false)
	let isUpdatingDisplayName = $state(false)
	let isChangingPassword = $state(false)
	let isLoggingOut = $state(false)

	// Profile form data
	let displayName = $state("")
	let displayNameError = $state("")

	// Change password form data
	let currentPassword = $state("")
	let newPassword = $state("")
	let confirmPassword = $state("")
	let passwordError = $state("")

	$effect(() => {
		displayName = userCtx.user?.displayName || ""
	})

	async function onShowAllCharacterFieldsClick(event: { checked: boolean }) {
		socket?.emit("userSettings:updateShowAllCharacterFields", {
			enabled: event.checked
		})
	}

	async function onEasyCharacterCreationClick(event: { checked: boolean }) {
		socket?.emit("userSettings:updateEasyCharacterCreation", {
			enabled: event.checked
		})
	}

	async function onEasyPersonaCreationClick(event: { checked: boolean }) {
		socket?.emit("userSettings:updateEasyPersonaCreation", {
			enabled: event.checked
		})
	}

	async function onShowHomePageBannerClick(event: { checked: boolean }) {
		socket?.emit("userSettings:updateShowHomePageBanner", {
			enabled: event.checked
		})
	}

	// Profile functions
	async function updateDisplayName() {
		if (!displayName.trim()) {
			displayNameError = "Display name cannot be empty"
			return
		}

		try {
			displayNameSchema.parse(displayName.trim())
		} catch (error) {
			if (error instanceof z.ZodError) {
				displayNameError =
					error.errors[0]?.message || "Invalid display name"
				return
			}
		}

		displayNameError = ""
		isUpdatingDisplayName = true

		socket?.emit("users:current:updateDisplayName", {
			displayName: displayName.trim()
		})
	}

	function openChangePasswordModal() {
		showChangePasswordModal = true
		currentPassword = ""
		newPassword = ""
		confirmPassword = ""
		passwordError = ""
	}

	function closeChangePasswordModal() {
		showChangePasswordModal = false
		currentPassword = ""
		newPassword = ""
		confirmPassword = ""
		passwordError = ""
	}

	async function changePassword() {
		passwordError = ""

		if (!currentPassword) {
			passwordError = "Current passphrase is required"
			return
		}

		if (!newPassword) {
			passwordError = "New passphrase is required"
			return
		}

		if (newPassword !== confirmPassword) {
			passwordError = "New passphrases do not match"
			return
		}

		try {
			passphraseSchema.parse(newPassword)
		} catch (error) {
			if (error instanceof z.ZodError) {
				passwordError =
					error.errors[0]?.message || "Invalid new passphrase"
				return
			}
		}

		isChangingPassword = true

		socket?.emit("users:current:changePassphrase", {
			currentPassphrase: currentPassword,
			newPassphrase: newPassword
		})
	}

	function switchToDocumentView() {
		enableAccessibility()
		goto("/document-view")
	}

	async function logout() {
		isLoggingOut = true

		try {
			// First emit socket logout
			socket?.emit("users:current:logout", {})

			// Then call the API to clear the cookie
			const response = await fetch("/api/logout", {
				method: "POST",
				credentials: "include"
			})

			if (response.ok) {
				// Redirect to home page
				window.location.href = "/"
			} else {
				toaster.error({
					title: "Logout failed",
					description: "Please try again"
				})
			}
		} catch (error) {
			console.error("Logout error:", error)
			toaster.error({
				title: "Logout failed",
				description: "Please try again"
			})
		} finally {
			isLoggingOut = false
		}
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex gap-2">
		<Switch
			name="show-all-character-fields"
			checked={userSettingsCtx.settings?.showAllCharacterFields ?? false}
			onCheckedChange={onShowAllCharacterFieldsClick}
		>
			<Switch.Control
				class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
			>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.HiddenInput />
			<Switch.Label class="font-semibold">
				Show All Character Fields
			</Switch.Label>
		</Switch>
	</div>

	<div class="flex gap-2">
		<Switch
			name="easy-character-creation"
			checked={userSettingsCtx.settings?.enableEasyCharacterCreation ??
				true}
			onCheckedChange={onEasyCharacterCreationClick}
		>
			<Switch.Control
				class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
			>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.HiddenInput />
			<Switch.Label class="font-semibold">
				Easy Character Creation
			</Switch.Label>
		</Switch>
	</div>

	<div class="flex gap-2">
		<Switch
			name="easy-persona-creation"
			checked={userSettingsCtx.settings?.enableEasyPersonaCreation ??
				true}
			onCheckedChange={onEasyPersonaCreationClick}
		>
			<Switch.Control
				class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
			>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.HiddenInput />
			<Switch.Label class="font-semibold">
				Easy Persona Creation
			</Switch.Label>
		</Switch>
	</div>

	<div class="flex gap-2">
		<Switch
			name="show-home-page-banner"
			checked={userSettingsCtx.settings?.showHomePageBanner ?? true}
			onCheckedChange={onShowHomePageBannerClick}
		>
			<Switch.Control
				class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
			>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.HiddenInput />
			<Switch.Label class="font-semibold">
				Show Home Page Banner
			</Switch.Label>
		</Switch>
	</div>

	<!-- Document View Section -->
	<div class="mt-4 border-t pt-4">
		<h3 class="mb-2 text-lg font-semibold">Document View</h3>
		<p class="text-surface-700-300 mb-3 text-sm">
			A simplified, high-contrast, keyboard- and screen-reader-friendly
			alternative to this interface. You can also switch to it any time
			with Ctrl+Shift+Y.
		</p>
		<button
			type="button"
			class="btn preset-filled-primary-500 w-fit"
			onclick={switchToDocumentView}
		>
			<Icons.Accessibility size={16} />
			Switch to Document View
		</button>
	</div>

	<!-- Import Section -->
	{#if userCtx.user?.isAdmin && !systemSettingsCtx.settings?.isAndroidWrapper}
		<div class="mt-4 border-t pt-4">
			<h3 class="mb-4 text-lg font-semibold">Data Import</h3>
			<p class="text-surface-700-300 mb-3 text-sm">
				Import your characters, personas, chats, and lorebooks from
				other applications.
			</p>
			<a
				href="/import"
				class="btn preset-filled-primary-500 w-fit"
				aria-label="Import from SillyTavern"
			>
				<Icons.Download size={16} />
				Import from SillyTavern
			</a>
		</div>
	{/if}

	<!-- User Profile Section - Only show when accounts are enabled -->
	{#if systemSettingsCtx.settings?.isAccountsEnabled && userCtx.user}
		<div class="mt-4 border-t pt-4">
			<h3 class="mb-4 text-lg font-semibold">User Profile</h3>

			<!-- Display Name -->
			<div class="mb-4 flex flex-col gap-2">
				<label for="display-name" class="font-semibold">
					Display Name
				</label>
				<div class="flex gap-2">
					<input
						id="display-name"
						type="text"
						class="input flex-1"
						bind:value={displayName}
						placeholder="Enter your display name"
						disabled={isUpdatingDisplayName}
					/>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						onclick={updateDisplayName}
						disabled={isUpdatingDisplayName ||
							!displayName.trim() ||
							displayName === userCtx.user?.displayName}
					>
						{#if isUpdatingDisplayName}
							<Icons.Loader2 size={16} class="animate-spin" />
							Updating...
						{:else}
							Update
						{/if}
					</button>
				</div>
				{#if displayNameError}
					<p class="text-error-500 text-sm">{displayNameError}</p>
				{/if}
			</div>

			<!-- Profile Actions -->
			<div class="flex flex-col gap-2">
				<button
					type="button"
					class="btn preset-filled-secondary-500 mx-auto w-fit"
					onclick={openChangePasswordModal}
				>
					<Icons.Key size={16} />
					Change Passphrase
				</button>

				<button
					type="button"
					class="btn preset-filled-error-500 mx-auto w-fit"
					onclick={logout}
					disabled={isLoggingOut}
				>
					{#if isLoggingOut}
						<Icons.Loader2 size={16} class="animate-spin" />
						Logging Out...
					{:else}
						<Icons.LogOut size={16} />
						Logout
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>

<!-- Change Password Modal -->
<Dialog
	open={showChangePasswordModal}
	onOpenChange={(e) => (showChangePasswordModal = e.open)}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 max-w-lg space-y-6 p-6 shadow-xl"
			>
				<header class="flex items-center justify-between">
					<h2 class="text-xl font-bold">Change Passphrase</h2>
					<button
						class="btn-ghost"
						aria-label="Close"
						onclick={closeChangePasswordModal}
					>
						<Icons.X class="h-5 w-5" />
					</button>
				</header>

				<article class="space-y-4">
					<div>
						<label for="current-password" class="font-semibold">
							Current Passphrase
						</label>
						<input
							id="current-password"
							type="password"
							class="input"
							bind:value={currentPassword}
							placeholder="Enter current passphrase"
							disabled={isChangingPassword}
						/>
					</div>

					<div>
						<label for="new-password" class="font-semibold">
							New Passphrase
						</label>
						<input
							id="new-password"
							type="password"
							class="input"
							bind:value={newPassword}
							placeholder="Enter new passphrase"
							disabled={isChangingPassword}
						/>
						<p class="text-muted-foreground mt-1 text-sm">
							Must be at least 6 characters with uppercase,
							lowercase, and special character
						</p>
					</div>

					<div>
						<label for="confirm-password" class="font-semibold">
							Confirm New Passphrase
						</label>
						<input
							id="confirm-password"
							type="password"
							class="input"
							bind:value={confirmPassword}
							placeholder="Confirm new passphrase"
							disabled={isChangingPassword}
						/>
					</div>

					{#if passwordError}
						<p class="text-error-500 text-sm">{passwordError}</p>
					{/if}

					<footer class="flex justify-end gap-2">
						<button
							type="button"
							class="btn btn-sm variant-ghost"
							onclick={closeChangePasswordModal}
							disabled={isChangingPassword}
						>
							Cancel
						</button>
						<button
							type="button"
							class="btn btn-sm variant-filled-primary"
							onclick={changePassword}
							disabled={isChangingPassword ||
								!currentPassword ||
								!newPassword ||
								!confirmPassword}
						>
							{#if isChangingPassword}
								<Icons.Loader2 size={16} class="animate-spin" />
								Changing...
							{:else}
								Change Passphrase
							{/if}
						</button>
					</footer>
				</article>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
