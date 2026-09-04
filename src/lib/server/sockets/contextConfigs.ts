import { db } from "$lib/server/db"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { user as loadUser, user } from "./users"
import { userSettingsGet } from "./userSettings"
import type { Handler } from "$lib/shared/events"
import {
	bareLayouts,
	previewContextTemplate
} from "$lib/server/pipelines/prompt/preview"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"

export const contextConfigsListHandler: Handler<
	Sockets.ContextConfigs.List.Params,
	Sockets.ContextConfigs.List.Response
> = {
	event: "contextConfigs:list",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage context configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage context configurations."
			)
		}

		const contextConfigsList = await db.query.contextConfigs.findMany({
			columns: {
				id: true,
				name: true,
				isImmutable: true
			},
			orderBy: (c, { asc, desc }) => [desc(c.isImmutable), asc(c.name)]
		})
		const res: Sockets.ContextConfigs.List.Response = { contextConfigsList }
		emitToUser("contextConfigs:list", res)
		return res
	}
}

export const contextConfigsGet: Handler<
	Sockets.ContextConfigs.Get.Params,
	Sockets.ContextConfigs.Get.Response
> = {
	event: "contextConfigs:get",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage context configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage context configurations."
			)
		}

		const contextConfig = await db.query.contextConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (!contextConfig) {
			emitToUser("contextConfigs:get:error", {
				error: "Context config not found"
			})
			throw new Error("Context config not found")
		}
		const res: Sockets.ContextConfigs.Get.Response = { contextConfig }
		emitToUser("contextConfigs:get", res)
		return res
	}
}

export const contextConfigsCreate: Handler<
	Sockets.ContextConfigs.Create.Params,
	Sockets.ContextConfigs.Create.Response
> = {
	event: "contextConfigs:create",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can create context configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can create context configurations."
			)
		}

		// seedKey marks a row as one of the built-in seeded configs and is
		// UNIQUE, so it must never come from the client. The sidebars build a
		// "New" config by spreading the currently-selected one and deleting a
		// couple of fields; cloning a SEEDED config therefore carried its
		// seedKey straight through and the insert died on the unique index:
		//   duplicate key value violates unique constraint "context_configs_seed_key_unique"
		//   a duplicate seed_key.
		//
		// id is stripped for the same reason personasCreate strips it: both are
		// server-owned, and honouring either lets a caller collide with or
		// overwrite an existing row. Done here rather than in the sidebar
		// because a handler must not trust its payload — the sidebar already
		// deletes `id` and still missed this one.
		const {
			id: _id,
			seedKey: _seedKey,
			...contextConfigValues
		} = (params.contextConfig ?? {}) as any

		const [contextConfig] = await db
			.insert(schema.contextConfigs)
			.values(contextConfigValues)
			.returning()
		await contextConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.ContextConfigs.Create.Response = { contextConfig }
		emitToUser("contextConfigs:create", res)
		return res
	}
}

export const contextConfigsUpdate: Handler<
	Sockets.ContextConfigs.Update.Params,
	Sockets.ContextConfigs.Update.Response
> = {
	event: "contextConfigs:update",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can update context configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can update context configurations."
			)
		}

		const id = params.contextConfig.id!
		const { id: _, ...updateData } = params.contextConfig

		const currentConfig = await db.query.contextConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, id)
		})
		if (currentConfig?.isImmutable) {
			emitToUser("contextConfigs:update:error", {
				error: "Cannot update a built-in context config."
			})
			throw new Error("Cannot update a built-in context config.")
		}

		// A raw client could target a mutable row with an {id}-only payload
		// (no other fields present at all) — updateData then has no defined
		// values, and an empty .set() throws rather than being a legitimate
		// no-op (same round-8 fix already applied to promptConfigsUpdate).
		const hasUpdates = Object.values(updateData).some(
			(v) => v !== undefined
		)
		const contextConfig = hasUpdates
			? (
					await db
						.update(schema.contextConfigs)
						.set(updateData)
						.where(eq(schema.contextConfigs.id, id))
						.returning()
				)[0]
			: currentConfig!
		await contextConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.ContextConfigs.Update.Response = { contextConfig }
		emitToUser("contextConfigs:update", res)
		await user(socket, {}, emitToUser)
		return res
	}
}

export const contextConfigsDelete: Handler<
	Sockets.ContextConfigs.Delete.Params,
	Sockets.ContextConfigs.Delete.Response
