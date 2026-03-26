import { db } from "$lib/server/db"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { user as loadUser, user } from "./users"
import { userSettingsGet } from "./userSettings"
import { getConnectionAdapter } from "../utils/getConnectionAdapter"
import type { Handler } from "$lib/shared/events"

// --- CONNECTIONS SOCKET HANDLERS ---

export const connectionsList: Handler<
	Sockets.Connections.List.Params,
	Sockets.Connections.List.Response
> = {
	event: "connections:list",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage connections."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage connections."
			)
		}

		const connectionsList = await db.query.connections.findMany({
			columns: {
				id: true,
				name: true,
				type: true
			},
			orderBy: (c, { asc }) => [asc(c.type), asc(c.name)]
		})
		const res: Sockets.Connections.List.Response = { connectionsList }
		emitToUser("connections:list", res)
		return res
	}
}

export const connectionsGet: Handler<
	Sockets.Connections.Get.Params,
	Sockets.Connections.Get.Response
> = {
	event: "connections:get",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage connections."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage connections."
			)
		}

		const connection = await db.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (!connection) {
			const res = { error: "Connection not found." }
			emitToUser("error", res)
			throw new Error("Connection not found.")
		}
		const res: Sockets.Connections.Get.Response = { connection }
		emitToUser("connections:get", res)
		return res
	}
}

export const connectionsCreate: Handler<
	Sockets.Connections.Create.Params,
	Sockets.Connections.Create.Response
> = {
	event: "connections:create",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage connections."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage connections."
			)
		}

		let data = { ...params.connection }
		const Adapter = getConnectionAdapter(data.type)
		data = { ...Adapter.connectionDefaults, ...data }
		if ("id" in data) delete data.id
		// Always remove id before insert to let DB auto-increment
		if ("id" in data) delete data.id
		const [conn] = await db
			.insert(schema.connections)
			.values(data)
			.returning()
		await connectionsSetUserActive.handler(
			socket,
			{ id: conn.id },
			emitToUser
		)
		await connectionsList.handler(socket, {}, emitToUser)
		const res: Sockets.Connections.Create.Response = { connection: conn }
		emitToUser("connections:create", res)
		return res
	}
}

export const connectionsUpdate: Handler<
	Sockets.Connections.Update.Params,
	Sockets.Connections.Update.Response
> = {
	event: "connections:update",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage connections."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage connections."
			)
		}

		const id = params.connection.id
		if ("id" in params.connection) delete (params.connection as any).id
		const [updated] = await db
			.update(schema.connections)
			.set(params.connection)
			.where(eq(schema.connections.id, id))
			.returning()
		await connectionsGet.handler(socket, { id }, emitToUser)
		const res: Sockets.Connections.Update.Response = { connection: updated }
		emitToUser("connections:update", res)
		await user(socket, {}, emitToUser)
		await connectionsList.handler(socket, {}, emitToUser)
		return res
	}
}

export const connectionsDelete: Handler<
	Sockets.Connections.Delete.Params,
	Sockets.Connections.Delete.Response
> = {
	event: "connections:delete",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can manage connections."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can manage connections."
			)
		}

		const currentUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, socket.user!.id)
		})

		// Check if this connection is the user's active connection
		if (currentUser) {
			const userSettings = await db.query.userSettings.findFirst({
				where: (us, { eq }) => eq(us.userId, currentUser.id)
			})

			if (userSettings?.activeConnectionId === params.id) {
				await connectionsSetUserActive.handler(
					socket,
					{ id: null },
					emitToUser
				)
			}
		}
		await db
			.delete(schema.connections)
			.where(eq(schema.connections.id, params.id))
		await connectionsList.handler(socket, {}, emitToUser)
		const res: Sockets.Connections.Delete.Response = { id: params.id }
		emitToUser("connections:delete", res)
		return res
	}
}

export const connectionsSetUserActive: Handler<
	Sockets.Connections.SetUserActive.Params,
	Sockets.Connections.SetUserActive.Response
