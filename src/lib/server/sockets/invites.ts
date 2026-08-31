import { eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import {
	createInvite,
	listInvites,
	revokeInvite
} from "$lib/server/auth/invites"
import {
	isWildcardAllowed,
	listAllowedHosts
} from "$lib/server/sockets/originAllowlist"

/**
 * Admin-side invite management (plan 27 §2–§3).
 *
 * A token is returned exactly once, at creation. It is stored only as a hash,
 * so an admin who loses the link generates a new invite rather than recovering
 * the old one — the same rule as recovery codes, for the same reason.
 */

function failWith(
	event: string,
	emitToUser: (event: string, data: any) => void,
	err: unknown
): never {
	const message = err instanceof Error ? err.message : "Something went wrong."
	emitToUser(`${event}:error`, { error: message })
	throw err instanceof Error ? err : new Error(message)
}

function toView(
	row: SelectAccountInvite,
	username?: string | null
): Sockets.Invites.InviteView {
	return {
		id: row.id,
		kind: row.kind,
		userId: row.userId,
		username: username ?? null,
		expiresAt: row.expiresAt,
		usedAt: row.usedAt,
		revokedAt: row.revokedAt,
		createdAt: row.createdAt
	}
}

/**
 * Hostnames an invite link could sensibly point at (27 §3).
 *
 * An admin sitting on `http://192.168.1.5:3000` who sends that link to someone
 * outside the network has sent them a dead address. So the choice is offered
 * explicitly rather than guessed, with the most externally-reachable option
 * preselected.
 *
 * The admin's own current origin is not listed here — the client contributes
 * that itself, since only the browser knows it.
 */
async function inviteHostOptions(): Promise<Sockets.Invites.HostOption[]> {
	const options: Sockets.Invites.HostOption[] = []

	// A running tunnel is the whole reason someone outside the network can
	// reach this instance, so it outranks everything else.
	const { getActiveTunnelHostname } = await import(
		"$lib/server/tunnels/supervisor"
	)
	const tunnel = getActiveTunnelHostname()
	if (tunnel) {
		options.push({
			hostname: tunnel,
			label: "Active tunnel",
			source: "tunnel",
			// A tunnel always terminates TLS; never offer an http link for it.
			forceHttps: true,
			priority: 3
		})
	}

	// Configured hosts, unless the allowlist has been switched off entirely —
	// a wildcard names no host, so there is nothing to offer from it.
	if (!isWildcardAllowed()) {
		for (const entry of listAllowedHosts()) {
			if (entry.source !== "env") continue
			options.push({
				hostname: entry.hostname,
				label: "Configured host",
				source: "env",
				forceHttps: false,
				priority: 2
			})
		}
	}

	return options
}

export const invitesList: Handler<
	Sockets.Invites.List.Params,
	Sockets.Invites.List.Response
> = {
	event: "invites:list",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const rows = await listInvites()
		const users = await db.query.users.findMany({
			columns: { id: true, username: true }
		})
		const nameById = new Map(users.map((u) => [u.id, u.username]))
		const res: Sockets.Invites.List.Response = {
			invites: rows.map((r) =>
				toView(r, r.userId ? nameById.get(r.userId) : null)
			),
			hostOptions: await inviteHostOptions()
		}
		emitToUser("invites:list", res)
		return res
	}
}

export const invitesCreate: Handler<
	Sockets.Invites.Create.Params,
	Sockets.Invites.Create.Response
> = {
	event: "invites:create",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		try {
			if (params.kind === "account") {
				const target = await db.query.users.findFirst({
					where: eq(schema.users.id, params.userId!)
				})
				if (!target) throw new Error("That user does not exist.")
			}

			const invite = await createInvite({
				kind: params.kind,
				userId: params.kind === "account" ? params.userId! : null,
				createdBy: socket.user!.id
			})

			const res: Sockets.Invites.Create.Response = {
				// Shown once. Not recoverable — only the hash is kept.
				token: invite.token,
				id: invite.id,
				expiresAt: invite.expiresAt
			}
			emitToUser("invites:create", res)
			await invitesList.handler(socket, {}, emitToUser)
			return res
		} catch (err) {
			failWith("invites:create", emitToUser, err)
		}
	}
}

export const invitesRevoke: Handler<
	Sockets.Invites.Revoke.Params,
	Sockets.Invites.Revoke.Response
> = {
	event: "invites:revoke",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		await revokeInvite(params.id)
		const res: Sockets.Invites.Revoke.Response = { success: true }
		emitToUser("invites:revoke", res)
		await invitesList.handler(socket, {}, emitToUser)
		return res
	}
}

export function registerInviteHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, invitesList, emitToUser)
	register(socket, invitesCreate, emitToUser)
	register(socket, invitesRevoke, emitToUser)
}
