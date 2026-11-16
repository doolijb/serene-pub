/**
 * 🚧 LLM lane widths: an admin's override of how many model requests one host
 * takes at once (perf-I, owner ruling 2026-11-13, ★P2-b follow-up).
 *
 * OWNS the `llm_lane_widths` table (one row per host, keyed by the URL origin an
 * LLM lane is keyed by) and every write to it, the in-use host listing the
 * Admin → Connections card shows, and the load that feeds the overrides to
 * `llmLanes.ts`. Nothing else reads or writes the table.
 *
 * Does NOT own model residency or loading order — it governs requests in flight
 * per host, never which model is loaded (a queue never owns model lifecycle);
 * that is the Servers direction's later work. A managed server record's own
 * width would plug in at `defaultLlmLaneWidth`'s managed branch in `llmLanes.ts`.
 *
 * Read by the LLM queue, via `llmLaneWidthOf` (override, else the derived default).
 */
import { db, dbReady } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	defaultLlmLaneWidth,
	llmLaneHostOf,
	MAX_LLM_LANE_WIDTH,
	MIN_LLM_LANE_WIDTH,
	resolveLlmLaneHost,
	setLlmLaneWidthOverrides
} from "./llmLanes"
import { llmQueue } from "$lib/server/utils/llmQueue"

let loaded: Promise<void> | null = null

async function readRows() {
	await dbReady
	return db.select().from(schema.llmLaneWidths)
}

/** Reads every override once and hands it to `llmLanes.ts`. Run at boot (the
 *  `llm-lane-widths` startup task) and before the admin list. A read that throws
 *  leaves the defaults (the queue must still work). */
export function ensureLlmLaneWidthsLoaded(): Promise<void> {
	loaded ??= (async () => {
		try {
			const rows = await readRows()
			setLlmLaneWidthOverrides(
				new Map(rows.map((r) => [r.laneKey, r.width]))
			)
		} catch (e) {
			console.warn(
				"LLM lane widths could not be read; using the defaults.",
				e
			)
		}
	})()
	return loaded
}

/** The hosts in use (text-model connections, by resolved address), then any override whose host has no connection. */
export async function listLlmLaneHosts(): Promise<
	Sockets.Connections.LlmLanes.Host[]
> {
	await dbReady
	await ensureLlmLaneWidthsLoaded()
	const [connections, rows] = await Promise.all([
		db
			.select({
				id: schema.connections.id,
				name: schema.connections.name,
				type: schema.connections.type,
				baseUrl: schema.connections.baseUrl
			})
			.from(schema.connections),
		readRows()
	])
	const overrides = new Map(rows.map((r) => [r.laneKey, r.width]))
	const byKey = new Map<string, Sockets.Connections.LlmLanes.Host>()
	for (const c of connections) {
		if (CONNECTION_TYPE.modalityOf(c.type) !== "text-gen") continue
		const host = await resolveLlmLaneHost(c)
		if (host.laneKey.startsWith("connection:")) continue
		let entry = byKey.get(host.laneKey)
		if (!entry) {
			entry = {
				laneKey: host.laneKey,
				defaultWidth: defaultLlmLaneWidth(host),
				width: overrides.get(host.laneKey) ?? null,
				managed: host.managed,
				cloud: host.cloud,
				connections: []
			}
			byKey.set(host.laneKey, entry)
		}
		entry.connections.push({ id: c.id, name: c.name })
	}
	const inUse = [...byKey.values()].sort((a, b) =>
		a.laneKey < b.laneKey ? -1 : a.laneKey > b.laneKey ? 1 : 0
	)
	for (const h of inUse)
		h.connections.sort((a, b) => a.name.localeCompare(b.name))
	const unused = rows
		.filter((r) => !byKey.has(r.laneKey))
		.map((r) => r.laneKey)
		.sort()
		.map((laneKey): Sockets.Connections.LlmLanes.Host => {
			// No connection names a type here, so the address alone decides.
			const host = llmLaneHostOf({ baseUrl: laneKey })
			return {
				laneKey,
				defaultWidth: defaultLlmLaneWidth(host),
				width: overrides.get(laneKey) ?? null,
				managed: false,
				cloud: host.cloud,
				connections: []
			}
		})
	return [...inUse, ...unused]
}

/** Sets (1–16) or clears (`null`) one host's override, then re-reads the rows and wakes the queue. */
export async function setLlmLaneWidth(
	laneKey: string,
	width: number | null
): Promise<{ error?: string }> {
	let isOrigin = false
	try {
		isOrigin = new URL(laneKey).origin === laneKey
	} catch {
		isOrigin = false
	}
	if (!isOrigin)
		return {
			error: "A host is written as its address without a path, like http://localhost:5001."
		}
	if (
		width !== null &&
		(!Number.isInteger(width) ||
			width < MIN_LLM_LANE_WIDTH ||
			width > MAX_LLM_LANE_WIDTH)
	)
		return {
			// The card's own refusal, word for word (connectionsAdmin.ts).
			error: `Use a whole number from ${MIN_LLM_LANE_WIDTH} to ${MAX_LLM_LANE_WIDTH}, or leave it empty for the default.`
		}
	await dbReady
	if (width === null) {
		await db
			.delete(schema.llmLaneWidths)
			.where(eq(schema.llmLaneWidths.laneKey, laneKey))
	} else {
		await db
			.insert(schema.llmLaneWidths)
			.values({ laneKey, width })
			.onConflictDoUpdate({
				target: schema.llmLaneWidths.laneKey,
				set: { width, updatedAt: new Date() }
			})
	}
	const rows = await readRows()
	setLlmLaneWidthOverrides(new Map(rows.map((r) => [r.laneKey, r.width])))
	loaded = Promise.resolve()
	llmQueue.widthsChanged()
	return {}
}
