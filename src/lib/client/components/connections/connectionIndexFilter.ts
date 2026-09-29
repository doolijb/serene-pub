/**
 * The index's one filter and its search, as a pure function over list rows.
 *
 * Extracted from the view so the rules can be stated and tested without a
 * component: which connections a filter keeps, what each filter row counts,
 * and how search reaches into model names. The view renders whatever this
 * returns and decides nothing.
 *
 * ## The unit is the CONNECTION
 *
 * Not the model. Models left the index with the
 * 2026-09-17 concept ruling (readiness card + connections list), so there is
 * nothing left to narrow inside a connection — a filter either keeps a
 * connection or drops it. A capability filter therefore asks whether ANY of a
 * connection's models can serve that capability, which is the question a
 * person filtering by "Images" is actually asking.
 *
 * ## The filter's values
 *
 * Unchanged (`IndexFilter`), because a `cap:` value is seeded from outside —
 * Jump, the onboarding wizard's step, the panels digest — and those callers
 * are not this unit's to move.
 *
 * - `all` — every connection, including one with no models. That is a
 *   connection somebody has not finished setting up, and hiding it is how it
 *   stays unfinished.
 * - `attention` — only what needs a person: the host's last listing failed,
 *   a model it listed before is gone, or a local file failed to download.
 * - `defaults` — narrows nothing. The view swaps the list for the ledger (see
 *   `DefaultsLedger`'s header), so this value is a MODE, not a predicate, and
 *   `filterConnections` is never asked about it.
 * - `cap:<transform>` — connections with at least one model able to serve it.
 *
 * ## Search
 *
 * The query matches a connection (name, note, service, host) or one of its
 * models (name, identifier); either keeps the whole connection, because the
 * connection is the row. Search never widens what the filter narrowed.
 */

import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { presetLabel } from "$lib/shared/utils/connectionDefaults"
import { endpointKind, isLocalOnnxType } from "./modelManagement"

export type IndexFilter = "all" | "defaults" | "attention" | `cap:${string}`

export interface IndexModel {
	id: number
	name: string
	model: string
	enabled: boolean
	missingSince: string | null
	satisfiableCapabilities?: string[]
	/** Present only on a local ONNX connection's rows. */
	local?: { state?: "not_downloaded" | "downloading" | "on_disk" | "error" }
}

export interface IndexConnection {
	id: number
	name?: string | null
	type?: string | null
	baseUrl?: string | null
	notes?: string | null
	/** The OpenAI-compatible preset slug, when the row names one. */
	preset?: string | null
	models: IndexModel[]
	modelsSync: { at: string | null; error: string | null }
}

export interface FilterConnectionsOptions {
	query: string
	filter: IndexFilter
	/**
	 * What this connection's service is CALLED, for search.
	 *
	 * The whole row rather than its type, because an OpenAI-compatible row's
	 * service is its preset ("OpenRouter"), which the type alone cannot say —
	 * and "openrouter" is exactly what somebody types to find it.
	 */
	serviceLabel: (connection: IndexConnection) => string
}

export function parseIndexFilter(
	value: string | null | undefined
): IndexFilter {
	if (value === "defaults" || value === "attention") return value
	if (value && value.startsWith("cap:") && value.length > 4)
		return value as IndexFilter
	return "all"
}

/**
 * Whether this connection is waiting on a person.
 *
 * Three facts, and all three are about the connection rather than one model:
 * a host that could not be listed, a model that has stopped being listed, and
 * a local file whose download failed. A model merely switched off is NOT here
 * — that is somebody's choice, and a list that nags about it is a list people
 * stop reading.
 */
export function needsAttention(connection: IndexConnection): boolean {
	if (connection.modelsSync.error) return true
	return connection.models.some(
		(m) => m.missingSince != null || m.local?.state === "error"
	)
}

/**
 * Whether an OpenAI-compatible row names no preset — a bare URL nobody picked
 * a service for, same row the add-connection picker calls "Custom
 * (OpenAI-Compatible)". Absent or empty both count: neither is a slug
 * `presetLabel` can put a name to.
 */
/**
 * What a connection's SERVICE is called — the chip beside its title, and what
 * search sees (R5). One function for the index row, the capability view and
 * the finder's destination pills, so one endpoint is one word everywhere. The
 * kind is folded through `endpointKind`, so the Ollama embeddings type is the
 * same "Ollama" the text one is; a custom OpenAI-compatible preset reads
 * "OpenAI-compatible" rather than the preset's internal name.
 */
export function serviceLabel(connection: {
	type?: string | null
	preset?: string | null
}): string {
	const kind = endpointKind(connection.type)
	if (kind === "koboldcpp-managed") return "KoboldCPP"
	if (kind === "ollama") return "Ollama"
	if (isLocalOnnxType(connection.type)) return "ONNX"
	if (connection.type === CONNECTION_TYPE.OPENAI)
		return isCustomOpenAiPreset(connection.preset)
			? "OpenAI-compatible"
			: presetLabel(connection.preset)
	return (
		CONNECTION_TYPE.options.find((t) => t.value === connection.type)
			?.label ??
		connection.type ??
		"Unknown service"
	)
}

export function isCustomOpenAiPreset(
	preset: string | null | undefined
): boolean {
	return !preset
}

/** Whether any of this connection's models may serve that capability. */
export function servesCapability(
	connection: IndexConnection,
	capability: string
): boolean {
	return connection.models.some((m) =>
		(m.satisfiableCapabilities ?? []).includes(capability)
	)
}

function keptByFilter(
	connection: IndexConnection,
	filter: IndexFilter
): boolean {
	if (filter === "all" || filter === "defaults") return true
	if (filter === "attention") return needsAttention(connection)
	return servesCapability(connection, filter.slice(4))
}

function matchesQuery(
	connection: IndexConnection,
	q: string,
	serviceLabel: FilterConnectionsOptions["serviceLabel"]
): boolean {
	if (!q) return true
	const haystacks = [
		connection.name,
		connection.notes,
		serviceLabel(connection),
		connection.baseUrl
	]
	if (haystacks.some((h) => h?.toLowerCase().includes(q))) return true
	return connection.models.some(
		(m) =>
			m.name.toLowerCase().includes(q) ||
			m.model.toLowerCase().includes(q)
	)
}

export function filterConnections<C extends IndexConnection>(
	rows: readonly C[],
	opts: FilterConnectionsOptions
): C[] {
	const q = opts.query.trim().toLowerCase()
	return rows.filter(
		(c) =>
			keptByFilter(c, opts.filter) &&
			matchesQuery(c, q, opts.serviceLabel)
	)
}

/**
 * How many connections a filter row would keep, ignoring the query.
 *
 * Ignoring it on purpose: the count is what tells a person whether pressing
 * the row is worth it, and a count that moved as they typed would be
 * answering a question they have not asked yet. `defaults` counts nothing —
 * it is a mode, not a narrowing — and the caller omits its count.
 */
export function countConnections(
	rows: readonly IndexConnection[],
	filter: IndexFilter
): number {
	if (filter === "defaults") return 0
	return rows.filter((c) => keptByFilter(c, filter)).length
}

/** What the index says about the whole list, for its summary line. */
export interface IndexTotals {
	connections: number
	models: number
	missing: number
	unreachable: number
}

export function indexTotals(rows: readonly IndexConnection[]): IndexTotals {
	let models = 0
	let missing = 0
	let unreachable = 0
	for (const c of rows) {
		models += c.models.length
		missing += c.models.filter((m) => m.missingSince != null).length
		if (c.modelsSync.error) unreachable++
	}
	return { connections: rows.length, models, missing, unreachable }
}
