/**
 * Serve a plugin's frame documents (20 §12).
 *
 * The URL is `/plugin-ui/<pluginId>/<file...>` — the FIRST segment is the
 * plugin id and everything after it is the stored file path. One segment,
 * because a plugin slug is dotted and never slashed (SDK `defineExtension`);
 * an id outside that grammar is a 404 rather than a guess.
 *
 * No session auth, deliberately: an opaque-origin sandbox sends no
 * credentials, so a cookie check here would refuse every legitimate frame
 * load. What's served is vendor code a plugin shipped — never user data; the
 * data plane is the MessageChannel the host feeds, which *is* session-scoped.
 * Only enabled plugins serve at all, so the surface follows the admin's
 * switch.
 *
 * Every response carries the CSP composed from the plugin's grants: the same
 * declared, admin-deniable `network:<host>` permission that governs the
 * server-side fetchHost decides where this document may connect. No grant, no
 * network.
 */
import type { RequestHandler } from "@sveltejs/kit"
import { eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	readPluginFile,
	frameCsp,
	parseFrameSrc
} from "$lib/server/plugins/frameHost"

export const GET: RequestHandler = async (event) => {
	const parsed = parseFrameSrc(event.params.rest)
	if (!parsed) return new Response("Not found", { status: 404 })
	const { pluginId, path } = parsed

	const [plugin] = await db
		.select({
			enabled: schema.plugins.enabled,
			manifest: schema.plugins.manifest,
			adminDenied: schema.plugins.adminDenied
		})
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, pluginId))
		.limit(1)
	if (!plugin?.enabled) return new Response("Not found", { status: 404 })

	const file = await readPluginFile(db, pluginId, path)
	if (!file) return new Response("Not found", { status: 404 })

	return new Response(new Uint8Array(Buffer.from(file.content, "base64")), {
		headers: {
			"Content-Type": file.mime,
			"Content-Security-Policy": frameCsp(
				plugin.manifest,
				plugin.adminDenied
			),
			// Belt beside the sandbox attribute's braces: even a direct
			// navigation to this URL renders inert.
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "private, max-age=300"
		}
	})
}
