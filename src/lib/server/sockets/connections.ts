import { db } from "$lib/server/db"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { user as loadUser, user } from "./users"
import { getConnectionAdapter } from "../utils/getConnectionAdapter"


// --- CONNECTIONS SOCKET HANDLERS ---

export async function connectionsList(
	socket: any,
	message: Sockets.ConnectionsList.Call,
	emitToUser: (event: string, data: any) => void
) {
	const connectionsList = await db.query.connections.findMany({
		columns: {
			id: true,
			name: true,
			type: true
		},
		orderBy: (c, { asc }) => [asc(c.type), asc(c.name)],
	})
	const res: Sockets.ConnectionsList.Response = { connectionsList }
	emitToUser("connectionsList", res)
}

export async function connection(
	socket: any,
	message: Sockets.Connection.Call,
	emitToUser: (event: string, data: any) => void
) {
	const connection = await db.query.connections.findFirst({
		where: (c, { eq }) => eq(c.id, message.id)
	})
	if (!connection) {
		const res = { error: "Connection not found." }
		emitToUser("error", res)
		return
	}
	const res: Sockets.Connection.Response = { connection }
	emitToUser("connection", res)
}

export async function createConnection(
	socket: any,
	message: Sockets.CreateConnection.Call,
	emitToUser: (event: string, data: any) => void
) {
	let data = { ...message.connection }
	const Adapter = getConnectionAdapter(data.type)
	data = { ...Adapter.connectionDefaults, ...data }
	if ("id" in data) delete data.id
	// try {
	// 	const modelsRes = await Adapter.listModels(data as any)
	// 	if (modelsRes.error) {
	// 		const res = { error: modelsRes.error }
	// 		emitToUser("error", res)
	// 		return
	// 	}
	// 	if (!modelsRes.models || modelsRes.models.length === 0) {
	// 		const res = { error: "No models found for this connection." }
	// 		emitToUser("error", res)
	// 	} else {
	// 		data.model = modelsRes.models[0].id
	// 	}
	// } catch (error: any) {
	// 	console.error("Error fetching models:", error)
	// 	const res = { error: "Failed to fetch models for this connection." }
	// 	emitToUser("error", res)
	// 	return
	// }
	// Always remove id before insert to let DB auto-increment
	if ("id" in data) delete data.id
	const [conn] = await db.insert(schema.connections).values(data).returning()
	await setUserActiveConnection(socket, { id: conn.id }, emitToUser)
	await connectionsList(socket, {}, emitToUser)
	const res: Sockets.CreateConnection.Response = { connection: conn }
	emitToUser("createConnection", res)
}

export async function updateConnection(
	socket: any,
	message: Sockets.UpdateConnection.Call,
	emitToUser: (event: string, data: any) => void
) {
	const id = message.connection.id
	if ("id" in message.connection) delete (message.connection as any).id
	const [updated] = await db
		.update(schema.connections)
		.set(message.connection)
		.where(eq(schema.connections.id, id))
		.returning()
	await connection(socket, { id }, emitToUser)
	const res: Sockets.UpdateConnection.Response = { connection: updated }
	emitToUser("updateConnection", res)
	await user(socket, {}, emitToUser)
	await connectionsList(socket, {}, emitToUser)
}

export async function deleteConnection(
	socket: any,
	message: Sockets.DeleteConnection.Call,
	emitToUser: (event: string, data: any) => void
) {
	const currentUser = await db.query.users.findFirst({
		where: (u, { eq }) => eq(u.id, 1)
	})
	if (currentUser && currentUser.activeConnectionId === message.id) {
		await setUserActiveConnection(socket, { id: null }, emitToUser)
	}
	await db
		.delete(schema.connections)
		.where(eq(schema.connections.id, message.id))
	await connectionsList(socket, {}, emitToUser)
	const res: Sockets.DeleteConnection.Response = { id: message.id }
	emitToUser("deleteConnection", res)
}

export async function setUserActiveConnection(
	socket: any,
	message: Sockets.SetUserActiveConnection.Call,
	emitToUser: (event: string, data: any) => void
) {
	const currentUser = await db.query.users.findFirst({
		where: (u, { eq }) => eq(u.id, 1)
	})
	if (!currentUser) {
		const res = { error: "User not found." }
		emitToUser("error", res)
		return
	}
	await db
		.update(schema.users)
		.set({
			activeConnectionId: message.id
		})
		.where(eq(schema.users.id, currentUser.id))
	// The user handler is not modularized yet, so call as in original
	// @ts-ignore
	await loadUser(socket, {}, emitToUser)
	if (message.id) await connection(socket, { id: message.id }, emitToUser)
	const res: Sockets.SetUserActiveConnection.Response = { ok: true }
	emitToUser("setUserActiveConnection", res)
}

export async function testConnection(
	socket: any,
	message: Sockets.TestConnection.Call,
	emitToUser: (event: string, data: any) => void
) {
	const {Adapter, testConnection, listModels} = getConnectionAdapter(message.connection.type)
	if (!Adapter) {
		const res: Sockets.TestConnection.Response = {
			ok: false,
			error: "Unsupported connection type.",
			models: []
		}
		emitToUser("testConnection", res)
		return
	}

	try {
		const result = await testConnection(message.connection)
		let models: any[] = []
		let error: string | null = null
		if (result.ok) {
			const modelsRes = await listModels(message.connection)
			if (modelsRes.error) {
				emitToUser("error", {
					error: modelsRes.error,
				})
				return
			}
			models = modelsRes.models || []
			error = modelsRes.error || null
		} else {
			error = result.error || "Connection failed."
		}
		const res: Sockets.TestConnection.Response = {
			ok: result.ok,
			error: error || null,
			models
		}
		emitToUser("testConnection", res)
	} catch (error: any) {
		console.error("Connection test error:", error)
		const res: Sockets.TestConnection.Response = {
			ok: false,
			error: error?.message || String(error) || "Connection failed.",
			models: []
		}
		emitToUser("testConnection", res)
	}
}

export async function refreshModels(
	socket: any,
	message: Sockets.RefreshModels.Call,
	emitToUser: (event: string, data: any) => void
) {
	const { listModels } = getConnectionAdapter(message.connection.type)

	try {
		const result = await listModels(message.connection)
		if (result.error) {
			const res = {
				error: result.error,
			}
			emitToUser("error", res)
		} else if (!result.models) {
			const res: Sockets.RefreshModels.Response = {
				error: "Failed to refresh models.",
				models: []
			}
			emitToUser("refreshModels", res)
			return
		}
		const res: Sockets.RefreshModels.Response = {
			models: result.models,
			error: null
		}
		emitToUser("refreshModels", res)
	} catch (error: any) {
		console.error("Refresh models error:", error)
		const res: Sockets.RefreshModels.Response = {
			error: "Failed to refresh models.",
			models: []
		}
		emitToUser("refreshModels", res)
	}
}


