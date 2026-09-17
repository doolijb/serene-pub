/**
 * The index's one filter and its search, as a pure function over list rows.
 *
 * Extracted from the view so the rules can be stated and tested without a
 * component: which models a filter keeps, when a connection stays visible
 * for its own sake, and how search reaches into model names. The view
 * renders whatever this returns and decides nothing.
 *
 * ## The filter's values
 *
 * - `all` — every endpoint, every model, including an endpoint with none
 *   (that is an endpoint somebody has not finished setting up, and hiding it
 *   is how it stays unfinished).
 * - `defaults` — only models an instance default points at.
 * - `attention` — only what needs a person: models the host has stopped
 *   listing, and endpoints whose last listing failed (shown whole, because
 *   the problem is the endpoint).
 * - `cap:<transform>` — only models that may serve that capability.
 *
 * A model-narrowing filter drops an endpoint left with no models; `all` is
 * the only filter under which an empty endpoint is a thing to show.
 *
 * ## Search
 *
 * The query matches an endpoint (name, note, service, host) or a model (name,
 * identifier). Matching the endpoint keeps all its filter-narrowed models;
 * matching a model keeps that model. Search never widens what the filter
 * narrowed.
 */

export type IndexFilter = "all" | "defaults" | "attention" | `cap:${string}`

export interface IndexModel {
	id: number
	name: string
	model: string
	enabled: boolean
	missingSince: string | null
	satisfiableCapabilities?: string[]
}

export interface IndexConnection {
	id: number
	name?: string | null
	type?: string | null
	baseUrl?: string | null
	notes?: string | null
	models: IndexModel[]
	modelsSync: { at: string | null; error: string | null }
}

export interface IndexGroup<C extends IndexConnection = IndexConnection> {
	connection: C
	/** The models this filter and query keep, in list order. */
	models: C["models"]
}

export interface FilterIndexOptions {
	query: string
	filter: IndexFilter
	/** Which capabilities' defaults point at (connectionId, modelId). */
	isDefault: (connectionId: number, modelId: number) => boolean
	/** The service label for an endpoint type, for search. */
	serviceLabel: (type: string | null | undefined) => string
}

export function parseIndexFilter(
	value: string | null | undefined
): IndexFilter {
	if (value === "defaults" || value === "attention") return value
	if (value && value.startsWith("cap:") && value.length > 4)
		return value as IndexFilter
	return "all"
}

export function filterIndex<C extends IndexConnection>(
	rows: readonly C[],
	opts: FilterIndexOptions
): IndexGroup<C>[] {
	const q = opts.query.trim().toLowerCase()
	const out: IndexGroup<C>[] = []

	for (const connection of rows) {
		const endpointHit =
			!q ||
			[
				connection.name,
				connection.notes,
				opts.serviceLabel(connection.type),
				connection.baseUrl
			].some((h) => h?.toLowerCase().includes(q))

		let models = connection.models.filter((m) =>
			keptByFilter(m, connection, opts)
		)
		if (q && !endpointHit)
			models = models.filter(
				(m) =>
					m.name.toLowerCase().includes(q) ||
					m.model.toLowerCase().includes(q)
			)

		const showEndpoint =
			models.length > 0 ||
			(opts.filter === "all" && endpointHit) ||
			(opts.filter === "attention" &&
				!!connection.modelsSync.error &&
				endpointHit)
		if (!showEndpoint) continue
		out.push({ connection, models: models as C["models"] })
	}
	return out
}

function keptByFilter(
	m: IndexModel,
	connection: IndexConnection,
	opts: FilterIndexOptions
): boolean {
	const f = opts.filter
	if (f === "all") return true
	if (f === "defaults") return opts.isDefault(connection.id, m.id)
	if (f === "attention")
		return m.missingSince != null || !!connection.modelsSync.error
	const capability = f.slice(4)
	return (m.satisfiableCapabilities ?? []).includes(capability)
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
