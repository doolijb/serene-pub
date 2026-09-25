import { db } from "$lib/server/db"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { buildUsersCurrent, user } from "./users"
import { userSettingsGet } from "./userSettings"
import { buildSystemSettingsGet } from "./systemSettings"
import { buildConnectionDefaultsList } from "./connectionDefaults"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	withConnectionDefaults,
	stableStringify
} from "$lib/shared/utils/connectionDefaults"
// `adapterIO` (the per-modality test/list loader) lives with the sync now:
// the sync is the one caller that needs it outside a socket, and a second
// copy here is how the two would pick different adapter families for a type.
import {
	adapterIO,
	syncConnectionModels,
	syncConnectionModelsById,
	syncManyConnectionModels
} from "$lib/server/connections/modelSync"
import type { Handler } from "$lib/shared/events"
import { capabilityLabel, gradeOf, TRANSFORMS } from "@serene-pub/sdk"
import type {
	CapabilityId,
	CapabilityOverrides,
	CapabilitySet
} from "@serene-pub/sdk"
import { adapterCapabilities } from "$lib/shared/connectionAdapters/manifest"
import { normalizeConnectionPreset } from "$lib/shared/connectionAdapters/presetSlug"
import { capabilityRefusal } from "$lib/server/pipelines/runtime/capabilityGuard"
import {
	capabilityColumn,
	persistCapabilities,
	probedCapabilities,
	resolveConnectionCapabilities
} from "$lib/server/connections/resolve"
import { setCapabilityDefault } from "$lib/server/connections/capabilityDefaults"
import { EMBEDDING_CAPABILITY } from "$lib/server/embedding/target"
import {
	applyEmbeddingStarChange,
	currentEmbeddingModelId
} from "$lib/server/embedding/reindex"
import { NER_CAPABILITY } from "$lib/shared/constants/ner"
import { applyNerStarChange, currentNerModelId } from "$lib/server/ner/reindex"
import { localModelStates } from "$lib/server/localModels/onnxCache"
import {
	allConnectionModels as listAllConnectionModels,
	connectionModelById,
	connectionModels as listConnectionModels,
	ensureConnectionModel,
	importProbedModels,
	mergeEndpointModel
} from "$lib/server/connections/models"
import { loginRateLimit } from "$lib/server/services/loginRateLimit"
import type { ModelFacts } from "$lib/shared/connections/modelFacts"
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

/**
 * Whether another connection already holds this name.
 *
 * Names are unique instance-wide, compared case-insensitively after trimming:
 * every picker shows a connection by name alone, so two rows reading the same
 * are unorderable by the person choosing. Checked in JS over the whole table
 * rather than in SQL so the comparison is one spelling everywhere — the table
 * is small and admin-only, and a second spelling in a query is how "same"
 * stops meaning the same.
 */
async function connectionNameTaken(
	name: string,
	exceptId?: number
): Promise<boolean> {
	const want = name.trim().toLowerCase()
	if (!want) return false
	const rows = await db
		.select({ id: schema.connections.id, name: schema.connections.name })
		.from(schema.connections)
	return rows.some(
		(r) => r.id !== exceptId && (r.name ?? "").trim().toLowerCase() === want
	)
}

/**
 * The `connections:list` payload — every endpoint with its models.
 *
 * One pure builder, shared by the own handler (which emits eagerly through
 * it) and by every cascade in this file, `koboldcpp.ts` and `ollama.ts`
 * (`await emitToUser("connections:list", () => buildConnectionsList())`), so
 * the gate skips the two queries when no open view holds the key. Takes no
 * socket: the list is the same for every admin, and only admins are answered.
 */
/**
 * Whether this endpoint holds a credential at all — the one bit of the key the
 * client is allowed to know.
 *
 * Truthiness on the stored field, deliberately, and no decryption: an empty
 * string is what every preset seeds `apiKey` with, so "the field exists" is not
 * the question — "did somebody put something in it" is. Decrypting here would
 * cost a crypto call per endpoint per list build to learn a fact that
 * `Boolean(value)` already answers.
 */
function hasStoredCredential(endpoint: {
	extraJson?: Record<string, any> | null
}): boolean {
	const value = endpoint.extraJson?.apiKey
	if (typeof value === "string") return value.trim().length > 0
	// The encrypted envelope is an object; its presence is the answer.
	return value != null && typeof value === "object"
}

