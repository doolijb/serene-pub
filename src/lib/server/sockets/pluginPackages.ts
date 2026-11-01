/**
 * **Plugin packages over the wire** (PLAN-pipeline-canvas-and-genre-authoring
 * §7, P5): export a genre as a content-only package zip. Admin-only, and on unless
 * `SP_PLUGINS_ENABLED` turns the subsystem off (ruling 6), refused in `plugins:installLocal`'s own
 * words (`requirePackageInstall`).
 *
 * The upload half is an HTTP route, not a socket event: a package zip is installed by
 * `/api/admin/plugins/package` (`$lib/server/plugins/packageUpload.ts`),
 * which takes the zip in pieces and keeps it on disk instead of in a message.
 */
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { refusable } from "./refusable"
import { requirePackageInstall } from "./plugins"

type Emit = (event: string, data: any) => void

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

export function registerPluginPackageHandlers(
	socket: any,
	emitToUser: Emit,
	register: (socket: any, handler: Handler<any, any>, emitToUser: Emit) => void
) {
	register(socket, pluginsExportPackage, emitToUser)
}
