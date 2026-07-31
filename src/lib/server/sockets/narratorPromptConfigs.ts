import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { user as loadUser } from "./users"
import { userSettingsGet } from "./userSettings"
import type { Handler } from "$lib/shared/events"

export const narratorPromptConfigsListHandler: Handler<
	Sockets.NarratorPromptConfigs.List.Params,
	Sockets.NarratorPromptConfigs.List.Response
> = {
	event: "narratorPromptConfigs:list",
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

		const narratorPromptConfigsList =
			await db.query.narratorPromptConfigs.findMany({
				columns: {
					id: true,
					name: true,
					isImmutable: true
				},
				orderBy: (c, { asc }) => [asc(c.isImmutable), asc(c.name)]
			})
		const res: Sockets.NarratorPromptConfigs.List.Response = {
			narratorPromptConfigsList
		}
		emitToUser("narratorPromptConfigs:list", res)
		return res
	}
}

export const narratorPromptConfigsGet: Handler<
	Sockets.NarratorPromptConfigs.Get.Params,
	Sockets.NarratorPromptConfigs.Get.Response
> = {
	event: "narratorPromptConfigs:get",
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

		const narratorPromptConfig =
			await db.query.narratorPromptConfigs.findFirst({
				where: (c, { eq }) => eq(c.id, params.id)
			})
		if (!narratorPromptConfig) {
			emitToUser("narratorPromptConfigs:get:error", {
				error: "Narrator prompt config not found"
			})
			throw new Error("Narrator prompt config not found")
		}
		const res: Sockets.NarratorPromptConfigs.Get.Response = {
			narratorPromptConfig
		}
		emitToUser("narratorPromptConfigs:get", res)
		return res
	}
}

export const narratorPromptConfigsCreate: Handler<
	Sockets.NarratorPromptConfigs.Create.Params,
	Sockets.NarratorPromptConfigs.Create.Response
> = {
	event: "narratorPromptConfigs:create",
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

		const [narratorPromptConfig] = await db
			.insert(schema.narratorPromptConfigs)
			.values(params.narratorPromptConfig)
			.returning()
		await narratorPromptConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.NarratorPromptConfigs.Create.Response = {
			narratorPromptConfig
		}
		emitToUser("narratorPromptConfigs:create", res)
		return res
	}
}

export const narratorPromptConfigsUpdate: Handler<
	Sockets.NarratorPromptConfigs.Update.Params,
	Sockets.NarratorPromptConfigs.Update.Response
> = {
	event: "narratorPromptConfigs:update",
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

		const id = params.narratorPromptConfig.id!
		const { id: _, ...rawUpdateData } = params.narratorPromptConfig

		const currentConfig = await db.query.narratorPromptConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, id)
		})
		// Immutable (built-in) configs may still have their AI Override
		// (connection/sampling) changed — that's the one thing the UI
		// leaves editable for them — but nothing else. Every other field
		// must come only from seeding.
		const updateData = currentConfig?.isImmutable
			? {
					connectionId: rawUpdateData.connectionId,
					samplingConfigId: rawUpdateData.samplingConfigId
				}
			: rawUpdateData

		// A raw client could target an immutable row with neither override
		// field present at all — updateData then has no defined values, and
		// an empty .set() throws rather than being a legitimate no-op.
		const hasUpdates = Object.values(updateData).some((v) => v !== undefined)
		const narratorPromptConfig = hasUpdates
			? (
					await db
						.update(schema.narratorPromptConfigs)
						.set(updateData)
						.where(eq(schema.narratorPromptConfigs.id, id))
						.returning()
				)[0]
			: currentConfig!
		await narratorPromptConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.NarratorPromptConfigs.Update.Response = {
			narratorPromptConfig
		}
		emitToUser("narratorPromptConfigs:update", res)
		return res
	}
}

export const narratorPromptConfigsDelete: Handler<
	Sockets.NarratorPromptConfigs.Delete.Params,
	Sockets.NarratorPromptConfigs.Delete.Response
> = {
	event: "narratorPromptConfigs:delete",
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

		const currentConfig = await db.query.narratorPromptConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (currentConfig?.isImmutable) {
			emitToUser("narratorPromptConfigs:delete:error", {
				error: "Cannot delete a built-in narrator prompt config."
			})
			throw new Error("Cannot delete a built-in narrator prompt config.")
		}

		await db
			.delete(schema.narratorPromptConfigs)
			.where(eq(schema.narratorPromptConfigs.id, params.id))
		await narratorPromptConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.NarratorPromptConfigs.Delete.Response = {
			success: "Narrator prompt config deleted successfully"
		}
		emitToUser("narratorPromptConfigs:delete", res)
		return res
	}
}

export const narratorPromptConfigsSetUserActive: Handler<
	Sockets.NarratorPromptConfigs.SetUserActive.Params,
	Sockets.NarratorPromptConfigs.SetUserActive.Response
> = {
	event: "narratorPromptConfigs:setUserActive",
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
			emitToUser("narratorPromptConfigs:setUserActive:error", {
				error: "User not found."
			})
			throw new Error("User not found")
		}

		// Find or create user settings
		let userSettings = await db.query.userSettings.findFirst({
			where: (us, { eq }) => eq(us.userId, currentUser.id)
		})

		if (!userSettings) {
			await db
				.insert(schema.userSettings)
				.values({
					userId: currentUser.id
				})
				.onConflictDoNothing()
		}

		await db
			.update(schema.userSettings)
			.set({
				activeNarratorPromptConfigId: params.id
			})
			.where(eq(schema.userSettings.userId, currentUser.id))

		await loadUser(socket, {}, emitToUser) // Emit updated user info
		await userSettingsGet.handler(socket, {}, emitToUser)
		if (params.id) {
			await narratorPromptConfigsGet.handler(
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
		const res: Sockets.NarratorPromptConfigs.SetUserActive.Response = {
			user: updatedUser!
		}
		emitToUser("narratorPromptConfigs:setUserActive", res)
		return res
	}
}

// Registration function for all narrator-prompt-config handlers
export function registerNarratorPromptConfigHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, narratorPromptConfigsListHandler, emitToUser)
	register(socket, narratorPromptConfigsGet, emitToUser)
	register(socket, narratorPromptConfigsCreate, emitToUser)
	register(socket, narratorPromptConfigsUpdate, emitToUser)
	register(socket, narratorPromptConfigsDelete, emitToUser)
	register(socket, narratorPromptConfigsSetUserActive, emitToUser)
}