> = {
	event: "contextConfigs:delete",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can delete context configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can delete context configurations."
			)
		}

		const currentConfig = await db.query.contextConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (currentConfig?.isImmutable) {
			emitToUser("contextConfigs:delete:error", {
				error: "Cannot delete a built-in context config."
			})
			throw new Error("Cannot delete a built-in context config.")
		}

		// Check if this is the user's active context config and reset to default if so
		const userSettings = await db.query.userSettings.findFirst({
			where: (us, { eq }) => eq(us.userId, socket.user!.id)
		})
		if (userSettings?.activeContextConfigId === params.id) {
			await contextConfigsSetUserActive.handler(
				socket,
				{ id: null },
				emitToUser
			)
		}
		await db
			.delete(schema.contextConfigs)
			.where(eq(schema.contextConfigs.id, params.id))
		await contextConfigsListHandler.handler(socket, {}, emitToUser)
		const res: Sockets.ContextConfigs.Delete.Response = {
			success: "Context config deleted successfully"
		}
		emitToUser("contextConfigs:delete", res)
		return res
	}
}

export const contextConfigsSetUserActive: Handler<
	Sockets.ContextConfigs.SetUserActive.Params,
	Sockets.ContextConfigs.SetUserActive.Response
> = {
	event: "contextConfigs:setUserActive",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can set active context configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can set active context configurations."
			)
		}

		const userId = socket.user!.id
		const currentUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, userId)
		})
		if (!currentUser) {
			emitToUser("contextConfigs:setUserActive:error", {
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
				activeContextConfigId: params.id
			})
			.where(eq(schema.userSettings.userId, currentUser.id))

		// You may want to emit the user and contextConfig updates here as in the original
		await loadUser(socket, {}, emitToUser)
		await userSettingsGet.handler(socket, {}, emitToUser)

		// Get the updated user to return in response
		const updatedUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, currentUser.id),
			with: {
				userSettings: true
			}
		})
		const res: Sockets.ContextConfigs.SetUserActive.Response = {
			user: updatedUser!
		}
		emitToUser("contextConfigs:setUserActive", res)
		return res
	}
}

export const contextConfigsPreview: Handler<
	Sockets.ContextConfigs.Preview.Params,
	Sockets.ContextConfigs.Preview.Response
> = {
	event: "contextConfigs:preview",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage context configurations."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage context configurations."
			)
		}

		// Previewed against the **bare** layouts, which is what an archived
		// context config is pinned to: these templates carry their own headings
		// and fences, so rendering them through the wrapped defaults would show
		// every block twice-wrapped — a bug that exists only in the preview,
		// which is the worst kind to go looking for.
		const res: Sockets.ContextConfigs.Preview.Response =
			await previewContextTemplate({
				source: params.template,
				// Named rather than left to a default, and it is a fact rather
				// than a guess: `context_configs` is the 0.5 table, 0.5 had one
				// template language, and the column that would have said
				// otherwise did not exist. Every other caller reads the engine
				// off the row; this one is the archive, and the archive is
				// Handlebars by definition.
				engine: CORE_TEMPLATE_ENGINE,
				layouts: bareLayouts()
			})
		emitToUser("contextConfigs:preview", res)
		return res
	}
}

// Legacy functions for compatibility
export async function contextConfigsList(
	socket: any,
	message: {},
	emitToUser: (event: string, data: any) => void
) {
	await contextConfigsListHandler.handler(socket, {}, emitToUser)
}

export async function contextConfig(
	socket: any,
	message: { id: number },
	emitToUser: (event: string, data: any) => void
) {
	await contextConfigsGet.handler(socket, { id: message.id }, emitToUser)
}

export async function createContextConfig(
	socket: any,
	message: { contextConfig: any },
	emitToUser: (event: string, data: any) => void
) {
	await contextConfigsCreate.handler(
		socket,
		{ contextConfig: message.contextConfig },
		emitToUser
	)
}

export async function updateContextConfig(
	socket: any,
	message: { contextConfig: any },
	emitToUser: (event: string, data: any) => void
) {
	await contextConfigsUpdate.handler(
		socket,
		{ contextConfig: message.contextConfig },
		emitToUser
	)
}

export async function deleteContextConfig(
	socket: any,
	message: { id: number },
	emitToUser: (event: string, data: any) => void
) {
	await contextConfigsDelete.handler(socket, { id: message.id }, emitToUser)
}

export async function setUserActiveContextConfig(
	socket: any,
	message: { id: number | null },
	emitToUser: (event: string, data: any) => void
) {
	await contextConfigsSetUserActive.handler(
		socket,
		{ id: message.id },
		emitToUser
	)
}

// Registration function for all context config handlers
export function registerContextConfigHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, contextConfigsListHandler, emitToUser)
	register(socket, contextConfigsGet, emitToUser)
	register(socket, contextConfigsCreate, emitToUser)
	register(socket, contextConfigsUpdate, emitToUser)
	register(socket, contextConfigsDelete, emitToUser)
	register(socket, contextConfigsSetUserActive, emitToUser)
	register(socket, contextConfigsPreview, emitToUser)
}