export async function buildConnectionsList(): Promise<Sockets.Connections.List.Response> {
	const endpoints = await db.query.connections.findMany({
		orderBy: (c, { asc }) => [asc(c.type), asc(c.name)]
	})
	// Every model on the instance in one query, grouped here: the index
	// renders every endpoint WITH its models, and one round trip per card
	// is a list that search cannot see until every card has loaded.
	const modelRows = await listAllConnectionModels(db)
	const modelsByConnection = new Map<number, SelectConnectionModel[]>()
	for (const m of modelRows) {
		const list = modelsByConnection.get(m.connectionId) ?? []
		list.push(m)
		modelsByConnection.set(m.connectionId, list)
	}
	// Projected by hand rather than spread: `extraJson` carries the
	// encrypted key envelope and has no business on a list, and
	// `capabilities` is the panel's own fetch. What is listed is what a
	// picker or the index needs — identity, filing, the note, and the
	// models judged as pairs.
	const connectionsList: Sockets.Connections.List.Row[] = await Promise.all(
		endpoints.map(async (c) => {
			const models = modelsByConnection.get(c.id) ?? []
			// ⚠ Only the two local ONNX types get anything back — see
			// `localModelStates`. Every other endpoint's models are a host's,
			// and have no disk state here to report.
			const local = await localModelStates(db, c, models)
			return {
				id: c.id,
				name: c.name,
				type: c.type,
				baseUrl: c.baseUrl,
				// So a picker can filter by what the endpoint is for (20 §14):
				// a text-gen slot must not offer the embeddings connection.
				modality: c.modality,
				preset: c.preset ?? null,
				// The user's own note, for the picker to show BESIDE the row —
				// the moment of choosing is the only moment it is worth
				// anything. Nothing on this server reads it; it is carried, not
				// consulted (see the column comment in schema.ts).
				notes: c.notes,
				// ⚠ A BOOLEAN, never the key. The index needs to tell "you have
				// not typed a key yet" (unfinished, gold) from "the key was
				// rejected" (broken, red), and it cannot without knowing one is
				// there. The envelope itself stays in `extra_json`, walked only
				// by `tokenCrypto`, and is what this projection exists to keep
				// off the wire.
				hasCredential: hasStoredCredential(c),
				models: models.map((m) => modelRowView(c, m, local.get(m.id))),
				modelsSync: modelsSyncView(c)
			}
		})
	)
	return { connectionsList }
}

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
		const res = await buildConnectionsList()
		emitToUser("connections:list", res)
		return res
	}
}

/**
 * The `connections:get` payload — one endpoint, backfilled and decrypted.
 *
 * One pure builder, shared by the own handler (eager: its caller in
 * `connectionsUpdate` reads the return value) and by the one cascade that only
 * pushes — `connections:setDefault` re-sending the endpoint it just starred. A
 * null `connection` is "the id names nothing": the handler is what turns that
 * into a refusal, so the cascade can decline to push rather than emit a null at
 * a form.
 *
 * ⚠ This builder WRITES. The backfill below persists, and behind the gate it is
 * therefore paid only for a client that is about to render the row — which is
 * the only client it is owed to. What it repairs is a false "unsaved changes"
 * state in the edit form, and a row nobody has open cannot be showing one; the
 * next open backfills it.
 */
export async function buildConnectionsGet(
	id: number
): Promise<Sockets.Connections.Get.Response> {
	const raw = await db.query.connections.findFirst({
		where: (c, { eq }) => eq(c.id, id)
	})
	if (!raw) return { connection: null }

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
				promptFormat: merged.promptFormat,
				tokenCounter: merged.tokenCounter,
				extraJson: merged.extraJson
			})
			.where(eq(schema.connections.id, id))
			.returning()
		connection = updated
		// The backfill above can INTRODUCE a model where none was named —
		// `CONNECTION_DEFAULTS` names one for KoboldCPP and for Anthropic —
		// so a row follows it. Without this, opening such a connection for
		// the first time would show an endpoint with no model row at all.
		// It ensures a ROW, never a default: connections have none.
		await ensureConnectionModel(db, id, (merged as any).model)
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
				apiKey: decryptApiKeyField(connection.extraJson.apiKey) ?? ""
			}
		}
	}

	return { connection }
}

/**
 * The same endpoint, pushed rather than answered.
 *
 * The ONE spelling of this cascade, so a push never disagrees with the reply
 * about what `connections:get` carries. A row that vanished between a write's
 * own validation and this push has nothing worth sending: throwing leaves
 * `evaluate` in `sockets/index.ts` to log it and emit nothing, where a null
 * connection would reach an open edit form as a row that had been emptied.
 */
