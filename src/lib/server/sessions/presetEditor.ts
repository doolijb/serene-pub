/**
 * 🚧 **The admin preset editor's reads** (PLAN-layering §4, P4, R2, R4,
 * A5, A10; lane 7, 2026-10-21). A preset is one set of changes on its
 * genre's defaults (R2); this module answers what the editor shows and what
 * its pickers offer — every list derived, nothing typed:
 *
 *  · `presetEditorView` — **the genre's defaults** (its registrations and
 *    settings, read-only), **the preset's changes** as stored, the
 *    registrations a session on the preset would run, the genre's settings
 *    with the preset's value, lock and ask-at-start each, and the catalogue
 *    the "Add" picker builds a trigger from: the session's events (what
 *    each carries), the genre's actions, core's cadences with their options.
 *  · `registrationCandidates` — **the pipeline picker filtered by fit**
 *    (R4): every published pipeline, each with whether it fits the trigger
 *    and, when not, why in words (the SDK's `fitOf`); those that declare
 *    they suit the trigger first.
 *  · `conditionPropsOf` — **the condition picker** (A5): the derived
 *    properties of `sessionOf(genre)`, each with its type and members — no
 *    free-text paths anywhere.
 *  · `normalizePresetSettings` — a preset's settings as the editor sends
 *    them, checked against the genre's fields (a value, a lock, ask at
 *    start).
 *
 * Administrators only: the sockets that call these refuse anyone else.
 */
