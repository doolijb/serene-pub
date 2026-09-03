import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { capabilityDefaults } from "$lib/server/connections/capabilityDefaults"
import { eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { isAndroidWrapper } from "$lib/server/utils"
import { isLocalEmbeddingSupported } from "$lib/server/embedding"

export const systemSettingsGet: Handler<
	Sockets.SystemSettings.Get.Params,
	Sockets.SystemSettings.Get.Response
> = {
	event: "systemSettings:get",
	handler: async (socket, params, emitToUser) => {
		try {
			// koboldCppManagedAdminPassword and the CharaVault credential fields
			// are never read client-side (only used server-side) — exclude them
			// here regardless of caller so they're never handed to any
			// authenticated user's browser, not just hidden by client UI. The
			// CharaVault connection status is surfaced separately via the
			// admin-only cardSources:charaVault:status event instead.
			const [
				settings,
				ollamaSettings,
				koboldCppSettings,
				koboldCppAdminPasswordRow
			] = await Promise.all([
				db.query.systemSettings.findFirst({
					where: eq(schema.systemSettings.id, 1),
					columns: {
						id: false,
						charaVaultEmail: false,
						charaVaultEncryptedToken: false,
						charaVaultTokenIv: false,
						charaVaultTokenAuthTag: false
					}
				}),
				db.query.ollamaSettings.findFirst({
					where: eq(schema.ollamaSettings.id, 1),
					columns: { id: false }
				}),
				db.query.koboldCppSettings.findFirst({
					where: eq(schema.koboldCppSettings.id, 1),
					columns: { id: false, koboldCppManagedAdminPassword: false }
				}),
				// Separate, minimal query just for presence -- the password value
				// itself must never enter a variable that could end up in a
				// response object, even transiently.
				db.query.koboldCppSettings.findFirst({
					where: eq(schema.koboldCppSettings.id, 1),
					columns: { koboldCppManagedAdminPassword: true }
				})
			])

			if (!settings) throw new Error("System settings not found")

			const res: Sockets.SystemSettings.Get.Response = {
				systemSettings: settings as any,
				ollamaSettings: (ollamaSettings ?? {}) as any,
				koboldCppSettings: {
					...(koboldCppSettings ?? {}),
					koboldCppManagedAdminPasswordSet:
						!!koboldCppAdminPasswordRow?.koboldCppManagedAdminPassword
				} as any,
				isAndroidWrapper: isAndroidWrapper(),
				localEmbeddingsSupported: await isLocalEmbeddingSupported(),
				// The instance default per capability (0175). It used to be two
				// columns on `system_settings` and rode along with the row; now it
				// is its own table, so it is fetched and sent explicitly — the
				// sidebars need it to star the default and to enable Set Default.
				capabilityDefaults: await capabilityDefaults(db)
			}

			emitToUser("systemSettings:get", res)
			return res
		} catch (error: any) {
			console.error("Error fetching system settings:", error)
			emitToUser("systemSettings:get:error", {
				error: "Failed to fetch system settings"
			})
			throw error
		}
	}
}

export const systemSettingsUpdateSummarizationEnabled: Handler<
	Sockets.SystemSettings.UpdateSummarizationEnabled.Params,
	Sockets.SystemSettings.UpdateSummarizationEnabled.Response
> = {
	event: "systemSettings:updateSummarizationEnabled",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			await db
				.update(schema.systemSettings)
				.set({ summarizationEnabled: params.enabled })
				.where(eq(schema.systemSettings.id, 1))

			const res: Sockets.SystemSettings.UpdateSummarizationEnabled.Response =
				{
					success: true,
					enabled: params.enabled
				}
			emitToUser("systemSettings:updateSummarizationEnabled", res)
			await systemSettingsGet.handler(socket, {}, emitToUser)
			return res
		} catch (error: any) {
			console.error("Update summarization enabled error:", error)
			emitToUser("systemSettings:updateSummarizationEnabled:error", {
				error: "Failed to update summarization setting"
			})
			throw error
		}
	}
}

/** The scripts kill switch (18 §10): off = the host supplies no engine at all. */
export const systemSettingsUpdateScriptsEnabled: Handler<
	Sockets.SystemSettings.UpdateScriptsEnabled.Params,
	Sockets.SystemSettings.UpdateScriptsEnabled.Response
