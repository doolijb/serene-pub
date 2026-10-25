/**
 * **In-app genres** (PLAN-pipeline-canvas-and-genre-authoring §6.1): a genre
 * an administrator makes on this pub by copying a listed one, owned by
 * neither core nor a plugin. Its `origin` is `pub`.
 *
 * A genre has no table — it is its create spec's active version row — so a
 * copy is a set of copied documents: the create document always, and with
 * `scope: 'all'` every active published spec whose inlet lock names the
 * source genre. Each copy is re-addressed (`id`, the lock, `taxonomy.genre`,
 * every contributed action's `genre`, author presets' `owner`) so the copy's
 * bindings validate against the new genre and its slash names land under the
 * new owner's namespace instead of colliding with the source's. Then one
 * default preset, the source's default layout under origin `pub`, and the
 * registry entry.
 *
 * The registry: stats, sheets and omitWidgets live only in the SDK's
 * in-process registry (`getGenre`). An in-app genre takes its source's
 * declaration with its own id and display text, held in a map of its own —
 * never in `pluginGenres.ts`'s `held`, which `syncPluginGenres` withdraws for
 * every id that is not an installed plugin — and re-registered at boot by
 * `registerPubGenres`, which reads the source off the create version's
 * `derived_from_spec_version_id`.
 *
 * Kept out of the socket handler file so `sockets/sessionAdmin.ts` stays a
 * handler file.
 */

import { isDefaultSave } from "$lib/server/pipelines/entities/presetBindings"
import {
	SAVE_MESSAGE_SPEC_ID,
	_registerPackageGenre,
	_withdrawGenre,
	declareHostState,
	getGenre,
	hostStateFor,
	sessionEvents,
	type GenreDecl,
	type SettingsSchema,
	type SpecDocument
} from "@serene-pub/sdk"
import { and, asc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	assertInstallSlashNamesFree,
	loadDocument,
	saveDocument
} from "$lib/server/pipelines/boot/store"
import { reconcileConfigs } from "$lib/server/pipelines/config/named"
import { listSessionGenres } from "$lib/server/pipelines/entities/sessionGenres"
import { parseActionIdentity } from "$lib/shared/actions/identity"
import { AUTHORED_OWNER_LABEL } from "$lib/shared/widgets/authoredOwner"

/** The owner slug grammar `pipelines:fork` asks for. */
export const OWNER_SLUG = /^[a-z0-9]+([.-][a-z0-9]+)*$/
/** The genre's own name: lowercase words joined by single hyphens. */
export const GENRE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Who brought a genre. */
export type GenreOrigin = "core" | "plugin" | "pub"

/** A refusal meant for the admin, as a sentence. */
export class PubGenreRefusal extends Error {}

const refuse = (sentence: string): never => {
	throw new PubGenreRefusal(sentence)
}

/** `acme.lab:genre/quest` → `acme.lab`. */
const ownerOf = (id: string): string => id.slice(0, Math.max(0, id.indexOf(":")))

/** `core:genre/story` → `adventure`. */
const genreNameOf = (genreId: string): string =>
	genreId.slice(genreId.indexOf("genre/") + "genre/".length)

/** `core:spec/story-respond` → `adventure-respond`. */
const specTailOf = (slug: string): string => {
	const i = slug.indexOf("spec/")
	return i >= 0 ? slug.slice(i + "spec/".length) : slug.slice(slug.indexOf(":") + 1)
}

/* ── the registry ───────────────────────────────────────────────────── */

/**
 * In-app genre id → source genre id. On `globalThis` for the reason
 * `pluginGenres.ts` gives: a Vite SSR reload re-evaluates this module while
 * the SDK's registry keeps its entries.
 */
const KEY = Symbol.for("serene-pub.pubGenres")
const pubHeld = ((globalThis as Record<symbol, unknown>)[KEY] ??= new Map<
	string,
	string | null
>()) as Map<string, string | null>

/** The in-app genres registered in this process, with their sources (tests, diagnostics). */
export function pubGenreSources(): ReadonlyMap<string, string | null> {
	return pubHeld
}

