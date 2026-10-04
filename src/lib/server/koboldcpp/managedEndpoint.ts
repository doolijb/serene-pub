/**
 * THE managed KoboldCPP endpoint — one row for the one process this pub runs.
 *
 * Serene Pub runs one koboldcpp on one port, and its model manager swaps the
 * text or image model that process holds on demand. So it is one endpoint that
 * chats and draws, and every model it can serve — text GGUFs and image
 * checkpoints alike — is a `connection_models` row on it, each carrying its
 * `modality`. Which transforms a model may serve is judged per model
 * (`capabilityRefusal`), never by filing it under a second connection.
 *
 * The oldest row of the type is the one. More than one can exist only on an
 * install that predates this rule; `koboldCppManagedFold.ts` folds image rows
 * in at boot, and the handlers here never add a second.
 */

import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { resolveConnectionCapabilities } from "$lib/server/connections/resolve"

/** What a new managed endpoint is called, before any clash. */
export const MANAGED_ENDPOINT_NAME = "KoboldCPP"

/** The managed endpoint, or undefined when this install has none yet. */
export async function managedKoboldCppEndpoint(
	db: Db
): Promise<SelectConnection | undefined> {
	const [row] = await db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.type, CONNECTION_TYPE.KOBOLDCPP_MANAGED))
		.orderBy(asc(schema.connections.id))
		.limit(1)
	return row
}

/**
 * A name no other connection has, case-insensitively — the rule
 * `connections:create` enforces, which a raw insert would otherwise skip.
 */
async function freeName(db: Db): Promise<string> {
	return managedEndpointName(
		(
			await db
				.select({ name: schema.connections.name })
				.from(schema.connections)
		).map((r) => r.name ?? "")
	)
}

/**
 * The managed endpoint's name against the names already taken — the rule
 * `freeName` applies, pure, so the 0.5.3 upgrade names the endpoint it builds
 * exactly as a fresh one would be named.
 */
export function managedEndpointName(names: Iterable<string>): string {
	const taken = new Set([...names].map((n) => n.trim().toLowerCase()))
	const base = MANAGED_ENDPOINT_NAME
	if (!taken.has(base.toLowerCase())) return base
	const local = `${base} on this machine`
	if (!taken.has(local.toLowerCase())) return local
	for (let n = 2; ; n++) {
		const candidate = `${local} ${n}`
		if (!taken.has(candidate.toLowerCase())) return candidate
	}
}

/**
 * The managed endpoint, created when there is none.
 *
 * A raw insert, so it does by hand the two things `connections:create` would:
 * a unique name, and a resolved `capabilities` column — an empty one reads as
 * "not determined yet" and falls through to the modality test, which is right
 * only by accident.
 */
export async function ensureManagedKoboldCppEndpoint(
	db: Db,
	baseUrl: string | null | undefined
): Promise<SelectConnection> {
	const existing = await managedKoboldCppEndpoint(db)
	if (existing) return existing
	const defaults = CONNECTION_DEFAULTS[CONNECTION_TYPE.KOBOLDCPP_MANAGED]
	const data: InsertConnection = {
		...defaults,
		type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
		modality: "text-gen",
		name: await freeName(db),
		// Display only: the managed KoboldCPP's own settings are what the adapters and
		// dispatchImage resolve a managed row's base URL from.
		baseUrl: baseUrl ?? defaults.baseUrl ?? null,
		extraJson: { ...(defaults.extraJson ?? {}) }
	}
	data.capabilities = { resolved: resolveConnectionCapabilities(data) }
	const [row] = await db.insert(schema.connections).values(data).returning()
	return row
}
