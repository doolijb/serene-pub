import { db } from "$lib/server/db"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { user as loadUser, user, usersCurrent } from "./users"
import { userSettingsGet } from "./userSettings"
import { systemSettingsGet } from "./systemSettings"
import { getConnectionAdapter } from "../utils/getConnectionAdapter"
import { getImageAdapter } from "../utils/getImageAdapter"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	withConnectionDefaults,
	stableStringify
} from "$lib/shared/utils/connectionDefaults"

/**
 * Resolve a connection's test/list functions, picking the adapter FAMILY by
 * modality: image-gen types route to the image adapters, everything else to the
 * text adapters. Both families export `testConnection`/`listModels` with the
 * same call shape, so callers destructure the two the same way.
 */
async function adapterIO(type: string) {
	return CONNECTION_TYPE.isImage(type)
		? await getImageAdapter(type)
		: await getConnectionAdapter(type)
}
import type { Handler } from "$lib/shared/events"
import { loginRateLimit } from "$lib/server/services/loginRateLimit"
import {
	encryptApiKeyField,
	decryptApiKeyField
} from "$lib/server/utils/tokenCrypto"

// extraJson.apiKey is encrypted at rest (tokenCrypto.ts) — stored plaintext
// before this fix. A plain-string value is a fresh/edited key from the
// client (or a legacy row); already-encrypted-envelope values (already
// re-saved once through this same path) are left untouched rather than
// re-encrypted on every unrelated field edit.
function withEncryptedApiKey<T extends { extraJson?: Record<string, any> }>(
	data: T
): T {
	if (!data.extraJson || typeof data.extraJson.apiKey !== "string") {
		return data
	}
	if (!data.extraJson.apiKey) return data
	return {
		...data,
		extraJson: {
			...data.extraJson,
			apiKey: encryptApiKeyField(data.extraJson.apiKey)
		}
	}
}

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
				baseUrl: true,
				// So a picker can filter by what the endpoint is for (20 §14):
				// a text-gen slot must not offer the embeddings connection.
				modality: true
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

		// The edit form loads the real key back into its input on edit (same
		// pattern as vectorization:listModels) — decrypt here, at the point
		// it's about to leave the server, not earlier (the backfill-defaults
		// comparison above deliberately operates on the still-encrypted
		// envelope so it round-trips byte-for-byte when nothing actually
		// changed).
		if (connection.extraJson) {
			connection = {
				...connection,
				extraJson: {
					...connection.extraJson,
					apiKey:
						decryptApiKeyField(connection.extraJson.apiKey) ?? ""
				}
			}
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
		data = withEncryptedApiKey(data)
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
		const updateData = withEncryptedApiKey(params.connection)
		const [updated] = await db
			.update(schema.connections)
			.set(updateData)
			.where(eq(schema.connections.id, id))
			.returning()
		// connectionsGet.handler already builds the fully-processed record
		// (CONNECTION_DEFAULTS backfill + decrypted apiKey) and broadcasts its
		// own "connections:get" — reuse its return value here instead of the
		// raw (still-encrypted, non-backfilled) `updated` row, so the
		// "connections:update" ack itself carries a client-safe, fully
		// processed connection the UI can use to reset its unsaved-changes
		// baseline immediately, without waiting on/racing that second,
		// incidental broadcast. `getResult.connection` is only null when the
		// id isn't found, which can't be the case here (the update above just
		// succeeded against it) — the `?? updated` fallback exists purely to
		// satisfy Update.Response's non-null `connection` type.
		const getResult = await connectionsGet.handler(
			socket,
			{ id },
			emitToUser
		)
		const res: Sockets.Connections.Update.Response = {
			connection: getResult.connection ?? updated
		}
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

		// Instance-wide budget (not per-user) — every call here can reach an
		// external host via the connection's own configured base URL, with
		// no throttling otherwise, unlike the GitHub card source's own
		// rate limiter for the same class of concern.
		const rateLimitKey = "connections:test"
		if (loginRateLimit.isRateLimited(rateLimitKey)) {
			const res: Sockets.Connections.Test.Response = {
				ok: false,
				error: "Rate limited. Please wait a moment and try again.",
				models: []
			}
			emitToUser("connections:test", res)
			return res
		}
		loginRateLimit.recordFailedAttempt(rateLimitKey)

		try {
			// getConnectionAdapter always throws for an unsupported type
			// rather than returning a falsy Adapter — moved inside this try
			// (was previously outside it) so that throw produces this
			// handler's own clean {ok:false, error, connectionId} response
			// instead of an uncaught error.
			const { testConnection, listModels } = await adapterIO(
				params.connection.type
			)
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
				models,
				connectionId: params.connection?.id,
				// Passed through untouched — core does not know what any given
				// adapter chose to include, which is the point.
				...((result as any).extra
					? { extra: (result as any).extra }
					: {})
			}
			emitToUser("connections:test", res)
			return res
		} catch (error: any) {
			console.error("Connection test error:", error)
			const res: Sockets.Connections.Test.Response = {
				ok: false,
				error: error?.message || String(error) || "Connection failed.",
				models: [],
				connectionId: params.connection?.id
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

		const rateLimitKey = "connections:refreshModels"
		if (loginRateLimit.isRateLimited(rateLimitKey)) {
			const res: Sockets.Connections.RefreshModels.Response = {
				error: "Rate limited. Please wait a moment and try again.",
				models: []
			}
			emitToUser("connections:refreshModels", res)
			return res
		}
		loginRateLimit.recordFailedAttempt(rateLimitKey)

		try {
			// getConnectionAdapter can throw for an unsupported type — moved
			// inside this try so that surfaces as this handler's own clean
			// error response instead of an uncaught error.
			const { listModels } = await adapterIO(params.connection.type)
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
					models: [],
					connectionId: params.connection?.id
				}
				emitToUser("connections:refreshModels", res)
				return res
			}
			const res: Sockets.Connections.RefreshModels.Response = {
				models: result.models,
				error: null,
				connectionId: params.connection?.id
			}
			emitToUser("connections:refreshModels", res)
			return res
		} catch (error: any) {
			console.error("Refresh models error:", error)
			const res: Sockets.Connections.RefreshModels.Response = {
				error: "Failed to refresh models.",
				models: [],
				connectionId: params.connection?.id
			}
			emitToUser("connections:refreshModels", res)
			return res
		}
	}
}

