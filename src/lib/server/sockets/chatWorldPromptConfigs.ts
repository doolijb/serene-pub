import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { user as loadUser } from "./users"
import { userSettingsGet } from "./userSettings"
import type { Handler } from "$lib/shared/events"

export const chatWorldPromptConfigsListHandler: Handler<
	Sockets.ChatWorldPromptConfigs.List.Params,
	Sockets.ChatWorldPromptConfigs.List.Response
> = {
	event: "chatWorldPromptConfigs:list",
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

		const chatWorldPromptConfigsList =
			await db.query.chatWorldPromptConfigs.findMany({
				columns: {
					id: true,
					name: true,
					isImmutable: true
				},
				orderBy: (c, { asc }) => [asc(c.isImmutable), asc(c.name)]
			})
		const res: Sockets.ChatWorldPromptConfigs.List.Response = {
			chatWorldPromptConfigsList
		}
		emitToUser("chatWorldPromptConfigs:list", res)
		return res
	}
}

export const chatWorldPromptConfigsGet: Handler<
	Sockets.ChatWorldPromptConfigs.Get.Params,
	Sockets.ChatWorldPromptConfigs.Get.Response
> = {
	event: "chatWorldPromptConfigs:get",
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

		const chatWorldPromptConfig =
			await db.query.chatWorldPromptConfigs.findFirst({
				where: (c, { eq }) => eq(c.id, params.id)
			})
		if (!chatWorldPromptConfig) {
			emitToUser("chatWorldPromptConfigs:get:error", {
				error: "World prompt config not found"
			})
			throw new Error("World prompt config not found")
		}
		const res: Sockets.ChatWorldPromptConfigs.Get.Response = {
			chatWorldPromptConfig
		}
		emitToUser("chatWorldPromptConfigs:get", res)
		return res
	}
}

export const chatWorldPromptConfigsCreate: Handler<
	Sockets.ChatWorldPromptConfigs.Create.Params,
	Sockets.ChatWorldPromptConfigs.Create.Response
> = {
	event: "chatWorldPromptConfigs:create",
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

		const [chatWorldPromptConfig] = await db
			.insert(schema.chatWorldPromptConfigs)
			.values(params.chatWorldPromptConfig)
			.returning()
		await chatWorldPromptConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.ChatWorldPromptConfigs.Create.Response = {
			chatWorldPromptConfig
		}
		emitToUser("chatWorldPromptConfigs:create", res)
		return res
	}
}

export const chatWorldPromptConfigsUpdate: Handler<
	Sockets.ChatWorldPromptConfigs.Update.Params,
	Sockets.ChatWorldPromptConfigs.Update.Response
> = {
	event: "chatWorldPromptConfigs:update",
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

		const id = params.chatWorldPromptConfig.id!
		const { id: _, ...updateData } = params.chatWorldPromptConfig
		const [chatWorldPromptConfig] = await db
			.update(schema.chatWorldPromptConfigs)
			.set(updateData)
			.where(eq(schema.chatWorldPromptConfigs.id, id))
			.returning()
		await chatWorldPromptConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.ChatWorldPromptConfigs.Update.Response = {
			chatWorldPromptConfig
		}
		emitToUser("chatWorldPromptConfigs:update", res)
		return res
	}
}

export const chatWorldPromptConfigsDelete: Handler<
	Sockets.ChatWorldPromptConfigs.Delete.Params,
	Sockets.ChatWorldPromptConfigs.Delete.Response
> = {
	event: "chatWorldPromptConfigs:delete",
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
			.delete(schema.chatWorldPromptConfigs)
			.where(eq(schema.chatWorldPromptConfigs.id, params.id))
		await chatWorldPromptConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.ChatWorldPromptConfigs.Delete.Response = {
			success: "World prompt config deleted successfully"
		}
		emitToUser("chatWorldPromptConfigs:delete", res)
		return res
	}
}

export const chatWorldPromptConfigsSetUserActive: Handler<
	Sockets.ChatWorldPromptConfigs.SetUserActive.Params,
	Sockets.ChatWorldPromptConfigs.SetUserActive.Response
> = {
	event: "chatWorldPromptConfigs:setUserActive",
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
			emitToUser("chatWorldPromptConfigs:setUserActive:error", {
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
				activeChatWorldPromptConfigId: params.id
			})
			.where(eq(schema.userSettings.userId, currentUser.id))

		await loadUser(socket, {}, emitToUser) // Emit updated user info
		await userSettingsGet.handler(socket, {}, emitToUser)
		if (params.id) {
			await chatWorldPromptConfigsGet.handler(
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
		const res: Sockets.ChatWorldPromptConfigs.SetUserActive.Response = {
			user: updatedUser!
		}
		emitToUser("chatWorldPromptConfigs:setUserActive", res)
		return res
	}
}

// Registration function for all chat-world-prompt-config handlers
export function registerChatWorldPromptConfigHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, chatWorldPromptConfigsListHandler, emitToUser)
	register(socket, chatWorldPromptConfigsGet, emitToUser)
	register(socket, chatWorldPromptConfigsCreate, emitToUser)
	register(socket, chatWorldPromptConfigsUpdate, emitToUser)
	register(socket, chatWorldPromptConfigsDelete, emitToUser)
	register(socket, chatWorldPromptConfigsSetUserActive, emitToUser)
}
