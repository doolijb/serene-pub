/**
 * Which plugins are switched off — for LISTINGS only (R67, owner 2026-09-24):
 * a disabled plugin appears nowhere in the front end outside the plugins
 * page. Its rows stay as they are (specs published, choices stored), so
 * turning it back on restores everything, and sessions already running on
 * what it provided keep running: resolution and dispatch never read this.
 *
 * One read per listing — the plugins table is small, and a listing asks once.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

export interface DisabledPlugins {
	/** `plugins.id` — what `source_plugin_id` / `owner_plugin_id` hold. */
	ids: Set<number>
	/** `plugins.plugin_id` — what id prefixes and manifest keys hold. */
	slugs: Set<string>
	/** Is a row owned by a disabled plugin, by its integer owner column? */
	owns(ownerId: number | null | undefined): boolean
	/** Is a namespaced id (`<pluginId>:…`) a disabled plugin's? */
	ownsId(id: string | null | undefined): boolean
}

export async function disabledPlugins(db: Db): Promise<DisabledPlugins> {
	const rows = await db
		.select({ id: schema.plugins.id, pluginId: schema.plugins.pluginId })
		.from(schema.plugins)
		.where(eq(schema.plugins.enabled, false))
	const ids = new Set(rows.map((r) => r.id))
	const slugs = new Set(rows.map((r) => r.pluginId))
	return {
		ids,
		slugs,
		owns: (ownerId) => ownerId != null && ids.has(ownerId),
		ownsId: (id) => {
			if (!id) return false
			const at = id.indexOf(":")
			return at > 0 && slugs.has(id.slice(0, at))
		}
	}
}