/**
 * Register one in-app genre: its source's declaration (`getGenre(from)`)
 * under the new id and display text, so stats, sheets and omitWidgets follow
 * the copy. A source the registry does not hold (a transitional genre) gives
 * a declaration of the stated parts alone. Replaces a previous registration.
 */
export function registerPubGenre(
	newId: string,
	from: string | null,
	props: {
		name: string
		description?: string
		family?: string
		shape?: unknown
		events?: Record<string, { required?: boolean; open?: boolean }>
	}
): GenreDecl {
	const source = from ? getGenre(from) : undefined
	const decl = {
		...(source ?? {}),
		id: newId,
		name: props.name,
		description: props.description ?? "",
		family: props.family ?? source?.family ?? "",
		...(props.shape !== undefined ? { shape: props.shape } : {}),
		events: props.events ?? source?.events ?? {}
	} as unknown as GenreDecl
	const registered = _registerPackageGenre(ownerOf(newId), decl)
	// 🚧 RF fix 8: a copy keeps what the host keeps for its source's tools —
	// the Lair's whisper and direction, the crawl's standing orders — so its
	// pipelines write what they wrote. Never attributes; the place follows
	// the copy's scenes on its own.
	if (from) {
		const kept = hostStateFor(from).filter((d) => d.genres.length)
		if (kept.length) declareHostState(kept.map((d) => ({ slot: d.slot, role: d.role, genres: [newId], ...(d.owners ? { owners: d.owners } : {}) })))
	}
	pubHeld.set(newId, from)
	return registered
}

/** Take one in-app genre back out of the registry. */
export function withdrawPubGenre(id: string): void {
	if (!pubHeld.has(id)) return
	_withdrawGenre(id)
	pubHeld.delete(id)
}

/* ── reads ──────────────────────────────────────────────────────────── */

interface SpecVersionRow {
	specId: number
	slug: string
	name: string | null
	sourcePluginId: number | null
	activeVersionId: number | null
	versionId: number
	status: string
	inputGenre: string | null
	inputEvent: string | null
	genre: Record<string, any> | null
	derivedFromSpecVersionId: number | null
}

async function activeSpecRows(db: Db): Promise<SpecVersionRow[]> {
	const rows = await db
		.select({
			specId: schema.pipelineSpecs.id,
			slug: schema.pipelineSpecs.slug,
			name: schema.pipelineSpecs.name,
			sourcePluginId: schema.pipelineSpecs.sourcePluginId,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			versionId: schema.pipelineSpecVersions.id,
			status: schema.pipelineSpecVersions.status,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			genre: schema.pipelineSpecVersions.genre,
			derivedFromSpecVersionId: schema.pipelineSpecVersions.derivedFromSpecVersionId
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.id, schema.pipelineSpecs.activeVersionId)
		)
		.orderBy(asc(schema.pipelineSpecs.id))
	const mounted = await registeredMounts(db)
	return (rows as SpecVersionRow[])
		.filter((r) => r.activeVersionId === r.versionId)
		.map((r) => {
			// 🚧 A pipeline mounted by registrations has no lock (D3): its genre
			// and event are the genre's defaults' that register it (D7).
			if (r.inputGenre) return r
			const m = mounted.get(r.slug)
			return m ? { ...r, inputGenre: m.genreId, inputEvent: r.inputEvent ?? m.event } : r
		})
}

/**
 * 🚧 Which genre's defaults register each pipeline, and on which event — a
 * `session-created` registration first, so a create pipeline reads as one.
 * The first genre wins for a pipeline several register (core's save, which
 * the copies leave to core).
 */
