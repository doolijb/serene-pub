import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { user } from "./users"
import { userSettingsGet } from "./userSettings"
import type { Handler } from "$lib/shared/events"
import {
	getSupportedSamplers,
	getUnsupportedSamplers
} from "$lib/shared/utils/samplerMappings"

// --- WEIGHTS SOCKET HANDLERS ---

export const samplingHandler: Handler<
	Sockets.SamplingConfigs.Get.Params,
	Sockets.SamplingConfigs.Get.Response
> = {
	event: "sampling",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage sampling configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage sampling configurations."
			)
		}

		const sampling = await db.query.samplingConfigs.findFirst({
			where: (w, { eq }) => eq(w.id, params.id),
			orderBy: (w, { asc }) => [asc(w.isImmutable), asc(w.name)]
		})
		const res: Sockets.SamplingConfigs.Get.Response = {
			sampling: sampling!
		}
		emitToUser("sampling", res)
		return res
	}
}

// Legacy functions for compatibility
export async function sampling(
	socket: any,
	message: { id: number },
	emitToUser: (event: string, data: any) => void
) {
	await samplingHandler.handler(socket, { id: message.id }, emitToUser)
}

export async function samplingConfigsList(
	socket: any,
	message: {},
	emitToUser: (event: string, data: any) => void
) {
	await samplingConfigsListHandler.handler(socket, {}, emitToUser)
}

export async function setUserActiveSamplingConfig(
	socket: any,
	message: { id: number },
	emitToUser: (event: string, data: any) => void
) {
	await samplingConfigsSetUserActive.handler(
		socket,
		{ id: message.id },
		emitToUser
	)
}

export async function createSamplingConfig(
	socket: any,
	message: { sampling: any },
	emitToUser: (event: string, data: any) => void
) {
	await samplingConfigsCreate.handler(
		socket,
		{ sampling: message.sampling },
		emitToUser
	)
}

export async function deleteSamplingConfig(
	socket: any,
	message: { id: number },
	emitToUser: (event: string, data: any) => void
) {
	await samplingConfigsDelete.handler(socket, { id: message.id }, emitToUser)
}

export async function updateSamplingConfig(
	socket: any,
	message: { sampling: any },
	emitToUser: (event: string, data: any) => void
) {
	await samplingConfigsUpdate.handler(
		socket,
		{ sampling: message.sampling },
		emitToUser
	)
}

export const samplingConfigsGet: Handler<
	Sockets.SamplingConfigs.Get.Params,
	Sockets.SamplingConfigs.Get.Response
> = {
	event: "samplingConfigs:get",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage sampling configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage sampling configurations."
			)
		}

		const sampling = await db.query.samplingConfigs.findFirst({
			where: (w, { eq }) => eq(w.id, params.id),
			orderBy: (w, { asc }) => [asc(w.isImmutable), asc(w.name)]
		})
		const res: Sockets.SamplingConfigs.Get.Response = {
			sampling: sampling!
		}
		emitToUser("samplingConfigs:get", res)
		return res
	}
}

export const samplingConfigsListHandler: Handler<
	Sockets.SamplingConfigs.List.Params,
	Sockets.SamplingConfigs.List.Response
> = {
	event: "samplingConfigs:list",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage sampling configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage sampling configurations."
			)
		}

		const samplingConfigsList = await db.query.samplingConfigs.findMany({
			columns: {
				id: true,
				name: true,
				isImmutable: true
			}
		})
		const res: Sockets.SamplingConfigs.List.Response = {
			samplingConfigsList
		}
		emitToUser("samplingConfigs:list", res)
		return res
	}
}

export const samplingConfigsSetUserActive: Handler<
	Sockets.SamplingConfigs.SetUserActive.Params,
	Sockets.SamplingConfigs.SetUserActive.Response
> = {
	event: "samplingConfigs:setUserActive",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can set active sampling configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can set active sampling configurations."
			)
		}

		const userId = socket.user!.id
		const currentUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, userId)
		})
		if (!currentUser) {
			emitToUser("samplingConfigs:setUserActive:error", {
				error: "User not found."
			})
			throw new Error("User not found")
		}

		// Find or create user settings
		let userSettings = await db.query.userSettings.findFirst({
			where: (us, { eq }) => eq(us.userId, currentUser.id)
		})

		if (!userSettings) {
			await db.insert(schema.userSettings).values({
				userId: currentUser.id
			})
		}

		await db
			.update(schema.userSettings)
			.set({
				activeSamplingConfigId: params.id
			})
			.where(eq(schema.userSettings.userId, currentUser.id))

		await user(socket, {}, emitToUser)
		await userSettingsGet.handler(socket, {}, emitToUser)
		if (params.id) {
			await samplingConfigsGet.handler(
				socket,
				{ id: params.id },
				emitToUser
			)
		}

		// Get the updated user to return in response
		const updatedUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, currentUser.id),
			with: {
				userSettings: true
			}
		})
		const res: Sockets.SamplingConfigs.SetUserActive.Response = {
			user: updatedUser!
		}
		emitToUser("samplingConfigs:setUserActive", res)
		return res
	}
}

export const samplingConfigsCreate: Handler<
	Sockets.SamplingConfigs.Create.Params,
	Sockets.SamplingConfigs.Create.Response
