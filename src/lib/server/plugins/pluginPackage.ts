/**
 * Reading a **plugin package** — the folder `serene-pub build` writes.
 *
 * One artifact since D-1: `dist/plugin/manifest.json` carries both halves of a
 * package (what it implements — node definitions, handlers, permissions — and
 * what it declares — genres, surfaces, presets, configs, prompts), and the
 * pipeline documents travel beside it, one JSON file each, because a document
 * is large and the manifest is what every reader an instance has already reads.
 *
 * This module is **pure**: it touches the filesystem and nothing else. No db
 * handle, no registry, no side effect. That is what lets the install, the CLI
 * and a test all hold a package to the same reading, and it is why the checks
 * here are *structural* — a slug in the grammar, a schema version this release
 * knows, a document for every pipeline the manifest names. Whether the ids it
 * claims are free, whether its requirements exist, whether an admin consents:
 * all of that is the instance's, and none of it is here.
 *
 * ⚠ **A manifest is untrusted input.** The author-side SDK refuses most of what
 * is checked below while the author is still writing, but a package may have
 * been built against an older SDK or assembled by hand, and install stores the
 * manifest verbatim (NOMENCLATURE §12). So every rule the author was held to
 * that would let a package claim somebody else's rows is repeated here.
 */

import { readFile, readdir, stat } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { mimeForUiPath } from "./pluginMime"
import {
	appletCardFindings,
	genreCreateSpecFindings,
	type SpecDocument
} from "@serene-pub/sdk"
import { isSafeUiPath } from "./frameHost"
import { manifestDisplayTextFindings } from "./store"
import { PLUGIN_BUILD_DIR } from "$lib/shared/plugins/packageManifest"

/** Where `serene-pub build` writes, relative to the package root. */
export { PLUGIN_BUILD_DIR }

/**
 * The plugin slug grammar, restated from `defineExtension`.
 *
 * Dotted and never slashed: a plugin's id IS the SDK slug (ruled 2026-09-17),
 * and `/plugin-ui/<id>/<file…>` reads the id as ONE segment, so a slashed id
 * would address a file nobody could serve.
 */
const SLUG = /^[a-z0-9]+([.-][a-z0-9]+)*$/

const MIB = 1024 * 1024

const positiveEnv = (name: string, fallback: number): number => {
	const n = Number(process.env[name])
	return Number.isFinite(n) && n > 0 ? n : fallback
}

/** The largest package this pub installs, in MB, counted as the files it unpacks to (`SP_PLUGIN_PACKAGE_MAX_MB`). */
export const PLUGIN_PACKAGE_MAX_MB: number = positiveEnv(
	"SP_PLUGIN_PACKAGE_MAX_MB",
	512
)
/** The most files one package may hold (`SP_PLUGIN_FILES_MAX`). */
export const PLUGIN_FILES_MAX: number = positiveEnv(
	"SP_PLUGIN_FILES_MAX",
	10_000
)

/** The refusal for a package whose files total too many bytes. */
export const packageTooLargeSentence = (bytes: number): string =>
	`This package is ${Math.ceil(bytes / MIB)} MB; this pub allows ${PLUGIN_PACKAGE_MAX_MB} MB (SP_PLUGIN_PACKAGE_MAX_MB). Nothing was installed.`

/** The refusal for a package that holds too many files. */
export const packageTooManyFilesSentence = (count: number): string =>
	`This package has ${count.toLocaleString("en")} files; this pub allows ${PLUGIN_FILES_MAX.toLocaleString("en")} (SP_PLUGIN_FILES_MAX). Nothing was installed.`

/** One file of a package, not yet read: where it is and what it weighs. */
export interface PluginPackageFile {
	path: string
	mime: string
	kind: "ui" | "asset"
	bytes: number
	/** Absolute path of the file in the package folder. */
	source: string
}

/**
 * The manifest, in the shape this app reads it.
 *
 * Deliberately loose — `Record<string, unknown>` for the halves nothing here
 * interprets — because the manifest is stored verbatim and the readers that
 * interpret a half (`permissions.ts`, `frameHost.surfacesOf`, `eventHost`) are
 * each tolerant of their own field being anything. Narrowing it here would put
 * a second, stricter opinion in front of theirs.
 */
export interface PluginPackageManifest {
	schemaVersion: number
	slug: string
	name: unknown
	version: string
	description?: unknown
	pipelines?: Array<{ id: string; version?: string }>
	genres?: Array<Record<string, unknown>>
	surfaces?: Record<string, unknown>
	presets?: Array<Record<string, unknown>>
	configs?: Array<Record<string, unknown>>
	prompts?: Array<Record<string, unknown>>
	requires?: string[]
	[key: string]: unknown
}

