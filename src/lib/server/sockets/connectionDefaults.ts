/**
 * Admin → Defaults: which connection and sampling config this instance uses for
 * each capability.
 *
 * This screen is now the DEFINITION of "does this instance have this capability
 * at all". Nothing picks a connection because it exists, because it is the only
 * one, or because it happens to be capable — the resolution chain is
 * `capability default → pipeline config → session override`, and a run whose
 * capability has no default fails with a sentence pointing here. So the list
 * this serves has to be the honest union of what could ever be asked for, not
 * whatever somebody remembered to type into an array.
 *
 * ## What is served, and why both halves
 *
 * `combos` is `aggregateCombos` over `pipeline_type_registry` — the union of
 * what the adapter manifest can express and what core's node types demand.
 * Neither source alone is right, and today's data proves both directions
 * (see `combos.ts`).
 *
 * `connectionOptions` is every connection, JUDGED and not filtered, per
 * capability. The judgement is `judgeAgainst` — the same function the pipeline
 * panel's connection picker uses, imported rather than re-derived, because a
 * second copy is how "not tested yet" quietly becomes "not eligible" and the
 * picker empties on every install that upgraded into the capability model.
 *
 * ## Why the whole matrix in one response
 *
 * Nine capabilities × a handful of connections is a few hundred bytes, and the
 * alternative — a fetch per capability as the admin opens each card — means the
 * page cannot say "three of nine registered" until it has asked nine times.
 * The summary strip is the point of the screen; it has to be true on first
 * paint.
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { asc } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { systemSettingsGet } from "./systemSettings"
import { S, type CapabilityId } from "@serene-pub/sdk"
import {
	aggregateCombos,
	type RegistryTypeRow
} from "$lib/shared/capabilities/combos"
import { samplingShapeForCapability } from "$lib/shared/capabilities/samplingShape"
import {
	judgeAgainst,
	type ChoiceList
} from "$lib/server/pipelines/config/panel/choices"
import {
	capabilityRefusal,
	storedCapabilities
} from "$lib/server/pipelines/runtime/capabilityGuard"
import {
	capabilityDefaults,
	setCapabilityDefault
} from "$lib/server/connections/capabilityDefaults"

const DENIED = "Access denied. Only admin users can manage capability defaults."

function requireAdmin(
	socket: any,
	emitToUser: (event: string, data: any) => void
) {
	if (!socket.user!.isAdmin) {
		emitToUser("error", { error: DENIED })
		throw new Error(DENIED)
	}
}

/**
 * The combo list, from rows.
 *
 * Every registry row is read, not just `kind: 'node'`: a script or an input
 * type declaring a connection slot demands that capability every bit as much,
 * and filtering by kind here would be a rule this file invents and nothing
 * else enforces. `status` is likewise not filtered — a deprecated type still
 * has live configs pointed at it, and a capability disappearing from this
 * screen while a pipeline still requires it is exactly the silent gap the
 * aggregation exists to close.
 */
async function combosFor(database: typeof db) {
	const rows = (await database
		.select({
			typeId: schema.pipelineTypeRegistry.typeId,
			version: schema.pipelineTypeRegistry.version,
			slots: schema.pipelineTypeRegistry.slots
		})
		.from(schema.pipelineTypeRegistry)) as RegistryTypeRow[]
	return aggregateCombos(rows)
}

export const connectionDefaultsList: Handler<
	Sockets.ConnectionDefaults.List.Params,
	Sockets.ConnectionDefaults.List.Response
