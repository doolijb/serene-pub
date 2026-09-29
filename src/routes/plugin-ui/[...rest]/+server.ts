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
 * switch — and nothing serves while the extension subsystem is off
 * (`SP_PLUGINS_ENABLED`): a 404, as if no plugin were installed.
 *
 * Every response carries the CSP composed from the plugin's grants: the same
 * declared, admin-deniable `network:<host>` permission that governs the
 * server-side fetchHost decides where this document may connect. No grant, no
 * network.
 */
import { createHash } from "node:crypto"
import type { RequestHandler } from "@sveltejs/kit"
import { and, eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	readPluginFile,
	frameCsp,
	notCoreRow,
	parseFrameSrc
} from "$lib/server/plugins/frameHost"
import { pluginsEnabled } from "$lib/server/plugins/flag"

export const GET: RequestHandler = async (event) => {
	if (!pluginsEnabled()) return new Response("Not found", { status: 404 })
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
		// `core` is never a plugin's frame: a page answers core's owner as its own.
		.where(and(eq(schema.plugins.pluginId, pluginId), notCoreRow()))
		.limit(1)
	if (!plugin?.enabled) return new Response("Not found", { status: 404 })

	const file = await readPluginFile(db, pluginId, path)
	if (!file) return new Response("Not found", { status: 404 })

	// Revalidated on every load, answered 304 while nothing about the response
	// changed: an update to a plugin reaches the next page load (a component
	// module, a document inside `sp-frame`). The tag covers the policy too —
	// a grant an admin withdrew must reach a frame whose bytes did not change.
	const csp = frameCsp(plugin.manifest, plugin.adminDenied)
	const etag = `"${createHash("sha256").update(`${file.hash}\n${file.mime}\n${csp}`).digest("hex").slice(0, 40)}"`
	const cacheHeaders = { ETag: etag, "Cache-Control": "private, no-cache", "Content-Security-Policy": csp }
	if (event.request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: cacheHeaders })

	return new Response(new Uint8Array(Buffer.from(file.content, "base64")), {
		headers: {
			"Content-Type": file.mime,
			...cacheHeaders,
			// The CSP's own `sandbox` is what keeps a direct navigation to this
			// URL at an opaque origin; this only stops a type being guessed.
			"X-Content-Type-Options": "nosniff"
		}
	})
}
