import { db } from "$lib/server/db"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { user as loadUser, user, usersCurrent } from "./users"
import { userSettingsGet } from "./userSettings"
import { systemSettingsGet } from "./systemSettings"
import { getConnectionAdapter } from "../utils/getConnectionAdapter"
import {
	withConnectionDefaults,
	stableStringify
} from "$lib/shared/utils/connectionDefaults"
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
				type: true,
				model: true,
				baseUrl: true
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

		const raw = await db.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, params.id)
		})
		if (!raw) {
			const res = { error: "Connection not found." }
			emitToUser("error", res)
			throw new Error("Connection not found.")
		}

		// Backfill any fields missing their type's defaults (e.g. extraJson
		// keys added to CONNECTION_DEFAULTS after this connection was
		// created) and persist them *before* handing the record to the edit
		// form. Without this, the form's own defaulting logic fills the gaps
		// only in its local copy, which immediately diverges from the raw
		// DB record still held as the "original" — a false "unsaved changes"
		// state the moment the connection is opened.
		let connection = raw
		const merged = withConnectionDefaults(raw)
		if (stableStringify(merged) !== stableStringify(raw)) {
			const [updated] = await db
				.update(schema.connections)
				.set({
					baseUrl: merged.baseUrl,
					model: merged.model,
					promptFormat: merged.promptFormat,
					tokenCounter: merged.tokenCounter,
					extraJson: merged.extraJson
				})
				.where(eq(schema.connections.id, params.id))
				.returning()
			connection = updated
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
		data = withConnectionDefaults(data as any)
		if ("id" in data) delete data.id
		// Always remove id before insert to let DB auto-increment
		if ("id" in data) delete data.id
		const [conn] = await db
			.insert(schema.connections)
			.values(data)
			.returning()
		// Auto-set as default only when no default exists yet (first connection)
		const sysSettings = await db.query.systemSettings.findFirst({
			columns: { defaultConnectionId: true }
		})
		if (!sysSettings?.defaultConnectionId) {
			await connectionsSetUserActive.handler(
				socket,
				{ id: conn.id },
				emitToUser
			)
		}
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

		// Clear default connection in system settings if it's the one being deleted
		const systemSettings = await db.query.systemSettings.findFirst({
			columns: { id: true, defaultConnectionId: true }
		})
		if (systemSettings?.defaultConnectionId === params.id) {
			await connectionsSetUserActive.handler(
				socket,
				{ id: null },
				emitToUser
			)
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
				error: "Access denied. Only admin users can set the default connection."
			}
			emitToUser("error", res)
			throw new Error("Access denied.")
		}

		// Update system-wide default connection (replaces the old per-user active connection)
		await db
			.update(schema.systemSettings)
			.set({ defaultConnectionId: params.id })
			.where(eq(schema.systemSettings.id, 1))

		if (params.id)
			await connectionsGet.handler(socket, { id: params.id }, emitToUser)

		const res: Sockets.Connections.SetUserActive.Response = {
			ok: true,
			id: params.id
		}
		emitToUser("connections:setUserActive", res)

		// Push updated system settings and user so clients reflect the new default immediately
		await systemSettingsGet.handler(socket, {}, emitToUser)
		await usersCurrent.handler(socket, {}, emitToUser)

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

		const { Adapter, testConnection, listModels } =
			await getConnectionAdapter(params.connection.type)
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

		const { listModels } = await getConnectionAdapter(
			params.connection.type
		)

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