> = {
	event: "connectionDefaults:list",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		const combos = await combosFor(db)
		const defaults = await capabilityDefaults(db)

		const connectionRows = await db
			.select()
			.from(schema.connections)
			.orderBy(asc(schema.connections.name))
		// Read through `storedCapabilities`, never raw `capabilities.resolved`:
		// it intersects the cached set with what the manifest still declares, so
		// a connection whose adapter has since stopped declaring a transform is
		// offered DISABLED rather than offered and then refused at bind. Built
		// once here rather than per capability — nine capabilities would
		// otherwise re-derive the same set nine times per row.
		const judged: ChoiceList = (connectionRows as any[]).map((c) => ({
			id: c.id,
			label: c.name,
			capabilities: storedCapabilities(c)
		})) as ChoiceList

		const samplingRows = await db
			.select()
			.from(schema.samplingConfigs)
			.orderBy(asc(schema.samplingConfigs.name))

		const connectionOptions: Record<
			string,
			Sockets.ConnectionDefaults.List.ConnectionOption[]
		> = {}
		const samplingOptions: Record<
			string,
			Sockets.ConnectionDefaults.List.SamplingOption[]
		> = {}

		for (const combo of combos) {
			// `eligible` is the inverse of `disabled`, not of "has a reason": an
			// untested connection carries a reason AND stays selectable, which
			// is the one case a boolean built from `reason` would get wrong.
			connectionOptions[combo.id] = judgeAgainst(judged, [combo.id]).map(
				(entry) => ({
					id: entry.id,
					name: entry.label,
					eligible: !entry.disabled,
					...(entry.reason ? { reason: entry.reason } : {})
				})
			)

			// A capability with no sampling vocabulary — `text->embedding` —
			// gets an EMPTY list, and the page renders no picker for it rather
			// than an empty one. See `samplingShapeForCapability`.
			const shape = samplingShapeForCapability(combo.id)
			samplingOptions[combo.id] = shape
				? (samplingRows as any[])
						// A row written before the column existed reads as
						// untyped and is kept, the same rule `ofShape` follows:
						// vanishing from every picker is a worse failure than
						// appearing in one where it does not belong.
						.filter((s) => (s.shape ?? S.textGen) === shape)
						.map((s) => ({ id: s.id, name: s.name }))
				: []
		}

		const res: Sockets.ConnectionDefaults.List.Response = {
			combos,
			defaults,
			connectionOptions,
			samplingOptions
		}
		emitToUser("connectionDefaults:list", res)
		return res
	}
}

export const connectionDefaultsSet: Handler<
	Sockets.ConnectionDefaults.Set.Params,
	Sockets.ConnectionDefaults.Set.Response
> = {
	event: "connectionDefaults:set",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)

		// The capability must be one the aggregation actually names. Not
		// paranoia about a hostile client: the capability IS the primary key of
		// `connection_defaults` — since 0183 as its two sides, `(input, output)`
		// — over an open string space, so a typo'd id ("text+imgae->text")
		// inserts cleanly, shows up on no screen, and is matched by nothing
		// forever. Refusing it here is the only place that can tell.
		//
		// A MIS-ORDERED id ("image+text->text", the same words in the wrong
		// order) is the one case 0183 made survivable on its own: `sidesOf`
		// canonicalises before storing. It is still refused here, because a
		// build that does not name the combination has no business registering
		// it whatever the spelling.
		const combos = await combosFor(db)
		if (!combos.some((c) => c.id === params.capability)) {
			const error = `"${params.capability}" is not a capability this build knows about.`
			emitToUser("connectionDefaults:set:error", { error })
			throw new Error(error)
		}

		// A connection is judged before it is registered, by the SAME reader the
		// picker above greyed the row with (`capabilityRefusal` →
		// `storedCapabilities` → `judgeAgainst`). A write path that accepts what
		// its own screen disables is not a hypothetical: the picker's `disabled`
		// is markup, and this handler is reachable from a stale tab whose option
		// list predates the connection being re-typed. Registering an image-only
		// endpoint for chat succeeds, shows a check on screen, and then fails
		// every Send with a sentence about adapters — which is exactly what the
		// deleted auto-star used to do.
		//
		// Clearing (`id: null`) is never judged: it names no connection, and
		// refusing to un-register would be a trap.
		if (params.half === "connection" && params.id != null) {
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
				const error = "Connection not found."
				emitToUser("connectionDefaults:set:error", { error })
				throw new Error(error)
			}
			const refusal = capabilityRefusal(
				row,
				params.capability as CapabilityId
			)
			if (refusal) {
				emitToUser("connectionDefaults:set:error", { error: refusal })
				throw new Error(refusal)
			}
		}

		// One half, leaving the other alone. `null` clears — and clearing the
		// sampling half means "let the backend use its own defaults", which is a
		// legitimate answer and must not disturb the connection beside it.
		await setCapabilityDefault(
			db,
			params.capability,
			params.half === "connection"
				? { connectionId: params.id }
				: { samplingConfigId: params.id }
		)

		const res: Sockets.ConnectionDefaults.Set.Response = {
			capability: params.capability,
			defaults: await capabilityDefaults(db)
		}
		emitToUser("connectionDefaults:set", res)

		// Push the settings too: `capabilityDefaults` rides on
		// `systemSettings:get`, which is where every OTHER screen's copy comes
		// from — the connection sidebar's star, the sampling sidebar's, the
		// wizard's "have you set up a connection yet". Writing here and not
		// pushing there leaves two client copies of one table disagreeing until
		// a reload, which is the same two-spellings failure one level up.
		await systemSettingsGet.handler(socket, {}, emitToUser)

		return res
	}
}

export function registerConnectionDefaultsHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, connectionDefaultsList, emitToUser)
	register(socket, connectionDefaultsSet, emitToUser)
}
