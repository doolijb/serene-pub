/**
 * 🚧 (M2a) `core:query/plugin-storage@1`, the read itself: one file out of the
 * running plugin's own storage, read-only and size-capped.
 *
 * The host hands in who owns the running spec (`ownerPluginId`, a fact this
 * instance wrote at install) and who is acting (`userId`); nothing here takes
 * an id from a port. Grants come from the effective permission set, never the
 * raw manifest. The jail is the storage host's: a relative path, no `..`, and
 * the real path under the real root.
 */
import fs from "node:fs/promises"
import nodePath from "node:path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	effectivePermissions,
	perUserStorageGrant,
	storageGrant
} from "$lib/server/plugins/permissions"
import { declaredPermissions } from "$lib/shared/plugins/declaredPermissions"
import {
	storageSegment,
	userStorageDir
} from "$lib/server/plugins/SandboxManager"
import { getAppDataDir } from "$lib/server/utils/appDataDir"

/** The same 4 MiB as `PLUGIN_STORAGE_QUERY_MAX_BYTES` in the contracts (kept local so this reads without the SDK build). */
export const PLUGIN_STORAGE_QUERY_MAX_BYTES = 4 * 1024 * 1024

export interface PluginStorageRead {
	ownerPluginId: string | undefined
	userId: number | undefined
	scope?: unknown
	as?: unknown
	path: unknown
	/** Defaults to the app data dir; a test names its own. */
	dataDir?: string
}

export interface PluginStorageAnswer {
	main: unknown
	found: boolean
}

const mib = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MiB`

export async function readPluginStorage(
	db: Db,
	req: PluginStorageRead
): Promise<PluginStorageAnswer> {
	if (!req.ownerPluginId)
		throw new Error(
			"plugin-storage reads only a plugin's own pipeline's storage"
		)
	const scope = req.scope === "me" ? "me" : "pub"
	const as = req.as === "text" ? "text" : "json"
	const rel = req.path
	if (typeof rel !== "string" || rel.length === 0)
		throw new Error("plugin-storage: a path is required")
	if (nodePath.isAbsolute(rel) || rel.split(/[\\/]/).includes(".."))
		throw new Error("plugin-storage: path escapes the plugin's folder")

	const [row] = await db
		.select({
			manifest: schema.plugins.manifest,
			adminDenied: schema.plugins.adminDenied
		})
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, req.ownerPluginId))
		.limit(1)
	if (!row)
		throw new Error(
			`plugin-storage: '${req.ownerPluginId}' is not installed`
		)
	const eff = effectivePermissions(
		declaredPermissions(row.manifest as any),
		(row.adminDenied ?? null) as string[] | null
	)
	const dataDir = req.dataDir ?? getAppDataDir()
	let root: string | undefined
	if (scope === "pub") {
		if (storageGrant(eff) === undefined)
			throw new Error("plugin-storage: storage is not granted to this plugin")
		root = nodePath.join(dataDir, "extensions_data", storageSegment(req.ownerPluginId))
	} else {
		if (perUserStorageGrant(eff) === undefined)
			throw new Error(
				"plugin-storage: per-user storage is not granted to this plugin"
			)
		if (req.userId == null)
			throw new Error("plugin-storage: no person is acting for this run")
		root = userStorageDir(dataDir, req.ownerPluginId, req.userId)
		if (!root) throw new Error("plugin-storage: no person is acting for this run")
	}

	let real: string
	try {
		const realRoot = await fs.realpath(root)
		real = await fs.realpath(nodePath.join(root, rel))
		if (!real.startsWith(realRoot + nodePath.sep))
			throw new Error("plugin-storage: path escapes the plugin's folder")
	} catch (e: any) {
		if (e?.code === "ENOENT" || e?.code === "ENOTDIR")
			return { main: null, found: false }
		throw e
	}
	const st = await fs.stat(real)
	if (!st.isFile()) return { main: null, found: false }
	if (st.size > PLUGIN_STORAGE_QUERY_MAX_BYTES)
		throw new Error(
			`plugin-storage: '${rel}' is ${mib(st.size)}, over the ${mib(PLUGIN_STORAGE_QUERY_MAX_BYTES)} a query reads`
		)
	const text = await fs.readFile(real, "utf8")
	if (as === "text") return { main: text, found: true }
	try {
		return { main: JSON.parse(text), found: true }
	} catch {
		throw new Error(`plugin-storage: '${rel}' is not valid JSON`)
	}
}
