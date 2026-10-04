/**
 * What Admin › Pipelines › Events says about events, pure so it is tested
 * (`eventsAdmin.test.ts`): an event's change-view address, which presets
 * bind it, where its event map opens, and its neighbours on that map.
 *
 * Event ids carry `:` and `/` (`core:event/session-created@1`), so every
 * link encodes them; the admin router decodes the param.
 */

type MapNode = Sockets.Pipelines.EventMap.MapNode
type EventMapGraph = NonNullable<Sockets.Pipelines.EventMap.Response["eventMap"]>
type Preset = Pick<Sockets.SessionAdmin.PresetRow, "id" | "name" | "genreId" | "bindings">

/** The scope an event map is drawn for — the address's `genre` · `preset` · `session`. */
export interface EventMapScope {
	/** "" = every genre. */
	genreId: string
	/** "" = any preset. */
	presetId: string
	sessionId: number | null
}

/** The address's word for "every genre", so a reload keeps a cleared picker. */
export const ALL_GENRES = "all"

/** An event's change view, carrying a map scope when one is given. */
export function eventHref(id: string, scope?: Partial<EventMapScope> | URLSearchParams): string {
	const base = `/admin/pipelines/events/${encodeURIComponent(id)}`
	const q = scope instanceof URLSearchParams ? scope : scope ? scopeQuery(scope) : null
	const s = q?.toString()
	return s ? `${base}?${s}` : base
}

/** The query a scope rides on; a cleared genre with nothing else is `genre=all`. */
export function scopeQuery(scope: Partial<EventMapScope>): URLSearchParams {
	const p = new URLSearchParams()
	if (scope.genreId) p.set("genre", scope.genreId)
	else if (!scope.presetId && scope.sessionId == null && scope.genreId === "") p.set("genre", ALL_GENRES)
	if (scope.presetId) p.set("preset", scope.presetId)
	if (scope.sessionId != null) p.set("session", String(scope.sessionId))
	return p
}

/** The address's scope, or null when it names none (the caller picks the default). */
export function scopeFromQuery(search: string | URLSearchParams): EventMapScope | null {
	const q = typeof search === "string" ? new URLSearchParams(search) : search
	if (!["genre", "preset", "session"].some((k) => q.has(k))) return null
	const int = (k: string) => {
		const n = Number(q.get(k))
		return Number.isInteger(n) && n > 0 ? n : null
	}
	const genre = q.get("genre")
	return {
		genreId: !genre || genre === ALL_GENRES ? "" : genre,
		presetId: int("preset")?.toString() ?? "",
		sessionId: int("session")
	}
}

/**
 * Where an event's map opens when the address names no scope: the event's
 * first genre, else the fallback (Chat) — every genre at once is every
 * published pipeline, too dense to read.
 */
export function defaultScope(
	event: Pick<Sockets.Pipelines.EventMap.RegistryRow, "genres"> | null | undefined,
	fallbackGenreId: string
): EventMapScope {
	return {
		genreId: event?.genres[0]?.genreId ?? fallbackGenreId,
		presetId: "",
		sessionId: null
	}
}

/** One preset's binding of an event: the **Bound by presets** inline's row. */
export interface PresetBinding {
	presetId: number
	presetName: string
	genreId: string
	spec: string
	/** A pipeline_configs id; absent = the pipeline's shipped default. */
	config?: number
}

/** The presets whose event bindings name this event, by name. */
export function presetsBinding(presets: readonly Preset[], eventId: string): PresetBinding[] {
	const out: PresetBinding[] = []
	for (const p of presets) {
		const b = p.bindings?.[eventId]
		if (!b?.spec) continue
		out.push({
			presetId: p.id,
			presetName: p.name,
			genreId: p.genreId,
			spec: b.spec,
			...(b.config != null ? { config: b.config } : {})
		})
	}
	return out.sort((a, b) => a.presetName.localeCompare(b.presetName, undefined, { sensitivity: "base" }))
}

/**
 * An event's neighbours on the drawn event map — the places a map click
 * opens, as lists, so they are reachable without a pointer.
 */
export function mapNeighbours(
	map: EventMapGraph | null | undefined,
	eventId: string
): { answeredBy: MapNode[]; causedBy: MapNode[]; heardBy: MapNode[] } {
	if (!map) return { answeredBy: [], causedBy: [], heardBy: [] }
	const byId = new Map(map.nodes.map((n) => [n.id, n]))
	const pick = (ids: string[]) =>
		ids.map((id) => byId.get(id)).filter((n): n is MapNode => !!n)
	return {
		answeredBy: pick(map.edges.filter((e) => e.from === eventId && e.kind === "binds").map((e) => e.to)),
		causedBy: pick(map.edges.filter((e) => e.to === eventId && e.kind === "causes").map((e) => e.from)),
		heardBy: pick(map.edges.filter((e) => e.from === eventId && e.kind === "listens").map((e) => e.to))
	}
}

/**
 * Where a map node opens: a pipeline its workspace, a plugin's listener the
 * plugins page, an event its change view. Core's listeners have no page.
 */
export function nodeHref(node: MapNode, scope?: Partial<EventMapScope>): string | null {
	if (node.kind === "event") return eventHref(node.id, scope)
	if (node.kind === "spec") return `/admin/pipelines/${encodeURIComponent(node.id)}`
	if (node.kind === "listener" && !node.id.startsWith("core:")) return "/admin/plugins"
	return null
}
