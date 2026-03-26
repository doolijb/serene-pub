import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { user as loadUser } from "./users"
import { userSettingsGet } from "./userSettings"
import type { Handler } from "$lib/shared/events"

export const promptConfigsListHandler: Handler<
	Sockets.PromptConfigs.List.Params,
	Sockets.PromptConfigs.List.Response
> = {
	event: "promptConfigs:list",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage prompt configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage prompt configurations."
			)
		}

		const promptConfigsList = await db.query.promptConfigs.findMany({
			columns: {
				id: true,
				name: true,
				isImmutable: true
			},
			orderBy: (c, { asc }) => [asc(c.isImmutable), asc(c.name)]
		})
		const res: Sockets.PromptConfigs.List.Response = { promptConfigsList }
		emitToUser("promptConfigs:list", res)
		return res
	}
}

export const promptConfigsGet: Handler<
	Sockets.PromptConfigs.Get.Params,
	Sockets.PromptConfigs.Get.Response
> = {
	event: "promptConfigs:get",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage prompt configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage prompt configurations."
			)
		}

		const promptConfig = await db.query.promptConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (!promptConfig) {
			emitToUser("promptConfigs:get:error", {
				error: "Prompt config not found"
			})
			throw new Error("Prompt config not found")
		}
		const res: Sockets.PromptConfigs.Get.Response = { promptConfig }
		emitToUser("promptConfigs:get", res)
		return res
	}
}

export const promptConfigsCreate: Handler<
	Sockets.PromptConfigs.Create.Params,
	Sockets.PromptConfigs.Create.Response
> = {
	event: "promptConfigs:create",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can create prompt configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can create prompt configurations."
			)
		}

		const [promptConfig] = await db
			.insert(schema.promptConfigs)
			.values(params.promptConfig)
			.returning()
		await promptConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.PromptConfigs.Create.Response = { promptConfig }
		emitToUser("promptConfigs:create", res)
		return res
	}
}

export const promptConfigsUpdate: Handler<
	Sockets.PromptConfigs.Update.Params,
	Sockets.PromptConfigs.Update.Response
> = {
	event: "promptConfigs:update",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can update prompt configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can update prompt configurations."
			)
		}

		const id = params.promptConfig.id!
		const { id: _, ...updateData } = params.promptConfig
		const [promptConfig] = await db
			.update(schema.promptConfigs)
			.set(updateData)
			.where(eq(schema.promptConfigs.id, id))
			.returning()
		await promptConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.PromptConfigs.Update.Response = { promptConfig }
		emitToUser("promptConfigs:update", res)
		return res
	}
}

export const promptConfigsDelete: Handler<
	Sockets.PromptConfigs.Delete.Params,
	Sockets.PromptConfigs.Delete.Response
> = {
	event: "promptConfigs:delete",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can delete prompt configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can delete prompt configurations."
			)
		}

		await db
			.delete(schema.promptConfigs)
			.where(eq(schema.promptConfigs.id, params.id))
		await promptConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.PromptConfigs.Delete.Response = {
			success: "Prompt config deleted successfully"
		}
		emitToUser("promptConfigs:delete", res)
		return res
	}
}

export const promptConfigsSetUserActive: Handler<
	Sockets.PromptConfigs.SetUserActive.Params,
	Sockets.PromptConfigs.SetUserActive.Response
> = {
	event: "promptConfigs:setUserActive",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can set active prompt configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can set active prompt configurations."
			)
		}

		const userId = socket.user!.id
		const currentUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, userId)
		})
		if (!currentUser) {
			emitToUser("promptConfigs:setUserActive:error", {
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
				activePromptConfigId: params.id
			})
			.where(eq(schema.userSettings.userId, currentUser.id))

		await loadUser(socket, {}, emitToUser) // Emit updated user info
		await userSettingsGet.handler(socket, {}, emitToUser)
		if (params.id) {
			await promptConfigsGet.handler(
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
		const res: Sockets.PromptConfigs.SetUserActive.Response = {
			user: updatedUser!
		}
		emitToUser("promptConfigs:setUserActive", res)
		return res
	}
}

// Legacy functions for compatibility
export async function promptConfigsList(
	socket: any,
	message: {},
	emitToUser: (event: string, data: any) => void
) {
	await promptConfigsListHandler.handler(socket, {}, emitToUser)
}

export async function promptConfig(
	socket: any,
	message: { id: number },
	emitToUser: (event: string, data: any) => void
) {
	await promptConfigsGet.handler(socket, { id: message.id }, emitToUser)
}

export async function createPromptConfig(
	socket: any,
	message: { promptConfig: any },
	emitToUser: (event: string, data: any) => void
) {
	await promptConfigsCreate.handler(
		socket,
		{ promptConfig: message.promptConfig },
		emitToUser
	)
}

export async function updatePromptConfig(
	socket: any,
	message: { promptConfig: any },
	emitToUser: (event: string, data: any) => void
) {
	await promptConfigsUpdate.handler(
		socket,
		{ promptConfig: message.promptConfig },
		emitToUser
	)
}

export async function deletePromptConfig(
	socket: any,
	message: { id: number },
	emitToUser: (event: string, data: any) => void
) {
	await promptConfigsDelete.handler(socket, { id: message.id }, emitToUser)
}

export async function setUserActivePromptConfig(
	socket: any,
	message: { id: number | null },
	emitToUser: (event: string, data: any) => void
) {
	await promptConfigsSetUserActive.handler(
		socket,
		{ id: message.id },
		emitToUser
	)
}

// Registration function for all prompt config handlers
export function registerPromptConfigHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, promptConfigsListHandler, emitToUser)
	register(socket, promptConfigsGet, emitToUser)
	register(socket, promptConfigsCreate, emitToUser)
	register(socket, promptConfigsUpdate, emitToUser)
	register(socket, promptConfigsDelete, emitToUser)
	register(socket, promptConfigsSetUserActive, emitToUser)
}