async function registeredMounts(db: Db): Promise<Map<string, { genreId: string; event: string | null }>> {
	const rows = await db
		.select({
			genreId: schema.registrations.scopeRef,
			specSlug: schema.registrations.specSlug,
			family: schema.registrations.triggerFamily,
			ref: schema.registrations.triggerRef
		})
		.from(schema.registrations)
		.where(and(eq(schema.registrations.scopeKind, "genre"), eq(schema.registrations.dropped, false)))
		.orderBy(asc(schema.registrations.id))
	const out = new Map<string, { genreId: string; event: string | null }>()
	for (const r of rows) {
		if (!r.specSlug) continue
		const event = r.family === "event" ? r.ref : null
		const had = out.get(r.specSlug)
		if (!had) out.set(r.specSlug, { genreId: r.genreId, event })
		else if (had.genreId === r.genreId && event === sessionEvents.sessionCreated) had.event = event
	}
	return out
}

const isCreateRow = (r: SpecVersionRow) =>
	r.inputEvent === sessionEvents.sessionCreated && !!r.inputGenre

/** Every `plugins.plugin_id` on this pub, core's row included. */
async function pluginIds(db: Db): Promise<Set<string>> {
	const rows = await db.select({ pluginId: schema.plugins.pluginId }).from(schema.plugins)
	return new Set((rows as Array<{ pluginId: string }>).map((r) => r.pluginId))
}

/**
 * Whose a genre is: `core` for core's namespace; `plugin` when its create
 * spec came from a package or its owner segment is an installed plugin;
 * otherwise `pub` — made on this pub.
 */
export async function genreOrigin(db: Db, genreId: string): Promise<GenreOrigin> {
	const owner = ownerOf(genreId)
	if (owner === "core") return "core"
	const create = (await activeSpecRows(db)).find(
		(r) => isCreateRow(r) && r.inputGenre === genreId
	)
	if (!create || create.sourcePluginId != null) return "plugin"
	if ((await pluginIds(db)).has(owner)) return "plugin"
	return "pub"
}

/* ── create ─────────────────────────────────────────────────────────── */

export interface CreatePubGenreParams {
	ownerSlug: string
	name: string
	label: string
	description?: string
	family?: string
	from: string
	scope: "all" | "create"
}

/** A display string out of a stored I18n value. */
const text = (v: unknown): string =>
	typeof v === "string"
		? v
		: v && typeof v === "object" && typeof (v as { en?: unknown }).en === "string"
			? (v as { en: string }).en
			: ""

/** Re-address one copied document under the new genre (§6.1, "per document"). */
function rewriteDocument(
	source: SpecDocument,
	newSlug: string,
	newGenreId: string,
	owner: string,
	sourceOwner: string
): SpecDocument {
	const doc = structuredClone(source) as SpecDocument & Record<string, any>
	doc.id = newSlug
	// ⏳ A lock-era document keeps a lock and names its genre in places; a
	// document mounted by registrations names none (D3) — its genre is the
	// registrations the copy writes, never a field added here.
	if (doc.input) doc.input = { ...doc.input, genre: newGenreId }
	if (doc.taxonomy && typeof doc.taxonomy === "object" && "genre" in (doc.taxonomy as object))
		doc.taxonomy = { ...(doc.taxonomy as object), genre: newGenreId }
	const contributes = doc.contributes as { actions?: unknown } | undefined
	if (contributes && Array.isArray(contributes.actions))
		contributes.actions = contributes.actions.map((a: Record<string, unknown>) => {
			const next: Record<string, unknown> = { ...a, ...(a.genre !== undefined ? { genre: newGenreId } : {}) }
			// A stated slash name lives under its spec's namespace; the
			// derived one (`<owner>.<key>`) follows the new id by itself.
			if (typeof a.slash === "string") {
				if (sourceOwner !== "core" && a.slash.startsWith(`${sourceOwner}.`))
					next.slash = `${owner}.${a.slash.slice(sourceOwner.length + 1)}`
				else delete next.slash
			}
			return next
		})
	if (Array.isArray(doc.presets))
		doc.presets = doc.presets.map((p) =>
			p.owner !== undefined ? { ...p, owner } : p
		)
	return doc
}

/**
 * `sessionGenres:create`'s work: copy `from` into `<owner>:genre/<name>`.
 * Throws a `PubGenreRefusal` sentence for anything the admin can fix; on a
 * failure after the first document landed, what this call wrote is removed.
 */