import { eq, inArray } from "drizzle-orm"
import {
	allCadences,
	coreCadences,
	conditionPropsOf as sdkConditionPropsOf,
	effectiveRegistrations,
	eventById,
	fitOf,
	getGenre,
	i18nText,
	sessionEvents,
	sessionOf,
	settingValueOf,
	suitsOf,
	type EffectiveRegistration,
	type FieldDecl,
	type RegistrationDecl,
	type SpecDocument,
	type Trigger
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"

type View = Sockets.SessionAdmin.PresetEditor.Response
type RegView = Sockets.SessionAdmin.PresetEditor.Registration
type SettingView = Sockets.SessionAdmin.PresetEditor.Setting
type Candidate = Sockets.SessionAdmin.RegistrationCandidates.Candidate

const text = (v: unknown, fallback = ""): string => i18nText(v as never) ?? (typeof v === "string" ? v : fallback)

/** One registration as the editor lists it — the trigger as stored, the pipeline by name. */
function regView(r: EffectiveRegistration | RegistrationDecl, names: Map<string, string>, origin?: string): RegView {
	const e = r as EffectiveRegistration
	return {
		key: r.key,
		trigger: r.trigger as unknown as Record<string, unknown>,
		pipeline: r.pipeline,
		pipelineName: names.get(r.pipeline) ?? r.pipeline,
		...(r.mode ? { mode: r.mode } : {}),
		...(r.allowStacking !== undefined ? { allowStacking: r.allowStacking } : {}),
		...(r.caps ? { caps: { ...r.caps } } : {}),
		...(r.when ? { when: r.when as unknown as Record<string, unknown> } : {}),
		...(r.values ? { values: r.values as unknown as Record<string, unknown> } : {}),
		...(r.order !== undefined ? { order: r.order } : {}),
		...(r.label ? { label: text(r.label) } : {}),
		origin: (origin ?? e.origin ?? "genre") as RegView["origin"]
	}
}

/** Each pipeline's name, by slug. */
async function pipelineNames(db: Db, slugs: Iterable<string>): Promise<Map<string, string>> {
	const want = [...new Set(slugs)].filter(Boolean)
	const out = new Map<string, string>()
	if (!want.length) return out
	for (const r of await db
		.select({ slug: schema.pipelineSpecs.slug, name: schema.pipelineSpecs.name })
		.from(schema.pipelineSpecs)
		.where(inArray(schema.pipelineSpecs.slug, want)))
		out.set(r.slug, r.name)
	return out
}

/** A FieldDecl's control, as the editor draws a setting. */
function controlOf(decl: FieldDecl): Pick<SettingView, "control" | "members" | "min" | "max"> {
	const d = decl as FieldDecl & {
		of?: readonly string[]
		members?: ReadonlyArray<{ key: string; label?: unknown }>
		list?: boolean
	}
	const members = d.members?.length
		? d.members.map((m) => ({ key: m.key, label: text(m.label, m.key) }))
		: d.of?.map((k) => ({ key: k, label: k }))
	const bounds = { ...(typeof d.min === "number" ? { min: d.min } : {}), ...(typeof d.max === "number" ? { max: d.max } : {}) }
	if (d.list || d.type === "string[]") return { control: "list", ...(members ? { members } : {}) }
	switch (d.type) {
		case "boolean":
		case "string":
		case "text":
			return { control: d.type }
		case "integer":
		case "number":
			return { control: d.type, ...bounds }
		case "enum":
			return { control: "enum", ...(members ? { members } : {}) }
		default:
			return { control: "json" }
	}
}

type Catalogue = Sockets.SessionAdmin.PresetEditor.Catalogue

/**
 * A cadence option's control. A JSON option (an event's `where`, a value's
 * `when`, a Schedule's `at`, the jump ceiling) is no field a person types:
 * `json`, which the editor leaves alone. (An event to listen to is a choice
 * among the session's events — `cadenceCatalogue` makes it one.)
 */
export function cadenceOptionControl(decl: FieldDecl): Pick<SettingView, "control" | "members" | "min" | "max"> {
	const d = decl as FieldDecl & { format?: string }
	if (d.format === "json" || d.type === "object") return { control: "json" }
	return controlOf(decl)
}

/** The cadences an administrator may register a routine on, with their options. */
function cadenceCatalogue(events: Catalogue["events"]): Catalogue["cadences"] {
	return allCadences().map((c) => ({
		id: c.id,
		name: text(c.i18n?.name, c.id),
		...(text(c.i18n?.description) ? { description: text(c.i18n?.description) } : {}),
		...(c.clock ? { clock: c.clock } : {}),
		options: Object.fromEntries(
			Object.entries(c.options ?? {}).map(([k, decl]) => [
				k,
				{
					label: text((decl as { label?: unknown }).label, k),
					...(k === "event" && c.id === coreCadences.onEvent.id
						? { control: "enum" as const, members: events.map((e) => ({ key: e.id, label: e.name })) }
						: cadenceOptionControl(decl as FieldDecl)),
					...((decl as { default?: unknown }).default !== undefined ? { default: (decl as { default?: unknown }).default } : {})
				}
			])
		)
	}))
}

/** The events a registration may listen to: core's session events, and any the layers already name. */
function eventCatalogue(also: readonly string[]): Catalogue["events"] {
	const ids = [...new Set([...Object.values(sessionEvents), ...also])]
	return ids
		.map((id) => {
			const e = eventById(id)
			return {
				id,
				name: text(e?.name, id.replace(/^[^:]+:event\//, "").replace(/@\d+$/, "").replace(/-/g, " ")),
				carries: [...((e?.carries as readonly string[] | undefined) ?? ["session"])]
			}
		})
		.sort((a, b) => a.name.localeCompare(b.name))
}

/** **The preset editor's view** of one preset — see the module note. Null when there is no such preset. */
export async function presetEditorView(db: Db, presetId: number): Promise<View | null> {
	const [preset] = await db.select().from(schema.sessionPresets).where(eq(schema.sessionPresets.id, presetId)).limit(1)
	if (!preset) return null
	const genreId = preset.genreId
	const { ensureCoreGenres } = await import("$lib/server/pipelines/registrations/genreDefaults")
	await ensureCoreGenres()
	const { genreRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const { presetChangesOfPreset } = await import("$lib/server/pipelines/registrations/presetRows")
	const defaults = (await genreRegistrations(db, genreId)) as EffectiveRegistration[]
	const changes = await presetChangesOfPreset(db, presetId)
	const effective = effectiveRegistrations(defaults as RegistrationDecl[], changes)
	const names = await pipelineNames(db, [
		...defaults.map((r) => r.pipeline),
		...(changes.register ?? []).map((r) => r.pipeline)
	])

	// The genre's settings: declaration < the genre's defaults < this preset.
	const { getSessionGenre } = await import("$lib/server/pipelines/entities/sessionGenres")
	const { genreLayerValues, rulesFieldsOf } = await import("$lib/server/sessions/exposure")
	const genre = await getSessionGenre(db, genreId).catch(() => null)
	const declared = ((genre?.shape as { fields?: Record<string, FieldDecl> } | undefined)?.fields ?? {}) as Record<string, FieldDecl>
	const fields: Record<string, FieldDecl> = { ...declared, ...rulesFieldsOf(genreId) }
	const genreLayer = await genreLayerValues(genreId, genre?.settings)
	const presetLayer = (preset.settings && typeof preset.settings === "object" && !Array.isArray(preset.settings)
		? preset.settings
		: {}) as Record<string, unknown>
	const settings: SettingView[] = Object.entries(fields).map(([key, decl]) => {
		const g = key in genreLayer ? settingValueOf(genreLayer[key] as never) : null
		const p = key in presetLayer ? settingValueOf(presetLayer[key] as never) : null
		const d = decl as FieldDecl & { label?: unknown; description?: unknown; default?: unknown; advanced?: boolean }
		return {
			key,
			label: text(d.label, key),
			...(text(d.description) ? { description: text(d.description) } : {}),
			...controlOf(decl),
			declared: d.default,
			...(g ? { genre: { value: g.value, ...(g.lock ? { lock: true as const } : {}), ...(g.askAtStart ? { askAtStart: true as const } : {}) } } : {}),
			...(p ? { preset: { value: p.value, ...(p.lock ? { lock: true as const } : {}), ...(p.askAtStart ? { askAtStart: true as const } : {}) } } : {}),
			reach: (decl.reach ?? "owner") as "owner" | "admin",
			...(decl.fixedAtStart ? { fixedAtStart: true as const } : {}),
			...(key === "ruleset" || key === "rigour" ? { rules: true as const } : {}),
			...(d.advanced ? { advanced: true as const } : {})
		}
	})

	const { listGenreActions } = await import("$lib/server/pipelines/entities/sessionGenres")
	const actions = await listGenreActions(db, genreId).catch(() => [])
	const named = [...defaults, ...(changes.register ?? [])]
		.map((r) => (r.trigger.family === "event" ? r.trigger.event : null))
		.filter((e): e is string => !!e)
	const events = eventCatalogue(named)
	// 🚧 R56: what each registration's pipeline needs that nothing here
	// serves, and the preset's recommendations — an administrator sees both.
	const { unservedPipelines, presetRecommendations, disabledWhenUnserved } = await import(
		"$lib/server/pipelines/registrations/unserved"
	)
	const unserved = await unservedPipelines(db, [...defaults, ...effective].map((r) => r.pipeline))
	const marked = (view: RegView, r: { trigger: EffectiveRegistration["trigger"]; pipeline: string }): RegView => {
		const missing = unserved.get(r.pipeline)
		return missing && disabledWhenUnserved(r) ? { ...view, unavailable: missing.sentence } : view
	}
	const recommendations = (await presetRecommendations(db, [presetId])).get(presetId)
	return {
		presetId,
		genreId,
		genreName: genre?.name ?? genreId,
		defaults: defaults.map((r) => marked(regView(r, names, "genre"), r)),
		changes: changes as unknown as Sockets.SessionAdmin.PresetRegistrations,
		effective: effective.map((r) => marked(regView(r, names), r)),
		...(recommendations ? { recommendations } : {}),
		settings,
		catalogue: {
			events,
			actions: actions.map((a) => ({
				identity: `${a.specSlug}#${a.key}`,
				name: a.name,
				specSlug: a.specSlug,
				...(a.description ? { description: a.description } : {})
			})),
			cadences: cadenceCatalogue(events)
		}
	}
}

/**
 * **The pipeline picker, filtered by fit** (R4, A11): every published
 * pipeline, each with whether it fits `trigger` and why not in words —
 * those that state they suit the trigger first, then those that fit, then
 * the rest. The registration door judges the save again in full.
 */
export async function registrationCandidates(db: Db, trigger: Trigger): Promise<Candidate[]> {
	const rows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			name: schema.pipelineSpecs.name,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			status: schema.pipelineSpecVersions.status
		})
		.from(schema.pipelineSpecs)
		.innerJoin(schema.pipelineSpecVersions, eq(schema.pipelineSpecVersions.id, schema.pipelineSpecs.activeVersionId))
	const published = rows.filter((r) => r.status === "published")
	const { publishedDocuments } = await import("$lib/server/pipelines/registrations/door")
	const docs = await publishedDocuments(db, published.map((r) => r.slug))
	const triggerId =
		trigger.family === "event" ? trigger.event : trigger.family === "action" ? trigger.action : trigger.family === "routine" ? trigger.cadence.id : ""
	const out: Candidate[] = []
	for (const r of published) {
		const doc = docs.get(r.slug) as SpecDocument | null | undefined
		if (!doc) continue
		let fit: { ok: boolean; sentence?: string }
		try {
			const f = fitOf(doc, trigger)
			fit = f.ok ? { ok: true } : { ok: false, sentence: f.sentence }
		} catch (err) {
			fit = { ok: false, sentence: `${r.name} could not be read: ${(err as Error).message}` }
		}
		const suits = trigger.family === "event" && suitsOf(doc as never).includes(triggerId)
		out.push({
			slug: r.slug,
			name: r.name,
			fits: fit.ok,
			...(fit.ok ? {} : { reason: fit.sentence ?? "It does not fit." }),
			...(suits ? { suits: true as const } : {})
		})
	}
	const rank = (c: Candidate) => (c.suits && c.fits ? 0 : c.fits ? 1 : 2)
	return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/**
 * **The condition picker** (A5): every property `sessionOf(genre)` derives
 * — the genre's slots and sheets, its fields, the common vocabulary, the
 * host's facts — as a name, its stored path, its type and an enum's
 * members. Empty for a genre this pub cannot read.
 */
export async function conditionPropsFor(genreId: string): Promise<Sockets.Sessions.ConditionProps.Prop[]> {
	const { ensureCoreGenres } = await import("$lib/server/pipelines/registrations/genreDefaults")
	await ensureCoreGenres()
	const genre = getGenre(genreId)
	if (!genre) return []
	const { rulesets } = await import("@serene-pub/core-catalog")
	const view = sessionOf(genre, { vocabularies: [rulesets.common] } as never)
	return sdkConditionPropsOf(view).map(({ name, prop }) => ({
		name,
		path: prop.path,
		type: prop.type,
		...(prop.members?.length ? { members: [...prop.members] } : {})
	}))
}

/**
 * A preset's settings as the editor sends them — `{ key: value }` or
 * `{ key: { value, lock?, askAtStart? } }` — checked against the genre's
 * fields (and the rules it plays). Refused in a sentence naming the key.
 */
export async function normalizePresetSettings(
	db: Db,
	genreId: string,
	raw: unknown
): Promise<{ ok: true; settings: Record<string, unknown> | null } | { ok: false; error: string }> {
	if (raw === null) return { ok: true, settings: null }
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "A preset's settings are a set of named values." }
	const { getSessionGenre } = await import("$lib/server/pipelines/entities/sessionGenres")
	const { rulesFieldsOf } = await import("$lib/server/sessions/exposure")
	const genre = await getSessionGenre(db, genreId).catch(() => null)
	const declared = ((genre?.shape as { fields?: Record<string, FieldDecl> } | undefined)?.fields ?? {}) as Record<string, FieldDecl>
	const fields = { ...declared, ...rulesFieldsOf(genreId) }
	const out: Record<string, unknown> = {}
	for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
		if (!(key in fields)) return { ok: false, error: `'${key}' is not one of this genre's settings.` }
		const read = settingValueOf(v as never)
		try {
			if (JSON.stringify(read.value ?? null).length > 20000) throw new Error()
		} catch {
			return { ok: false, error: `${key}'s value cannot be stored.` }
		}
		if (read.askAtStart && (fields[key]!.reach ?? "owner") !== "owner")
			return { ok: false, error: `'${key}' never reaches a session's owner, so the start form cannot ask it.` }
		out[key] =
			read.lock || read.askAtStart
				? { value: read.value, ...(read.lock ? { lock: true } : {}), ...(read.askAtStart ? { askAtStart: true } : {}) }
				: read.value
	}
	return { ok: true, settings: Object.keys(out).length ? out : null }
}

/**
 * **Where a pipeline runs** (R2, R38): the genres whose defaults register it
 * (registering rows at genre scope — an administrator's `admin:` value edits
 * are not registrations), and every preset that adds it, or drops or changes
 * one of those registrations — each with its trigger as stored.
 */
export async function registeredInOf(db: Db, slug: string): Promise<Sockets.Pipelines.RegisteredIn.Place[]> {
	const { triggerOfRow, GENRE_CHANGE_PREFIX } = await import("$lib/server/pipelines/registrations/rows")
	const rows = await db
		.select()
		.from(schema.registrations)
		.where(inArray(schema.registrations.scopeKind, ["genre", "preset"]))
	const genreRows = rows.filter(
		(r) => r.scopeKind === "genre" && r.specSlug === slug && !!r.triggerFamily && !r.key.startsWith(GENRE_CHANGE_PREFIX)
	)
	const genreKeys = new Set(genreRows.map((r) => r.key))
	const presetRows = rows.filter((r) => r.scopeKind === "preset" && (r.specSlug === slug || genreKeys.has(r.key)))
	const presetIds = [...new Set(presetRows.map((r) => r.presetId).filter((v): v is number => v != null))]
	const presets = presetIds.length
		? await db
				.select({ id: schema.sessionPresets.id, name: schema.sessionPresets.name, genreId: schema.sessionPresets.genreId })
				.from(schema.sessionPresets)
				.where(inArray(schema.sessionPresets.id, presetIds))
		: []
	const { getSessionGenre } = await import("$lib/server/pipelines/entities/sessionGenres")
	const genreNames = new Map<string, string>()
	const nameOf = async (genreId: string) => {
		if (!genreNames.has(genreId))
			genreNames.set(genreId, (await getSessionGenre(db, genreId).catch(() => null))?.name ?? genreId)
		return genreNames.get(genreId)!
	}
	const out: Sockets.Pipelines.RegisteredIn.Place[] = []
	for (const r of genreRows)
		out.push({
			scope: "genre",
			genreId: r.scopeRef,
			genreName: await nameOf(r.scopeRef),
			key: r.key,
			trigger: (triggerOfRow(r) ?? {}) as unknown as Record<string, unknown>
		})
	for (const r of presetRows) {
		const p = presets.find((x) => x.id === r.presetId)
		if (!p) continue
		out.push({
			scope: "preset",
			genreId: p.genreId,
			genreName: await nameOf(p.genreId),
			presetId: p.id,
			presetName: p.name,
			key: r.key,
			trigger: (triggerOfRow(r) ?? {}) as unknown as Record<string, unknown>,
			...(r.dropped ? { dropped: true as const } : {})
		})
	}
	return out
}
