/**
 * **Export a genre as a content-only plugin package** (PLAN-pipeline-canvas-
 * and-genre-authoring §7, P5) — the reverse of `installPluginPackage`.
 *
 * Reads back what an install (or the in-app genre editor) projected into rows
 * and writes the folder `readPluginPackage` reads, in memory: a manifest at
 * `dist/plugin/manifest.json`, one document per pipeline under
 * `dist/plugin/pipelines/`, and the owning plugin's stored client files at the
 * paths they were stored under (`ui/**`, `dist/plugin/components/*.js`).
 *
 * ## Content only
 *
 * No `bundle.js`, no `hooks`, no permissions. A package exported here installs
 * its declarations and none of its code. When a document places one of its own
 * package's node definitions, the definition's *declaration* travels (so the
 * document validates on a pub that has never seen it) and the export says, in
 * `warnings`, that the node will not dispatch without the original bundle.
 *
 * ## What the rows give back
 *
 *  - **genre** — the create spec's published version row (`genre`,
 *    `input_genre`, `input_event`), with its id put back.
 *  - **pipelines** — every published spec whose inlet lock names the genre,
 *    plus every spec a preset of the genre binds, when it sits under the
 *    package slug; anything else a preset binds becomes a `requires` entry.
 *  - **presets** — the genre's `session_presets` rows (withdrawn ones left
 *    out), and the owning plugin's declared presets that have no row (a
 *    disabled plugin's presets are not projected).
 *  - **configs** — those the presets bind, the person-made (not immutable)
 *    ones on the exported specs, and every one this plugin seeded.
 *  - **layouts** — the owning plugin's declared layouts for the genre, its
 *    projected rows, and people's shared ones.
 *  - **prompts / widgets / components / surfaces / engines** — carried from
 *    the owning plugin's stored manifest when there is one.
 */
import { zipSync } from "fflate"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { i18nText } from "@serene-pub/sdk"
import type { I18n, SpecDocument } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { isCoreEventId } from "./requirements"
import { loadDocument } from "$lib/server/pipelines/boot/store"
import { isPluginSlug } from "./frameHost"
import {
	PLUGIN_BUILD_DIR,
	documentFileName,
	type PluginPackageManifest
} from "./pluginPackage"

const SESSION_CREATED = "core:event/session-created@1"

export interface ExportGenrePackageOptions {
	genreId: string
	/** The package slug — must be the genre id's owner segment exactly. */
	slug: string
	/** Package semver. */
	version: string
	/** Package display name. */
	name: string
	description?: string
}

export interface ExportedPackage {
	/** Package-root-relative path → content. */
	files: Record<string, Buffer | string>
	manifest: PluginPackageManifest
	/** What the package cannot carry, one sentence each. */
	warnings: string[]
}

/** A refusal worded for the admin who asked. */
export class ExportRefusal extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ExportRefusal"
	}
}

const ownerOf = (id: string): string => id.split(":")[0] ?? ""

