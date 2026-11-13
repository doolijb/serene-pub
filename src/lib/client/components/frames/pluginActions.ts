import { v4 as uuid } from "uuid"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

/**
 * 🚧 Run one of a package's `pluginActions` outside a session (M0,
 * SHAPES L12 Seams). Resolves the handler's value; rejects with the server's
 * own sentence. ⚠ Not a session action.
 */
export async function invokePluginAction(
	pluginId: string,
	action: string,
	input?: Record<string, unknown>,
	/**
	 * 🚧 M2e: sent only by the plugin's own applet mount (the launcher, or its session view). It names the mount
	 * for the server to check against its own data (`frameCauseOfInvoke`); the server never takes it as the cause.
	 */
	fromApplet?: { pluginId: string; sessionId?: number }
): Promise<unknown> {
	// The uuid package, not the Web Crypto UUID: that is undefined on a plain-http LAN address.
	const requestId = uuid()
	const res = await awaitReply({
		socket: useTypedSocket(),
		event: "pluginActions:invoke",
		errorEvent: "pluginActions:invoke:error",
		params: {
			pluginId,
			action,
			...(input ? { input } : {}),
			...(fromApplet ? { fromApplet } : {}),
			requestId
		},
		match: (r) => r?.requestId === requestId,
		matchError: (e) => (e as { requestId?: string } | null)?.requestId === requestId,
		timeoutMs: 130_000
	})
	return res.result
}
