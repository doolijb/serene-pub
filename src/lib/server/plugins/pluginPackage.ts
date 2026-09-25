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
import { extname, isAbsolute, join, resolve } from "node:path"
import type { SpecDocument } from "@serene-pub/sdk"
import { isSafeUiPath, type PluginFileInput } from "./frameHost"
import { manifestDisplayTextFindings } from "./store"

/** Where `serene-pub build` writes, relative to the package root. */
export const PLUGIN_BUILD_DIR = "dist/plugin"

/**
 * The plugin slug grammar, restated from `defineExtension`.
 *
 * Dotted and never slashed: a plugin's id IS the SDK slug (ruled 2026-09-17),
 * and `/plugin-ui/<id>/<file…>` reads the id as ONE segment, so a slashed id
 * would address a file nobody could serve.
 */
const SLUG = /^[a-z0-9]+([.-][a-z0-9]+)*$/

/** The event a genre's one required member answers (24 §3). */
const SESSION_CREATED = "core:event/session-created@1"

/** Ceilings on what one package may hand the reader, so a wrong `dir` fails fast. */
const MAX_UI_FILES = 256
const MAX_UI_BYTES = 8 * 1024 * 1024

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
	 * The package's client-side files, as `plugins:install` takes them.
	 *
	 * Everything under `ui/` plus any declared surface entry outside it —
	 * read as a set rather than only the declared entries, because a frame
	 * document loads its own script and stylesheet and a surface whose entry
	 * alone was stored renders blank.
	 */
	files: PluginFileInput[]
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

/** The media type a stored frame file is served with, by extension. */
const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
	".map": "application/json; charset=utf-8"
}

export const mimeForUiPath = (path: string): string =>
	MIME[extname(path).toLowerCase()] ?? "application/octet-stream"

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

/** Every surface entry a manifest declares, tolerant of the json being anything. */
export function declaredSurfaceEntries(manifest: unknown): string[] {
	const raw = (manifest as any)?.surfaces
	if (!raw || typeof raw !== "object") return []
	const out: string[] = []
	const take = (v: any) => {
		if (v && typeof v.entry === "string") out.push(v.entry)
	}
	take(raw["session-view"])
	take(raw.page)
	if (Array.isArray(raw.panels)) for (const p of raw.panels) take(p)
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
		.map((c) => (c && typeof c === "object" ? (c as { entry?: unknown }).entry : undefined))
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
	if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+/.test(manifest.version))
		findings.push(
			`manifest.version ${JSON.stringify(manifest.version)} is not semver. A plugin ` +
				`upgrades by version comparison.`
		)
	findings.push(...manifestDisplayTextFindings(manifest as Record<string, unknown>))

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
		const creates = documents.filter(
			(d) =>
				(d as any).input?.genre === id &&
				(d as any).input?.event === SESSION_CREATED
		)
		if (creates.length !== 1)
			findings.push(
				`genre '${id}' ships ${creates.length} create pipelines — every genre needs ` +
					`exactly one spec answering '${SESSION_CREATED}' (24 §3). A genre is its ` +
					`create pipeline's published row, so a genre without one reaches no picker.`
			)
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
	for (const entry of [...declaredSurfaceEntries(manifest), ...componentEntries]) {
		const what = componentEntries.has(entry) ? "component entry" : "surface entry"
		if (!isSafeUiPath(entry)) {
			findings.push(`${what} '${entry}' is not a servable path — relative, no '..', ` + `and under the package root.`)
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
				`${what} '${entry}' does not exist in the package. A surface an ` +
					`instance offers and cannot serve is a blank frame.`
			)
			continue
		}
		wanted.add(entry)
	}

	const files: PluginFileInput[] = []
	let bytes = 0
	for (const path of [...wanted].sort()) {
		if (!isSafeUiPath(path)) continue
		if (files.length >= MAX_UI_FILES) {
			findings.push(
				`the package ships more than ${MAX_UI_FILES} client files; refused rather ` +
					`than truncated, because a half-stored surface is worse than none.`
			)
			break
		}
		const data = await readFile(join(root, path))
		bytes += data.byteLength
		if (bytes > MAX_UI_BYTES) {
			findings.push(
				`the package's client files exceed ${MAX_UI_BYTES} bytes; refused rather ` +
					`than truncated.`
			)
			break
		}
		files.push({
			path,
			mime: mimeForUiPath(path),
			data: data.toString("base64")
		})
	}

	if (findings.length) throw new PluginPackageError(root, findings)
	return { dir: root, manifest, documents, files }
}