function resendConnection(
	id: number,
	emitToUser: (event: string, data: any) => void
) {
	return emitToUser("connections:get", async () => {
		const res = await buildConnectionsGet(id)
		if (!res.connection) throw new Error("Connection not found.")
		return res
	})
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

		const res = await buildConnectionsGet(params.id)
		if (!res.connection) {
			emitToUser("error", { error: "Connection not found." })
			throw new Error("Connection not found.")
		}

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
		// The name is prefilled from the preset on the client, but a preset
		// is not a name: two connections from one preset would otherwise read
		// the same in every picker. Refused here rather than only in the
		// sidebar, because the wizard and the document-view page create too.
		const desiredName = String((data as any).name ?? "").trim()
		if (!desiredName) {
			const error = "Connection name is required."
			emitToUser("connections:create:error", { error })
			throw new Error(error)
		}
		if (await connectionNameTaken(desiredName)) {
			const error = `A connection named "${desiredName}" already exists.`
			emitToUser("connections:create:error", { error })
			throw new Error(error)
		}
		;(data as any).name = desiredName
		if ("id" in data) delete data.id
		// Always remove id before insert to let DB auto-increment
		if ("id" in data) delete data.id
		// The picker sends the preset this was created from, and the column
		// holds the SLUG — a numeric preset `value` landing here would key
		// nothing in PRESET_CAPABILITIES while reading like a real slug forever
		// after. NULL is the honest answer for a custom endpoint.
		//
		// The rule itself now lives in `normalizeConnectionPreset`, shared with
		// `connectionsUpdate`, which had no sanitation at all and so persisted
		// values this line had always rejected. `?? null` because create's
		// answer to "nothing said" is the column default rather than "leave it
		// alone" — there is nothing to leave.
		//
		// The normalizer's `notice` is dropped here on purpose: `Create.Response`
		// has no channel for one, no client can currently produce a claim that
		// earns one (the picker sends a slug off the very list this validates
		// against, or nothing), and adding one is the create-surface work that is
		// a separate task.
		data.preset =
			normalizeConnectionPreset(data.preset, data.type).preset ?? null
		// Resolved at write time and cached on the row: the picker reads every
		// connection against every slot, and resolving there would mean loading
		// an adapter module per row (see connections/resolve.ts).
		data.capabilities = {
			...(data.capabilities ?? {}),
			resolved: resolveConnectionCapabilities(data)
		}
		// The `model` field a form may still send names a MODEL, not a column:
		// the endpoint row carries no model (connections have none), so the
		// string becomes a row in `connection_models` and never touches the
		// insert. `ensureConnectionModel` ensures the ROW, never a default.
		const formModel = (data as any).model
		delete (data as any).model
		const [conn] = await db
			.insert(schema.connections)
			.values(data)
			.returning()
		await ensureConnectionModel(db, conn.id, formModel)
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
		await emitToUser("connections:list", () => buildConnectionsList())
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

		// Renames obey the same uniqueness as creates: pickers show names
		// alone, so a rename onto a taken name unorders them just the same.
		if (typeof editable.name === "string") {
			const desiredName = editable.name.trim()
			if (!desiredName) {
				const error = "Connection name is required."
				emitToUser("connections:update:error", { error })
				throw new Error(error)
			}
			if (await connectionNameTaken(desiredName, id)) {
				const error = `A connection named "${desiredName}" already exists.`
				emitToUser("connections:update:error", { error })
				throw new Error(error)
			}
			editable.name = desiredName
		}

		// `preset` is the other payload field that is not simply the client's to
		// state, and until this it was the one nobody checked: create has coerced
		// it since the column landed, update passed it straight to `.set()`, so an
		// update stored what a create would have thrown away. It does not merely
		// sit there either — the `resolveConnectionCapabilities` call below caches
		// a capability set computed FROM it, and that cache is what the config
		// picker and the bind guard read.
		//
		// Read the row first rather than judging `updated` afterwards: by then the
		// bad value is stored and the cache is already built on it. The stored row
		// is also the only thing that can answer a PARTIAL payload's two open
		// questions — which type the preset is about to sit on, and which preset a
		// bare type change is about to strand.
		const stored = await db.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, id),
			columns: { type: true, preset: true }
		})
		const nextType =
			typeof editable.type === "string" ? editable.type : stored?.type
		const preset = normalizeConnectionPreset(
			// The payload's claim where it made one, and the STORED slug where it
			// did not: changing only `type` strands the preset just as surely as
			// sending a stale pair does, and nothing else would notice.
			"preset" in editable ? editable.preset : stored?.preset,
			nextType
		)
		if (preset.preset !== undefined) editable.preset = preset.preset
		else delete editable.preset

		const updateData = withEncryptedApiKey(editable as any)
		// The endpoint row carries no model — strip a legacy `model` field off
		// the payload before the write, then promote it to a real model row.
		// A partial update that says nothing about the model touches nothing.
		const payloadModel =
			"model" in editable ? (editable.model as string | null) : undefined
		delete (updateData as any).model
		const [updated] = await db
			.update(schema.connections)
			.set(updateData)
			.where(eq(schema.connections.id, id))
			.returning()
		if (updated && payloadModel !== undefined) {
			await ensureConnectionModel(db, id, payloadModel)
		}
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
		//
		// The one `connections:get` cascade that is NOT lazy, because this ack
		// reads its value: there is no query for the gate to skip when the
		// answer is needed either way. The gate still applies to its EMIT —
		// `emitToUser` delivers plain data on a gated event per interested
		// socket — so what is unconditional is the read, not the push.
		const getResult = await connectionsGet.handler(
			socket,
			{ id },
			emitToUser
		)
		const res: Sockets.Connections.Update.Response = {
			connection: getResult.connection ?? updated,
			// Only when something was actually discarded. A save is still a
			// success — the row is written and the ack carries it — so this rides
			// alongside rather than replacing it, and the clients say it out loud
			// instead of letting a preset vanish quietly.
			...(preset.notice ? { notice: preset.notice } : {})
		}
		emitToUser("connections:update", res)
		await user(socket, {}, emitToUser)
		await emitToUser("connections:list", () => buildConnectionsList())
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
		await emitToUser("connections:list", () => buildConnectionsList())
		const res: Sockets.Connections.Delete.Response = { id: params.id }
		emitToUser("connections:delete", res)
		// The defaults ride on `systemSettings:get`, and the cascade above may
		// just have emptied one. Without this the star stays on screen against a
		// connection that is gone.
		await emitToUser("systemSettings:get", () => buildSystemSettingsGet())
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
					// The merge resolves capabilities through the preset too, so
					// the pair is judged in the same key space the picker greyed
					// the row in.
					preset: true,
					capabilities: true
				}
			})
			if (!row) {
				const res = { error: "Connection not found." }
				emitToUser("error", res)
				throw new Error("Connection not found.")
			}
			// The MODEL half, validated before anything is stored: a
			// registration whose two halves name different connections is a pair
			// no picker can display and no run can resolve. It is REQUIRED —
			// connections have no default model, so "the endpoint, whichever
			// model" is not a registration.
			if (params.modelId == null) {
				const res = {
					error: "Choose a model on this connection — connections have no default model."
				}
				emitToUser("error", res)
				throw new Error(res.error)
			}
			const model = await connectionModelById(db, params.modelId)
			{
				const bad = !model
					? "That model no longer exists."
					: model.connectionId !== params.id
						? "That model is not on the connection you chose."
						: !model.enabled
							? "That model is switched off. Switch it on, or choose another."
							: model.missingSince
								? "That model is no longer listed by its host. Refresh the connection's models, or choose another."
								: null
				if (bad) {
					emitToUser("error", { error: bad })
					throw new Error(bad)
				}
			}
			// Judged as the PAIR (0114): one host serves a vision checkpoint and
			// a text-only one at the same base URL, so judging the bare endpoint
			// would star the text-only one for vision and fail at the first
			// image.
			const refusal = capabilityRefusal(
				mergeEndpointModel(row as any, model) as any,
				params.capability as CapabilityId
			)
			if (refusal) {
				const res = { error: refusal }
				emitToUser("error", res)
				throw new Error(refusal)
			}
		}

		// What the embedding star resolved to BEFORE the write — the comparison
		// that decides whether the index has to be rebuilt. Read here rather
		// than inside the helper, because after `setCapabilityDefault` the old
		// answer is gone.
		const embeddingBefore =
			params.capability === EMBEDDING_CAPABILITY
				? await currentEmbeddingModelId(db)
				: null
		// The same read for the entity star, for the same reason: after
		// `setCapabilityDefault` the old answer is gone, and the comparison
		// against it is the whole of the decision to re-annotate.
		const nerBefore =
			params.capability === NER_CAPABILITY
				? await currentNerModelId(db)
				: null

		await setCapabilityDefault(db, params.capability, {
			connectionId: params.id ?? null,
			// Both halves, always: an endpoint-level registration (null model)
			// is refused above, so reaching here with one would be a writer
			// that skipped validation.
			connectionModelId:
				params.id == null ? null : (params.modelId ?? null)
		})

		/**
		 * The embedding star's consequence.
		 *
		 * ⚠ A modality-specific branch in a generic handler, and it belongs
		 * here rather than in the screens that press the button. Every stored
		 * vector came from the model this star named a moment ago, so "the
		 * embedding target changed" has to trigger the rebuild whatever moved
		 * it — the sidebar, Admin → Defaults, or a future one-click path. In a
		 * client it would be a rule three screens each have to remember; in
		 * `setCapabilityDefault` it would be a consequence inside the storage
		 * boundary, which that file's header rules out.
		 *
		 * Nothing happens unless the model IDENTITY moved, so pressing the star
		 * twice, or starring a second row naming the same endpoint and model,
		 * costs nothing.
		 */
		if (params.capability === EMBEDDING_CAPABILITY)
			await applyEmbeddingStarChange(db, embeddingBefore)

		/**
		 * The entity star's consequence, and it belongs here for the reason the
		 * embedding one above does: every stored annotation was written by
		 * whichever extractor was in force when the lane reached that row, so
		 * "the entity model changed" has to clear them whatever moved the star.
		 * Nothing happens unless the model IDENTITY moved.
		 */
		if (params.capability === NER_CAPABILITY)
			await applyNerStarChange(db, nerBefore)

		if (params.id) await resendConnection(params.id, emitToUser)

		const res: Sockets.Connections.SetDefault.Response = {
			ok: true,
			capability: params.capability,
			id: params.id,
			modelId: params.id == null ? null : (params.modelId ?? null)
		}
		emitToUser("connections:setDefault", res)

		// The defaults ride on `systemSettings:get`, so this is how every client
		// learns the star moved.
		await emitToUser("systemSettings:get", () => buildSystemSettingsGet())
		await emitToUser("users:current", () =>
			buildUsersCurrent(socket.user!.id)
		)
		// Admin → Defaults renders from its own list, and a star pressed here
		// (or by a manager's "Use for chat") is the same registration that page
		// makes — so it is told too, at the price of one query only while the
		// page is open.
		await emitToUser("connectionDefaults:list", () =>
			buildConnectionDefaultsList()
		)

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
				if (params.connection?.id) {
					await persistCapabilities(db, params.connection.id, {
						resolved: capabilities,
						probe
					})
					// A passing test just listed the host, so the listing is
					// persisted here rather than fetched a second time by a
					// sync: the rows follow the test, and the refresh budget
					// is untouched. Listed off the FORM's state — an unsaved
					// base URL is what a person is testing — so a test of an
					// edit that is then discarded has synced against that
					// edit; the next open re-lists the saved row.
					await syncConnectionModels(db, params.connection.id, {
						models,
						error: modelsRes.error ?? null
					})
					await emitToUser("connections:models", () =>
						connectionModelsView(params.connection.id!)
					)
					await emitToUser("connections:list", () =>
						buildConnectionsList()
					)
				}
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
			// A SAVED connection is refreshed through the sync, so the
			// listing lands as rows (and marks what vanished) rather than
			// being shown once and forgotten. The stored row is what gets
			// listed — an unsaved edit to the base URL is what Test is for.
			// The listing still rides back for the document-view forms, which
			// render it as a transient dropdown.
			const savedId = params.connection?.id as number | undefined
			if (savedId) {
				const synced = await syncConnectionModelsById(db, savedId, {
					force: true
				})
				if (!synced) {
					const res: Sockets.Connections.RefreshModels.Response = {
						error: "Connection not found.",
						models: [],
						connectionId: savedId
					}
					emitToUser("connections:refreshModels", res)
					return res
				}
				await emitToUser("connections:models", () =>
					connectionModelsView(savedId)
				)
				await emitToUser("connections:list", () =>
					buildConnectionsList()
				)
				const res: Sockets.Connections.RefreshModels.Response = {
					models: synced.listing.error ? [] : synced.listing.models,
					error: synced.listing.error ?? null,
					connectionId: savedId
				}
				emitToUser("connections:refreshModels", res)
				return res
			}
			// Unsaved: a transient listing of whatever the form holds.
			// getConnectionAdapter can throw for an unsupported type — inside
			// this try so that surfaces as this handler's own clean error
			// response instead of an uncaught error.
			const { listModels } = await adapterIO(params.connection.type)
			const result = await listModels(params.connection)
			const res: Sockets.Connections.RefreshModels.Response = {
				models: result.error ? [] : (result.models ?? []),
				error: result.error ?? null,
				connectionId: undefined
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
	const attached = await listConnectionScripts(db, connectionId)
	const all = await scriptsView(db)
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
			await attachConnectionScript(db, params.id, params.scriptId)
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
		await detachConnectionScript(db, params.id, params.scriptId)
		const res = await connectionScriptsView(params.id)
		emitToUser("connections:detachScript", res)
		return res
	}
}