export async function createPubGenre(
	db: Db,
	params: CreatePubGenreParams
): Promise<{ genreId: string }> {
	const owner = String(params.ownerSlug ?? "").trim()
	const name = String(params.name ?? "").trim()
	const label = String(params.label ?? "").trim()
	const scope = params.scope === "create" ? "create" : "all"

	if (owner === "core")
		refuse("'core' is Serene Pub's own name — choose an owner name of your own.")
	if (!OWNER_SLUG.test(owner))
		refuse(
			"The owner name takes lowercase letters and digits, joined by single dots or hyphens."
		)
	if (owner === AUTHORED_OWNER_LABEL || owner.startsWith(`${AUTHORED_OWNER_LABEL}.`))
		refuse(`'${AUTHORED_OWNER_LABEL}' is reserved for authored components — choose another owner name.`)
	if ((await pluginIds(db)).has(owner))
		refuse(
			`'${owner}' is an installed plugin's name — a genre made here needs an owner name no plugin uses.`
		)
	if (!GENRE_NAME.test(name))
		refuse("The genre name takes lowercase letters and digits, joined by single hyphens.")
	if (!label) refuse("A genre needs a label people will see.")

	const genreId = `${owner}:genre/${name}`
	const listed = await listSessionGenres(db)
	if (listed.some((g) => g.genreId === genreId))
		refuse(`There is already a genre called '${genreId}'.`)
	const source = listed.find((g) => g.genreId === params.from)
	if (!source) refuse(`There is no genre called '${params.from}' to start from.`)

	const rows = await activeSpecRows(db)
	// 🚧 The source genre's pipelines are the ones its defaults register
	// (PLAN-layering D7) — ⏳ or, for a lock-era package genre, its locks'.
	const { genreRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const sourceRegs = await genreRegistrations(db, params.from)
	const registered = new Set(sourceRegs.map((r) => r.pipeline))
	const createSlug = sourceRegs.find(
		(r) => r.trigger.family === "event" && r.trigger.event === sessionEvents.sessionCreated
	)?.pipeline
	const ofSource = (r: SpecVersionRow) => r.inputGenre === params.from || registered.has(r.slug)
	const create =
		rows.find((r) => isCreateRow(r) && r.inputGenre === params.from && r.status === "published") ??
		rows.find((r) => r.slug === createSlug && r.status === "published")
	if (!create)
		refuse(`'${params.from}' has no published create pipeline to copy.`)
	// A plugin's add-on spec locked to the source genre (a reply variant, an
	// action pack) is the plugin's, not the genre's: only the specs that came
	// with the genre's own create spec are copied. Core's shared pipelines
	// (the default save) serve every genre and are registered, never copied.
	const copied = [
		create!,
		...(scope === "all"
			? rows.filter(
					(r) =>
						r !== create &&
						r.status === "published" &&
						ofSource(r) &&
						r.sourcePluginId === create!.sourcePluginId &&
						r.slug !== SAVE_MESSAGE_SPEC_ID
				)
			: [])
	]

	const sourceGenreName = genreNameOf(params.from)
	const sourceOwner = ownerOf(params.from)
	const slugMap = new Map<string, string>()
	for (const r of copied) {
		const tail = specTailOf(r.slug)
		const what = tail.startsWith(`${sourceGenreName}-`)
			? tail.slice(sourceGenreName.length + 1)
			: tail
		const newSlug = `${owner}:spec/${name}-${what}`
		if ([...slugMap.values()].includes(newSlug))
			refuse(`Two of '${params.from}''s pipelines would both be copied to '${newSlug}'.`)
		slugMap.set(r.slug, newSlug)
	}
	const taken = await db
		.select({ slug: schema.pipelineSpecs.slug })
		.from(schema.pipelineSpecs)
		.where(inArray(schema.pipelineSpecs.slug, [...slugMap.values()]))
	if (taken.length)
		refuse(`There is already a pipeline called '${(taken[0] as { slug: string }).slug}'.`)

	const sourceDisplay = source!.name
	const displayName = (specName: string | null, slug: string) => {
		const n = specName ?? slug
		return sourceDisplay && n.includes(sourceDisplay)
			? n.split(sourceDisplay).join(label)
			: `${label} · ${n}`
	}

	const batch = new Set(slugMap.values())
	const written: string[] = []
	const rollback = async () => {
		if (written.length)
			await db.delete(schema.pipelineSpecs).where(inArray(schema.pipelineSpecs.slug, written))
		await db.delete(schema.sessionPresets).where(eq(schema.sessionPresets.genreId, genreId))
		await db
			.delete(schema.registrations)
			.where(and(eq(schema.registrations.scopeKind, "genre"), eq(schema.registrations.scopeRef, genreId)))
		await db
			.delete(schema.sessionLayoutPresets)
			.where(
				and(
					eq(schema.sessionLayoutPresets.genreId, genreId),
					eq(schema.sessionLayoutPresets.origin, "pub")
				)
			)
		withdrawPubGenre(genreId)
	}

	try {
		// The create document first: envoy checks judge the others against
		// the published create spec of their genre.
		const saved: Array<{ slug: string; specId: number; specVersionId: number }> = []
		for (const r of copied) {
			const newSlug = slugMap.get(r.slug)!
			const doc = rewriteDocument(
				await loadDocument(db, r.versionId),
				newSlug,
				genreId,
				owner,
				sourceOwner
			) as SpecDocument & Record<string, any>
			if (r === create) {
				const block = (doc.genre ?? {}) as Record<string, unknown>
				doc.genre = {
					...block,
					name: label,
					description: params.description?.trim() ?? text(block.description),
					family: params.family?.trim() || (typeof block.family === "string" ? block.family : "")
				}
			}
			const s = await saveDocument(db, doc, {
				publish: true,
				name: displayName(r.name, r.slug),
				batch
			})
			written.push(newSlug)
			await db
				.update(schema.pipelineSpecVersions)
				.set({ derivedFromSpecVersionId: r.versionId })
				.where(eq(schema.pipelineSpecVersions.id, s.specVersionId))
			saved.push({ slug: newSlug, specId: s.specId, specVersionId: s.specVersionId })
		}
		await assertInstallSlashNamesFree(db)
		for (const s of saved) await reconcileConfigs(db, s.specId, s.specVersionId, s.slug)

		await insertDefaultPreset(db, params.from, genreId, label, slugMap, new Set(
			rows.filter((r) => ofSource(r)).map((r) => r.slug)
		))
		// 🚧 The new genre's defaults (D7): the source's registrations, each on
		// the copy of its pipeline where one was made — an action's identity
		// follows its spec. Origin `pub`: the boot's projection leaves them be.
		{
			const { registrationKeyOf } = await import("@serene-pub/sdk")
			const { rowOfDecl } = await import("$lib/server/pipelines/registrations/rows")
			const { replaceRows } = await import("$lib/server/pipelines/registrations/write")
			// Only what was copied — and core's save, which serves every genre:
			// a source pipeline left behind answers for the source genre alone.
			const kept = sourceRegs.filter(
				(r) => slugMap.has(r.pipeline) || (r.trigger.family === "event" && isDefaultSave(r.trigger.event, r.pipeline))
			)
			const remapped = kept.map((r) => {
				const pipeline = slugMap.get(r.pipeline) ?? r.pipeline
				let trigger = r.trigger
				if (trigger.family === "action") {
					const hash = trigger.action.lastIndexOf("#")
					const to = slugMap.get(trigger.action.slice(0, hash))
					if (to) trigger = { family: "action", action: `${to}${trigger.action.slice(hash)}` }
				}
				const { origin: _o, changedBy: _c, ...decl } = r
				return { ...decl, key: registrationKeyOf(trigger, pipeline), trigger, pipeline }
			})
			const scopeOf = { kind: "genre" as const, genreId }
			await replaceRows(
				db,
				scopeOf,
				remapped.map((d) => rowOfDecl(d as never, scopeOf, "pub")),
				["pub"]
			)
		}
		await copyDefaultLayout(db, params.from, genreId)

		const [createRow] = await db
			.select({ genre: schema.pipelineSpecVersions.genre })
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.id, saved[0].specVersionId))
			.limit(1)
		const block = ((createRow as any)?.genre ?? {}) as Record<string, any>
		registerPubGenre(genreId, params.from, {
			name: label,
			description: text(block.description),
			family: typeof block.family === "string" ? block.family : undefined,
			...(block.shape ? { shape: block.shape } : {}),
			...(block.events ? { events: block.events } : {})
		})
	} catch (e) {
		await rollback().catch((err) =>
			console.warn("[pubGenres] rollback after a failed create was incomplete:", err)
		)
		if (e instanceof PubGenreRefusal) throw e
		throw new PubGenreRefusal(
			`'${genreId}' was not created: ${e instanceof Error ? e.message : String(e)}`
		)
	}
	return { genreId }
}

