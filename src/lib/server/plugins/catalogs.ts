/**
 * 🚧 **Plugin string catalogs** (M0, SHAPES L5; lane P3).
 *
 * A package's `lang/<locale>.json` — `{ "English source text": "translation" }`
 * with `{0}`…`{n}` placeholders — is stored by install as a `kind 'asset'`
 * `plugin_files` row. This module reads those rows into a per-plugin module
 * cache so `pluginCatalogOf` can answer synchronously.
 */
import { and, asc, eq, like } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { readPluginFileBytes } from "./frameHost"

interface Cached {
	/** The rows' hashes, sorted — the cache key. */
	key: string
	catalogs: Map<string, ReadonlyMap<string, string>>
}

const cache = new Map<string, Cached>()
const EMPTY: ReadonlyMap<string, string> = new Map()

const localeOfPath = (path: string): string =>
	path.replace(/^lang\//, "").replace(/\.json$/, "").toLowerCase()

/** The catalog a plugin ships for exactly this locale; empty when none is loaded. */
export function pluginCatalogOf(pluginId: string, locale: string): ReadonlyMap<string, string> {
	return cache.get(pluginId)?.catalogs.get(locale.toLowerCase()) ?? EMPTY
}

/** (Re)read a plugin's `lang/*.json` rows; returns the locales loaded, sorted. */
export async function loadPluginCatalogs(db: Db, pluginId: string): Promise<string[]> {
	const rows = await db
		.select()
		.from(schema.pluginFiles)
		.where(
			and(
				eq(schema.pluginFiles.pluginId, pluginId),
				eq(schema.pluginFiles.kind, "asset"),
				like(schema.pluginFiles.path, "lang/%.json")
			)
		)
		.orderBy(asc(schema.pluginFiles.path))
	const key = rows.map((r) => `${r.path}:${r.hash}`).join("|")
	const hit = cache.get(pluginId)
	if (hit && hit.key === key) return [...hit.catalogs.keys()].sort()

	const catalogs = new Map<string, ReadonlyMap<string, string>>()
	for (const row of rows) {
		try {
			const bytes = await readPluginFileBytes(row)
			const parsed: unknown = JSON.parse(bytes.toString("utf8"))
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("not an object")
			}
			const map = new Map<string, string>()
			for (const [k, v] of Object.entries(parsed)) {
				if (typeof v === "string") map.set(k, v)
			}
			catalogs.set(localeOfPath(row.path), map)
		} catch {
			console.warn(
				`Plugin ${pluginId}: ${row.path} is not a JSON object of strings; skipped.`
			)
		}
	}
	cache.set(pluginId, { key, catalogs })
	return [...catalogs.keys()].sort()
}

/** The best loaded locale for an app language: exact → base → first `<base>-*` → null. */
export function pluginCatalogLocaleFor(pluginId: string, language: string): string | null {
	const loaded = cache.get(pluginId)?.catalogs
	if (!loaded || !loaded.size) return null
	const want = language.toLowerCase()
	if (loaded.has(want)) return want
	const base = want.split("-")[0]
	if (loaded.has(base)) return base
	return [...loaded.keys()].sort().find((l) => l.startsWith(`${base}-`)) ?? null
}