> = {
	event: "samplingConfigs:create",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can create sampling configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can create sampling configurations."
			)
		}

		const [sampling] = await db
			.insert(schema.samplingConfigs)
			.values(params.sampling)
			.returning()

		await samplingConfigsSetUserActive.handler(
			socket,
			{ id: sampling.id },
			emitToUser
		)
		await samplingConfigsListHandler.handler(socket, {}, emitToUser)

		const res: Sockets.SamplingConfigs.Create.Response = { sampling }
		emitToUser("samplingConfigs:create", res)
		return res
	}
}

export const samplingConfigsDelete: Handler<
	Sockets.SamplingConfigs.Delete.Params,
	Sockets.SamplingConfigs.Delete.Response
> = {
	event: "samplingConfigs:delete",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can delete sampling configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can delete sampling configurations."
			)
		}

		const currentSamplingConfig = await db.query.samplingConfigs.findFirst({
			where: (w, { eq }) => eq(w.id, params.id)
		})
		if (currentSamplingConfig!.isImmutable) {
			emitToUser("samplingConfigs:delete:error", {
				error: "Cannot delete immutable samplingConfigs."
			})
			throw new Error("Cannot delete immutable samplingConfigs")
		}
		// Check if this is the user's active sampling config and reset to default if so
		const userSettings = await db.query.userSettings.findFirst({
			where: (us, { eq }) => eq(us.userId, socket.user!.id)
		})
		if (userSettings?.activeSamplingConfigId === params.id) {
			// Get the system default sampling config
			const systemSettings = await db.query.systemSettings.findFirst()
			const defaultConfigId = systemSettings?.defaultSamplingConfigId || 1
			await samplingConfigsSetUserActive.handler(
				socket,
				{ id: defaultConfigId },
				emitToUser
			)
		}
		await db
			.delete(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, params.id))
		await samplingConfigsListHandler.handler(socket, {}, emitToUser)

		const res: Sockets.SamplingConfigs.Delete.Response = {
			success: "Sampling config deleted successfully"
		}
		emitToUser("samplingConfigs:delete", res)
		return res
	}
}

export const samplingConfigsUpdate: Handler<
	Sockets.SamplingConfigs.Update.Params,
	Sockets.SamplingConfigs.Update.Response
> = {
	event: "samplingConfigs:update",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can update sampling configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can update sampling configurations."
			)
		}

		const id = params.sampling.id!
		const { id: _, ...updateData } = params.sampling // Remove id from sampling object to avoid conflicts

		const currentSamplingConfig = await db.query.samplingConfigs.findFirst({
			where: (w, { eq }) => eq(w.id, id)
		})
		if (currentSamplingConfig!.isImmutable) {
			emitToUser("samplingConfigs:update:error", {
				error: "Cannot update immutable samplingConfigs."
			})
			throw new Error("Cannot update immutable samplingConfigs")
		}

		const [updatedSamplingConfig] = await db
			.update(schema.samplingConfigs)
			.set(updateData)
			.where(eq(schema.samplingConfigs.id, id))
			.returning()

		await samplingConfigsListHandler.handler(socket, {}, emitToUser)
		await samplingConfigsGet.handler(socket, { id }, emitToUser)
		await user(socket, {}, emitToUser)

		const res: Sockets.SamplingConfigs.Update.Response = {
			sampling: updatedSamplingConfig
		}
		emitToUser("samplingConfigs:update", res)
		return res
	}
}

export const samplingConfigsGetSupportedSamplers: Handler<
	Sockets.SamplingConfigs.GetSupportedSamplers.Params,
	Sockets.SamplingConfigs.GetSupportedSamplers.Response
> = {
	event: "samplingConfigs:getSupportedSamplers",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Get user settings with active connection
		const userSettings = await db.query.userSettings.findFirst({
			where: (us, { eq }) => eq(us.userId, userId),
			with: {
				activeConnection: true
			}
		})

		let connectionType: string | undefined

		if (userSettings?.activeConnection) {
			connectionType = userSettings.activeConnection.type
		} else {
			// Fall back to system default connection
			const systemSettings = await db.query.systemSettings.findFirst({
				with: {
					defaultConnection: true
				}
			})
			connectionType = systemSettings?.defaultConnection?.type
		}

		if (!connectionType) {
			emitToUser("samplingConfigs:getSupportedSamplers:error", {
				error: "No active connection found"
			})
			throw new Error("No active connection found")
		}

		// Get supported and unsupported samplers
		const supportedSamplers = Array.from(
			getSupportedSamplers(connectionType)
		)
		const unsupportedSamplers: Record<string, string> = {}
		for (const [key, reason] of getUnsupportedSamplers(connectionType)) {
			unsupportedSamplers[key] = reason
		}

		const res: Sockets.SamplingConfigs.GetSupportedSamplers.Response = {
			connectionType,
			supportedSamplers,
			unsupportedSamplers
		}

		emitToUser("samplingConfigs:getSupportedSamplers", res)
		return res
	}
}

// Registration function for all sampling config handlers
export function registerSamplingConfigHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, samplingConfigsListHandler, emitToUser)
	register(socket, samplingConfigsGet, emitToUser)
	register(socket, samplingConfigsSetUserActive, emitToUser)
	register(socket, samplingConfigsCreate, emitToUser)
	register(socket, samplingConfigsUpdate, emitToUser)
	register(socket, samplingConfigsDelete, emitToUser)
	register(socket, samplingHandler, emitToUser)
	register(socket, samplingConfigsGetSupportedSamplers, emitToUser)
}
