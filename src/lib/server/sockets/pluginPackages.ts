/**
 * **Plugin packages over the wire** (PLAN-pipeline-canvas-and-genre-authoring
 * §7, P5): export a genre as a content-only package zip, and install a package
 * zip uploaded by an admin — the upload half `plugins:installLocal` lacks.
 *
 * Both are admin-only and both stay behind `SP_PLUGINS_ENABLED` (ruling 6),
 * refused in `plugins:installLocal`'s own words (`requirePackageInstall`).
 */
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { unzipSync } from "fflate"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { getAppDataDir } from "$lib/server/utils/appDataDir"
import { PLUGIN_BUILD_DIR } from "$lib/server/plugins/pluginPackage"
import { refusable } from "./refusable"
import { installPackageFromDir, requirePackageInstall } from "./plugins"

type Emit = (event: string, data: any) => void

/** The upload ceiling, decoded — the package reader's own client-file cap. */
export const MAX_PACKAGE_BYTES = 8 * 1024 * 1024
/** What the unzip will write, at most: entries and inflated bytes. */
const MAX_ENTRIES = 2048
const MAX_INFLATED_BYTES = 64 * 1024 * 1024

const MANIFEST = `${PLUGIN_BUILD_DIR}/manifest.json`

/**
 * A zip entry name this will write, or null for one it refuses: absolute
 * (`/x`, `C:\x`, `\\host`), backslashed, or with a `..` / `.` segment.
 */
export function safeEntryPath(name: string): string | null {
	if (!name || name.includes("\0") || name.includes("\\")) return null
	if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return null
	const parts = name.split("/")
	if (parts.some((p) => p === ".." || p === ".")) return null
	return name
}

/**
 * Unzip `bytes` into a map of safe relative paths. Throws a sentence for an
 * entry it will not write, for too many entries, or for too much inflated
 * data. A package zipped with its folder around it (`my-plugin/dist/…`) is
 * unwrapped to its root.
 */
export function unzipPackage(bytes: Uint8Array): Record<string, Uint8Array> {
	const unsafe: string[] = []
	let count = 0
	let inflated = 0
	let entries: Record<string, Uint8Array>
	try {
		entries = unzipSync(bytes, {
			filter: (f) => {
				if (f.name.endsWith("/")) return false
				if (!safeEntryPath(f.name)) {
					unsafe.push(f.name)
					return false
				}
				count++
				inflated += f.originalSize
				return count <= MAX_ENTRIES && inflated <= MAX_INFLATED_BYTES
			}
		})
	} catch (e) {
		throw new Error(
			`That file is not a readable zip: ${e instanceof Error ? e.message : String(e)}.`
		)
	}
	if (unsafe.length)
		throw new Error(
			`The package names files outside its own folder (${unsafe
				.slice(0, 3)
				.map((n) => `'${n}'`)
				.join(", ")}). Nothing was installed.`
		)
	if (count > MAX_ENTRIES || inflated > MAX_INFLATED_BYTES)
		throw new Error(
			`The package unpacks to more than ${MAX_ENTRIES} files or ` +
				`${MAX_INFLATED_BYTES / 1024 / 1024} MiB. Nothing was installed.`
		)

	if (!(MANIFEST in entries)) {
		const roots = new Set(Object.keys(entries).map((k) => k.split("/")[0]))
		const [only] = [...roots]
		if (roots.size === 1 && `${only}/${MANIFEST}` in entries) {
			const out: Record<string, Uint8Array> = {}
			for (const [k, v] of Object.entries(entries))
				out[k.slice(only!.length + 1)] = v
			return out
		}
	}
	return entries
}

/** A genre's create-spec semver, for the default package version. */
async function defaultVersion(genreId: string): Promise<string> {
	const rows = (await db
		.select({
			semver: schema.pipelineSpecVersions.semver,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.id, schema.pipelineSpecs.activeVersionId)
		)
		.where(eq(schema.pipelineSpecVersions.inputGenre, genreId))) as any[]
	const create = rows.find(
		(r) => r.inputEvent === "core:event/session-created@1"
	)
	return create?.semver ?? "1.0.0"
}

/**
 * `plugins:exportPackage {genreId, version?, name?, scaffold?}` →
 * `{blob, filename: "<slug>-<version>.zip", warnings}` — with `scaffold`, the
 * same package plus its source (`exportScaffold.ts`), as
 * `<slug>-<version>-source.zip`.
 *
 * The slug is the genre id's owner segment: an in-app genre under `acme.lab`
 * exports as `acme.lab`. The version defaults to the owning plugin's, else
 * the create pipeline's; the name to the plugin's, else the genre's.
 */
export const pluginsExportPackage: Handler<
	Sockets.Plugins.ExportPackage.Params,
	Sockets.Plugins.ExportPackage.Response