/* --- the models on an endpoint (0114) -------------------------------- */

/**
 * All four model handlers answer with the same refreshed view.
 *
 * The `connectionScriptsView` pattern, for a sharper version of its reason: a
 * write here changes more than the row it names. Creating, renaming or
 * deleting a model moves capability-default registrations (ON DELETE SET NULL
 * releases them) and the satisfiable set the dropdown offers — so a response
 * carrying only the row that was touched would leave the client's picture one
 * write behind.
 *
 * `type` and `preset` ride along for the same reason `capabilitiesView` carries
 * them: a per-model capability panel needs the KEY SPACE, and that belongs to the
 * saved endpoint.
 */
export async function connectionModelsView(
	connectionId: number
): Promise<Sockets.Connections.Models.Response> {
	const endpoint = await db.query.connections.findFirst({
		where: (c, { eq }) => eq(c.id, connectionId)
	})
	if (!endpoint) return { connectionId, error: "Connection not found." }
	const rows = await listConnectionModels(db, connectionId)
	const local = await localModelStates(db, endpoint, rows)
	return {
		connectionId,
		type: endpoint.type,
		preset: endpoint.preset ?? null,
		modelsSync: modelsSyncView(endpoint),
		models: rows.map((m) => modelRowView(endpoint, m, local.get(m.id)))
	}
}