> = {
	event: "systemSettings:updateScriptsEnabled",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			await db
				.update(schema.systemSettings)
				.set({ scriptsEnabled: params.enabled })
				.where(eq(schema.systemSettings.id, 1))

			const res: Sockets.SystemSettings.UpdateScriptsEnabled.Response = {
				success: true,
				enabled: params.enabled
			}
			emitToUser("systemSettings:updateScriptsEnabled", res)
			await systemSettingsGet.handler(socket, {}, emitToUser)
			return res
		} catch (error: any) {
			console.error("Update scripts enabled error:", error)
			emitToUser("systemSettings:updateScriptsEnabled:error", {
				error: "Failed to update the scripts setting"
			})
			throw error
		}
	}
}

export const systemSettingsUpdateContextDebuggingEnabled: Handler<
	Sockets.SystemSettings.UpdateContextDebuggingEnabled.Params,
	Sockets.SystemSettings.UpdateContextDebuggingEnabled.Response
> = {
	event: "systemSettings:updateContextDebuggingEnabled",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			await db
				.update(schema.systemSettings)
				.set({ contextDebuggingEnabled: params.enabled })
				.where(eq(schema.systemSettings.id, 1))
			const res: Sockets.SystemSettings.UpdateContextDebuggingEnabled.Response =
				{
					success: true,
					enabled: params.enabled
				}
			emitToUser("systemSettings:updateContextDebuggingEnabled", res)
			await systemSettingsGet.handler(socket, {}, emitToUser)
			return res
		} catch (error: any) {
			console.error("Update context debugging enabled error:", error)
			emitToUser("systemSettings:updateContextDebuggingEnabled:error", {
				error: "Failed to update context debugging setting"
			})
			throw error
		}
	}
}

/**
 * Show or hide the Legacy configs panel — the 0.5 archives (context/prompt
 * configs). The column has gated the nav since the changeover; this is the
 * write the admin Settings page needed. Hiding is for when somebody is done
 * referring back; the rows themselves stay until the tables go in 0.8.0.
 */
export const systemSettingsUpdateLegacyConfigsVisible: Handler<
	Sockets.SystemSettings.UpdateLegacyConfigsVisible.Params,
	Sockets.SystemSettings.UpdateLegacyConfigsVisible.Response
> = {
	event: "systemSettings:updateLegacyConfigsVisible",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			await db
				.update(schema.systemSettings)
				.set({ legacyPromptConfigsVisible: params.visible })
				.where(eq(schema.systemSettings.id, 1))
			const res: Sockets.SystemSettings.UpdateLegacyConfigsVisible.Response =
				{
					success: true,
					visible: params.visible
				}
			emitToUser("systemSettings:updateLegacyConfigsVisible", res)
			await systemSettingsGet.handler(socket, {}, emitToUser)
			return res
		} catch (error: any) {
			console.error("Update legacy configs visible error:", error)
			emitToUser("systemSettings:updateLegacyConfigsVisible:error", {
				error: "Failed to update the legacy configs setting"
			})
			throw error
		}
	}
}

export const systemSettingsUpdateAccountsEnabled: Handler<
	Sockets.SystemSettings.UpdateAccountsEnabled.Params,
	Sockets.SystemSettings.UpdateAccountsEnabled.Response