> = {
	event: "connections:setUserActive",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can set active connections."
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can set active connections."
			)
		}

		const currentUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, socket.user!.id)
		})
		if (!currentUser) {
			const res = { error: "User not found." }
			emitToUser("error", res)
			throw new Error("User not found.")
		}

		// Find or create user settings
		let userSettings = await db.query.userSettings.findFirst({
			where: (us, { eq }) => eq(us.userId, currentUser.id)
		})

		if (!userSettings) {
			await db.insert(schema.userSettings).values({
				userId: currentUser.id
			})
			userSettings = await db.query.userSettings.findFirst({
				where: (us, { eq }) => eq(us.userId, currentUser.id)
			})
		}

		await db
			.update(schema.userSettings)
			.set({
				activeConnectionId: params.id
			})
			.where(eq(schema.userSettings.userId, currentUser.id))
		// The user handler is not modularized yet, so call as in original
		// @ts-ignore
		await loadUser(socket, {}, emitToUser)
		await userSettingsGet.handler(socket, {}, emitToUser)
		if (params.id)
			await connectionsGet.handler(socket, { id: params.id }, emitToUser)
		const res: Sockets.Connections.SetUserActive.Response = { ok: true }
		emitToUser("connections:setUserActive", res)
		return res
	}
}

export const connectionsTest: Handler<
	Sockets.Connections.Test.Params,
	Sockets.Connections.Test.Response
> = {
	event: "connections:test",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res: Sockets.Connections.Test.Response = {
				ok: false,
				error: "Access denied. Only admin users can test connections.",
				models: []
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can test connections."
			)
		}

		const { Adapter, testConnection, listModels } = getConnectionAdapter(
			params.connection.type
		)
		if (!Adapter) {
			const res: Sockets.Connections.Test.Response = {
				ok: false,
				error: "Unsupported connection type.",
				models: []
			}
			emitToUser("connections:test", res)
			return res
		}

		try {
			const result = await testConnection(params.connection)
			let models: any[] = []
			let error: string | null = null
			if (result.ok) {
				const modelsRes = await listModels(params.connection)
				if (modelsRes.error) {
					emitToUser("error", {
						error: modelsRes.error
					})
					throw new Error(modelsRes.error)
				}
				models = modelsRes.models || []
				error = modelsRes.error || null
			} else {
				error = result.error || "Connection failed."
			}
			const res: Sockets.Connections.Test.Response = {
				ok: result.ok,
				error: error || null,
				models
			}
			emitToUser("connections:test", res)
			return res
		} catch (error: any) {
			console.error("Connection test error:", error)
			const res: Sockets.Connections.Test.Response = {
				ok: false,
				error: error?.message || String(error) || "Connection failed.",
				models: []
			}
			emitToUser("connections:test", res)
			return res
		}
	}
}

export const connectionsRefreshModels: Handler<
	Sockets.Connections.RefreshModels.Params,
	Sockets.Connections.RefreshModels.Response
> = {
	event: "connections:refreshModels",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res: Sockets.Connections.RefreshModels.Response = {
				error: "Access denied. Only admin users can refresh models.",
				models: []
			}
			emitToUser("error", res)
			throw new Error(
				"Access denied. Only admin users can refresh models."
			)
		}

		const { listModels } = getConnectionAdapter(params.connection.type)

		try {
			const result = await listModels(params.connection)
			if (result.error) {
				const res = {
					error: result.error
				}
				emitToUser("error", res)
				throw new Error(result.error)
			} else if (!result.models) {
				const res: Sockets.Connections.RefreshModels.Response = {
					error: "Failed to refresh models.",
					models: []
				}
				emitToUser("connections:refreshModels", res)
				return res
			}
			const res: Sockets.Connections.RefreshModels.Response = {
				models: result.models,
				error: null
			}
			emitToUser("connections:refreshModels", res)
			return res
		} catch (error: any) {
			console.error("Refresh models error:", error)
			const res: Sockets.Connections.RefreshModels.Response = {
				error: "Failed to refresh models.",
				models: []
			}
			emitToUser("connections:refreshModels", res)
			return res
		}
	}
}

// Registration function for all connection handlers
export function registerConnectionHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, connectionsList, emitToUser)
	register(socket, connectionsGet, emitToUser)
	register(socket, connectionsCreate, emitToUser)
	register(socket, connectionsUpdate, emitToUser)
	register(socket, connectionsDelete, emitToUser)
	register(socket, connectionsSetUserActive, emitToUser)
	register(socket, connectionsTest, emitToUser)
	register(socket, connectionsRefreshModels, emitToUser)
}
