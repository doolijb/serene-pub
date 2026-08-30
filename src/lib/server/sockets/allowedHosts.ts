import type { Handler } from "$lib/shared/events"
import {
	isWildcardAllowed,
	listAllowedHosts
} from "$lib/server/sockets/originAllowlist"

/**
 * The read-only allowed-hosts surface (plan 26 §9, re-scoped).
 *
 * §9 originally specified an app-editable `allowed_hosts` table so an admin
 * could add hostnames the zero-config default missed. Collapsing the app and
 * Socket.IO onto one listener removed the cases that needed it: a browser tab's
 * handshake is same-origin now, so the same-hostname rule covers every
 * deployment shape we ship — direct, LAN, reverse proxy and tunnel alike. What
 * was left worth building is the half nobody disputed: showing an admin what is
 * actually in effect, and where each entry came from.
 *
 * Read-only by construction. There is no write handler here, and that is the
 * point rather than an omission — every host below is configured somewhere with
 * more authority than a form (the process environment, or the running tunnel),
 * and offering an in-app edit that silently loses on restart would be worse
 * than offering none.
 */
export const allowedHostsGet: Handler<
	Sockets.AllowedHosts.Get.Params,
	Sockets.AllowedHosts.Get.Response
> = {
	event: "allowedHosts:get",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")

		const hosts: Sockets.AllowedHosts.HostEntry[] = listAllowedHosts()

		// A live tunnel's hostname is genuinely reachable and genuinely
		// allowed, but not via the list — the same-hostname rule covers it,
		// because page and socket now share an origin. Attributing it to the
		// tunnel is the honest label; claiming it as a configured entry would
		// imply something an admin could edit or delete here.
		const { getActiveTunnelHostname } = await import(
			"$lib/server/tunnels/supervisor"
		)
		const tunnelHostname = getActiveTunnelHostname()
		if (
			tunnelHostname &&
			!hosts.some((h) => h.hostname === tunnelHostname)
		) {
			hosts.push({ hostname: tunnelHostname, source: "tunnel" })
		}

		const res: Sockets.AllowedHosts.Get.Response = {
			wildcard: isWildcardAllowed(),
			hosts
		}
		emitToUser("allowedHosts:get", res)
		return res
	}
}

export function registerAllowedHostHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, allowedHostsGet, emitToUser)
}