/**
 * The new genre's one preset: the source's default preset (else its first
 * enabled one) with its bindings and included actions re-addressed to the
 * copies. An event whose spec was not copied is dropped; configuration ids
 * belong to the source's specs, so they are not carried.
 */
async function insertDefaultPreset(
	db: Db,
	from: string,
	genreId: string,
	label: string,
	slugMap: ReadonlyMap<string, string>,
	sourceSlugs: ReadonlySet<string>
): Promise<void> {
	const presets = (await db
		.select()
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.genreId, from))
		.orderBy(asc(schema.sessionPresets.id))) as Array<typeof schema.sessionPresets.$inferSelect>
	const live = presets.filter((p) => !p.withdrawnAt)
	const base = live.find((p) => p.isDefault) ?? live.find((p) => p.enabled) ?? null

	const bindings: Record<string, { spec: string }> = {}
	for (const [event, b] of Object.entries(
		(base?.bindings ?? {}) as Record<string, { spec: string }>
	)) {
		const spec = slugMap.get(b?.spec)
		if (spec) bindings[event] = { spec }
		// 🚧 Core's default save serves every genre, so it is kept as is.
		else if (b?.spec && isDefaultSave(event, b.spec)) bindings[event] = { spec: b.spec }
	}
	// 🚧 Every preset shows what saves a person's message (owner ruling 2026-10-15).
	if (!bindings[sessionEvents.messageOffered])
		bindings[sessionEvents.messageOffered] = { spec: SAVE_MESSAGE_SPEC_ID }
	if (!bindings[sessionEvents.sessionCreated]) {
		const createSlug = [...slugMap.values()][0]
		bindings[sessionEvents.sessionCreated] = { spec: createSlug }
	}

	const stated = base?.includedActions
	const includedActions = Array.isArray(stated)
		? (stated as unknown[]).map(String).flatMap((identity) => {
				const parsed = parseActionIdentity(identity)
				if (!parsed) return [identity]
				const to = slugMap.get(parsed.specSlug)
				if (to) return [`${to}#${parsed.key}`]
				// A source-genre spec that was not copied offers nothing here.
				return sourceSlugs.has(parsed.specSlug) ? [] : [identity]
			})
		: null

	await db.insert(schema.sessionPresets).values({
		name: label,
		description: base?.description ?? null,
		genreId,
		bindings,
		primarySlug: base?.primarySlug ? (slugMap.get(base.primarySlug) ?? null) : null,
		configSelections: {},
		includedActions,
		defaults: (base?.defaults ?? null) as Record<string, unknown> | null,
		enabled: true,
		isDefault: true,
		isImmutable: false
	})
}

