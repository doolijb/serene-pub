/**
 * 🚧 **Plugin actions over the wire** (M0, SHAPES L12 Seams; lane P4):
 * `pluginActions:invoke {pluginId, action, input?, requestId?}` →
 * `{pluginId, action, result, requestId?}` — a package's `pluginActions`
 * handler run OUTSIDE a session for whoever is signed in. The door behind a
 * frame's or plugin page's `ctx.invoke(name, payload)` and the host half of
 * the `file-pick` / `file-save` widget requests. ⚠ Not a session **action**.
 *
 * Interface stub written by supervisor P; lane P4 builds the body.
 */
import type { Handler } from "$lib/shared/events"
import { db } from "$lib/server/db"
import { invokePluginAction } from "$lib/server/plugins/pluginActions"
import { askerOf, refusable } from "./refusable"

type Emit = (event: string, data: any) => void

export const pluginActionsInvoke: Handler<
	Sockets.PluginActions.Invoke.Params,
	Sockets.PluginActions.Invoke.Response
> = refusable(
	"pluginActions:invoke",
	async (socket, params, emitToUser) => {
		const userId = socket.user?.id
		if (!Number.isInteger(userId)) throw new Error("Sign in to use an extension.")
		const p = (params ?? {}) as Partial<Sockets.PluginActions.Invoke.Params>
		const { pluginId, action } = p
		const input = p.input === undefined ? {} : p.input
		if (
			typeof pluginId !== "string" ||
			!pluginId ||
			typeof action !== "string" ||
			!action ||
			typeof input !== "object" ||
			input === null ||
			Array.isArray(input)
		)
			throw new Error("That request names no extension action.")
		const result = await invokePluginAction(db, { pluginId, action, input, userId })
		const response = { pluginId, action, result, ...askerOf(params) }
		emitToUser("pluginActions:invoke", response)
		return response
	},
	"The extension could not do that.",
	undefined,
	(raw) => ({
		...askerOf(raw),
		pluginId: (raw as { pluginId?: unknown } | undefined)?.pluginId,
		action: (raw as { action?: unknown } | undefined)?.action
	})
)

export function registerPluginActionHandlers(
	socket: any,
	emitToUser: Emit,
	register: (socket: any, handler: Handler<any, any>, emitToUser: Emit) => void
) {
	register(socket, pluginActionsInvoke, emitToUser)
}
