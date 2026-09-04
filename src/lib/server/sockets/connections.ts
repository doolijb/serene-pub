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
import { capabilityLabel, gradeOf } from "@serene-pub/sdk"
import type {
	CapabilityId,
	CapabilityOverrides,
	CapabilitySet
} from "@serene-pub/sdk"
import { adapterCapabilities } from "$lib/shared/connectionAdapters/manifest"
import { capabilityRefusal } from "$lib/server/pipelines/runtime/capabilityGuard"
import {
	capabilityColumn,
	persistCapabilities,
	probedCapabilities,
	resolveConnectionCapabilities
} from "$lib/server/connections/resolve"
import { setCapabilityDefault } from "$lib/server/connections/capabilityDefaults"
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
		// The picker sends the preset this was created from, and the column
		// holds the SLUG — a numeric preset `value` landing here would key
		// nothing in PRESET_CAPABILITIES while reading like a real slug forever
		// after. NULL is the honest answer for a custom endpoint.
		data.preset =
			typeof data.preset === "string" && data.preset ? data.preset : null
		// Resolved at write time and cached on the row: the picker reads every
		// connection against every slot, and resolving there would mean loading
		// an adapter module per row (see connections/resolve.ts).
		data.capabilities = {
			...(data.capabilities ?? {}),
			resolved: resolveConnectionCapabilities(data)
		}
		const [conn] = await db
			.insert(schema.connections)
			.values(data)
			.returning()
		// ⚠ Saving a connection does NOT make it the default. Anything.
		//
		// This used to auto-star the first connection ever saved — "only when no
		// default exists yet", which reads harmless and was not: it wrote
		// `text->text` regardless of what the row could DO, so an instance whose
		// first connection was an image endpoint got that endpoint as its chat
		// default, and the failure arrived later, from `getConnectionAdapter`,
		// naming a type rather than the choice nobody made.
		//
		// The ruling: "pipelines will not automatically choose a saved connection
		// just because it exists. it needs to be set somewhere in the app for
		// use." Existing is not choosing, and being the only one is not choosing
		// either. A connection becomes usable by being registered in
		// Admin → Defaults, or by the explicit one-click paths that call
		// `connectionsSetDefault` with the capability they mean
		// (`koboldcpp:connectModel`, `ollama:connectModel`).
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
		// `capabilities` is server-owned: `persistCapabilities` below is its only
		// writer, and letting the payload carry it would defeat that. The client
		// round-trips the whole row — `connections:get` hands it over, the sidebar
		// holds it, and pressing Test does not refresh the copy it holds. So a
		// Save after a Test wrote the PRE-test column back over the probe, and
		// the read-then-write below then faithfully preserved the wreckage. The
		// same mechanism would eat `overrides` the moment a toggle UI exists.
		const { capabilities: _serverOwned, ...editable } =
			params.connection as Record<string, unknown>
		const updateData = withEncryptedApiKey(editable as any)
		const [updated] = await db
			.update(schema.connections)
			.set(updateData)
			.where(eq(schema.connections.id, id))
			.returning()
		// Re-resolved because an edit can change the type or the preset, and
		// from the row that came back rather than from the payload: a partial
		// update need not have carried either field, and resolving without them
		// would cache an empty set over a good one. The durable halves survive —
		// persistCapabilities keeps the probe and overrides it isn't handed.
		if (updated)
			await persistCapabilities(db, id, {
				resolved: resolveConnectionCapabilities(updated)
			})
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

/* --- capability overrides (0175) ------------------------------------- */

const CAPABILITY_DENIED =
	"Access denied. Only admin users can manage connections."

/**
 * The capability column, for the panel that toggles it.
 *
 * Its own read rather than a field on `connections:get`, and its own write
 * rather than a field on `connections:update` — see the server-ownership comment
 * in connectionsUpdate above, which strips `capabilities` off that payload
 * precisely so a client's stale copy cannot land back on top of a probe. A panel
 * fed from the editor's `connection` would walk into the same bug from the other
 * side, so it is handed an id and fetches for itself.
 *
 * `type` and `preset` ride along because the panel needs the KEY SPACE, and that
 * belongs to the saved row: Document View's edit page can change `type` in local
 * state long before anything is saved, and rendering the half-changed value
 * would offer switches the stored connection has no field for.
 */
async function capabilitiesView(
	id: number
): Promise<Sockets.Connections.Capabilities.Response> {
	const row = await db.query.connections.findFirst({
		where: (c, { eq }) => eq(c.id, id),
		columns: { id: true, type: true, preset: true, capabilities: true }
	})
	if (!row) return { connectionId: id, error: "Connection not found." }
	return {
		connectionId: id,
		type: row.type,
		preset: row.preset ?? null,
		capabilities: capabilityColumn(row)
	}
}

export const connectionsCapabilities: Handler<
	Sockets.Connections.Capabilities.Params,
	Sockets.Connections.Capabilities.Response