/** The source genre's default layout, copied under the new genre as a `pub` row. */
async function copyDefaultLayout(db: Db, from: string, genreId: string): Promise<void> {
	const { genreDefaultLayoutRow, DEFAULT_LAYOUT_SLUG } = await import(
		"$lib/server/db/layoutPresets"
	)
	const row = await genreDefaultLayoutRow(from, db)
	if (!row) return
	await db.insert(schema.sessionLayoutPresets).values({
		// NO id — the sequence assigns one (seed rule).
		seedKey: `layout:${genreId}:pub/${DEFAULT_LAYOUT_SLUG}`,
		genreId,
		origin: "pub",
		pluginId: null,
		withdrawnAt: null,
		authorUserId: null,
		slug: DEFAULT_LAYOUT_SLUG,
		name: row.name,
		description: row.description,
		visibility: "shared",
		layout: row.layout
	})
}

/* ── update ─────────────────────────────────────────────────────────── */

export interface UpdatePubGenrePatch {
	name?: string
	description?: string
	family?: string
	fields?: SettingsSchema
}

/**
 * Rewrite an in-app genre's declaration — name, description, family, session
 * fields — as a new published version of its create document (a new row by
 * hash), then reconcile its configurations and re-register it. A shipped
 * genre (core's or a plugin's) is refused: its declaration is its owner's.
 */
