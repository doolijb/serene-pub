/**
 * THE managed audio.cpp endpoint — one row for the one process this pub runs.
 *
 * Its `baseUrl` is display only: where audio.cpp actually is comes from its
 * settings (the port), never from this row. The oldest row of the type is the
 * one; the handlers never add a second.
 */
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { resolveConnectionCapabilities } from "$lib/server/connections/resolve"
import { audioCppBaseUrl } from "./process"
import { ensureAudioCppSettings } from "./settings"

/** What a new managed endpoint is called, before any clash. */
export const MANAGED_ENDPOINT_NAME = "audio.cpp"

/** The managed endpoint, or undefined when this install has none yet. */
export async function managedAudioCppEndpoint(
	db: Db
): Promise<SelectConnection | undefined> {
	const [row] = await db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.type, CONNECTION_TYPE.AUDIOCPP_MANAGED))
		.orderBy(asc(schema.connections.id))
		.limit(1)
	return row
}

/** A name no other connection has, case-insensitively. */
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
 * The managed endpoint, created when there is none. A raw insert, so it does
 * by hand what `connections:create` would: a unique name and a resolved
 * `capabilities` column.
 */
export async function ensureManagedAudioCppEndpoint(
	db: Db,
	baseUrl: string | null | undefined
): Promise<SelectConnection> {
	const existing = await managedAudioCppEndpoint(db)
	if (existing) return existing
	const defaults = CONNECTION_DEFAULTS[CONNECTION_TYPE.AUDIOCPP_MANAGED]
	const data: InsertConnection = {
		...defaults,
		type: CONNECTION_TYPE.AUDIOCPP_MANAGED,
		name: await freeName(db),
		baseUrl: baseUrl ?? defaults.baseUrl ?? null,
		extraJson: { ...(defaults.extraJson ?? {}) }
	}
	data.capabilities = { resolved: resolveConnectionCapabilities(data) }
	const [row] = await db.insert(schema.connections).values(data).returning()
	return row
}

/**
 * Boot fold: when the managed row exists and its display baseUrl differs from
 * the one the settings port derives, update it. Never creates a row.
 */
export async function foldAudioCppManagedBaseUrl(db: Db): Promise<void> {
	const row = await managedAudioCppEndpoint(db)
	if (!row) return
	const want = audioCppBaseUrl(await ensureAudioCppSettings(db))
	if (row.baseUrl === want) return
	await db
		.update(schema.connections)
		.set({ baseUrl: want })
		.where(eq(schema.connections.id, row.id))
}
