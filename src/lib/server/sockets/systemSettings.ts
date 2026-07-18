import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { isAndroidWrapper } from "$lib/server/utils"

export const systemSettingsGet: Handler<Sockets.SystemSettings.Get.Params, Sockets.SystemSettings.Get.Response> = {
	event: "systemSettings:get",
	handler: async (socket, params, emitToUser) => {
		try {
			// koboldCppManagedAdminPassword is never read client-side (only used
			// server-side, eg. subprocessManager.ts / KoboldCppManagedAdapter.ts) —
			// exclude it here regardless of caller so it's never handed to any
			// authenticated user's browser, not just hidden by client UI.
			const [settings, ollamaSettings, koboldCppSettings] = await Promise.all([
				db.query.systemSettings.findFirst({ where: eq(schema.systemSettings.id, 1), columns: { id: false } }),
				db.query.ollamaSettings.findFirst({ where: eq(schema.ollamaSettings.id, 1), columns: { id: false } }),
				db.query.koboldCppSettings.findFirst({
					where: eq(schema.koboldCppSettings.id, 1),
					columns: { id: false, koboldCppManagedAdminPassword: false }
				})
			])

			if (!settings) throw new Error("System settings not found")

			const res: Sockets.SystemSettings.Get.Response = {
				systemSettings: settings as any,
				ollamaSettings: (ollamaSettings ?? {}) as any,
				koboldCppSettings: (koboldCppSettings ?? {}) as any,
				isAndroidWrapper: isAndroidWrapper()
			}

			emitToUser("systemSettings:get", res)
			return res
		} catch (error: any) {
			console.error("Error fetching system settings:", error)
			emitToUser("systemSettings:get:error", { error: "Failed to fetch system settings" })
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

			const res: Sockets.SystemSettings.UpdateSummarizationEnabled.Response = {
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
			const res: Sockets.SystemSettings.UpdateContextDebuggingEnabled.Response = {
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

export const systemSettingsUpdateAccountsEnabled: Handler<
	Sockets.SystemSettings.UpdateAccountsEnabled.Params,
	Sockets.SystemSettings.UpdateAccountsEnabled.Response
> = {
	event: "systemSettings:updateAccountsEnabled",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			// Once enabled, unauthenticated access is blocked app-wide (see
			// auth.ts), so the admin flipping this on must already have a
			// passphrase to log back in with — re-check server-side rather
			// than trusting the client's own pre-flight modal, since nothing
			// stops a caller from emitting this event directly.
			if (params.enabled) {
				const currentPassphrase = await db.query.passphrases.findFirst({
					where: (p, { eq, and, isNull }) =>
						and(eq(p.userId, socket.user!.id), isNull(p.invalidatedAt)),
					orderBy: (p, { desc }) => [desc(p.createdAt)]
				})
				if (!currentPassphrase) {
					throw new Error("Set a passphrase before enabling user accounts")
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
	register: (socket: any, handler: Handler<any, any>, emitToUser: (event: string, data: any) => void) => void
) {
	register(socket, systemSettingsGet, emitToUser)
	register(socket, systemSettingsUpdateSummarizationEnabled, emitToUser)
	register(socket, systemSettingsUpdateContextDebuggingEnabled, emitToUser)
	register(socket, systemSettingsUpdateAccountsEnabled, emitToUser)
}
