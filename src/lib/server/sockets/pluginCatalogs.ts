/**
 * 🚧 **Plugin string catalogs over the wire** (M0, SHAPES L5; lane P3):
 * `pluginCatalogs:get {pluginId, language}` →
 * `{pluginId, language, locale, entries}` — the package's `lang/<locale>.json`
 * that best matches the viewer's language, for a frame or component's
 * `ctx.t` (precedence: plugin catalog → the app's MT table → English).
 * Any signed-in person.
 *
 * Interface stub written by supervisor P; lane P3 builds the body.
 */
import type { Handler } from "$lib/shared/events"
import { and, eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { pluginsEnabled } from "$lib/server/plugins"
import { notCoreRow } from "$lib/server/plugins/frameHost"
import {
	loadPluginCatalogs,
	pluginCatalogLocaleFor,
	pluginCatalogOf
} from "$lib/server/plugins/catalogs"
import { refusable } from "./refusable"

type Emit = (event: string, data: any) => void

export const pluginCatalogsGet: Handler<
	Sockets.PluginCatalogs.Get.Params,
	Sockets.PluginCatalogs.Get.Response
> = refusable(
	"pluginCatalogs:get",
	async (socket, params, emitToUser) => {
		if (typeof socket.user?.id !== "number") {
			throw new Error("Sign in to read an extension's translations.")
		}
		const pluginId = String(params?.pluginId ?? "")
		const language = String(params?.language ?? "en")
		const empty: Sockets.PluginCatalogs.Get.Response = {
			pluginId,
			language,
			locale: null,
			entries: {}
		}
		let response = empty
		if (pluginsEnabled()) {
			const [row] = await db
				.select({ id: schema.plugins.id })
				.from(schema.plugins)
				.where(
					and(
						eq(schema.plugins.pluginId, pluginId),
						eq(schema.plugins.enabled, true),
						notCoreRow()
					)
				)
				.limit(1)
			if (row) {
				await loadPluginCatalogs(db, pluginId)
				const locale = pluginCatalogLocaleFor(pluginId, language)
				if (locale) {
					response = {
						pluginId,
						language,
						locale,
						entries: Object.fromEntries(pluginCatalogOf(pluginId, locale))
					}
				}
			}
		}
		emitToUser("pluginCatalogs:get", response)
		return response
	},
	"The extension's translations could not be read.",
	undefined,
	(raw) => ({ pluginId: (raw as { pluginId?: unknown } | undefined)?.pluginId })
)

export function registerPluginCatalogHandlers(
	socket: any,
	emitToUser: Emit,
	register: (socket: any, handler: Handler<any, any>, emitToUser: Emit) => void
) {
	register(socket, pluginCatalogsGet, emitToUser)
}
