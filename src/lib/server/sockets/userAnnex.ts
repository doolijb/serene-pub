/**
 * 🚧 (M2b) `appletApi:userAnnex {pluginId, op, …}` → `{pluginId, result, requestId?}`:
 * the door behind an applet frame's `user-annex` request. The person is
 * ALWAYS the socket's signed-in user — never a param. Refused unless the
 * plugin is installed, enabled and holds `applet:annex:user` (declared,
 * reviewed, not denied). Not interest-gated: a direct reply.
 */
import { and, eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { pluginsEnabled } from "$lib/server/plugins"
import { notCoreRow } from "$lib/server/plugins/frameHost"
import { appletGrant, effectivePermissions } from "$lib/server/plugins/permissions"
import { declaredPermissions } from "$lib/shared/plugins/declaredPermissions"
import {
	getUserAnnex,
	listUserAnnex,
	removeUserAnnex,
	setUserAnnex
} from "$lib/server/plugins/userAnnex"
import { askerOf, refusable } from "./refusable"

type Emit = (event: string, data: any) => void

/** The pure part: run one op for one person, once the grant is judged. */
export async function runUserAnnexOp(
	userId: number,
	pluginId: string,
	p: Sockets.PluginUserAnnex.Request
): Promise<Sockets.PluginUserAnnex.Result> {
	const base = (p as { base?: unknown }).base
	if (base !== undefined && !(Number.isInteger(base) && (base as number) >= 0))
		throw new Error("'base' is the version you last read: a whole number, 0 for none yet.")
	const key = (p as { key?: unknown }).key
	if (p.op !== "list" && typeof key !== "string")
		throw new Error("That request names no key.")
	switch (p.op) {
		case "get":
			return getUserAnnex(db, userId, pluginId, p.key)
		case "set":
			if (!("doc" in p) || p.doc === undefined)
				throw new Error("A set carries a 'doc'.")
			return setUserAnnex(db, userId, pluginId, p.key, p.doc, { base: p.base })
		case "list": {
			if (p.prefix !== undefined && typeof p.prefix !== "string")
				throw new Error("A prefix is text.")
			return { rows: await listUserAnnex(db, userId, pluginId, p.prefix) }
		}
		case "remove":
			return removeUserAnnex(db, userId, pluginId, p.key, { base: p.base })
		default:
			throw new Error("That is not a user annex operation: get, set, list or remove.")
	}
}

export const pluginsUserAnnex: Handler<
	Sockets.PluginUserAnnex.Params,
	Sockets.PluginUserAnnex.Response
> = refusable(
	"appletApi:userAnnex",
	async (socket, params, emitToUser) => {
		const userId = socket.user?.id
		if (!Number.isInteger(userId)) throw new Error("Sign in to use an extension.")
		const pluginId = (params as { pluginId?: unknown } | undefined)?.pluginId
		if (typeof pluginId !== "string" || !pluginId)
			throw new Error("That request names no extension.")
		if (!pluginsEnabled()) throw new Error("Extensions are switched off.")
		const [row] = await db
			.select({
				manifest: schema.plugins.manifest,
				adminDenied: schema.plugins.adminDenied
			})
			.from(schema.plugins)
			.where(
				and(
					eq(schema.plugins.pluginId, pluginId),
					eq(schema.plugins.enabled, true),
					notCoreRow()
				)
			)
			.limit(1)
		if (!row) throw new Error("That extension is not installed and switched on.")
		const eff = effectivePermissions(
			declaredPermissions(row.manifest),
			row.adminDenied
		)
		if (!appletGrant(eff).userAnnex)
			throw new Error("That extension has not been given the person's annex.")
		const result = await runUserAnnexOp(
			userId as number,
			pluginId,
			params as Sockets.PluginUserAnnex.Request
		)
		const response = { pluginId, result, ...askerOf(params) }
		emitToUser("appletApi:userAnnex", response)
		return response
	},
	"The extension's documents could not be reached.",
	undefined,
	(raw) => ({
		...askerOf(raw),
		pluginId: (raw as { pluginId?: unknown } | undefined)?.pluginId
	})
)

export function registerUserAnnexHandlers(
	socket: any,
	emitToUser: Emit,
	register: (socket: any, handler: Handler<any, any>, emitToUser: Emit) => void
) {
	register(socket, pluginsUserAnnex, emitToUser)
}
