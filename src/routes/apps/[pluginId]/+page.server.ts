import type { PageServerLoad } from "./$types"
import { and, eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { isPluginSlug, notCoreRow } from "$lib/server/plugins/frameHost"
import { pluginsEnabled } from "$lib/server/plugins/flag"
import { appletMount } from "$lib/server/plugins/appletMount"
import { listOfferedGenres } from "$lib/server/pipelines/entities/sessionGenres"

/**
 * 🚧 M2c: an applet's launcher. `/apps/<pluginId>` mounts the plugin's `session-view` surface with no session, for
 * a plugin that offers an applet genre it provides the view for. Anything else is the not-found state.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!pluginsEnabled()) return {}
	const pluginId = params.pluginId ?? ""
	if (!isPluginSlug(pluginId)) return {}

	const [plugin] = await db
		.select({
			enabled: schema.plugins.enabled,
			name: schema.plugins.name,
			version: schema.plugins.version,
			manifest: schema.plugins.manifest,
			adminDenied: schema.plugins.adminDenied
		})
		.from(schema.plugins)
		.where(and(eq(schema.plugins.pluginId, pluginId), notCoreRow()))
		.limit(1)
	if (!plugin?.enabled) return {}

	const mount = appletMount(pluginId, plugin, await listOfferedGenres(db))
	return mount ?? {}
}