/**
 * One model row as the wire shows it — shared by the list and the view.
 *
 * ⚠ `local` is passed IN rather than derived here. It costs a directory stat
 * and a registry read, both of which the two callers batch per endpoint, and a
 * synchronous projection is what lets every other caller keep mapping rows
 * without awaiting anything. An absent argument means "this endpoint has no
 * disk state", which is every type but the two local ONNX ones.
 */
function modelRowView(
	endpoint: SelectConnection,
	m: SelectConnectionModel,
	local?: Sockets.Connections.LocalModelState
): Sockets.Connections.Models.ModelRow {
	return {
		id: m.id,
		connectionId: m.connectionId,
		model: m.model,
		name: m.name,
		enabled: m.enabled,
		missingSince: m.missingSince?.toISOString() ?? null,
		contextWindow: m.contextWindow ?? null,
		promptFormat: m.promptFormat ?? null,
		tokenCounter: m.tokenCounter ?? null,
		sortOrder: m.sortOrder,
		capabilities: capabilityColumn(m),
		satisfiableCapabilities: satisfiableTransforms(endpoint, m),
		// Omitted entirely when the host said nothing, so a consumer branches on
		// presence rather than on an empty object that reads like an answer.
		...(m.facts && Object.keys(m.facts).length
			? { facts: m.facts as ModelFacts }
			: {}),
		...(local ? { local } : {})
	}
}