export interface PluginPackage {
	/** The package root — the folder that was read, absolute. */
	dir: string
	/** The manifest, verbatim. Never rewritten: install stores exactly this. */
	manifest: PluginPackageManifest
	/** One per `manifest.pipelines` entry, in the manifest's order. */
	documents: SpecDocument[]
	/**
	 * The package's files, listed and sized but not read (install copies them).
	 *
	 * Everything under `ui/` plus any declared surface entry outside it —
	 * read as a set rather than only the declared entries, because a frame
	 * document loads its own script and stylesheet and a surface whose entry
	 * alone was stored renders blank. Then the `assets` dir and `lang/*.json`,
	 * kind `asset`.
	 */
	files: PluginPackageFile[]
}

/** A package this instance will not read, with every reason at once. */
export class PluginPackageError extends Error {
	readonly findings: string[]
	constructor(dir: string, findings: string[]) {
		super(
			`'${dir}' is not a readable plugin package:\n` +
				findings.map((f) => `  • ${f}`).join("\n")
		)
		this.name = "PluginPackageError"
		this.findings = findings
	}
}

/** The document file `serene-pub build` writes for a spec id. */
export const documentFileName = (specId: string): string =>
	`${specId.replace(/[:/]/g, "_")}.json`

// The MIME table lives in the leaf `./pluginMime` (no imports), so `frameHost` can read it
// without pulling this module — and the database — into the definition registry's imports.
export { mimeForUiPath }

const exists = async (path: string): Promise<boolean> => {
	try {
		await stat(path)
		return true
	} catch {
		return false
	}
}

/** Every file under `root`, as paths relative to it, depth-first and sorted. */
async function walk(root: string, prefix = ""): Promise<string[]> {
	let entries
	try {
		entries = await readdir(join(root, prefix), { withFileTypes: true })
	} catch {
		return []
	}
	const out: string[] = []
	for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const rel = prefix ? `${prefix}/${e.name}` : e.name
		if (e.isDirectory()) out.push(...(await walk(root, rel)))
		else if (e.isFile()) out.push(rel)
	}
	return out
}

/**
 * Every frame document a manifest's `surfaces` declare (session view, page),
 * tolerant of the json being anything. A widget is never a frame: a document
 * inside one is its component's `sp-frame`.
 */
export function declaredSurfaceEntries(manifest: unknown): string[] {
	const out: string[] = []
	const take = (v: any) => {
		if (v && typeof v.entry === "string") out.push(v.entry)
	}
	const raw = (manifest as any)?.surfaces
	if (raw && typeof raw === "object") {
		take(raw["session-view"])
		take(raw.page)
	}
	return out
}

/**
 * The built modules a manifest's components name (§3.5, C3) — `serene-pub
 * build` writes each under `dist/plugin/components/` and points `entry` at it.
 */
export function declaredComponentEntries(manifest: unknown): string[] {
	const raw = (manifest as { components?: unknown } | null)?.components
	if (!Array.isArray(raw)) return []
	return raw
		.map((c) =>
			c && typeof c === "object"
				? (c as { entry?: unknown }).entry
				: undefined
		)
		.filter((e): e is string => typeof e === "string")
}

/**
 * Read and structurally validate the package built in `dir`.
 *
 * Throws {@link PluginPackageError} carrying **every** finding rather than the
 * first: an author fixing a package one sentence per run is an author who runs
 * it five times.
 */