> = {
	event: "systemSettings:updateAccountsEnabled",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		// The Android build is single-user by design: it is one person's app on
		// one device, with no way to reach it from elsewhere (tunnels are
		// unavailable there too). Enabling accounts would only add a login
		// wall — and because the transition is one-way, an accidental tap
		// would be unrecoverable without the recovery environment variables.
		// Enforced here and not just hidden in the UI, same as the tunnel
		// gates.
		if (params.enabled && isAndroidWrapper()) {
			throw new Error(
				"User accounts are not available in the Android app"
			)
		}
		try {
			const currentSettings = await db.query.systemSettings.findFirst({
				where: eq(schema.systemSettings.id, 1),
				columns: { isAccountsEnabled: true }
			})

			// The client's own UI states "This setting cannot be reversed"
			// but only enforces it cosmetically (a disabled Switch) — a
			// direct socket.emit bypassing that UI could otherwise silently
			// re-disable accounts, re-exposing the no-auth auto-attach-to-
			// admin fallback (auth.ts) on an instance an admin had
			// deliberately locked down. Enforce the one-way transition
			// server-side.
			if (
				params.enabled === false &&
				currentSettings?.isAccountsEnabled
			) {
				throw new Error(
					"User accounts cannot be disabled once enabled."
				)
			}

			// Once enabled, unauthenticated access is blocked app-wide (see
			// auth.ts), so the admin flipping this on must already have a
			// passphrase to log back in with — re-check server-side rather
			// than trusting the client's own pre-flight modal, since nothing
			// stops a caller from emitting this event directly.
			if (params.enabled) {
				const currentPassphrase = await db.query.passphrases.findFirst({
					where: (p, { eq, and, isNull }) =>
						and(
							eq(p.userId, socket.user!.id),
							isNull(p.invalidatedAt)
						),
					orderBy: (p, { desc }) => [desc(p.createdAt)]
				})
				if (!currentPassphrase) {
					throw new Error(
						"Set a passphrase before enabling user accounts"
					)
				}
			}

			await db
				.update(schema.systemSettings)
				.set({ isAccountsEnabled: params.enabled })
				.where(eq(schema.systemSettings.id, 1))
			const res: Sockets.SystemSettings.UpdateAccountsEnabled.Response = {
				success: true,
				enabled: params.enabled
			}
			emitToUser("systemSettings:updateAccountsEnabled", res)
			await systemSettingsGet.handler(socket, {}, emitToUser)

			// Every socket that connected while accounts were disabled was
			// auto-attached to the fallback admin with no token (auth.ts) —
			// authMiddleware only runs at handshake, so those sessions never
			// re-check once this flips. Evict that whole room now (this
			// necessarily includes the calling admin's own socket, since
			// reaching this handler at all required being that fallback
			// admin) so every such session is forced through the
			// now-enabled real login flow. Must come after emitToUser above
			// so the caller sees their own success response first — same
			// ordering as users.ts's setPassphrase/changePassphrase.
			if (params.enabled) {
				const fallbackAdmin = await db.query.users.findFirst({
					where: (u, { eq }) => eq(u.isAdmin, true),
					orderBy: (u, { asc }) => [asc(u.id)]
				})
				if (fallbackAdmin) {
					socket.io
						.to(`user_${fallbackAdmin.id}`)
						.disconnectSockets(true)
				}
			}

			return res
		} catch (error: any) {
			console.error("Update accounts enabled error:", error)
			emitToUser("systemSettings:updateAccountsEnabled:error", {
				error: error.message || "Failed to update accounts setting"
			})
			throw error
		}
	}
}

// Registration function for all system settings handlers
export function registerSystemSettingsHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, systemSettingsGet, emitToUser)
	register(socket, systemSettingsUpdateSummarizationEnabled, emitToUser)
	register(socket, systemSettingsUpdateScriptsEnabled, emitToUser)
	register(socket, systemSettingsUpdateContextDebuggingEnabled, emitToUser)
	register(socket, systemSettingsUpdateLegacyConfigsVisible, emitToUser)
	register(socket, systemSettingsUpdateAccountsEnabled, emitToUser)
	register(socket, systemSettingsUpdateRequireTwoFactor, emitToUser)
}

/**
 * Site-wide two-factor requirement (plan 27 §4).
 *
 * Reversible, unlike the accounts switch: turning it on is a policy an admin
 * may reasonably reconsider, and nobody is locked out by turning it off. It
 * takes effect through the setup gate, so users without a factor are walked
 * through enrolment on their next request rather than being refused.
 */
export const systemSettingsUpdateRequireTwoFactor: Handler<
	Sockets.SystemSettings.UpdateRequireTwoFactor.Params,
	Sockets.SystemSettings.UpdateRequireTwoFactor.Response
> = {
	event: "systemSettings:updateRequireTwoFactor",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const settings = await db.query.systemSettings.findFirst({
			where: eq(schema.systemSettings.id, 1),
			columns: { isAccountsEnabled: true }
		})
		// Without accounts there is one implicit user and no login, so a second
		// factor has nothing to protect and no moment to be asked for.
		if (params.enabled && !settings?.isAccountsEnabled) {
			const message =
				"Enable user accounts before requiring two-factor authentication."
			emitToUser("systemSettings:updateRequireTwoFactor:error", {
				error: message
			})
			throw new Error(message)
		}

		await db
			.update(schema.systemSettings)
			.set({ requireTwoFactor: params.enabled })
			.where(eq(schema.systemSettings.id, 1))

		const res: Sockets.SystemSettings.UpdateRequireTwoFactor.Response = {
			success: true
		}
		emitToUser("systemSettings:updateRequireTwoFactor", res)
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}