// Registration function for all connection handlers
/* --- stop guards on a connection (18 §4b) ---------------------------- */

/**
 * The three answer with the same refreshed view, library-style: attach and
 * detach change both lists at once, and two fetches that could disagree are
 * one fetch that cannot.
 */
async function connectionScriptsView(
	connectionId: number
): Promise<Sockets.Connections.Scripts.Response> {
	const { listConnectionScripts, scriptsView, STOP_TYPE_ID } = await import(
		"$lib/server/pipelines/entities/scripts"
	)
	const attached = await listConnectionScripts(db as any, connectionId)
	const all = await scriptsView(db as any)
	const attachedIds = new Set(attached.map((s) => s.id))
	return {
		connectionId,
		attached: attached.map((s) => ({
			id: s.id,
			name: s.name,
			enabled: s.enabled
		})),
		available: all.scripts
			.filter((s) => s.typeId === STOP_TYPE_ID && !attachedIds.has(s.id))
			.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled }))
	}
}

const connectionScriptsGate = (socket: any): string | null =>
	socket.user!.isAdmin
		? null
		: "Access denied. Only admin users can manage connections."

export const connectionsScripts: Handler<
	Sockets.Connections.Scripts.Params,
	Sockets.Connections.Scripts.Response
> = {
	event: "connections:scripts",
	handler: async (socket, params, emitToUser) => {
		const denied = connectionScriptsGate(socket)
		if (denied) {
			emitToUser("connections:scripts:error", { error: denied })
			return { error: denied }
		}
		const res = await connectionScriptsView(params.id)
		emitToUser("connections:scripts", res)
		return res
	}
}

export const connectionsAttachScript: Handler<
	Sockets.Connections.ScriptWrite.Params,
	Sockets.Connections.ScriptWrite.Response
> = {
	event: "connections:attachScript",
	handler: async (socket, params, emitToUser) => {
		const denied = connectionScriptsGate(socket)
		if (denied) {
			emitToUser("connections:attachScript:error", { error: denied })
			return { error: denied }
		}
		try {
			const { attachConnectionScript } = await import(
				"$lib/server/pipelines/entities/scripts"
			)
			await attachConnectionScript(db as any, params.id, params.scriptId)
		} catch (err) {
			const res = { error: (err as Error).message }
			emitToUser("connections:attachScript:error", res)
			return res
		}
		const res = await connectionScriptsView(params.id)
		emitToUser("connections:attachScript", res)
		return res
	}
}

export const connectionsDetachScript: Handler<
	Sockets.Connections.ScriptWrite.Params,
	Sockets.Connections.ScriptWrite.Response
> = {
	event: "connections:detachScript",
	handler: async (socket, params, emitToUser) => {
		const denied = connectionScriptsGate(socket)
		if (denied) {
			emitToUser("connections:detachScript:error", { error: denied })
			return { error: denied }
		}
		const { detachConnectionScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		await detachConnectionScript(db as any, params.id, params.scriptId)
		const res = await connectionScriptsView(params.id)
		emitToUser("connections:detachScript", res)
		return res
	}
}

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
	register(socket, connectionsScripts, emitToUser)
	register(socket, connectionsAttachScript, emitToUser)
	register(socket, connectionsDetachScript, emitToUser)
}
