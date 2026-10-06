/**
 * The **event map** (PLAN-turn-order §B1) — the one answer to "which events
 * a genre's pipelines bind, which spec causes what, and who listens", read
 * from rows. A registry query, not a trace: it states what is installed,
 * never what is running. Built the B2 page renders and B3's conformance
 * reads, from the same facts each recomputes once (<B1>).
 *
 * # Nodes — three kinds
 * · `event`    — every event `allEvents()` registers. The id is the event
 *   slug (`core:event/message-completed@1`); the label is the declaration's
 *   `en` display name, else the humanised name.
 * · `spec`     — every published active pipeline whose input lock answers
 *   the scope's genre (or every published active pipeline when unscoped).
 *   The id is the spec slug.
 * · `listener` — the two core listeners (auto-advance, the
 *   `sessions:turnOrder` push) plus one node per subscribed plugin hook
 *   (`<pluginId>:listener/<hookName>`).
 *
 * # Edges — three kinds
 * · `binds`   event → spec. A spec's inlet lock (`event` / `events`) IS the
 *   statement "this genre may bind this event to this spec". Preset and
 *   session bindings add no edges of their own: the save path accepts only a
 *   binding the bound spec's lock answers, so every bound pair is already a
 *   lock edge, and a session-scope rebind moves a *node* (a strategy), never
 *   an event↔spec pair. The map's scope chooses which genre's specs (and so
 *   which locks) are drawn; a preset or a session then keeps, per event, only
 *   the spec its resolution picks (B2 review), so its map is what it runs.
 *   `session-action` is an open slot and is never narrowed.
 * · `causes`  spec → event, listener → event. A spec's `outlet` nodes fire
 *   the data events whose `causedBy` lists the outlet's definition id — the
 *   event side of the outlet declarations' `causesEvent`, which is the
 *   complete one (a finished reply is both a creation and a completion, so
 *   its `message-completed` is caused by every outlet whose write lands a
 *   row). The auto-advance listener fires `message-respond`.
 * · `listens` event → listener. Plugin subscriptions (`eventHooks` /
 *   `hooks.eventListeners`, reconciled by `subscriptionsOf`) and the two
 *   core listeners.
 *
 * # Roots
 * An event with no `causes` edge in — a *computed* root. An event B3's C21
 * declares a root but that some listener causes is not one here: the
 * auto-advance listener causes `message-respond`, so the map has
 * `message-respond` bound, caused and not a root, even though C21 lists it.
 * The conformance rule announces declared roots in its own list; it does not
 * read them off this `root` flag.
 */

import { pipelineLabelsById } from "$lib/server/pipelines/entities/pipelineLabels"
import { and, asc, eq, inArray } from "drizzle-orm"
import { notCoreRow } from "$lib/server/plugins/frameHost"
import * as schema from "$lib/server/db/schema"
import { allEvents, getDefinition, i18nText, isEventId, packageEventById, sessionEvents } from "@serene-pub/sdk"
import { subscriptionsOf } from "$lib/server/plugins/eventHost"

export type EventMapNodeKind = "event" | "spec" | "listener"
export type EventMapEdgeKind = "binds" | "causes" | "listens"

export interface EventMapNode {
	id: string
	kind: EventMapNodeKind
	label: string
	/** Events only: an event with no `causes` edge in (see the module note). */
	root: boolean
}

export interface EventMapEdge {
	from: string
	to: string
	kind: EventMapEdgeKind
}

export interface EventMap {
	nodes: EventMapNode[]
	edges: EventMapEdge[]
}

/** The scope the map is drawn for. All fields optional; nothing is required. */
export interface EventMapScope {
	genreId?: string
	presetId?: number
	sessionId?: number
}

/** The map's node ids for the two core listeners (§4.6, §4.7). */
export const AUTO_ADVANCE_LISTENER_ID = "core:listener/auto-advance"
export const TURN_ORDER_PUSH_LISTENER_ID = "core:listener/turn-order-push"

