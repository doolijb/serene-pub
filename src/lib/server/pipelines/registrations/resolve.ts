/**
 * 🚧 **The one resolver** (PLAN-layering D7, R2, R24, R33, A11; 2026-10-20):
 * which registrations a session has — the genre's defaults ⊕ its preset's
 * changes ⊕ its own rows, merged by the SDK's pure `effectiveRegistrations`,
 * read here from the `registrations` table and judged against what this
 * instance has published.
 *
 * It replaces the bindings resolvers (`resolveSessionEventVerdict`,
 * `resolveSubjectVerdict`'s layers), the action layering (`listSessionFunctions`,
 * `presetActionsFor`, the companion rule), the preset's bindings and the
 * pub-level rows (R33, retired). Those names survive as thin readers of this
 * one answer, so every caller asks the same question of the same rows.
 *
 * ## A registration that does not resolve falls back, out loud
 *
 * The 2026-09-10 ruling stands (A11): an upgrade or an uninstall must never
 * stop a session working. A registration whose pipeline is not published here
 * is **stale**: it is left out, and on an event the layer below answers in
 * its place — the genre's defaults under a preset's registration, the
 * preset's under a session's. A preset's stale registration is reported as a
 * `PresetFallback` (the receipt, the session banner, the boot's
 * `session_preset_notices`, the admin list all say it). 🚧 A registration
 * the registration door's last re-check found broken (A11 — fit, values or
 * envoys, `fit.ts`) is left out the same way, its sentence the door's; the
 * check itself runs at boot and on install, update, disable and publish,
 * never here.
 *
 * ## Many per event (R24)
 *
 * An event may carry several registrations: each runs, in `order` then key,
 * each its own run, when its `when` holds over the session's published values
 * (`evaluateCondition`, R31 — absent is always). `registrationsOn` answers
 * which run and which were skipped.
 *
 * ## Cached
 *
 * Per database handle and session, until anything it read changes: a
 * registrations write, a preset or session preset change, a spec published
 * or withdrawn (`invalidateRegistrations`), or the session's preset pointer
 * moving (read on every call — the one query a hit costs). Off under Vitest
 * unless a test asks for it (`setRegistrationCacheEnabled`), so a fixture
 * written straight to the tables is always what resolves.
 */
import {
	coreCadences,
	effectiveRegistrations as mergeRegistrations,
	evaluateCondition,
	type ConditionDecl,
	type EffectiveRegistration,
	type RegistrationDecl
} from "@serene-pub/sdk"
import { and, eq, inArray, or } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	baseKeyOf,
	declOfRow,
	presetChangesOfRows,
	registers,
	registrationScopeWhere,
	sessionRowsOf,
	type RegistrationRow
} from "$lib/server/pipelines/registrations/rows"
import { brokenReason } from "$lib/server/pipelines/registrations/fit"

/**
 * A preset registration that does not resolve, in the shape every surface
 * repeats it in (the receipt, the banner, the notice, the admin list).
 */
export interface PresetFallback {
	presetId: number
	/** The preset's name, because that is what an administrator recognises. */
	preset: string
	event: string
	/** The pipeline the preset still names. */
	bound: string
	/** Why it does not resolve, as a sentence. */
	reason: string
}

/** A registration left out because its pipeline is not published here. */
export interface StaleRegistration {
	registration: EffectiveRegistration
	reason: string
	/** What answers its event instead, when it was on an event; null = nothing serves. */
	fallback: string | null
}

/** What one session runs, with where each registration came from. */
export interface SessionRegistrations {
	sessionId: number
	genreId: string
	presetId: number | null
	presetName: string | null
	/** genre ⊕ preset ⊕ session — what runs. Published pipelines only; ordered (R24). */
	effective: EffectiveRegistration[]
	/** genre ⊕ preset — what the preset offers, before the session's own rows. */
	offered: EffectiveRegistration[]
	/** The genre's defaults alone. */
	defaults: EffectiveRegistration[]
	/** The rows each layer holds, as stored. */
	rows: { genre: RegistrationRow[]; preset: RegistrationRow[]; session: RegistrationRow[] }
	/** Every registration left out as stale, across the three merges. */
	stale: StaleRegistration[]
	/** The preset's stale event registrations, said out loud. */
	fallbacks: PresetFallback[]
}