export async function updatePubGenre(
	db: Db,
	genreId: string,
	patch: UpdatePubGenrePatch
): Promise<void> {
	const origin = await genreOrigin(db, genreId)
	if (origin !== "pub")
		refuse(
			origin === "core"
				? `'${genreId}' ships with Serene Pub — copy it to a genre of your own to change its name or fields.`
				: `'${genreId}' comes from a plugin — copy it to a genre of your own to change its name or fields.`
		)
	if (patch.name !== undefined && !patch.name.trim()) refuse("A genre needs a label people will see.")
	if (
		patch.fields !== undefined &&
		(patch.fields === null || typeof patch.fields !== "object" || Array.isArray(patch.fields))
	)
		refuse("Session fields must be a settings schema — an object of field declarations.")
	if (patch.fields) {
		const fault = sessionFieldFault(patch.fields)
		if (fault) refuse(fault)
	}

	const create = (await activeSpecRows(db)).find(
		(r) => isCreateRow(r) && r.inputGenre === genreId
	)!
	const doc = (await loadDocument(db, create.versionId)) as SpecDocument & Record<string, any>
	const block = { ...((doc.genre ?? {}) as Record<string, any>) }
	if (patch.name !== undefined) block.name = patch.name.trim()
	if (patch.description !== undefined) block.description = patch.description.trim()
	if (patch.family !== undefined) block.family = patch.family.trim()
	if (patch.fields !== undefined)
		block.shape = { ...((block.shape ?? {}) as Record<string, unknown>), fields: patch.fields }
	doc.genre = block

	let saved: Awaited<ReturnType<typeof saveDocument>>
	try {
		saved = await saveDocument(db, doc, { publish: true })
	} catch (e) {
		refuse(`The genre was not saved: ${e instanceof Error ? e.message : String(e)}`)
	}
	// The source travels with every version, so the boot re-registration can
	// read it off whichever one is active.
	if (saved!.specVersionId !== create.versionId && create.derivedFromSpecVersionId != null)
		await db
			.update(schema.pipelineSpecVersions)
			.set({ derivedFromSpecVersionId: create.derivedFromSpecVersionId })
			.where(eq(schema.pipelineSpecVersions.id, saved!.specVersionId))
	await reconcileConfigs(db, saved!.specId, saved!.specVersionId, create.slug)

	const source = await sourceGenreOf(db, create.derivedFromSpecVersionId)
	registerPubGenre(genreId, source, {
		name: text(block.name),
		description: text(block.description),
		family: typeof block.family === "string" ? block.family : undefined,
		...(block.shape ? { shape: block.shape } : {}),
		...(block.events ? { events: block.events } : {})
	})
	// 🚧 A11: the genre's registrations go back through the door — its
	// declaration (fields, envoys) is what they were judged against.
	const { refitAfterChange } = await import("$lib/server/pipelines/registrations/fit")
	await refitAfterChange(db, [genreId, create.slug])
}

/**
 * The field types a session form offers (the session-fields editor's list).
 * The SDK's publish check (`settingsSchemaFindings` through `validate()`)
 * judges display text only and its type check (`checkSchema`) is not public,
 * so the type and an enum's options are checked here, in a sentence.
 */