const humanise = (raw: string): string =>
	raw
		.split("-")
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join(" ")

/** The name segment of an id, its `@<major>` and owner/kind prefix stripped. */
const nameOf = (id: string): string => {
	const name = id.split("/").pop() ?? id
	return name.replace(/@\d+$/, "")
}

export async function eventMap(
	db: Db,
	scope: EventMapScope = {}
): Promise<EventMap> {
	const edges = new Map<string, EventMapEdge>()
	const addEdge = (from: string, to: string, kind: EventMapEdgeKind) => {
		edges.set(`${from}\0${to}\0${kind}`, { from, to, kind })
	}

	// Scope: the session's genre and preset, then the explicit ones over it.
	let sessionGenre: string | null = null
	let sessionPreset: number | null = null
	if (scope.sessionId != null) {
		const [row] = await db
			.select({
				genreId: schema.sessions.genreId,
				presetId: schema.sessions.presetId
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, scope.sessionId))
			.limit(1)
		sessionGenre = row?.genreId ?? null
		sessionPreset = row?.presetId ?? null
	}
	const presetId = scope.presetId ?? sessionPreset
	let genreId = scope.genreId ?? sessionGenre
	if (genreId == null && presetId != null) {
		const [row] = await db
			.select({ genreId: schema.sessionPresets.genreId })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, presetId))
			.limit(1)
		genreId = row?.genreId ?? null
	}

	// ── Events: the SDK's one registry, every one of them. ────────────────
	// The registry stores each event's bare `slug` (`'message-completed'`); the
	// id the locks, bindings and surfaces are keyed by is the full
	// `core:event/<slug>@<version>`. Only core defines events in 0.6 (F8), so
	// the owner prefix is fixed.
	const defs = allEvents()
	const eventIdOf = (d: (typeof defs)[number]) =>
		`core:event/${d.slug}@${d.version}`

	// ── Binds: published active specs and their inlet locks ────────────────
	const specRows = await db
		.select({
			id: schema.pipelineSpecs.id,
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			versionId: schema.pipelineSpecVersions.id,
			status: schema.pipelineSpecVersions.status,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			inputEvents: schema.pipelineSpecVersions.inputEvents,
			sourcePluginId: schema.pipelineSpecs.sourcePluginId
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
		.orderBy(asc(schema.pipelineSpecs.id))
	// ⚠ Filtered in memory rather than in SQL, for the reason `lockedEventSpec`
	// states: the active-version check compares two tables' columns, and the
	// published spec set is small and closed.
	// A disabled plugin appears nowhere outside the plugins page (owner,
	// 2026-09-24): its pipelines are not drawn.
	const disabledPluginIds = new Set(
		(
			await db
				.select({ id: schema.plugins.id })
				.from(schema.plugins)
				.where(eq(schema.plugins.enabled, false))
		).map((r) => r.id)
	)
	const scopeSpecs = (specRows as any[]).filter(
		(r) =>
			!(r.sourcePluginId != null && disabledPluginIds.has(r.sourcePluginId)) &&
			r.activeVersionId === r.versionId &&
			r.status === "published" &&
			(genreId == null || r.inputGenre === genreId)
	)
	const locksOf = (r: any): Set<string> => {
		const locked = new Set<string>()
		if (r.inputEvent) locked.add(r.inputEvent)
		for (const e of r.inputEvents ?? []) locked.add(e)
		return locked
	}
	const specLabels = await pipelineLabelsById(db)

	// A preset or a session narrows the drawing to what it runs (B2 review):
	// for each event, the one spec its resolution picks — the session through
	// the same resolvers the reply path and the dispatcher use, a preset
	// through its own binding, and an event it leaves unbound through the
	// genre's locked spec. `session-action` is an open slot — every
	// offered action's spec answers it — so it is never narrowed.
	let chosen: ((event: string) => Promise<string | null | undefined>) | null = null
	if (scope.sessionId != null && genreId != null) {
		const sid = scope.sessionId
		const g = genreId
		const { resolveSessionEventSpec } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		const { resolveSubjectSpec } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		chosen = (event) =>
			event === sessionEvents.messageRespond
				? resolveSubjectSpec(db, g, event, { sessionId: sid })
				: resolveSessionEventSpec(db, g, event, { sessionId: sid })
	} else if (presetId != null && genreId != null) {
		const [preset] = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, presetId))
			.limit(1)
		if (preset) {
			const g = genreId
			const { presetBindingVerdict } = await import(
				"$lib/server/pipelines/entities/presetBindings"
			)
			const { lockedEventSpec } = await import(
				"$lib/server/pipelines/entities/presetBindings"
			)
			// What the runtime does with each verdict: a binding runs its
			// spec; a stale binding's fallback runs what it names (null =
			// nothing); an unbound event runs the genre's locked spec.
			chosen = async (event) => {
				const v = await presetBindingVerdict(db, preset as any, g, event)
				return v.via === "none" ? await lockedEventSpec(db, g, event) : v.spec
			}
		}
	}
	if (chosen) {
		const events = new Set(scopeSpecs.flatMap((r) => [...locksOf(r)]))
		const pick = new Map<string, string | null | undefined>()
		for (const event of events)
			if (event !== sessionEvents.sessionAction) pick.set(event, await chosen(event))
		// `undefined` = no narrowing for that event; `null` = nothing runs it.
		const runs = (r: any, event: string) =>
			!pick.has(event) || pick.get(event) === undefined || pick.get(event) === r.slug
		for (let i = scopeSpecs.length - 1; i >= 0; i--)
			if (![...locksOf(scopeSpecs[i])].some((e) => runs(scopeSpecs[i], e)))
				scopeSpecs.splice(i, 1)
		for (const r of scopeSpecs)
			for (const event of locksOf(r))
				if (runs(r, event)) addEdge(event, r.slug, "binds")
	} else {
		for (const r of scopeSpecs)
			for (const event of locksOf(r)) addEdge(event, r.slug, "binds")
	}

	// ── Causes: the scope specs' outlet definitions' `causes_event` ────────
	const versionIds = scopeSpecs
		.map((r) => r.activeVersionId as number | undefined)
		.filter((v): v is number => v != null)
	const slugOfVersion = new Map(
		scopeSpecs.map((r) => [r.activeVersionId, r.slug] as const)
	)
	let outletNodes: Array<{
		specVersionId: number
		definitionId: string
		definitionVersion: number
		config: unknown
	}> = []
	if (versionIds.length) {
		outletNodes = await db
			.select({
				specVersionId: schema.pipelineNodes.specVersionId,
				definitionId: schema.pipelineNodes.definitionId,
				definitionVersion: schema.pipelineNodes.definitionVersion,
				config: schema.pipelineNodes.config
			})
			.from(schema.pipelineNodes)
			.where(
				and(
					inArray(schema.pipelineNodes.specVersionId, versionIds),
					eq(schema.pipelineNodes.kind, "outlet")
				)
			)
	}
	// ⚠ Read from the *event* side, not the definitions' `causesEvent`, even
	// though B1 names that column: the definitions' `causesEvent` declares each
	// outlet's primary write's event only — `core:outlet/create-message@1` says
	// `message-created@1` — while a lifecycle event like `message-completed` is
	// on the `causedBy` of every outlet whose write lands a row (a finished
	// reply is both a creation and a completion). That event-side list is the
	// same directed relation read from the other end, and it is the complete
	// one; the map is drawn from it so B1's cycle edge `respond →
	// message-completed` exists. Every event an outlet's `causesEvent` names is
	// on its own `causedBy`, so nothing the column states is lost.
	for (const node of outletNodes) {
		const slug = slugOfVersion.get(node.specVersionId)
		if (!slug) continue
		for (const def of defs) {
			if (def.causedBy?.includes(node.definitionId))
				addEdge(slug, eventIdOf(def), "causes")
		}
		// A recording (E1): the event is the one its literal names, which no
		// core event's `causedBy` can list.
		const from = getDefinition(`${node.definitionId}@${node.definitionVersion}`)?.causesEventFrom
		const recorded = from ? (node.config as Record<string, unknown> | null)?.[from] : undefined
		if (typeof recorded === "string") addEdge(slug, recorded, "causes")
	}

	// ── Listeners: the two core ones, then plugin subscriptions ────────────
	addEdge(sessionEvents.turnOrderChanged, AUTO_ADVANCE_LISTENER_ID, "listens")
	addEdge(AUTO_ADVANCE_LISTENER_ID, sessionEvents.messageRespond, "causes")
	addEdge(sessionEvents.turnOrderChanged, TURN_ORDER_PUSH_LISTENER_ID, "listens")

	const pluginRows: Array<{ pluginId: string; manifest: unknown; adminDenied: string[] | null }> =
		await db
			.select({
				pluginId: schema.plugins.pluginId,
				manifest: schema.plugins.manifest,
				adminDenied: schema.plugins.adminDenied
			})
			.from(schema.plugins)
			.where(and(eq(schema.plugins.enabled, true), notCoreRow()))
	const pluginListeners = new Map<string, string>()
	for (const row of pluginRows) {
		const { subscriptions } = subscriptionsOf(row)
		for (const s of subscriptions) {
			const id = `${s.pluginId}:listener/${s.hookName}`
			pluginListeners.set(id, `${s.pluginId} · ${s.hookName}`)
			addEdge(s.event, id, "listens")
		}
	}

	// ── Roots, then the sorted document. ───────────────────────────────────
	const causedInto = new Set<string>()
	for (const e of edges.values()) if (e.kind === "causes") causedInto.add(e.to)

	const nodes: EventMapNode[] = [
		...defs.map((d) => ({
			id: eventIdOf(d),
			kind: "event" as const,
			label: i18nText(d.name) ?? humanise(d.slug),
			root: !causedInto.has(eventIdOf(d))
		})),
		// A package's declared events (E1): the ones a recording or a lock
		// in this scope names, labelled from their declaration.
		...[...new Set([...edges.values()].flatMap((e) => [e.from, e.to]))]
			.filter((id) => isEventId(id) && !id.startsWith("core:"))
			.map((id) => ({
				id,
				kind: "event" as const,
				label: i18nText(packageEventById(id)?.name) ?? id,
				root: !causedInto.has(id)
			})),
		...scopeSpecs.map((r) => ({
			id: r.slug,
			kind: "spec" as const,
			// The pipeline's name with its genre beside it (NOMENCLATURE §2,
			// "Pipeline names"): a map can hold several genres' _Reply_.
			label: specLabels.get(r.id) ?? humanise(nameOf(r.slug)),
			root: false
		})),
		{
			id: AUTO_ADVANCE_LISTENER_ID,
			kind: "listener" as const,
			label: "Auto-advance",
			root: false
		},
		{
			id: TURN_ORDER_PUSH_LISTENER_ID,
			kind: "listener" as const,
			label: "Turn-order push",
			root: false
		},
		...[...pluginListeners].map(([id, label]) => ({
			id,
			kind: "listener" as const,
			label,
			root: false
		}))
	]
	nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
	const sortedEdges = [...edges.values()].sort((a, b) =>
		a.kind !== b.kind
			? a.kind < b.kind
				? -1
				: 1
			: a.from !== b.from
				? a.from < b.from
					? -1
					: 1
				: a.to < b.to
					? -1
					: a.to > b.to
						? 1
						: 0
	)

	return { nodes, edges: sortedEdges }
}