function modelsSyncView(endpoint: {
	modelsSyncedAt: Date | null
	modelsSyncError: string | null
}): Sockets.Connections.ModelsSync {
	return {
		at: endpoint.modelsSyncedAt?.toISOString() ?? null,
		error: endpoint.modelsSyncError ?? null
	}
}

/**
 * The transforms this (endpoint, model) pair may be registered as the
 * default for — judged as the PAIR, with the same reader the star, the
 * picker and the bind guard use.
 *
 * Computed here rather than in the browser because the layers live here:
 * a second client-side implementation of the four-layer resolution is the
 * exact divergence `ConnectionCapabilities` exists to prevent. A switched-off
 * model satisfies nothing — the star refuses it, so the dropdown must not
 * offer it.
 */
function satisfiableTransforms(
	endpoint: SelectConnection,
	model: SelectConnectionModel
): string[] {
	// A switched-off model satisfies nothing, and so does one the host has
	// stopped listing: the star refuses both, so the dropdown offers neither.
	if (!model.enabled || model.missingSince) return []
	const merged = mergeEndpointModel(endpoint, model)
	return (Object.keys(TRANSFORMS) as CapabilityId[]).filter(
		(id) => !capabilityRefusal(merged as any, id)
	)
}

const MODEL_DENIED =
	"Access denied. Only admin users can manage connection models."

/**
 * What a client may state about a model, and what it may not.
 *
 * ⚠ `extraJson` is REFUSED rather than ignored. The column is real and is merged
 * onto the pair for an adapter to read, but nothing renders it yet — so the only
 * way to set it today would be a hand-crafted socket call, and the field it would
 * most obviously be used for is an api key. The crypto path
 * (`utils/tokenCrypto.ts`) walks `connections.extra_json` and only that one, so a
 * key written onto a model row would sit in plaintext for as long as the row
 * lives. Refusing at the door beats trusting the convention.
 *
 * ⚠ `isDefault` is REFUSED outright: connections have no default model,
 * so there is no star to move and no second way to attempt it.
 */
function modelPayload(input: unknown): {
	values?: Record<string, unknown>
	error?: string
} {
	const raw = (input ?? {}) as Record<string, unknown>
	if ("extraJson" in raw)
		return {
			error:
				"Per-model adapter options cannot be set from here yet. The API key " +
				"belongs to the connection, where it is encrypted at rest."
		}
	if ("isDefault" in raw)
		return {
			error: "Connections have no default model — every default names an explicit model."
		}
	const values: Record<string, unknown> = {}
	if (typeof raw.model === "string") values.model = raw.model.trim()
	if (typeof raw.name === "string") values.name = raw.name.trim()
	if (typeof raw.enabled === "boolean") values.enabled = raw.enabled
	if ("contextWindow" in raw) {
		const n = Number(raw.contextWindow)
		// Blank clears the override, which is a different state from zero: NULL
		// means "the sampling config decides" and is the value every row the
		// backfill created holds.
		values.contextWindow =
			raw.contextWindow == null || raw.contextWindow === ""
				? null
				: Number.isFinite(n) && n > 0
					? Math.floor(n)
					: null
	}
	if ("promptFormat" in raw)
		values.promptFormat =
			typeof raw.promptFormat === "string" && raw.promptFormat
				? raw.promptFormat
				: null
	if ("tokenCounter" in raw)
		values.tokenCounter =
			typeof raw.tokenCounter === "string" && raw.tokenCounter
				? raw.tokenCounter
				: null
	if (typeof raw.sortOrder === "number" && Number.isFinite(raw.sortOrder))
		values.sortOrder = Math.floor(raw.sortOrder)
	return { values }
}