> = refusable(
	"plugins:exportPackage",
	async (socket, params, emitToUser) => {
		requirePackageInstall(socket, emitToUser)
		const genreId = typeof params?.genreId === "string" ? params.genreId.trim() : ""
		if (!genreId) throw new Error("Name the genre to export.")
		const slug = genreId.split(":")[0] ?? ""

		const [plugin] = (await db
			.select({
				name: schema.plugins.name,
				version: schema.plugins.version
			})
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, slug))
			.limit(1)) as Array<{ name: string; version: string }>

		const version =
			typeof params.version === "string" && params.version.trim()
				? params.version.trim()
				: plugin?.version && plugin.version !== "0.0.0"
					? plugin.version
					: await defaultVersion(genreId)

		const { exportGenrePackage, zipPackage } = await import(
			"$lib/server/plugins/exportPackage"
		)
		const { i18nText } = await import("@serene-pub/sdk")
		// The genre's own label when no plugin names the package.
		const genreName = async (): Promise<string> => {
			const rows = (await db
				.select({ genre: schema.pipelineSpecVersions.genre })
				.from(schema.pipelineSpecs)
				.innerJoin(
					schema.pipelineSpecVersions,
					eq(
						schema.pipelineSpecVersions.id,
						schema.pipelineSpecs.activeVersionId
					)
				)
				.where(eq(schema.pipelineSpecVersions.inputGenre, genreId))) as any[]
			const named = rows.find((r) => r.genre?.name)
			return (named && i18nText(named.genre.name)) || genreId
		}
		const name =
			typeof params.name === "string" && params.name.trim()
				? params.name.trim()
				: plugin?.name || (await genreName())

		const pkg = await exportGenrePackage(db, { genreId, slug, version, name })
		// With source (§7, "export as scaffold"): the authoring half beside
		// the built package, so the zip unpacks into a package
		// `serene-pub build` rebuilds. What it cannot carry as data is listed
		// in its README and said here too.
		let files = pkg.files
		let warnings = pkg.warnings
		if (params.scaffold === true) {
			const { scaffoldSourceFor } = await import("$lib/server/plugins/exportScaffold")
			const { PLUGIN_BUILD_DIR } = await import("$lib/server/plugins/pluginPackage")
			const source = await scaffoldSourceFor(pkg.manifest, pkg.files, PLUGIN_BUILD_DIR)
			files = { ...pkg.files, ...source.files }
			warnings = [...warnings, ...source.todo.map((t) => `To finish the source: ${t}`)]
		}
		const response = {
			blob: zipPackage(files),
			filename: `${slug}-${version}${params.scaffold === true ? "-source" : ""}.zip`,
			warnings
		}
		emitToUser("plugins:exportPackage", response)
		return response
	},
	"The genre could not be exported."
)

/**
 * `plugins:installPackage {filename, bytes}` — `bytes` is the zip, base64, at
 * most 8 MiB decoded. Unzipped into a fresh folder under the data dir
 * (`plugin-uploads/<random>`), installed exactly as `plugins:installLocal`
 * installs a folder, and the folder removed. Answers what `installLocal`
 * answers.
 */
export const pluginsInstallPackage: Handler<
	Sockets.Plugins.InstallPackage.Params,
	Sockets.Plugins.InstallPackage.Response
> = refusable(
	"plugins:installPackage",
	async (socket, params, emitToUser) => {
		requirePackageInstall(socket, emitToUser)
		const raw: unknown = params?.bytes
		let bytes: Uint8Array
		if (typeof raw === "string") {
			// Base64 inflates by 4/3; refuse before decoding what cannot fit.
			if (raw.length > Math.ceil((MAX_PACKAGE_BYTES * 4) / 3) + 4)
				throw new Error(
					`That package is larger than ${MAX_PACKAGE_BYTES / 1024 / 1024} MiB.`
				)
			bytes = new Uint8Array(Buffer.from(raw, "base64"))
		} else if (raw instanceof Uint8Array) bytes = raw
		else throw new Error("Attach the package zip to install.")
		if (!bytes.byteLength) throw new Error("That package is empty.")
		if (bytes.byteLength > MAX_PACKAGE_BYTES)
			throw new Error(
				`That package is larger than ${MAX_PACKAGE_BYTES / 1024 / 1024} MiB.`
			)

		const entries = unzipPackage(bytes)
		if (!(MANIFEST in entries))
			throw new Error(
				`${typeof params.filename === "string" ? `'${params.filename}'` : "That zip"} ` +
					`has no '${MANIFEST}'. Install the zip 'serene-pub build' or an ` +
					`export wrote.`
			)

		const dir = path.join(getAppDataDir(), "plugin-uploads", randomUUID())
		try {
			for (const [rel, data] of Object.entries(entries)) {
				const target = path.join(dir, rel)
				// Belt and braces: the joined path must stay inside the folder.
				if (!target.startsWith(dir + path.sep))
					throw new Error(`The package names '${rel}', outside its folder.`)
				await mkdir(path.dirname(target), { recursive: true })
				await writeFile(target, data)
			}
			const response = await installPackageFromDir(
				socket,
				dir,
				emitToUser,
				"installPackage"
			)
			emitToUser("plugins:installPackage", response)
			return response
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	},
	"The package could not be installed."
)

export function registerPluginPackageHandlers(
	socket: any,
	emitToUser: Emit,
	register: (socket: any, handler: Handler<any, any>, emitToUser: Emit) => void
) {
	register(socket, pluginsExportPackage, emitToUser)
	register(socket, pluginsInstallPackage, emitToUser)
}
