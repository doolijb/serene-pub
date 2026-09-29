import type { PageServerLoad } from "./$types"
import { and, eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	surfacesOf,
	frameSrc,
	isPluginSlug,
	notCoreRow
} from "$lib/server/plugins/frameHost"
import { pluginsEnabled } from "$lib/server/plugins/flag"

/**
 * Resolve the plugin's declared `page` surface (20 §12). The frame's document
 * is served (and CSP'd) by the plugin-ui route; this only picks the entry so
 * a disabled or page-less plugin renders the not-found state, never a dead
 * frame. The frame itself is opaque-origin, so no auth rides this load — the
 * page is vendor code, not user data. With the extension subsystem off
 * (`SP_PLUGINS_ENABLED`) no plugin has a page: the not-found state.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!pluginsEnabled()) return {}
	// One segment, the same id the frame URL carries: a plugin slug is dotted
	// and never slashed, so nothing here counts segments.
	const [pluginId = ""] = (params.rest ?? "").split("/").filter(Boolean)
	if (!isPluginSlug(pluginId)) return {}

	const [plugin] = await db
		.select({
			enabled: schema.plugins.enabled,
			name: schema.plugins.name,
			manifest: schema.plugins.manifest
		})
		.from(schema.plugins)
		.where(and(eq(schema.plugins.pluginId, pluginId), notCoreRow()))
		.limit(1)
	if (!plugin?.enabled) return {}

	const page = surfacesOf(plugin.manifest, pluginId).page
	if (!page) return {}
	return { src: frameSrc(pluginId, page.entry), title: page.title ?? plugin.name }
}