> = {
	event: "connections:capabilities",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = { connectionId: params.id, error: CAPABILITY_DENIED }
			emitToUser("connections:capabilities:error", {
				error: CAPABILITY_DENIED
			})
			return res
		}
		const res = await capabilitiesView(params.id)
		if (res.error) {
			emitToUser("connections:capabilities:error", { error: res.error })
			return res
		}
		emitToUser("connections:capabilities", res)
		return res
	}
}

export const connectionsSetCapability: Handler<
	Sockets.Connections.SetCapability.Params,
	Sockets.Connections.SetCapability.Response
> = {
	event: "connections:setCapability",
	handler: async (socket, params, emitToUser) => {
		const fail = (error: string) => {
			emitToUser("connections:setCapability:error", { error })
			return { connectionId: params.id, error }
		}
		if (!socket.user!.isAdmin) return fail(CAPABILITY_DENIED)

		const row = await db.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, params.id),
			columns: { id: true, type: true, preset: true, capabilities: true }
		})
		if (!row) return fail("Connection not found.")

		// THE GATE. `resolveCapabilities` already ignores a key the adapter never
		// declared, so an undeclared override changes nothing today — but it is
		// DURABLE, and the key space moves when the type does. Junk written here
		// would sit in the column until someone switched an OpenAI-compatible
		// connection to a type that does declare it, and then RESURRECT as a
		// setting nobody made. Refuse it at the door instead.
		const declared = adapterCapabilities(row.type)?.supports?.[
			params.capability
		]
		if (declared === undefined)
			return fail(
				`This connection type has no ${capabilityLabel(params.capability)} to switch — its protocol cannot express it.`
			)

		// Three states, and only three. A value off this list is a malformed
		// payload rather than a new state, and writing it would put a grade
		// nothing can read into the durable half of the column.
		//
		// `"none"` is a legal `Band` and is deliberately NOT accepted: `false`
		// already says off, and a second spelling of it would be a durable value
		// whose meaning depends on which writer produced it.
		const { value } = params
		if (
			value !== null &&
			value !== false &&
			value !== "native" &&
			value !== "emulated"
		)
			return fail("Unrecognised capability setting.")

		const current = capabilityColumn(row)
		const overrides: CapabilityOverrides = { ...(current.overrides ?? {}) }
		// null DELETES rather than writing `false`. The two look identical on
		// screen and mean opposite things: an absent key hands authority back to
		// the probe — the honest owner of what the backend actually does — while
		// `false` outranks every probe that will ever run, permanently blinding
		// the row to it.
		//
		// The wire says a BAND and the column stores a GRADE, and this is the one
		// place that converts. `"native"` is the capability's top band — 2 for
		// `tools`, 1 for `text->image` — so the number cannot be decided by a
		// client that would have to carry every capability's scale to do it.
		if (value === null) delete overrides[params.capability]
		else
			overrides[params.capability] =
				value === false ? false : gradeOf(params.capability, value)

		const resolved = resolveConnectionCapabilities({
			type: row.type,
			preset: row.preset,
			capabilities: { ...current, overrides }
		})
		// No `probe` key, so the stored one survives — this write is a person's,
		// and it knows nothing about what the backend last answered. `overrides`
		// is always an OBJECT, `{}` included: undefined reads as "keep what is
		// stored", so clearing the last override would be a silent no-op.
		const written = await persistCapabilities(db, row.id, {
			resolved,
			overrides
		})

		const res: Sockets.Connections.SetCapability.Response = {
			connectionId: row.id,
			type: row.type,
			preset: row.preset ?? null,
			capabilities: written
		}
		// This event ONLY. Not connectionsGet, whose broadcast carries a whole
		// connection and, through ConnectionsSidebar's handler, replaces both
		// `connection` and `originalConnection` — silently discarding the
		// in-progress name/URL/model edits of the very form this panel sits in.
		emitToUser("connections:setCapability", res)
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

		// No clear-on-delete dance. `connection_defaults.connection_id` is
		// ON DELETE SET NULL, so deleting a connection releases every capability
		// it held, in one statement, for capabilities this handler has never
		// heard of. The read-then-unstar that used to sit here only ever knew
		// about `text->text`: an image connection holding `text->image` was
		// deleted with its registration left pointing at a row that no longer
		// existed, and the failure surfaced at render time as a dangling id.
		//
		// The cascade is also what makes the "cleared" refusal a different
		// sentence from "unset" — a surviving row with a null connection is the
		// only evidence that something WAS set up and is now gone
		// (capabilityTarget.ts).
		await db
			.delete(schema.connections)
			.where(eq(schema.connections.id, params.id))
		await connectionsList.handler(socket, {}, emitToUser)
		const res: Sockets.Connections.Delete.Response = { id: params.id }
		emitToUser("connections:delete", res)
		// The defaults ride on `systemSettings:get`, and the cascade above may
		// just have emptied one. Without this the star stays on screen against a
		// connection that is gone.
		await systemSettingsGet.handler(socket, {}, emitToUser)
		return res
	}
}