const SESSION_FIELD_TYPES = new Set([
	"string",
	"text",
	"number",
	"integer",
	"boolean",
	"enum",
	"string[]"
])

function sessionFieldFault(fields: SettingsSchema): string | null {
	for (const [key, raw] of Object.entries(fields as Record<string, unknown>)) {
		if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key))
			return `'${key}' is not a field key — use letters, digits, '_' and '-', starting with a letter.`
		if (!raw || typeof raw !== "object" || Array.isArray(raw))
			return `Session field '${key}' is not a field declaration.`
		const f = raw as { type?: unknown; of?: unknown; members?: unknown }
		if (typeof f.type !== "string" || !SESSION_FIELD_TYPES.has(f.type))
			return `Session field '${key}' has type '${String(f.type)}' — a session field is one of ${[...SESSION_FIELD_TYPES].join(", ")}.`
		// Core declares a choice's options as `members[{key, label}]` (each with
		// display text); `of` is the bare list. Either is options.
		const members = Array.isArray(f.members)
			? f.members.filter((m) => m && typeof m === "object" && typeof (m as { key?: unknown }).key === "string")
			: []
		if (f.type === "enum" && !(Array.isArray(f.of) && f.of.length) && !members.length)
			return `Session field '${key}' is a choice with no options — give it at least one.`
	}
	return null
}

/** The genre a copied create version came from, off its `derived_from` row. */
async function sourceGenreOf(db: Db, derivedFrom: number | null): Promise<string | null> {
	if (derivedFrom == null) return null
	const [row] = await db
		.select({ inputGenre: schema.pipelineSpecVersions.inputGenre, slug: schema.pipelineSpecs.slug })
		.from(schema.pipelineSpecVersions)
		.innerJoin(schema.pipelineSpecs, eq(schema.pipelineSpecs.id, schema.pipelineSpecVersions.specId))
		.where(eq(schema.pipelineSpecVersions.id, derivedFrom))
		.limit(1)
	if (row?.inputGenre) return row.inputGenre
	// 🚧 A source mounted by registrations: the genre whose defaults register it (D7).
	return row?.slug ? ((await registeredMounts(db)).get(row.slug)?.genreId ?? null) : null
}

/* ── boot ───────────────────────────────────────────────────────────── */

/**
 * Re-register every in-app genre in this process: each active create version
 * whose owner is neither `core` nor an installed plugin (and that no package
 * brought). Sources first — a copy of a copy needs its source registered to
 * inherit from. Returns a sentence per genre that could not be registered.
 */
export async function registerPubGenres(db: Db): Promise<string[]> {
	const installed = await pluginIds(db)
	const creates = (await activeSpecRows(db)).filter(
		(r) =>
			isCreateRow(r) &&
			r.sourcePluginId == null &&
			ownerOf(r.inputGenre!) !== "core" &&
			!installed.has(ownerOf(r.inputGenre!)) &&
			!r.inputGenre!.includes("@")
	)
	const byGenre = new Map(creates.map((r) => [r.inputGenre!, r]))
	const sources = new Map<string, string | null>()
	for (const r of creates)
		sources.set(r.inputGenre!, await sourceGenreOf(db, r.derivedFromSpecVersionId))

	const refused: string[] = []
	const done = new Set<string>()
	const visit = (id: string, path: Set<string>) => {
		if (done.has(id) || path.has(id)) return
		path.add(id)
		const from = sources.get(id) ?? null
		if (from && byGenre.has(from)) visit(from, path)
		const block = (byGenre.get(id)!.genre ?? {}) as Record<string, any>
		try {
			registerPubGenre(id, from, {
				name: text(block.name) || id,
				description: text(block.description),
				family: typeof block.family === "string" ? block.family : undefined,
				...(block.shape ? { shape: block.shape } : {}),
				...(block.events ? { events: block.events } : {})
			})
		} catch (e) {
			refused.push(`'${id}': ${e instanceof Error ? e.message : String(e)}`)
		}
		done.add(id)
	}
	for (const id of byGenre.keys()) visit(id, new Set())
	return refused
}
