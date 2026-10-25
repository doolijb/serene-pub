<script lang="ts">
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	import InlineError from "$lib/client/components/InlineError.svelte"
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
		displayNameSchema,
		DISPLAY_NAME_MAX_LENGTH
	} from "$lib/shared/validation/displayName"
	import {
		passphraseSchema,
		PASSPHRASE_RULE_HINT
	} from "$lib/shared/validation/passphrase"
	import * as Icons from "@lucide/svelte"
	import LanguagePicker from "$lib/client/components/inputs/LanguagePicker.svelte"
	import TimeZonePicker from "$lib/client/components/inputs/TimeZonePicker.svelte"
	import {
		browserTimeZone,
		displayTimeZone,
		realDateTime
	} from "$lib/client/utils/realTime.svelte"
	import { docsHref } from "$lib/shared/utils/docsHref"
	import { languageDefinition } from "$lib/shared/i18n/languages"
	import LoreWriteModePicker from "$lib/client/components/inputs/LoreWriteModePicker.svelte"
	import RoutineCapsCard from "./RoutineCapsCard.svelte"
	import SettingCard from "./SettingCard.svelte"
	import AvatarPicker from "$lib/client/components/media/AvatarPicker.svelte"
	import { avatarSrc } from "$lib/client/utils/media"
	import {
		LORE_WRITE_MODE_CHOICES,
		effectiveLoreWriteMode,
		type LoreWriteMode
	} from "$lib/shared/lorebooks/loreWriteMode"
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

	function handleUsersCurrentSetTimeZone(
		message: SocketEventMap["users:current:setTimeZone"]["response"]
	) {
		// The shell's first-load report lands here too; only a change the
		// picker asked for is worth a toast.
		if (!timeZoneRequested) return
		timeZoneRequested = false
		if (message.success)
			toaster.success({ title: `${t("Time zone set to")} ${message.timeZone}` })
	}

	function handleUsersCurrentSetTimeZoneError(
		message: SocketEventMap["users:current:setTimeZone:error"]["response"]
	) {
		timeZoneRequested = false
		toaster.error({ title: message.error || t("Failed to set time zone") })
	}

	function handleUsersCurrentUpdateDisplayName(
		message: SocketEventMap["users:current:updateDisplayName"]["response"]
	) {
		isUpdatingDisplayName = false
		if (message.success) {
			toaster.success({
				title: message.displayName
					? "Display name updated"
					: "Display name cleared",
				description: message.displayName
					? `Updated to "${message.displayName}"`
					: `You'll go by your username, "${userCtx.user?.username ?? ""}".`
			})
			displayNameError = ""
		} else {
			toaster.error({ title: "Failed to update display name" })
		}
	}

	function handleUsersCurrentUpdateAvatar(
		message: SocketEventMap["users:current:updateAvatar"]["response"]
	) {
		// Every tab of the account hears it; only the one that sent the
		// picture holds its crop.
		if (!isUpdatingAvatar) return
		isUpdatingAvatar = false
		avatarPicker?.commitPendingFrame(message.avatarMediaId)
		avatarPicker?.clear()
		// Drawn now rather than when the `users:current` behind it lands.
		if (userCtx.user)
			userCtx.user = {
				...userCtx.user,
				avatarMediaId: message.avatarMediaId,
				avatarMedia: message.avatarMedia
			}
		toaster.success({
			title: message.avatarMediaId ? "Avatar updated" : "Avatar removed"
		})
	}

	function handleUsersCurrentUpdateAvatarError(
		message: SocketEventMap["users:current:updateAvatar:error"]["response"]
	) {
		if (!isUpdatingAvatar) return
		isUpdatingAvatar = false
		avatarPicker?.clear()
		toaster.error({
			title: "Avatar error",
			description: message.error || "The avatar could not be saved."
		})
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
	useInterest<"users:current:setTimeZone">(
		"users:current:setTimeZone",
		handleUsersCurrentSetTimeZone
	)
	useInterest<"users:current:setTimeZone:error">(
		"users:current:setTimeZone:error",
		handleUsersCurrentSetTimeZoneError
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
	useInterest<"users:current:updateAvatar">(
		"users:current:updateAvatar",
		handleUsersCurrentUpdateAvatar
	)
	useInterest<"users:current:updateAvatar:error">(
		"users:current:updateAvatar:error",
		handleUsersCurrentUpdateAvatarError
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
		return `${t("Pub default")} (${languageDefinition(code).name})`
	})

	function onLanguageChange(value: string) {
		// "" is the inherit row, and it is stored as NULL rather than as a copy
		// of today's server default — that is what keeps this user moving when
		// an admin changes it later.
		socket.emit("userSettings:updateLanguage", {
			language: value === "" ? null : value
		})
	}

	// ── Time zone ─────────────────────────────────────────────────────────────
	// Where real-world times are SHOWN. Storage is UTC; story time is the
	// session's or lorebook's timeline and never reads this.
	let timeZoneRequested = false
	function onTimeZoneChange(value: string) {
		if (!value) return
		timeZoneRequested = true
		socket.emit("users:current:setTimeZone", { timeZone: value })
	}

	// ── Lorebook writes from sessions (plan A22) ─────────────────────────────
	// As the language: the inherit choice names what it gives today, and is
	// stored as NULL so an admin moving the instance's moves this person too.
	let pubLoreWriteMode = $derived(
		effectiveLoreWriteMode(
			null,
			systemSettingsCtx.settings?.loreWriteModeDefault
		)
	)
	let loreWriteInheritLabel = $derived(
		`Use the pub default (${LORE_WRITE_MODE_CHOICES[pubLoreWriteMode].label})`
	)

	function onLoreWriteModeChange(mode: LoreWriteMode | null) {
		socket.emit("userSettings:updateLoreWriteMode", { mode })
	}

	// Profile modal state
	let showChangePasswordModal = $state(false)
	let isUpdatingDisplayName = $state(false)
	let isChangingPassword = $state(false)
	let isLoggingOut = $state(false)

	// Profile form data
	let displayName = $state("")
	let displayNameError = $state("")

	// The account's avatar: no Save of its own, so the crop editor's Save
	// sends it (`onCommit`), and Remove clears it at once.
	let avatarPicker = $state<ReturnType<typeof AvatarPicker> | null>(null)
	let avatarFile = $state<File | undefined>()
	let avatarPreview = $state("")
	let isUpdatingAvatar = $state(false)

	function uploadAvatar(file: File) {
		isUpdatingAvatar = true
		socket.emit("users:current:updateAvatar", {
			// Socket.IO marshals a browser File to a Node Buffer.
			avatarFile: file as unknown as Buffer
		})
	}

	function removeAvatar() {
		isUpdatingAvatar = true
		socket.emit("users:current:updateAvatar", { avatarFile: null })
	}

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
	// need its own explicit reset after a save. Empty is a value too: saving
	// it clears the name back to the username.
	let displayNameChanged = $derived(
		(displayName.trim() || null) !== (userCtx.user?.displayName ?? null)
	)
	$effect(() => {
		hasUnsavedChanges = displayNameChanged
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
		const parsed = displayNameSchema.safeParse(displayName)
		if (!parsed.success) {
			displayNameError =
				parsed.error.errors[0]?.message || "Invalid display name"
			return
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

<!-- One card per setting (STYLE-GUIDE §6.4, setting cards): the title is the
     setting's name and its control's label, one sentence of help, the
     control beside the words once the view is wide enough. -->
<div class="flex max-w-[760px] flex-col gap-3">
	<SettingCard
		title={t("Language")}
		titleId="user-language-heading"
		helpId="user-language-note"
	>
		{#snippet help()}
			{t("Pub default follows what an administrator set for everyone.")}
			<a
				class="anchor"
				href={docsHref(
					"languages",
					"for-power-users-language-and-lore-search"
				)}
			>
				{t("How language affects search")}
			</a>
		{/snippet}
		<LanguagePicker
			label={t("Language")}
			labelHidden
			inheritLabel={serverDefaultOptionLabel}
			value={userSettingsCtx.settings?.language ?? ""}
			describedBy="user-language-note"
			onValueChange={onLanguageChange}
		/>
	</SettingCard>

	<SettingCard
		title={t("Time zone")}
		titleId="user-time-zone-heading"
		help={t("Real-world dates and times are shown in it; story time keeps its own.")}
	>
		<TimeZonePicker
			label={t("Time zone")}
			labelHidden
			value={userCtx.user?.timeZone ?? browserTimeZone()}
			describedBy="user-time-zone-note"
			onValueChange={onTimeZoneChange}
		/>
		<p id="user-time-zone-note" class="text-surface-600-400 text-xs">
			{t("Now")}: {realDateTime(new Date(), { dateStyle: "medium", timeStyle: "short" })}
			({displayTimeZone()})
		</p>
	</SettingCard>

	<!-- Lorebook writes from sessions (plan A22) -->
	<SettingCard
		title="Lorebook writes from sessions"
		titleId="user-lore-write-mode-heading"
		helpId="user-lore-write-mode-note"
		help="How your sessions may change the lorebooks you own; a lorebook can allow less, never more."
		layout="stack"
	>
		<LoreWriteModePicker
			legend="Lorebook writes from sessions"
			name="user-lore-write-mode"
			value={userSettingsCtx.settings?.loreWriteMode ?? null}
			inheritLabel={loreWriteInheritLabel}
			inheritDescription="Follow whatever an administrator has set for everyone."
			describedBy="user-lore-write-mode-note"
			onValueChange={onLoreWriteModeChange}
		/>
	</SettingCard>

	<!-- 🚧 Background routines (R11; lane 7): this person's own caps on
	     their sessions' real-time routines, under the pub's. -->
	<RoutineCapsCard scope="user" />

	<SettingCard
		title="Show all character fields"
		titleId="user-show-all-fields-heading"
		help="Every field on the character form, not just the common ones."
		layout="switch"
	>
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
			<Switch.Label class="sr-only">Show all character fields</Switch.Label>
		</Switch>
	</SettingCard>

	<SettingCard
		title="Easy character creation"
		titleId="user-easy-creation-heading"
		help="New in the Characters view opens a quick creator; off, it goes straight to the full form."
		layout="switch"
	>
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
			<Switch.Label class="sr-only">Easy character creation</Switch.Label>
		</Switch>
	</SettingCard>

	<SettingCard
		title="Document View"
		titleId="user-document-view-heading"
		help="A simplified, high-contrast view for the keyboard and screen readers; Ctrl+Shift+Y switches any time."
	>
		<button
			type="button"
			class="btn preset-tonal-surface w-fit max-w-full whitespace-normal"
			onclick={switchToDocumentView}
		>
			<Icons.Accessibility size={16} aria-hidden="true" />
			Switch to Document View
		</button>
		{#if accessibilityModeStore.persisted}
			<button
				type="button"
				class="btn preset-tonal-surface w-fit max-w-full whitespace-normal"
				onclick={exitDocumentView}
			>
				<Icons.X size={16} aria-hidden="true" />
				Exit Document View
			</button>
			<FieldHelp>
				This browser opens Document View by default.
			</FieldHelp>
		{/if}
	</SettingCard>

	<!-- Extension settings that are this person's own (scope: 'user') -->
	<PluginUserSettingsCard />

	<!-- Import: opens this view's own Import section (owner note 23,
	     2026-10-02; it was the /import page). -->
	{#if userCtx.user?.isAdmin && !systemSettingsCtx.settings?.isAndroidWrapper}
		<SettingCard
			title="Data import"
			titleId="user-data-import-heading"
			help="Characters, personas, sessions and lorebooks from another app."
		>
			<button
				type="button"
				class="btn preset-tonal-surface w-fit max-w-full whitespace-normal"
				onclick={() => (panelsCtx.digest.settingsSection = "import")}
			>
				<Icons.Download size={16} aria-hidden="true" />
				Import from SillyTavern
			</button>
		</SettingCard>
	{/if}

	<!-- User profile: the display name is everyone's, in every mode; the
	     sign-in pieces (two-step, passphrase, logout) need accounts on. -->
	{#if userCtx.user}
		{#if systemSettingsCtx.settings?.isAccountsEnabled}
			<TotpSettings />
		{/if}

		<section
			class="panel-card flex flex-col gap-4"
			aria-labelledby="user-profile-heading"
		>
			<h3 id="user-profile-heading" class="text-lead font-medium">
				User profile
			</h3>

			<!-- Avatar: round, as the account is drawn everywhere. -->
			<div class="flex items-start gap-4">
				<AvatarPicker
					bind:this={avatarPicker}
					bind:file={avatarFile}
					bind:preview={avatarPreview}
					src={avatarSrc(userCtx.user, { full: true })}
					mediaId={userCtx.user.avatarMediaId}
					media={userCtx.user.avatarMedia}
					shape="round"
					glyph={Icons.User}
					subject="your avatar"
					busy={isUpdatingAvatar}
					onCommit={uploadAvatar}
					onRemove={removeAvatar}
				/>
				<div class="flex min-w-0 flex-col gap-1">
					<p class="text-sm font-medium">Avatar</p>
					<p
						class="text-surface-600-400 text-chip"
						title="Your personas keep their own."
					>
						Shown beside your name in the rail, the people lists and
						conversations; click it or drop a picture on it.
					</p>
				</div>
			</div>

			<!-- Display Name -->
			<div class="flex flex-col gap-1.5">
				<label for="display-name" class="text-sm font-medium">
					Display name
				</label>
				<div class="flex gap-2">
					<input
						id="display-name"
						type="text"
						class="input min-w-0 flex-1"
						bind:value={displayName}
						placeholder={userCtx.user.username}
						maxlength={DISPLAY_NAME_MAX_LENGTH}
						aria-describedby="display-name-help"
						disabled={isUpdatingDisplayName}
					/>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						onclick={updateDisplayName}
						disabled={isUpdatingDisplayName || !displayNameChanged}
					>
						{#if isUpdatingDisplayName}
							<Icons.Loader2 size={16} class="animate-spin" />
							Updating…
						{:else}
							Update
						{/if}
					</button>
				</div>
				<p id="display-name-help" class="text-surface-600-400 text-chip">
					What the app and the characters call you; leave it empty to go
					by your username.
				</p>
				{#if displayNameError}
					<InlineError>{displayNameError}</InlineError>
				{/if}
			</div>

			{#if systemSettingsCtx.settings?.isAccountsEnabled}
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
			{/if}
		</section>
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
						<InlineError>{passwordError}</InlineError>
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