/** The sentence a stale registration carries — the one the bindings' refusal said. */
export const unpublishedReason = (slug: string): string =>
	`'${slug}' is not published on this pub — it was removed, retired, or never installed here.`

const byOrder = (a: EffectiveRegistration, b: EffectiveRegistration) =>
	(a.order ?? 0) - (b.order ?? 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

const eventOfReg = (r: RegistrationDecl): string | null =>
	r.trigger.family === "event" ? r.trigger.event : null

/** The spec ids among `slugs` whose active version is published. */
export async function publishedSpecs(db: Db, slugs: Iterable<string>): Promise<Set<string>> {
	const list = [...new Set(slugs)].filter(Boolean)
	if (!list.length) return new Set()
	const rows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			versionId: schema.pipelineSpecVersions.id,
			status: schema.pipelineSpecVersions.status
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.id, schema.pipelineSpecs.activeVersionId)
		)
		.where(inArray(schema.pipelineSpecs.slug, list))
	return new Set(
		rows
			.filter((r) => r.activeVersionId === r.versionId && r.status === "published")
			.map((r) => r.slug)
	)
}

/**
 * One merge, judged: the published registrations, and for a stale one on an
 * event the layer `below`'s registrations on that event in its place (unless
 * another registration on the event still answers).
 */
function judged(
	list: readonly EffectiveRegistration[],
	below: readonly EffectiveRegistration[] | null,
	published: ReadonlySet<string>,
	stale: StaleRegistration[],
	broken: (r: EffectiveRegistration) => string | null = () => null
): EffectiveRegistration[] {
	// 🚧 A11: a registration the last fit check found broken is left out
	// exactly as an unpublished one is, its sentence the door's.
	const fits = (r: EffectiveRegistration) => published.has(r.pipeline) && !broken(r)
	const out = list.filter(fits)
	for (const r of list) {
		if (fits(r)) continue
		const event = eventOfReg(r)
		let fallback: string | null = null
		if (event && below && !out.some((x) => eventOfReg(x) === event)) {
			const subs = below.filter(
				(b) => eventOfReg(b) === event && published.has(b.pipeline) && !out.some((o) => o.key === b.key)
			)
			out.push(...subs)
			fallback = subs[0]?.pipeline ?? null
		} else if (event) {
			fallback = out.find((x) => eventOfReg(x) === event)?.pipeline ?? null
		}
		if (!stale.some((s) => s.registration.key === r.key))
			stale.push({
				registration: r,
				reason: (published.has(r.pipeline) ? broken(r) : null) ?? unpublishedReason(r.pipeline),
				fallback
			})
	}
	return out.sort(byOrder)
}

/**
 * 🚧 The one cadence swap an owner may make (R52, 2026-10-21; lane F1): a
 * routine that runs **after each turn** or **after each round** runs on
 * whichever of the two its session picks — "When it runs" on the routine's
 * row (Story's reckoning: default after each round). Any other cadence change
 * is a different registration (A8) or an administrator's options (R36).
 */
export const TURN_OR_ROUND_CADENCES: readonly string[] = Object.freeze([
	coreCadences.afterEachTurn.id,
	coreCadences.afterEachRound.id
])

/**
 * 🚧 A session's change of a routine's cadence: a change row whose
 * `cadence_options` is set merges over the effective routine's options
 * (R36: an administrator, in their own session), and one whose `trigger_ref`
 * names the other of after-each-turn / after-each-round runs it on that one
 * (R52, `TURN_OR_ROUND_CADENCES`) — either way the registration's identity
 * (its key, A8) is unchanged, so its values and its queue survive.
 */
