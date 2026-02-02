import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"

export const systemSettingsGet: Handler<Sockets.SystemSettings.Get.Params, Sockets.SystemSettings.Get.Response> = {
	event: "systemSettings:get",
	handler: async (socket, params, emitToUser) => {
		try {
			const settings = await db.query.systemSettings.findFirst({
				where: eq(schema.systemSettings.id, 1),
				columns: {
					id: false // We don't need the ID in the response
				}
			})

			if (!settings) {
				throw new Error("System settings not found")
			}

			const res: Sockets.SystemSettings.Get.Response = {
				systemSettings: settings
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

export const systemSettingsUpdateOllamaManagerEnabled: Handler<Sockets.SystemSettings.UpdateOllamaManagerEnabled.Params, Sockets.SystemSettings.UpdateOllamaManagerEnabled.Response> = {
	event: "systemSettings:updateOllamaManagerEnabled",
	handler: async (socket, params, emitToUser) => {
		try {
			await db
				.update(schema.systemSettings)
				.set({
					ollamaManagerEnabled: params.enabled
				})
				.where(eq(schema.systemSettings.id, 1))

			const res: Sockets.SystemSettings.UpdateOllamaManagerEnabled.Response = {
				success: true,
				enabled: params.enabled
			}
			emitToUser("systemSettings:updateOllamaManagerEnabled", res)
			await systemSettingsGet.handler(socket, {}, emitToUser) // Refresh system settings after update
			return res
		} catch (error: any) {
			console.error("Update Ollama Manager enabled error:", error)
			emitToUser("systemSettings:updateOllamaManagerEnabled:error", {
				error: "Failed to update Ollama Manager setting"
			})
			throw error
		}
	}
}

export const systemSettingsUpdateShowAllCharacterFields: Handler<Sockets.SystemSettings.UpdateShowAllCharacterFields.Params, Sockets.SystemSettings.UpdateShowAllCharacterFields.Response> = {
	event: "systemSettings:updateShowAllCharacterFields",
	handler: async (socket, params, emitToUser) => {
		try {
			await db
				.update(schema.systemSettings)
				.set({
					showAllCharacterFields: params.enabled
				})
				.where(eq(schema.systemSettings.id, 1))

			const res: Sockets.SystemSettings.UpdateShowAllCharacterFields.Response = {
				success: true,
				enabled: params.enabled
			}
			emitToUser("systemSettings:updateShowAllCharacterFields", res)
			await systemSettingsGet.handler(socket, {}, emitToUser) // Refresh system settings after update
			return res
		} catch (error: any) {
			console.error("Update show all character fields error:", error)
			emitToUser("systemSettings:updateShowAllCharacterFields:error", {
				error: "Failed to update show all character fields setting"
			})
			throw error
		}
	}
}

export const systemSettingsUpdateEasyCharacterCreation: Handler<Sockets.SystemSettings.UpdateEasyCharacterCreation.Params, Sockets.SystemSettings.UpdateEasyCharacterCreation.Response> = {
	event: "systemSettings:updateEasyCharacterCreation",
	handler: async (socket, params, emitToUser) => {
		try {
			await db
				.update(schema.systemSettings)
				.set({
					enableEasyCharacterCreation: params.enabled
				})
				.where(eq(schema.systemSettings.id, 1))

			const res: Sockets.SystemSettings.UpdateEasyCharacterCreation.Response = {
				success: true,
				enabled: params.enabled
			}
			emitToUser("systemSettings:updateEasyCharacterCreation", res)
			await systemSettingsGet.handler(socket, {}, emitToUser) // Refresh system settings after update
			return res
		} catch (error: any) {
			console.error("Update easy character creation error:", error)
			emitToUser("systemSettings:updateEasyCharacterCreation:error", {
				error: "Failed to update easy character creation setting"
			})
			throw error
		}
	}
}

export async function updateShowHomePageBanner(
	socket: any,
	message: Sockets.UpdateShowHomePageBanner.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		await db
			.update(schema.systemSettings)
			.set({
				showHomePageBanner: message.enabled
			})
			.where(eq(schema.systemSettings.id, 1))

		const res: Sockets.UpdateShowHomePageBanner.Response = {
			success: true,
			enabled: message.enabled
		}
		emitToUser("updateShowHomePageBanner", res)
		await systemSettings(socket, {}, emitToUser) // Refresh system settings after update
	} catch (error: any) {
		console.error("Update show home page banner error:", error)
		const res = {
			error: "Failed to update show home page banner setting"
		}
		emitToUser("error", res)
	}
}
export const systemSettingsUpdateEasyPersonaCreation: Handler<Sockets.SystemSettings.UpdateEasyPersonaCreation.Params, Sockets.SystemSettings.UpdateEasyPersonaCreation.Response> = {
	event: "systemSettings:updateEasyPersonaCreation",
	handler: async (socket, params, emitToUser) => {
		try {
			await db
				.update(schema.systemSettings)
				.set({
					enableEasyPersonaCreation: params.enabled
				})
				.where(eq(schema.systemSettings.id, 1))

			const res: Sockets.SystemSettings.UpdateEasyPersonaCreation.Response = {
				success: true,
				enabled: params.enabled
			}
			emitToUser("systemSettings:updateEasyPersonaCreation", res)
			await systemSettingsGet.handler(socket, {}, emitToUser) // Refresh system settings after update
			return res
		} catch (error: any) {
			console.error("Update easy persona creation error:", error)
			emitToUser("systemSettings:updateEasyPersonaCreation:error", {
				error: "Failed to update easy persona creation setting"
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
	register(socket, systemSettingsUpdateOllamaManagerEnabled, emitToUser)
	register(socket, systemSettingsUpdateShowAllCharacterFields, emitToUser)
	register(socket, systemSettingsUpdateEasyCharacterCreation, emitToUser)
	register(socket, systemSettingsUpdateEasyPersonaCreation, emitToUser)
}
