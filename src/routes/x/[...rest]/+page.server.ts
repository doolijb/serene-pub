import type { PageServerLoad } from "./$types"
import { eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { surfacesOf, frameSrc } from "$lib/server/plugins/frameHost"

/**
 * Resolve the plugin's declared `page` surface (20 §12). The frame's document
 * is served (and CSP'd) by the plugin-ui route; this only picks the entry so
 * a disabled or page-less plugin renders the not-found state, never a dead
 * frame. The frame itself is opaque-origin, so no auth rides this load — the
 * page is vendor code, not user data.
 */
export const load: PageServerLoad = async ({ params }) => {
	const segments = (params.rest ?? "").split("/").filter(Boolean)
	if (segments.length < 2) return {}
	const pluginId = `${segments[0]}/${segments[1]}`

	const [plugin] = await db
		.select({
			enabled: schema.plugins.enabled,
			name: schema.plugins.name,
			manifest: schema.plugins.manifest
		})
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, pluginId))
		.limit(1)
	if (!plugin?.enabled) return {}

	const page = surfacesOf(plugin.manifest).page
	if (!page) return {}
	return { src: frameSrc(pluginId, page.entry), title: page.title ?? plugin.name }
}
