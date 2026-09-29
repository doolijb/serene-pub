<script lang="ts">
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import TotpSettings from "./TotpSettings.svelte"
	import PluginUserSettingsCard from "./PluginUserSettingsCard.svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { getContext, onDestroy } from "svelte"
	import { goto } from "$app/navigation"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import type { SocketEventMap } from "$lib/client/sockets/typedSocket"
	import {
		accessibilityModeStore,
		enableAccessibility,
		disableAccessibility
	} from "$lib/client/accessibility/state.svelte"
	import { z } from "zod"
	import {
		passphraseSchema,
		PASSPHRASE_RULE_HINT
	} from "$lib/shared/validation/passphrase"
	import * as Icons from "@lucide/svelte"
	import LanguagePicker from "$lib/client/components/inputs/LanguagePicker.svelte"
	import { languageDefinition } from "$lib/shared/i18n/languages"
	// See the note at the `t()` import in `src/routes/+page.svelte`: the English
	// source is the key, and wrapping a string is the whole cost of translating
	// it. This card is wrapped because it is the one a user reaches *to change
	// their language* — the least useful place to be stuck in English.
	import { t } from "$lib/client/i18n/state.svelte"

	interface Props {
		hasUnsavedChanges?: boolean
	}

	let { hasUnsavedChanges = $bindable(false) }: Props = $props()

	const socket = useTypedSocket()
	const panelsCtx: PanelsCtx = getContext("panelsCtx")

	// Declared through the interest registry below, which counts subscribers
	// per key and releases only this tab's. The hazard that replaces is a bare
	// `socket.off(event)`, which removes EVERY listener for that event across
	// the app, not just this tab's.
	function handleUserSettingsUpdateShowAllCharacterFields(
		message: SocketEventMap["userSettings:updateShowAllCharacterFields"]["response"]
	) {
		if (message.success) {
			toaster.success({
				title: `Character fields display ${message.enabled ? "expanded" : "simplified"}`
			})
		} else {
			toaster.error({
				title: "Failed to update character fields setting"
			})
		}
	}

	function handleUserSettingsUpdateEasyCharacterCreation(
		message: SocketEventMap["userSettings:updateEasyCharacterCreation"]["response"]
	) {
		if (message.success) {
			toaster.success({
				title: `Easy character creation ${message.enabled ? "enabled" : "disabled"}`
			})
		} else {
			toaster.error({
				title: "Failed to update easy character creation setting"
			})
		}
	}

	function handleUserSettingsUpdateLanguage(
		message: SocketEventMap["userSettings:updateLanguage"]["response"]
	) {
		if (message.success) {
			// Names the language that will actually be used, which for the
			// inherit option is the server's, not "default".
			toaster.success({
				title: `Language set to ${languageDefinition(message.effectiveLanguage).name}`
			})
		}
	}

	function handleUsersCurrentUpdateDisplayName(
		message: SocketEventMap["users:current:updateDisplayName"]["response"]
	) {
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
	}

	function handleUsersCurrentChangePassphrase(
		message: SocketEventMap["users:current:changePassphrase"]["response"]
	) {
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
	}

	function handleUsersCurrentLogout(
		message: SocketEventMap["users:current:logout"]["response"]
	) {
		if (message.success) {
			toaster.success({
				title: "Logged out successfully"
			})
		} else {
			isLoggingOut = false
			toaster.error({ title: "Logout failed" })
		}
	}

	function handleUsersCurrentUpdateDisplayNameError(
		message: SocketEventMap["users:current:updateDisplayName:error"]["response"]
	) {
		isUpdatingDisplayName = false
		displayNameError = message.error || "Failed to update display name"
		toaster.error({
			title: "Display name error",
			description: message.error || "Failed to update display name"
		})
	}

	function handleUsersCurrentChangePassphraseError(
		message: SocketEventMap["users:current:changePassphrase:error"]["response"]
	) {
		isChangingPassword = false
		passwordError = message.error || "Failed to change passphrase"
		toaster.error({
			title: "Passphrase error",
			description: message.error || "Failed to change passphrase"
		})
	}

	function handleUsersCurrentLogoutError(
		message: SocketEventMap["users:current:logout:error"]["response"]
	) {
		isLoggingOut = false
		toaster.error({
			title: "Logout error",
			description: message.error || "Failed to logout"
		})
	}

	/**
	 * Every write reply this tab renders, all BARE and all STANDING.
	 *
	 * Bare because none of these events is in `SCOPED_EVENTS`: each is about
	 * the signed-in account, with no id to narrow to. Standing because each
	 * toggle, rename and passphrase change can happen again while the tab
	 * stays open, and because the two `userSettings:` cascades that follow a
	 * write are what keep the switches honest.
	 */
	useInterest<"userSettings:updateShowAllCharacterFields">(
		"userSettings:updateShowAllCharacterFields",
		handleUserSettingsUpdateShowAllCharacterFields
	)
	useInterest<"userSettings:updateEasyCharacterCreation">(
		"userSettings:updateEasyCharacterCreation",
		handleUserSettingsUpdateEasyCharacterCreation
	)
	useInterest<"userSettings:updateLanguage">(
		"userSettings:updateLanguage",
		handleUserSettingsUpdateLanguage
	)
	useInterest<"users:current:updateDisplayName">(
		"users:current:updateDisplayName",
		handleUsersCurrentUpdateDisplayName
	)
	useInterest<"users:current:changePassphrase">(
		"users:current:changePassphrase",
		handleUsersCurrentChangePassphrase
	)
	useInterest<"users:current:logout">(
		"users:current:logout",
		handleUsersCurrentLogout
	)
	useInterest<"users:current:updateDisplayName:error">(
		"users:current:updateDisplayName:error",
		handleUsersCurrentUpdateDisplayNameError
	)
	useInterest<"users:current:changePassphrase:error">(
		"users:current:changePassphrase:error",
		handleUsersCurrentChangePassphraseError
	)
	useInterest<"users:current:logout:error">(
		"users:current:logout:error",
		handleUsersCurrentLogoutError
	)

	onDestroy(() => {
		// The listeners are not here: the interest registry releases this
		// tab's subscribers as its effects are destroyed. What is left is the
		// one piece of state the parent shares with it.
		hasUnsavedChanges = false
	})

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

	// ── Language (R5) ────────────────────────────────────────────────────────
	// The inherit option names the language it would give you, so "Server
	// default" is never a choice made blind. `defaultLanguage` rides on the
	// system settings row every client already receives, admin or not.
	let serverDefaultOptionLabel = $derived.by(() => {
		const code = systemSettingsCtx.settings?.defaultLanguage
		return `${t("Server default")} (${languageDefinition(code).name})`
	})

	function onLanguageChange(value: string) {
		// "" is the inherit row, and it is stored as NULL rather than as a copy
		// of today's server default — that is what keeps this user moving when
		// an admin changes it later.
		socket.emit("userSettings:updateLanguage", {
			language: value === "" ? null : value
		})
	}

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

	// A successful save updates userCtx.user.displayName (see the server's
	// updateDisplayName handler, which re-runs the users:current handler),
	// which the effect above re-syncs displayName from — so this doesn't
	// need its own explicit reset after a save. Empty is "unsaveable," not
	// "unsaved" — an emptied field shouldn't prompt a discard-confirmation
	// for a value that was never going to be saved anyway.
	$effect(() => {
		hasUnsavedChanges =
			displayName.trim() !== "" &&
			displayName !== (userCtx.user?.displayName ?? "")
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
		panelsCtx.fullPageView = null
	}

	// The standard site had no way to undo the preference: the only
	// disableAccessibility() call lived on Document View's own settings page,
	// so anyone who left via Ctrl+Shift+Y was stranded on a site with no
	// off-switch, watching Document View return on the next restart.
	function exitDocumentView() {
		if (
			!confirm(
				"Turn off Document View? You can turn it back on any time with Ctrl+Shift+Y."
			)
		)
			return
		disableAccessibility()
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
	<!-- Language -->
	<div class="card preset-filled-surface-100-900 p-4">
		<h3 class="mb-2 text-sm font-medium">{t("Language")}</h3>
		<p class="text-surface-700-300 mb-3 text-sm">
			{t(
				"The language this interface is drawn in. Leave it on the server default to follow whatever an administrator has set for everyone."
			)}
		</p>
		<LanguagePicker
			label={t("Language")}
			inheritLabel={serverDefaultOptionLabel}
			value={userSettingsCtx.settings?.language ?? ""}
			describedBy="user-language-note"
			onValueChange={onLanguageChange}
		/>
		<p id="user-language-note" class="text-surface-700-300 mt-3 text-sm">
			{t(
				"Translations are produced automatically and are only as good as the translation service; text a translation has not reached yet stays in English. Your language also decides which retrieval features apply — see the Languages documentation page."
			)}
		</p>
	</div>

	<div
		class="card preset-filled-surface-100-900 divide-surface-300-700 divide-y p-4"
	>
		<div class="flex flex-col gap-2 pb-4">
			<p class="text-surface-600-400 text-sm">
				Shows every field on the character form (advanced/less-common
				ones included), instead of just the commonly-used subset.
			</p>
			<Switch
				name="show-all-character-fields"
				checked={userSettingsCtx.settings?.showAllCharacterFields ??
					false}
				onCheckedChange={onShowAllCharacterFieldsClick}
			>
				<Switch.Control
					class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
				>
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
				<Switch.Label class="font-semibold">
					Show all character fields
				</Switch.Label>
			</Switch>
		</div>

		<div class="flex flex-col gap-2 pt-4">
			<p class="text-surface-600-400 text-sm">
				Writing a character — or a persona — from the Characters panel's
				"New" menu opens a quick, simplified creator instead of the full
				character form. Turn off to always go straight to the full form.
			</p>
			<Switch
				name="easy-character-creation"
				checked={userSettingsCtx.settings
					?.enableEasyCharacterCreation ?? true}
				onCheckedChange={onEasyCharacterCreationClick}
			>
				<Switch.Control
					class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
				>
					<Switch.Thumb />
				</Switch.Control>
				<Switch.HiddenInput />
				<Switch.Label class="font-semibold">
					Easy character creation
				</Switch.Label>
			</Switch>
		</div>
	</div>

	<!-- Document View Section -->
	<div class="card preset-filled-surface-100-900 p-4">
		<h3 class="mb-2 text-sm font-medium">Document View</h3>
		<p class="text-surface-700-300 mb-3 text-sm">
			A simplified, high-contrast, keyboard- and screen-reader-friendly
			alternative to this interface. You can also switch to it any time
			with Ctrl+Shift+Y.
		</p>
		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				class="btn preset-filled-primary-500 w-fit max-w-full whitespace-normal"
				onclick={switchToDocumentView}
			>
				<Icons.Accessibility size={16} />
				Switch to Document View
			</button>
			{#if accessibilityModeStore.persisted}
				<button
					type="button"
					class="btn preset-tonal-error w-fit max-w-full whitespace-normal"
					onclick={exitDocumentView}
				>
					<Icons.X size={16} />
					Exit Document View
				</button>
			{/if}
		</div>
		{#if accessibilityModeStore.persisted}
			<p class="text-surface-700-300 mt-3 text-sm">
				This browser currently opens Document View by default.
			</p>
		{/if}
	</div>

	<!-- Extension settings that are this person's own (scope: 'user') -->
	<PluginUserSettingsCard />

	<!-- Import Section -->
	{#if userCtx.user?.isAdmin && !systemSettingsCtx.settings?.isAndroidWrapper}
		<div class="card preset-filled-surface-100-900 p-4">
			<h3 class="mb-4 text-sm font-medium">Data import</h3>
			<p class="text-surface-700-300 mb-3 text-sm">
				Import your characters, personas, sessions, and lorebooks from
				other applications.
			</p>
			<a
				href="/import"
				class="btn preset-filled-primary-500 w-fit max-w-full whitespace-normal"
				aria-label="Import from SillyTavern"
			>
				<Icons.Download size={16} />
				Import from SillyTavern
			</a>
		</div>
	{/if}

	<!-- User Profile Section - Only show when accounts are enabled -->
	{#if systemSettingsCtx.settings?.isAccountsEnabled && userCtx.user}
		<TotpSettings />

		<div class="card preset-filled-surface-100-900 p-4">
			<h3 class="mb-4 text-sm font-medium">User profile</h3>

			<!-- Display Name -->
			<div class="mb-4 flex flex-col gap-2">
				<label for="display-name" class="font-semibold">
					Display name
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
							Updating…
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
					class="btn preset-tonal-surface mx-auto w-fit"
					onclick={openChangePasswordModal}
				>
					<Icons.Key size={16} />
					Change passphrase
				</button>

				<button
					type="button"
					class="btn preset-tonal-error mx-auto w-fit"
					onclick={logout}
					disabled={isLoggingOut}
				>
					{#if isLoggingOut}
						<Icons.Loader2 size={16} class="animate-spin" />
						Logging out…
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
					<h2 class="text-xl font-bold">Change passphrase</h2>
					<button
						class="btn btn-icon preset-tonal-surface"
						aria-label="Close"
						onclick={closeChangePasswordModal}
					>
						<Icons.X class="h-5 w-5" />
					</button>
				</header>

				<article class="space-y-4">
					<div>
						<label for="current-password" class="font-semibold">
							Current passphrase
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
							New passphrase
						</label>
						<input
							id="new-password"
							type="password"
							class="input"
							bind:value={newPassword}
							placeholder="Enter new passphrase"
							disabled={isChangingPassword}
						/>
						<p class="text-surface-600-400 mt-1 text-sm">
							{PASSPHRASE_RULE_HINT}
						</p>
					</div>

					<div>
						<label for="confirm-password" class="font-semibold">
							Confirm new passphrase
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
							class="btn btn-sm preset-tonal-surface"
							onclick={closeChangePasswordModal}
							disabled={isChangingPassword}
						>
							Cancel
						</button>
						<button
							type="button"
							class="btn btn-sm preset-filled-primary-500"
							onclick={changePassword}
							disabled={isChangingPassword ||
								!currentPassword ||
								!newPassword ||
								!confirmPassword}
						>
							{#if isChangingPassword}
								<Icons.Loader2 size={16} class="animate-spin" />
								Changing…
							{:else}
								Change passphrase
							{/if}
						</button>
					</footer>
				</article>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