/** Lowercase, hyphenated, never empty — a declaration slug from a row's name. */
export function slugify(text: string, fallback: string): string {
	const s = String(text ?? "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
	const out = s || fallback
	// Layout and component slugs must start with a letter.
	return /^[a-z]/.test(out) ? out : `${fallback}-${out}`
}

/** A slug not yet in `taken`, numbered when it is. */
function unique(base: string, taken: Set<string>): string {
	let s = base
	for (let n = 2; taken.has(s); n++) s = `${base}-${n}`
	taken.add(s)
	return s
}

/** `plugin:<slug>:<spec>#<config>` → the config slug, when it is this plugin's. */
function seededConfigSlug(seedKey: string | null, slug: string): string | null {
	if (!seedKey?.startsWith(`plugin:${slug}:`)) return null
	const hash = seedKey.lastIndexOf("#")
	if (hash > 0) return seedKey.slice(hash + 1) || null
	// ⏳ The previous key spelling, `plugin:<id>:<slug>`.
	return seedKey.slice(`plugin:${slug}:`.length) || null
}

/** `plugin:<slug>:<preset>` → the preset slug, when it is this plugin's. */
function seededPresetSlug(seedKey: string | null, slug: string): string | null {
	if (!seedKey?.startsWith(`plugin:${slug}:`)) return null
	return seedKey.slice(`plugin:${slug}:`.length) || null
}

/**
 * Build the package for `genreId` in memory. Throws {@link ExportRefusal} with
 * a sentence when the genre cannot be packaged.
 */
export async function exportGenrePackage(
	db: Db,
	opts: ExportGenrePackageOptions
): Promise<ExportedPackage> {
	const { genreId, slug } = opts
	const warnings: string[] = []

	if (typeof genreId !== "string" || !/^[^:]+:genre\/.+/.test(genreId))
		throw new ExportRefusal(
			`'${genreId}' is not a genre id — '<owner>:genre/<name>'.`
		)
	const owner = ownerOf(genreId)
	if (owner === "core")
		throw new ExportRefusal(
			`'${genreId}' is one of the app's own genres. Core genres ship with ` +
				`Serene Pub and cannot be packaged; copy it into a genre of your own ` +
				`and export that.`
		)
	if (typeof slug !== "string" || !isPluginSlug(slug) || slug === "core")
		throw new ExportRefusal(
			`${JSON.stringify(slug)} is not a plugin slug — lowercase letters, digits, ` +
				`dots and hyphens ('acme.lab').`
		)
	if (owner !== slug)
		throw new ExportRefusal(
			`'${genreId}' sits under '${owner}', not '${slug}'. A package's ids must ` +
				`sit under its slug exactly, so this genre exports as '${owner}'.`
		)
	if (typeof opts.version !== "string" || !/^\d+\.\d+\.\d+/.test(opts.version))
		throw new ExportRefusal(
			`${JSON.stringify(opts.version)} is not a version — use semver, '1.0.0'.`
		)

	// Every published, active spec version on this pub, with its lock.
	const active = (await db
		.select({
			specId: schema.pipelineSpecs.id,
			slug: schema.pipelineSpecs.slug,
			sourcePluginId: schema.pipelineSpecs.sourcePluginId,
			versionId: schema.pipelineSpecVersions.id,
			semver: schema.pipelineSpecVersions.semver,
			genre: schema.pipelineSpecVersions.genre,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			status: schema.pipelineSpecVersions.status
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.id, schema.pipelineSpecs.activeVersionId)
		)) as Array<{
		specId: number
		slug: string
		sourcePluginId: number | null
		versionId: number
		semver: string
		genre: Record<string, any> | null
		inputGenre: string | null
		inputEvent: string | null
		status: string
	}>
	const published = active.filter((r) => r.status === "published")
	const bySlug = new Map(published.map((r) => [r.slug, r]))

	const creates = published.filter(
		(r) => r.inputGenre === genreId && r.inputEvent === SESSION_CREATED
	)
	if (creates.length !== 1)
		throw new ExportRefusal(
			creates.length
				? `'${genreId}' has ${creates.length} published create pipelines; a ` +
						`package carries exactly one.`
				: `'${genreId}' has no published create pipeline on this pub, so there ` +
						`is no genre to export.`
		)
	const create = creates[0]!

	// The plugin that owns the genre, if one does — by slug, the plugin's
	// identity, so an in-app genre under a slug no plugin holds has none.
	const [plugin] = (await db
		.select()
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, slug))
		.limit(1)) as any[]
	const ownerManifest: Record<string, any> | null =
		plugin?.manifest && typeof plugin.manifest === "object"
			? plugin.manifest
			: null

	// ---- presets --------------------------------------------------------
	type BindingRow = { spec: string; config?: number }
	type PresetSource =
		| { from: "row"; row: any }
		| { from: "manifest"; decl: Record<string, any> }
	const presetRows = (await db
		.select()
		.from(schema.sessionPresets)
		.where(
			and(
				eq(schema.sessionPresets.genreId, genreId),
				isNull(schema.sessionPresets.withdrawnAt)
			)
		)) as any[]
	presetRows.sort(
		(a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.id - b.id
	)
	const presetSources: PresetSource[] = presetRows.map((row) => ({
		from: "row",
		row
	}))
	const rowPresetSlugs = new Set(
		presetRows
			.map((r) => seededPresetSlug(r.seedKey, slug))
			.filter((s): s is string => !!s)
	)
	for (const decl of (ownerManifest?.presets ?? []) as any[])
		if (
			decl &&
			decl.genre === genreId &&
			typeof decl.slug === "string" &&
			!rowPresetSlugs.has(decl.slug)
		)
			presetSources.push({ from: "manifest", decl })

	// ---- which specs travel ----------------------------------------------
	const wanted = new Set<string>(
		published.filter((r) => r.inputGenre === genreId).map((r) => r.slug)
	)
	const boundConfigIds = new Set<number>()
	for (const p of presetSources) {
		const bindings =
			p.from === "row"
				? ((p.row.bindings ?? {}) as Record<string, BindingRow>)
				: ((p.decl.bindings ?? {}) as Record<string, { spec?: string }>)
		for (const b of Object.values(bindings)) {
			if (!b || typeof b.spec !== "string") continue
			wanted.add(b.spec)
			if (p.from === "row" && typeof (b as BindingRow).config === "number")
				boundConfigIds.add((b as BindingRow).config!)
		}
	}
	const requires = new Set<string>()
	const exported: typeof published = []
	for (const id of [...wanted].sort()) {
		if (ownerOf(id) !== slug) {
			requires.add(id)
			if (ownerOf(id) !== "core")
				warnings.push(
					`'${id}' belongs to another package; the export requires it rather ` +
						`than carrying it.`
				)
			continue
		}
		const row = bySlug.get(id)
		if (!row)
			throw new ExportRefusal(
				`'${id}' is bound by a preset of '${genreId}' and has no published ` +
					`version on this pub. Publish it, or unbind it, before exporting.`
			)
		exported.push(row)
	}
	// The create pipeline first, the rest in id order.
	exported.sort(
		(a, b) =>
			Number(b.slug === create.slug) - Number(a.slug === create.slug) ||
			a.slug.localeCompare(b.slug)
	)

	// ---- documents -------------------------------------------------------
	const files: Record<string, Buffer | string> = {}
	const documents: SpecDocument[] = []
	for (const row of exported) {
		const doc = await loadDocument(db, row.versionId)
		if (row.slug === create.slug && !(doc as any).genre && create.genre)
			(doc as any).genre = create.genre
		documents.push(doc)
		files[`${PLUGIN_BUILD_DIR}/pipelines/${documentFileName(doc.id)}`] =
			JSON.stringify(doc, null, 2) + "\n"
	}

	// Node definitions the documents place: core's ship with every pub; this
	// package's travel as declarations; anybody else's cannot travel at all.
	const placed = new Set<string>()
	for (const doc of documents)
		for (const n of (doc as any).nodes ?? [])
			if (typeof n?.definitionId === "string")
				placed.add(`${n.definitionId}@${n.definitionVersion ?? 1}`)
	const nodeDefinitions: any[] = []
	const ownDefinitions = new Map<string, any>(
		((ownerManifest?.nodeDefinitions ?? []) as any[])
			.filter((d) => d && typeof d.id === "string")
			.map((d) => [d.id, d])
	)
	for (const pin of [...placed].sort()) {
		const ns = ownerOf(pin)
		if (ns === "core") continue
		if (ns === slug) {
			const decl = ownDefinitions.get(pin)
			if (decl) {
				nodeDefinitions.push(decl)
				warnings.push(
					`node '${pin}' is this package's own code; its declaration travels, ` +
						`its handler does not, so it will not run until the original ` +
						`bundle is installed.`
				)
			} else
				warnings.push(
					`node '${pin}' has no declaration on this pub to carry; the ` +
						`pipelines placing it will be refused where it is not installed.`
				)
		} else
			warnings.push(
				`node '${pin}' belongs to '${ns}'; install that package wherever this ` +
					`one goes.`
			)
	}

	// ---- configs ---------------------------------------------------------
	const exportedSpecIds = exported.map((r) => r.specId)
	const configRows = (await db
		.select({
			id: schema.pipelineConfigs.id,
			specId: schema.pipelineConfigs.specId,
			seedKey: schema.pipelineConfigs.seedKey,
			name: schema.pipelineConfigs.name,
			isImmutable: schema.pipelineConfigs.isImmutable,
			specSlug: schema.pipelineSpecs.slug
		})
		.from(schema.pipelineConfigs)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineConfigs.specId)
		)) as Array<{
		id: number
		specId: number
		seedKey: string | null
		name: string
		isImmutable: boolean
		specSlug: string
	}>
	const chosenConfigs = configRows
		.filter(
			(c) =>
				boundConfigIds.has(c.id) ||
				seededConfigSlug(c.seedKey, slug) != null ||
				(exportedSpecIds.includes(c.specId) && !c.isImmutable)
		)
		.sort((a, b) => a.specSlug.localeCompare(b.specSlug) || a.id - b.id)
	const configSlugById = new Map<number, string>()
	const takenBySpec = new Map<string, Set<string>>()
	const manifestConfigs = new Map<string, any>(
		((ownerManifest?.configs ?? []) as any[])
			.filter((c) => c && typeof c.spec === "string" && typeof c.slug === "string")
			.map((c) => [`${c.spec}#${c.slug}`, c])
	)
	// Seeded slugs first, so a person's copy never takes the shipped name.
	for (const c of chosenConfigs) {
		const s = seededConfigSlug(c.seedKey, slug)
		if (!s) continue
		const taken = takenBySpec.get(c.specSlug) ?? new Set<string>()
		takenBySpec.set(c.specSlug, taken)
		taken.add(s)
		configSlugById.set(c.id, s)
	}
	for (const c of chosenConfigs) {
		if (configSlugById.has(c.id)) continue
		const taken = takenBySpec.get(c.specSlug) ?? new Set<string>()
		takenBySpec.set(c.specSlug, taken)
		configSlugById.set(c.id, unique(slugify(c.name, "config"), taken))
	}
	const valueRows = chosenConfigs.length
		? ((await db
				.select()
				.from(schema.pipelineConfigValues)
				.where(
					inArray(
						schema.pipelineConfigValues.configId,
						chosenConfigs.map((c) => c.id)
					)
				)) as any[])
		: []
	const configs = chosenConfigs.map((c) => {
		const values: Record<string, Record<string, unknown>> = {}
		const rows = valueRows
			.filter((v) => v.configId === c.id)
			// Whole-slot values before per-field ones, so a field wins.
			.sort((a, b) => Number(!!a.path) - Number(!!b.path) || a.id - b.id)
		for (const v of rows) {
			const slots = (values[v.nodeKey] ??= {})
			if (!v.path) slots[v.slot] = v.value
			else {
				const base = slots[v.slot]
				const obj =
					base && typeof base === "object" && !Array.isArray(base)
						? (base as Record<string, unknown>)
						: {}
				obj[v.path] = v.value
				slots[v.slot] = obj
			}
		}
		const s = configSlugById.get(c.id)!
		const shipped = manifestConfigs.get(`${c.specSlug}#${s}`)
		if (ownerOf(c.specSlug) !== slug) requires.add(c.specSlug)
		const decl: Record<string, unknown> = {
			spec: c.specSlug,
			slug: s,
			label: c.name
		}
		if (shipped?.description !== undefined) decl.description = shipped.description
		decl.values = values
		return decl
	})

	// ---- presets as declarations ------------------------------------------
	const takenPresets = new Set<string>()
	for (const p of presetSources) {
		const s =
			p.from === "row" ? seededPresetSlug(p.row.seedKey, slug) : p.decl.slug
		if (s) takenPresets.add(s)
	}
	const presets = presetSources.map((p) => {
		if (p.from === "manifest") return p.decl
		const r = p.row
		const presetSlug =
			seededPresetSlug(r.seedKey, slug) ??
			unique(slugify(r.name, "preset"), takenPresets)
		const bindings: Record<string, { spec: string; config?: string }> = {}
		for (const [event, b] of Object.entries(
			(r.bindings ?? {}) as Record<string, BindingRow>
		)) {
			if (!b || typeof b.spec !== "string") continue
			const cs =
				typeof b.config === "number" ? configSlugById.get(b.config) : undefined
			bindings[event] = cs ? { spec: b.spec, config: cs } : { spec: b.spec }
		}
		const decl: Record<string, unknown> = {
			slug: presetSlug,
			genre: genreId,
			label: r.name
		}
		if (r.description) decl.description = r.description
		decl.bindings = bindings
		if (Array.isArray(r.includedActions))
			decl.actions = { include: r.includedActions }
		if (r.defaults && typeof r.defaults === "object") decl.defaults = r.defaults
		decl.enabled = r.enabled !== false
		return decl
	})
	if (!presets.length)
		throw new ExportRefusal(
			`'${genreId}' has no preset. A package's genre needs at least one, ` +
				`binding its pipelines, or nobody can start a session on it.`
		)

	// ---- layouts ---------------------------------------------------------
	const layouts: Record<string, unknown>[] = []
	const takenLayouts = new Set<string>()
	for (const l of (ownerManifest?.layouts ?? []) as any[])
		if (l && l.genreId === genreId && typeof l.slug === "string") {
			layouts.push(l)
			takenLayouts.add(l.slug)
		}
	const layoutRows = (await db
		.select()
		.from(schema.sessionLayoutPresets)
		.where(
			and(
				eq(schema.sessionLayoutPresets.genreId, genreId),
				isNull(schema.sessionLayoutPresets.withdrawnAt)
			)
		)) as any[]
	for (const r of layoutRows.sort((a, b) => a.id - b.id)) {
		const mine = (r.origin === "plugin" && r.pluginId === slug) || r.origin === "pub"
		const shared = r.origin === "user" && r.visibility !== "private"
		if (!mine && !shared) continue
		const base = r.slug || slugify(r.name, "layout")
		if (mine && takenLayouts.has(base)) continue
		const l: Record<string, unknown> = {
			genreId,
			slug: mine ? base : unique(slugify(base, "layout"), takenLayouts),
			name: r.name
		}
		if (mine) takenLayouts.add(base)
		if (r.description) l.description = r.description
		l.preset = r.layout
		layouts.push(l)
	}

	// ---- client files ----------------------------------------------------
	const fileRows = (await db
		.select()
		.from(schema.pluginFiles)
		.where(eq(schema.pluginFiles.pluginId, slug))) as any[]
	for (const f of fileRows.sort((a, b) => a.path.localeCompare(b.path)))
		files[f.path] = Buffer.from(f.content, "base64")
	const carried = (key: string): unknown =>
		ownerManifest && ownerManifest[key] !== undefined ? ownerManifest[key] : undefined
	let components = carried("components") as any[] | undefined
	if (Array.isArray(components)) {
		const kept = components.filter(
			(c) => c && typeof c.entry === "string" && c.entry in files
		)
		if (kept.length !== components.length)
			warnings.push(
				`${components.length - kept.length} component(s) whose module is not ` +
					`stored on this pub were left out.`
			)
		components = kept
	}

	// ---- genre -----------------------------------------------------------
	const manifestGenre = ((ownerManifest?.genres ?? []) as any[]).find(
		(g) => g?.id === genreId
	)
	const genreDecl: Record<string, unknown> = {
		...(manifestGenre ?? {}),
		...(create.genre ?? {}),
		id: genreId
	}

	// ---- requires --------------------------------------------------------
	// Genres, specs, and core's events: every `core:event/…` a pipeline locks
	// on or a preset binds, so a pub on an older Serene Pub that lacks one
	// refuses the install by name (`missingRequirements` checks a core event
	// against this build's registry, a package's against installed ones).
	for (const doc of documents) {
		const lock = (doc as any).input?.genre
		if (typeof lock === "string" && ownerOf(lock) !== slug) requires.add(lock)
		const event = (doc as any).input?.event
		if (typeof event === "string" && isCoreEventId(event)) requires.add(event)
	}
	for (const p of presets)
		for (const event of Object.keys(
			((p as { bindings?: unknown }).bindings ?? {}) as Record<string, unknown>
		))
			if (isCoreEventId(event)) requires.add(event)

	const description =
		opts.description ??
		(typeof ownerManifest?.description === "string"
			? ownerManifest.description
			: i18nText(genreDecl.description as I18n | undefined) || undefined)

	const manifest: PluginPackageManifest = {
		schemaVersion: 1,
		slug,
		name: opts.name,
		version: opts.version,
		...(description ? { description } : {}),
		...(carried("engines") ? { engines: carried("engines") } : {}),
		...(nodeDefinitions.length ? { nodeDefinitions } : {}),
		genres: [genreDecl],
		pipelines: documents.map((d) => ({ id: d.id, version: d.version })),
		presets,
		configs,
		...(carried("prompts") ? { prompts: carried("prompts") as any[] } : {}),
		...(layouts.length ? { layouts } : {}),
		...(components?.length ? { components } : {}),
		...(components?.length && carried("widgets")
			? { widgets: carried("widgets") }
			: {}),
		...(carried("surfaces") ? { surfaces: carried("surfaces") as any } : {}),
		requires: [...requires].sort()
	}
	files[`${PLUGIN_BUILD_DIR}/manifest.json`] =
		JSON.stringify(manifest, null, 2) + "\n"

	return { files, manifest, warnings }
}

/** The package folder as one zip, paths as given. */
export function zipPackage(files: Record<string, Buffer | string>): Buffer {
	const entries: Record<string, Uint8Array> = {}
	for (const [path, content] of Object.entries(files))
		entries[path] =
			typeof content === "string"
				? new Uint8Array(Buffer.from(content, "utf8"))
				: new Uint8Array(content)
	return Buffer.from(zipSync(entries, { level: 6 }))
}