/** The admin gate and the endpoint lookup, spelled once for all five. */
async function modelGate(
	socket: any,
	event: string,
	connectionId: number,
	emitToUser: (event: string, data: any) => void
): Promise<Sockets.Connections.Models.Response | null> {
	if (!socket.user!.isAdmin) {
		emitToUser(`${event}:error`, { error: MODEL_DENIED })
		return { connectionId, error: MODEL_DENIED }
	}
	const exists = await db.query.connections.findFirst({
		where: (c, { eq }) => eq(c.id, connectionId),
		columns: { id: true }
	})
	if (!exists) {
		const error = "Connection not found."
		emitToUser(`${event}:error`, { error })
		return { connectionId, error }
	}
	return null
}

export const connectionsModels: Handler<
	Sockets.Connections.Models.Params,
	Sockets.Connections.Models.Response
> = {
	event: "connections:models",
	handler: async (socket, params, emitToUser) => {
		const denied = await modelGate(
			socket,
			"connections:models",
			params.id,
			emitToUser
		)
		if (denied) return denied
		const res = await connectionModelsView(params.id)
		emitToUser("connections:models", res)
		return res
	}
}

export const connectionsCreateModel: Handler<
	Sockets.Connections.CreateModel.Params,
	Sockets.Connections.CreateModel.Response
> = {
	event: "connections:createModel",
	handler: async (socket, params, emitToUser) => {
		const fail = (error: string) => {
			emitToUser("connections:createModel:error", { error })
			return { connectionId: params.id, error }
		}
		const denied = await modelGate(
			socket,
			"connections:createModel",
			params.id,
			emitToUser
		)
		if (denied) return denied

		const { values, error } = modelPayload(params.model)
		if (error) return fail(error)
		const identifier = String(values!.model ?? "")
		if (!identifier)
			return fail(
				"A model needs the identifier the service knows it by — the text this connection will send."
			)

		// Refused rather than silently promoted. `ensureConnectionModel` treats a
		// repeat as "the row that is there", which is right for the managed
		// flows whose whole pattern is find-or-create; a person pressing Add is
		// making a different claim, and answering it with anything but the new
		// row is worse than saying no.
		const clash = (await listConnectionModels(db, params.id)).find(
			(m) => m.model === identifier
		)
		if (clash)
			return fail(
				`This connection already has a model called “${clash.name}” sending “${identifier}”.`
			)

		await db.insert(schema.connectionModels).values({
			connectionId: params.id,
			model: identifier,
			name: (values!.name as string) || identifier,
			...(values!.enabled !== undefined
				? { enabled: values!.enabled as boolean }
				: {}),
			...(values!.contextWindow !== undefined
				? { contextWindow: values!.contextWindow as number | null }
				: {}),
			...(values!.promptFormat !== undefined
				? { promptFormat: values!.promptFormat as string | null }
				: {}),
			...(values!.tokenCounter !== undefined
				? { tokenCounter: values!.tokenCounter as string | null }
				: {}),
			...(values!.sortOrder !== undefined
				? { sortOrder: values!.sortOrder as number }
				: {})
		})

		const res = await connectionModelsView(params.id)
		emitToUser("connections:createModel", res)
		// The index renders models off the list, so the list moves with them.
		await emitToUser("connections:list", () => buildConnectionsList())
		return res
	}
}

export const connectionsUpdateModel: Handler<
	Sockets.Connections.UpdateModel.Params,
	Sockets.Connections.UpdateModel.Response
> = {
	event: "connections:updateModel",
	handler: async (socket, params, emitToUser) => {
		const fail = (error: string) => {
			emitToUser("connections:updateModel:error", { error })
			return { connectionId: params.id, error }
		}
		const denied = await modelGate(
			socket,
			"connections:updateModel",
			params.id,
			emitToUser
		)
		if (denied) return denied

		const row = await connectionModelById(db, params.modelId)
		// The pair has to be coherent even to be EDITED: a model id that belongs
		// to another endpoint is not a permission problem, it is a request about
		// a row this screen is not showing.
		if (!row || row.connectionId !== params.id)
			return fail("That model is not on this connection.")

		const { values, error } = modelPayload(params.model)
		if (error) return fail(error)
		if (values!.model !== undefined && !values!.model)
			return fail(
				"A model needs the identifier the service knows it by — the text this connection will send."
			)
		if (values!.name !== undefined && !values!.name)
			// The column's own check constraint refuses an empty name, and a
			// person who cleared the box meant "call it what it sends".
			values!.name = (values!.model as string) ?? row.model
		if (!Object.keys(values!).length)
			return await connectionModelsView(params.id)

		if (values!.model && values!.model !== row.model) {
			const clash = (await listConnectionModels(db, params.id)).find(
				(m) => m.model === values!.model && m.id !== row.id
			)
			if (clash)
				return fail(
					`This connection already has a model sending “${values!.model}”.`
				)
		}

		await db
			.update(schema.connectionModels)
			.set(values as any)
			.where(eq(schema.connectionModels.id, params.modelId))

		const res = await connectionModelsView(params.id)
		emitToUser("connections:updateModel", res)
		// The index renders models off the list, so the list moves with them.
		await emitToUser("connections:list", () => buildConnectionsList())
		return res
	}
}