export function withSessionCadences(
	effective: EffectiveRegistration[],
	sessionRows: readonly RegistrationRow[]
): EffectiveRegistration[] {
	const changed = sessionRows.filter((r) => !r.dropped && !r.triggerFamily && (r.cadenceOptions || r.triggerRef))
	if (!changed.length) return effective
	return effective.map((r) => {
		const row = r.trigger.family === "routine" ? changed.find((c) => c.key === r.key) : undefined
		if (!row || r.trigger.family !== "routine") return r
		const swap =
			row.triggerRef &&
			row.triggerRef !== r.trigger.cadence.id &&
			TURN_OR_ROUND_CADENCES.includes(row.triggerRef) &&
			TURN_OR_ROUND_CADENCES.includes(r.trigger.cadence.id)
				? row.triggerRef
				: null
		return {
			...r,
			trigger: {
				family: "routine",
				cadence: Object.freeze({
					id: swap ?? r.trigger.cadence.id,
					// The two take no options: a swap starts from none.
					options: Object.freeze({
						...(swap ? {} : r.trigger.cadence.options),
						...((row.cadenceOptions ?? {}) as Record<string, unknown>)
					})
				})
			}
		} as EffectiveRegistration
	})
}

/**
 * The three merges over a layer's rows. Pure apart from the published set handed in.
 * 🚧 `rulesActions` (PLAN-rulesets-functions D6): the session's ruleset's
 * action registrations (`rulesActionRegistrations`), in the genre's layer —
 * so a preset's or a session's change drops one by key like any other.
 */
export function mergeLayers(
	rows: { genre: readonly RegistrationRow[]; preset: readonly RegistrationRow[]; session: readonly RegistrationRow[] },
	published: ReadonlySet<string>,
	preset: { id: number; name: string } | null,
	rulesActions: readonly RegistrationDecl[] = []
): Pick<SessionRegistrations, "effective" | "offered" | "defaults" | "stale" | "fallbacks"> {
	// The genre's defaults: the projection's registrations, with any change
	// an administrator made at genre scope over them (A15 — "edit the genre's
	// defaults"), merged into one layer.
	const projected = [
		...rows.genre.filter(registers).map(declOfRow).filter((d): d is RegistrationDecl => !!d),
		...rulesActions
	]
	const genreChanges = rows.genre.filter((r) => !registers(r)).map((r) => ({ ...r, key: baseKeyOf(r.key) }))
	const genreDecls: RegistrationDecl[] = genreChanges.length
		? mergeRegistrations(projected, presetChangesOfRows(genreChanges)).map(
				({ origin: _o, changedBy: _c, ...d }) => d as RegistrationDecl
			)
		: projected
	const changes = presetChangesOfRows(rows.preset)
	const stale: StaleRegistration[] = []
	/** The broken verdict (A11) of the registering row a merge's registration came from. */
	const brokenIn =
		(...layers: Array<readonly RegistrationRow[]>) =>
		(r: EffectiveRegistration): string | null => {
			for (const list of layers) {
				const row = list.find((x) => registers(x) && x.key === r.key)
				if (row) return brokenReason(row.scopeKind, row.scopeRef, r.key)
			}
			return null
		}
	const defaults = judged(mergeRegistrations(genreDecls), null, published, stale, brokenIn(rows.genre))
	const offered = judged(
		mergeRegistrations(genreDecls, changes),
		defaults,
		published,
		stale,
		brokenIn(rows.preset, rows.genre)
	)
	const effective = withSessionCadences(
		judged(
			mergeRegistrations(genreDecls, changes, sessionRowsOf(rows.session)),
			offered,
			published,
			stale,
			brokenIn(rows.session, rows.preset, rows.genre)
		),
		rows.session
	)
	const fallbacks: PresetFallback[] = preset
		? stale
				.filter((s) => s.registration.origin === "preset" && eventOfReg(s.registration))
				.map((s) => ({
					presetId: preset.id,
					preset: preset.name,
					event: eventOfReg(s.registration)!,
					bound: s.registration.pipeline,
					reason: s.reason
				}))
		: []
	return { effective, offered, defaults, stale, fallbacks }
}

// ── Cache ───────────────────────────────────────────────────────────────────

let generation = 0
let cacheEnabled = !(typeof process !== "undefined" && process.env?.VITEST)
const cache = new WeakMap<
	object,
	Map<number, { gen: number; presetId: number | null; genreId: string; ruleset: string | null; value: SessionRegistrations }>
>()

const listeners = new Set<() => void>()

/** Hear every invalidation — a cache that reads registrations (the envoys') forgets with this one. */
export function onRegistrationsChanged(fn: () => void): void {
	listeners.add(fn)
}