export async function readPluginPackage(dir: string): Promise<PluginPackage> {
	const root = isAbsolute(dir) ? dir : resolve(dir)
	const buildDir = join(root, PLUGIN_BUILD_DIR)
	const manifestPath = join(buildDir, "manifest.json")

	let raw: string
	try {
		raw = await readFile(manifestPath, "utf8")
	} catch {
		throw new PluginPackageError(root, [
			`no '${PLUGIN_BUILD_DIR}/manifest.json'. A package is installed from what ` +
				`'serene-pub build' writes, not from its sources — run it in the package ` +
				`first. (An announce-only package writes 'announcement.json' instead and ` +
				`is not installable: rebuild it against the current SDK.)`
		])
	}

	let manifest: PluginPackageManifest
	try {
		manifest = JSON.parse(raw)
	} catch (e) {
		throw new PluginPackageError(root, [
			`${PLUGIN_BUILD_DIR}/manifest.json is not JSON: ${e instanceof Error ? e.message : String(e)}`
		])
	}
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
		throw new PluginPackageError(root, [
			`${PLUGIN_BUILD_DIR}/manifest.json is not a manifest object.`
		])

	const findings: string[] = []

	if (manifest.schemaVersion !== 1)
		findings.push(
			`manifest.schemaVersion is ${JSON.stringify(manifest.schemaVersion)}; this ` +
				`release reads 1. A newer package is refused rather than read as if it ` +
				`were this one.`
		)
	const slug = manifest.slug
	if (typeof slug !== "string" || !SLUG.test(slug))
		findings.push(
			`manifest.slug ${JSON.stringify(slug)} is not a plugin slug — lowercase ` +
				`letters, digits, dots and hyphens ('chariot.dice-tray'). It is the ` +
				`namespace every id the package registers must sit under, and it is one ` +
				`URL segment, so it is never slashed.`
		)
	// `core` is the app's own owner id: what core's widgets are answered as,
	// and what a page trusts with the viewer's line (C0b review, H3).
	if (slug === "core")
		findings.push(
			`manifest.slug 'core' is the app's own — a plugin cannot take it. Choose a slug ` +
				`of your own ('chariot.dice-tray').`
		)
	if (
		typeof manifest.version !== "string" ||
		!/^\d+\.\d+\.\d+/.test(manifest.version)
	)
		findings.push(
			`manifest.version ${JSON.stringify(manifest.version)} is not semver. A plugin ` +
				`upgrades by version comparison.`
		)
	findings.push(
		...manifestDisplayTextFindings(manifest as Record<string, unknown>)
	)

	// The documents. One file per `pipelines` entry, named the way the packager
	// names them — matched by name rather than by scanning the directory, so a
	// stray file cannot become a pipeline and a missing one cannot be silently
	// skipped.
	const documents: SpecDocument[] = []
	const entries = Array.isArray(manifest.pipelines) ? manifest.pipelines : []
	for (const entry of entries) {
		const id = entry && typeof entry.id === "string" ? entry.id : ""
		if (!id) {
			findings.push(`manifest.pipelines has an entry with no id.`)
			continue
		}
		const file = join(buildDir, "pipelines", documentFileName(id))
		let text: string
		try {
			text = await readFile(file, "utf8")
		} catch {
			findings.push(
				`manifest.pipelines names '${id}' and no document ships for it ` +
					`(${PLUGIN_BUILD_DIR}/pipelines/${documentFileName(id)}). The manifest ` +
					`carries a pipeline's identity; the document travels beside it.`
			)
			continue
		}
		let doc: SpecDocument
		try {
			doc = JSON.parse(text)
		} catch (e) {
			findings.push(
				`${documentFileName(id)} is not JSON: ${e instanceof Error ? e.message : String(e)}`
			)
			continue
		}
		if (!doc || typeof doc !== "object" || (doc as any).id !== id) {
			findings.push(
				`${documentFileName(id)} declares id ${JSON.stringify((doc as any)?.id)}, ` +
					`not '${id}'. The file name and the document have to agree or the ` +
					`manifest is naming something else.`
			)
			continue
		}
		if (typeof slug === "string" && doc.id.split(":")[0] !== slug)
			findings.push(
				`pipeline '${doc.id}' sits under namespace '${doc.id.split(":")[0]}', not ` +
					`'${slug}'. Ownership is what lets an update replace your rows and leave ` +
					`everyone else's alone.`
			)
		documents.push(doc)
	}

	// Genres: owned, and each with the create pipeline that is its one required
	// member (24 §3). Checked here because a genre whose create spec is missing
	// projects to nothing at all — the genre IS its create spec's published row.
	const genres = Array.isArray(manifest.genres) ? manifest.genres : []
	for (const g of genres) {
		const id = g && typeof g.id === "string" ? (g.id as string) : ""
		if (!id) {
			findings.push(`manifest.genres has an entry with no id.`)
			continue
		}
		if (typeof slug === "string" && id.split(":")[0] !== slug)
			findings.push(
				`genre '${id}' sits under namespace '${id.split(":")[0]}', not '${slug}'. ` +
					`A package declares only its own genres; referencing another's is done ` +
					`from a spec's input binding.`
			)
		// The SDK's rule, the one the packager runs too (`serene-pub check`/`build`):
		// a package the packager passes is never refused here on this count.
		findings.push(...genreCreateSpecFindings([{ id }], documents))
		// `shape` is optional in the SDK and load-bearing here:
		// `listSessionGenres` filters on it, so a genre that declares none is
		// installed, listed by nothing, and impossible to start. Refused at the
		// read, where it is a sentence, rather than at first use, where it is an
		// absence.
		const shape = g.shape
		if (!shape || typeof shape !== "object" || Array.isArray(shape))
			findings.push(
				`genre '${id}' declares no session shape. The shape is what every surface ` +
					`asks about — how many characters, whether a lorebook attaches, what the ` +
					`composer is — and a genre without one is listed by no picker and started ` +
					`by nobody.`
			)
	}

	// The client-side files. Declared entries must be servable paths that exist;
	// what is stored is the whole `ui/` tree, because a document loads its own
	// script.
	const wanted = new Set<string>()
	for (const rel of await walk(join(root, "ui"))) wanted.add(`ui/${rel}`)
	const componentEntries = new Set(declaredComponentEntries(manifest))
	for (const entry of [
		...declaredSurfaceEntries(manifest),
		...componentEntries
	]) {
		const what = componentEntries.has(entry)
			? "component entry"
			: "surface entry"
		if (!isSafeUiPath(entry)) {
			findings.push(
				`${what} '${entry}' is not a servable path — relative, no '..', ` +
					`and under the package root.`
			)
			continue
		}
		// The worker imports a component as a module: the BUILT one. A manifest
		// naming its source (`.ts`, `.svelte`) was never built — or was edited.
		if (componentEntries.has(entry) && !/\.m?js$/.test(entry)) {
			findings.push(
				`component entry '${entry}' is not a built module — run \`serene-pub build\`, which ` +
					`compiles each component to dist/plugin/components/<slug>.js.`
			)
			continue
		}
		if (!(await exists(join(root, entry)))) {
			findings.push(
				`${what} '${entry}' does not exist in the package. A surface a ` +
					`pub offers and cannot serve is a blank frame.`
			)
			continue
		}
		wanted.add(entry)
	}

	// Assets: the declared dir (`manifest.assets.dir`, default `assets`) and
	// `lang/*.json` — the folder IS the declaration (SHAPES L5).
	const assetPaths = new Set<string>()
	const assetsDecl = (manifest as { assets?: unknown }).assets
	/** The declared assets folder once it passed the check below — the one the card rule reads too. */
	let safeAssets: string | undefined
	if (
		assetsDecl &&
		typeof assetsDecl === "object" &&
		!Array.isArray(assetsDecl)
	) {
		const rawDir = (assetsDecl as { dir?: unknown }).dir
		const dir = typeof rawDir === "string" ? rawDir : "assets"
		const first = dir.split("/")[0]
		if (
			!isSafeUiPath(dir) ||
			first === "ui" ||
			first === "dist" ||
			first === "lang"
		)
			findings.push(
				`manifest.assets.dir '${dir}' is not a servable folder — relative, no '..', ` +
					`and not 'ui', 'dist' or 'lang', which the package already uses.`
			)
		else {
			safeAssets = dir
			for (const rel of await walk(join(root, dir)))
				assetPaths.add(`${dir}/${rel}`)
		}
	}
	try {
		for (const e of await readdir(join(root, "lang"), {
			withFileTypes: true
		}))
			if (e.isFile() && e.name.endsWith(".json"))
				assetPaths.add(`lang/${e.name}`)
	} catch {
		/* no lang folder */
	}

	// 🚧 M2d: the applet card — the packager's rule, repeated over the stored manifest.
	{
		for (const f of appletCardFindings(
			(manifest as { appletCard?: unknown }).appletCard,
			safeAssets,
			(path) => assetPaths.has(path),
			genres.some(
				(g) =>
					(g as { shape?: { applet?: unknown } } | null)?.shape
						?.applet === true
			)
		))
			findings.push(`${f.message} — ${f.fix}.`)
	}

	const files: PluginPackageFile[] = []
	let bytes = 0
	const collect = async (path: string, kind: "ui" | "asset") => {
		if (!isSafeUiPath(path)) return
		const source = join(root, path)
		const size = (await stat(source)).size
		bytes += size
		files.push({
			path,
			mime: mimeForUiPath(path),
			kind,
			bytes: size,
			source
		})
	}
	for (const path of [...wanted].sort()) await collect(path, "ui")
	for (const path of [...assetPaths].sort())
		if (!wanted.has(path)) await collect(path, "asset")

	if (bytes > PLUGIN_PACKAGE_MAX_MB * MIB)
		findings.push(packageTooLargeSentence(bytes))
	if (files.length > PLUGIN_FILES_MAX)
		findings.push(packageTooManyFilesSentence(files.length))

	if (findings.length) throw new PluginPackageError(root, findings)
	return { dir: root, manifest, documents, files }
}