export const connectionsDeleteModel: Handler<
	Sockets.Connections.DeleteModel.Params,
	Sockets.Connections.DeleteModel.Response
> = {
	event: "connections:deleteModel",
	handler: async (socket, params, emitToUser) => {
		const fail = (error: string) => {
			emitToUser("connections:deleteModel:error", { error })
			return { connectionId: params.id, error }
		}
		const denied = await modelGate(
			socket,
			"connections:deleteModel",
			params.id,
			emitToUser
		)
		if (denied) return denied

		const row = await connectionModelById(db, params.modelId)
		if (!row || row.connectionId !== params.id)
			return fail("That model is not on this connection.")

		await db
			.delete(schema.connectionModels)
			.where(eq(schema.connectionModels.id, params.modelId))

		// ⚠ The ENDPOINT survives with no models, deliberately. Removing the last
		// model is clearing a field, not throwing away a base URL and a key. Only
		// the managed flows tie the two together, and they say so themselves
		// (`forgetModelEverywhere`).

		// `connection_defaults.connection_model_id` is ON DELETE SET NULL, so a
		// registration that named this model is released to endpoint-only —
		// which now resolves as incomplete rather than stranded — and the
		// defaults ride on `systemSettings:get`, which is how every client
		// learns.
		await emitToUser("systemSettings:get", () => buildSystemSettingsGet())

		const res = await connectionModelsView(params.id)
		emitToUser("connections:deleteModel", res)
		// The index renders models off the list, so the list moves with them.
		await emitToUser("connections:list", () => buildConnectionsList())
		return res
	}
}

export const connectionsImportModels: Handler<
	Sockets.Connections.ImportModels.Params,
	Sockets.Connections.ImportModels.Response
> = {
	event: "connections:importModels",
	handler: async (socket, params, emitToUser) => {
		const denied = await modelGate(
			socket,
			"connections:importModels",
			params.id,
			emitToUser
		)
		if (denied) return denied

		const { added, skipped } = await importProbedModels(
			db,
			params.id,
			(params.models ?? []).map((m) => ({
				model: String(m.model ?? ""),
				name: m.name ?? null
			}))
		)

		const view = await connectionModelsView(params.id)
		const res: Sockets.Connections.ImportModels.Response = {
			...view,
			added,
			skipped
		}
		emitToUser("connections:importModels", res)
		// The index renders models off the list, so the list moves with them.
		await emitToUser("connections:list", () => buildConnectionsList())
		return res
	}
}

/**
 * Reconcile one endpoint's models — or every endpoint's — against what the
 * service lists. See `modelSync.ts` for the rule.
 *
 * An automatic sync (no `force`) is what the sidebar fires on open and on
 * navigation; it skips fresh listings, so browsing costs no network. A forced
 * sync is the Refresh button, and shares the refresh budget so a held key
 * cannot hammer a cloud API.
 */
export const connectionsSyncModels: Handler<
	Sockets.Connections.SyncModels.Params,
	Sockets.Connections.SyncModels.Response
> = {
	event: "connections:syncModels",
	handler: async (socket, params, emitToUser) => {
		const fail = (error: string) => {
			emitToUser("connections:syncModels:error", { error })
			return { results: [], error }
		}
		if (!socket.user!.isAdmin) return fail(MODEL_DENIED)
		const force = !!params?.force
		if (force) {
			const rateLimitKey = "connections:refreshModels"
			if (loginRateLimit.isRateLimited(rateLimitKey))
				return fail("Rate limited. Please wait a moment and try again.")
			loginRateLimit.recordFailedAttempt(rateLimitKey)
		}
		let results: Sockets.Connections.SyncModels.Result[]
		if (params?.id != null) {
			const one = await syncConnectionModelsById(db, params.id, { force })
			results = one ? [one.result] : []
		} else {
			results = await syncManyConnectionModels(db, { force })
		}
		// Every open model view re-reads from this; the index re-reads from
		// the list. Both broadcast rather than answered, because the tab that
		// asked is not the only one showing them.
		for (const r of results)
			await emitToUser("connections:models", () =>
				connectionModelsView(r.connectionId)
			)
		if (results.length)
			await emitToUser("connections:list", () => buildConnectionsList())
		const res: Sockets.Connections.SyncModels.Response = { results }
		emitToUser("connections:syncModels", res)
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
	register(socket, connectionsModels, emitToUser)
	register(socket, connectionsCreateModel, emitToUser)
	register(socket, connectionsUpdateModel, emitToUser)
	register(socket, connectionsDeleteModel, emitToUser)
	register(socket, connectionsImportModels, emitToUser)
	register(socket, connectionsSyncModels, emitToUser)
}