/** Forget every cached resolution — a registration, preset, session or published spec changed. */
export function invalidateRegistrations(): void {
	generation++
	for (const fn of listeners) fn()
}

/** Tests: turn the cache on (it is off under Vitest). */
export function setRegistrationCacheEnabled(on: boolean): void {
	cacheEnabled = on
	generation++
}

/** The rows of the three layers for one (genre, preset, session). */
async function layerRows(
	db: Db,
	genreId: string,
	presetId: number | null,
	sessionId: number | null
): Promise<SessionRegistrations["rows"]> {
	const clauses = [registrationScopeWhere({ kind: "genre", genreId })]
	if (presetId != null) clauses.push(registrationScopeWhere({ kind: "preset", presetId }))
	if (sessionId != null) clauses.push(registrationScopeWhere({ kind: "session", sessionId }))
	const rows = (await db
		.select()
		.from(schema.registrations)
		.where(or(...clauses))
		.orderBy(schema.registrations.id)) as RegistrationRow[]
	return {
		genre: rows.filter((r) => r.scopeKind === "genre"),
		preset: rows.filter((r) => r.scopeKind === "preset"),
		session: rows.filter((r) => r.scopeKind === "session")
	}
}

const pipelinesOf = (rows: SessionRegistrations["rows"]): string[] =>
	[...rows.genre, ...rows.preset, ...rows.session].map((r) => r.specSlug).filter((s): s is string => !!s)

/** 🚧 A ruleset's action registrations (D6), by its id; none when it is not installed. */
async function rulesActionDeclsOf(rulesetId: string | null): Promise<RegistrationDecl[]> {
	if (!rulesetId) return []
	const { getRuleset } = await import("@serene-pub/sdk")
	const decl = getRuleset(rulesetId)
	if (!decl) return []
	const { rulesActionRegistrations } = await import("$lib/server/rulesets/rulesActions")
	return rulesActionRegistrations(decl)
}

/**
 * **The session's registrations** — the one resolver (D7). Null when the
 * session does not exist. Never throws on a stale row: it is left out and
 * said (`stale`, `fallbacks`).
 */
export async function effectiveRegistrations(db: Db, sessionId: number): Promise<SessionRegistrations | null> {
	const [session] = await db
		.select({
			genreId: schema.sessions.genreId,
			presetId: schema.sessions.presetId,
			primaryRuleset: schema.sessions.primaryRuleset
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return null
	const genreId = session.genreId ?? "core:genre/story"
	const presetId = session.presetId ?? null
	const ruleset = session.primaryRuleset ?? null

	const perDb = cacheEnabled ? (cache.get(db as object) ?? new Map()) : null
	if (perDb) {
		const hit = perDb.get(sessionId)
		if (hit && hit.gen === generation && hit.presetId === presetId && hit.genreId === genreId && hit.ruleset === ruleset)
			return hit.value
	}

	let preset: { id: number; name: string } | null = null
	if (presetId != null) {
		const [row] = await db
			.select({ id: schema.sessionPresets.id, name: schema.sessionPresets.name })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, presetId))
			.limit(1)
		preset = row ?? null
	}
	// A preset that was deleted leaves the session on its genre's defaults
	// ("sessions born from it keep running; they simply reference nothing").
	const rows = await layerRows(db, genreId, preset?.id ?? null, sessionId)
	// 🚧 D6: each invokable function of the session's ruleset, an action of the rules-action pipeline.
	const rulesActions = await rulesActionDeclsOf(ruleset)
	const published = await publishedSpecs(db, [...pipelinesOf(rows), ...rulesActions.map((r) => r.pipeline)])
	const value: SessionRegistrations = {
		sessionId,
		genreId,
		presetId: preset?.id ?? null,
		presetName: preset?.name ?? null,
		rows,
		...mergeLayers(rows, published, preset, rulesActions)
	}
	if (perDb) {
		perDb.set(sessionId, { gen: generation, presetId, genreId, ruleset, value })
		cache.set(db as object, perDb)
	}
	return value
}