/**
 * Register one connection as the instance's default for ONE capability.
 *
 * Renamed from `connections:setUserActive`, which had not been about a user
 * since the per-user active connection was retired, and which wrote two places:
 * `system_settings.default_connection_id` AND the capability-keyed table. Both,
 * "in step" — except reads checked the table first and the column only when the
 * row was ABSENT, never when it was merely STALE, so on an upgraded install
 * every star press after the first landed in the column, lost to the seeded row,
 * and left pipeline runs on the old connection while every legacy screen
 * honoured the new one. A fresh install has no seeded row, so the fallback
 * worked and local testing never saw it. The column is gone (0181) and
 * `connection_defaults` is the only store.
 *
 * ⚠ `capability` is required and is NOT derived from the connection. One
 * KoboldCPP row can serve five capabilities, and the derivation most likely to
 * be written is "the first one it can do" — which is how an image-capable
 * connection becomes the chat default. The caller names what it means.
 *
 * A null id writes null rather than skipping, so unstarring CLEARS the
 * registration instead of stranding the last value — and lands the row in the
 * same state the delete cascade produces, which is what the "cleared" refusal
 * reads.
 */
export const connectionsSetDefault: Handler<
	Sockets.Connections.SetDefault.Params,
	Sockets.Connections.SetDefault.Response
> = {
	event: "connections:setDefault",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) {
			const res = {
				error: "Access denied. Only admin users can set the default connection."
			}
			emitToUser("error", res)
			throw new Error("Access denied.")
		}

		// The star is refused where the connection cannot do the thing, rather
		// than accepted and failed later at dispatch. Registering an image-only
		// endpoint as the chat default is a write that succeeds, shows a star on
		// screen, and then fails every Send with a sentence about adapters — and
		// it is exactly what the deleted auto-star did on its own. Judged with
		// `capabilityRefusal`, the same reader the picker and the bind guard use,
		// so all three agree about what a connection can do.
		//
		// Clearing (`id: null`) is never refused: it names no connection to
		// judge, and refusing to un-star would be a trap.
		if (params.id != null) {
			const row = await db.query.connections.findFirst({
				where: (c, { eq }) => eq(c.id, params.id!),
				columns: {
					id: true,
					name: true,
					type: true,
					capabilities: true
				}
			})
			if (!row) {
				const res = { error: "Connection not found." }
				emitToUser("error", res)
				throw new Error("Connection not found.")
			}
			const refusal = capabilityRefusal(
				row,
				params.capability as CapabilityId
			)
			if (refusal) {
				const res = { error: refusal }
				emitToUser("error", res)
				throw new Error(refusal)
			}
		}

		await setCapabilityDefault(db, params.capability, {
			connectionId: params.id ?? null
		})

		if (params.id)
			await connectionsGet.handler(socket, { id: params.id }, emitToUser)

		const res: Sockets.Connections.SetDefault.Response = {
			ok: true,
			capability: params.capability,
			id: params.id
		}
		emitToUser("connections:setDefault", res)

		// The defaults ride on `systemSettings:get`, so this is how every client
		// learns the star moved.
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
			let capabilities: CapabilitySet | undefined
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
				// A reachable backend is the only thing that can answer the
				// probe layer, so a passing test is where it comes from — keyed
				// off `ok` alone, since LM Studio legitimately passes while
				// still reporting an error string.
				const probe = probedCapabilities((result as any).extra)
				// Resolved against the STORED row for a saved connection, and
				// only against the form payload for one that has never been
				// saved. `params.connection` is whatever the client is holding,
				// and its `capabilities` half is the durable record of what a
				// person toggled — resolving from the client's copy would let a
				// stale editor overwrite the overrides with what it happened to
				// load, which is the same clobber `connections:update` had.
				const stored = params.connection?.id
					? await db.query.connections.findFirst({
							where: (c, { eq }) =>
								eq(c.id, params.connection.id!)
						})
					: undefined
				capabilities = resolveConnectionCapabilities(
					// The form's type/preset, since testing an unsaved EDIT of
					// either has to resolve against what is on screen; the
					// stored capabilities, since those are not the form's to own.
					{
						type: params.connection.type,
						preset: (params.connection as any).preset,
						capabilities: (stored as any)?.capabilities
					},
					probe
				)
				// params.connection is form state: a connection being tested
				// before its first save has nowhere to keep any of this yet.
				if (params.connection?.id)
					await persistCapabilities(db, params.connection.id, {
						resolved: capabilities,
						probe
					})
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
					: {}),
				...(capabilities ? { capabilities } : {})
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
	register(socket, connectionsSetDefault, emitToUser)
	register(socket, connectionsTest, emitToUser)
	register(socket, connectionsRefreshModels, emitToUser)
	register(socket, connectionsCapabilities, emitToUser)
	register(socket, connectionsSetCapability, emitToUser)
	register(socket, connectionsScripts, emitToUser)
	register(socket, connectionsAttachScript, emitToUser)
	register(socket, connectionsDetachScript, emitToUser)
}