/** A genre's defaults with a preset's changes — for a preset with no session in hand (the reconcile, the admin list). */
export async function presetRegistrations(
	db: Db,
	presetId: number
): Promise<Omit<SessionRegistrations, "sessionId"> | null> {
	const [preset] = await db
		.select({ id: schema.sessionPresets.id, name: schema.sessionPresets.name, genreId: schema.sessionPresets.genreId })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.id, presetId))
		.limit(1)
	if (!preset) return null
	const rows = await layerRows(db, preset.genreId, preset.id, null)
	const published = await publishedSpecs(db, pipelinesOf(rows))
	return {
		genreId: preset.genreId,
		presetId: preset.id,
		presetName: preset.name,
		rows,
		...mergeLayers(rows, published, { id: preset.id, name: preset.name })
	}
}

/** The genre's defaults alone — for a caller with no session and no preset in hand. */
export async function genreRegistrations(db: Db, genreId: string): Promise<EffectiveRegistration[]> {
	const rows = await layerRows(db, genreId, null, null)
	const published = await publishedSpecs(db, pipelinesOf(rows))
	return mergeLayers(rows, published, null).defaults
}

/** Registrations on one event, from a resolution — ordered (R24). */
export const onEvent = (regs: readonly EffectiveRegistration[], event: string): EffectiveRegistration[] =>
	regs.filter((r) => r.trigger.family === "event" && r.trigger.event === event)

/** The registration of one action identity, from a resolution. */
export const onAction = (regs: readonly EffectiveRegistration[], identity: string): EffectiveRegistration | undefined =>
	regs.find((r) => r.trigger.family === "action" && r.trigger.action === identity)

/**
 * Which of `regs` hold their `when` now (R31) over the session's published
 * values — read once, and only when one of them states a `when`.
 */
export async function whenHolds(
	db: Db,
	sessionId: number,
	regs: readonly EffectiveRegistration[],
	values?: unknown
): Promise<{ run: EffectiveRegistration[]; skipped: EffectiveRegistration[] }> {
	if (!regs.some((r) => r.when)) return { run: [...regs], skipped: [] }
	let doc = values
	if (doc === undefined) {
		const { publishedValues } = await import("$lib/server/pipelines/entities/publishedValues")
		doc = await publishedValues(db, sessionId)
	}
	const run: EffectiveRegistration[] = []
	const skipped: EffectiveRegistration[] = []
	for (const r of regs) (evaluateCondition(r.when as ConditionDecl | undefined, doc) ? run : skipped).push(r)
	return { run, skipped }
}

/**
 * **What runs on an event in a session** (R24): every registration on it
 * whose `when` holds, in order; those skipped; and the preset's fallback when
 * its registration on this event went stale.
 */
export async function registrationsOn(
	db: Db,
	sessionId: number,
	event: string,
	opts: { values?: unknown } = {}
): Promise<{ run: EffectiveRegistration[]; skipped: EffectiveRegistration[]; fallback?: PresetFallback }> {
	const resolved = await effectiveRegistrations(db, sessionId)
	if (!resolved) return { run: [], skipped: [] }
	const { run, skipped } = await whenHolds(db, sessionId, onEvent(resolved.effective, event), opts.values)
	const fallback = resolved.fallbacks.find((f) => f.event === event)
	return { run, skipped, ...(fallback ? { fallback } : {}) }
}

/**
 * 🚧 Pipeline → the one genre whose defaults register it (PLAN-layering D3).
 * A pipeline registrations mount carries no lock, so no `taxonomy.genre`;
 * what a list that mixes genres shows beside its name comes from here. A
 * pipeline two genres register is shared and absent from the map.
 */
export async function soleRegisteringGenres(db: Db): Promise<Map<string, string>> {
	const seen = new Map<string, Set<string>>()
	for (const g of await db
		.select({ slug: schema.registrations.specSlug, genreId: schema.registrations.scopeRef })
		.from(schema.registrations)
		.where(and(eq(schema.registrations.scopeKind, "genre"), eq(schema.registrations.dropped, false)))) {
		if (!g.slug) continue
		const set = seen.get(g.slug) ?? new Set<string>()
		set.add(g.genreId)
		seen.set(g.slug, set)
	}
	const out = new Map<string, string>()
	for (const [slug, set] of seen) if (set.size === 1) out.set(slug, [...set][0]!)
	return out
}
