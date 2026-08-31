import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { z } from "zod"
import type { Handler } from "$lib/shared/events"
import { isAndroidWrapper } from "$lib/server/utils"
import {
	encryptToken,
	TUNNEL_CREDENTIAL_KEY_INFO
} from "$lib/server/utils/tokenCrypto"
import {
	LOCAL_SERVER_SLUG,
	MAX_TUNNEL_TTL_SECONDS,
	MIN_TUNNEL_TTL_SECONDS,
	TunnelModes,
	TunnelProviders,
	TunnelStatuses
} from "$lib/shared/constants/Tunnels"

/**
 * Tunnel socket surface (plan 26 §8).
 *
 * Its own file, never folded into `sockets/connections.ts`. The isolation is
 * deliberate at every layer — schema, encryption keyInfo, this namespace — and
 * the one that actually matters is that none of it is ever wired into the
 * plugin/hook broker's callable surface. A script must not be able to discover
 * that this instance is publicly reachable, let alone make it so.
 *
 * Phase A built the row, the guards and the config surface; phase B wired
 * `enable`/`disable` to the supervisor in `$lib/server/tunnels`. The gates here
 * stay the authority on *whether* a tunnel may run — the supervisor is only the
 * mechanism — so nothing below defers a policy decision to it.
 */

/**
 * Tunnels are out of scope for the Android wrapper (26 §7), for the same reason
 * the managed model runners are: the supervisor's whole job is downloading and
 * spawning a provider binary, and that build has no binary to manage. Mirrors
 * the existing `isAndroidWrapper()` gate on
 * `systemSettings:updateKoboldCppManagerEnabled`.
 *
 * Note the scope — this defers *tunnels*, not the rest of plan 26. Allowed
 * hosts and TOTP are platform-independent and ship on Android normally.
 */
export const TUNNELS_UNAVAILABLE_ANDROID =
	"Tunnels are not available in the Android app"

export function tunnelsUnavailableReason(): string | undefined {
	if (isAndroidWrapper()) return TUNNELS_UNAVAILABLE_ANDROID
	return undefined
}

function assertTunnelsAvailable() {
	const reason = tunnelsUnavailableReason()
	if (reason) throw new Error(reason)
}

/**
 * A tunnel may only be live on an instance that requires accounts (26 §5).
 *
 * Checked server-side, not just hidden in the UI — the state this exists to
 * make unreachable is a publicly-reachable instance with no account boundary at
 * all. The reverse direction (disabling accounts while a tunnel runs) is
 * enforced from the settings side and lands with the supervisor in phase B;
 * the two settings are not allowed to drift independently.
 */
export async function assertAccountsEnabled() {
	const settings = await db.query.systemSettings.findFirst({
		where: eq(schema.systemSettings.id, 1),
		columns: { isAccountsEnabled: true }
	})
	if (!settings?.isAccountsEnabled) {
		throw new Error(
			"User accounts must be enabled before a tunnel can be started — " +
				"a publicly reachable instance with no account boundary is not " +
				"a state this app will put you in. Enable them in Settings > System."
		)
	}
	return true
}

async function accountsEnabled(): Promise<boolean> {
	const settings = await db.query.systemSettings.findFirst({
		where: eq(schema.systemSettings.id, 1),
		columns: { isAccountsEnabled: true }
	})
	return settings?.isAccountsEnabled ?? false
}

/**
 * `credential` is dropped, not masked. It never leaves the server in any form;
 * `credentialSet` is the only thing the UI needs to render "configured".
 */
export function toTunnelView(row: SelectTunnel): Sockets.Tunnels.TunnelView {
	const { credential, ...rest } = row
	return { ...rest, credentialSet: credential != null }
}

async function getLocalServer() {
	const server = await db.query.servers.findFirst({
		where: eq(schema.servers.slug, LOCAL_SERVER_SLUG)
	})
	if (!server) {
		// Seeded by db/defaults.ts sync() at boot. Missing means seeding failed,
		// which is a real fault worth surfacing rather than papering over by
		// creating one here — a second writer for a seeded row is how seeds
		// start diverging.
		throw new Error(
			"The local server record is missing — database defaults did not sync."
		)
	}
	return server
}

async function getLocalTunnel(serverId: number) {
	return await db.query.tunnels.findFirst({
		where: eq(schema.tunnels.serverId, serverId)
	})
}

/**
 * A bare hostname: no scheme, no port, no path, no wildcard. Same shape the
 * allowed-hosts list will enforce (26 §9) — rejected outright rather than
 * silently cleaned up, so an admin who typed `https://x.com:8080` finds out
 * they typed it instead of wondering why matching fails later.
 */
const hostnameSchema = z
	.string()
	.trim()
	.toLowerCase()
	.min(1, "Hostname is required")
	.max(253, "Hostname is too long")
	.refine((v) => !/[*\/\s:]/.test(v), {
		message:
			"Enter a bare hostname only — no scheme, port, path, or wildcard"
	})
	.refine((v) => /^[a-z0-9.-]+$/.test(v) && v.includes("."), {
		message: "Not a valid hostname"
	})

const updateConfigSchema = z
	.object({
		provider: z.enum(
			TunnelProviders.ALL as unknown as [string, ...string[]],
			{ message: "Unsupported tunnel provider" }
		),
		mode: z.enum(TunnelModes.ALL as unknown as [string, ...string[]]),
		hostname: hostnameSchema.nullish(),
		// Any duration inside the bounds — the 12-hour default is a pre-fill,
		// not the only option. Bounded on both ends so a mistyped value cannot
		// produce a tunnel that expires before it finishes starting, or one
		// whose "timer" is indistinguishable from having no timer at all.
		ttlSeconds: z
			.number()
			.int("Auto-stop must be a whole number of seconds")
			.min(
				MIN_TUNNEL_TTL_SECONDS,
				`Auto-stop must be at least ${MIN_TUNNEL_TTL_SECONDS / 60} minutes`
			)
			.max(
				MAX_TUNNEL_TTL_SECONDS,
				`Auto-stop must be at most ${MAX_TUNNEL_TTL_SECONDS / 86400} days — turn it off instead for a tunnel that should stay up`
			)
			.nullish(),
		autoStart: z.boolean().optional(),
		credential: z.string().trim().min(1).nullish()
	})
	.superRefine((v, ctx) => {
		// `mode` is stored separately from `provider` so future UI/supervisor
		// logic can branch on it (26 §7), but the two are not independently
		// chosen — each provider has exactly one mode, and a row where they
		// disagree would make every downstream branch ambiguous.
		const expectedMode =
			v.provider === TunnelProviders.CLOUDFLARE_QUICK
				? TunnelModes.EPHEMERAL
				: TunnelModes.PERSISTENT
		if (v.mode !== expectedMode) {
			ctx.addIssue({
				code: "custom",
				path: ["mode"],
				message: `${TunnelProviders.getLabel(v.provider)} is ${expectedMode}`
			})
		}
		if (v.provider === TunnelProviders.CLOUDFLARE_NAMED && !v.hostname) {
			ctx.addIssue({
				code: "custom",
				path: ["hostname"],
				message: "A named tunnel needs the hostname it will serve"
			})
		}
	})

/**
 * Emit a specific `{event}:error` before re-throwing.
 *
 * The registration wrapper (`sockets/index.ts`) replaces an uncaught throw with
 * "An error occurred while processing your request." — which is exactly the
 * wrong answer for this namespace, where the useful part *is* the message:
 * accounts are off, the token was rejected, that hostname isn't valid. The
 * re-throw is what keeps the wrapper's logging.
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

export const tunnelsGet: Handler<
	Sockets.Tunnels.Get.Params,
	Sockets.Tunnels.Get.Response
> = {
	event: "tunnels:get",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const unavailableReason = tunnelsUnavailableReason()
		// Read even when unavailable: an instance that once had a tunnel
		// configured and later moved to Android should still be able to see
		// what is on file, not have it silently vanish.
		const server = await getLocalServer()
		let tunnel = await getLocalTunnel(server.id)

		// Liveness is derived from the supervisor, never read from the row.
		// A row outlives the process it describes — after a restart it still
		// says `running` while nothing is — so a stale one is corrected here
		// rather than reported. Self-healing on read keeps the record honest
		// even for a row that boot reconciliation never saw.
		if (tunnel && (tunnel.enabled || tunnel.status !== "stopped")) {
			const { isSupervising } = await import(
				"$lib/server/tunnels/supervisor"
			)
			if (!isSupervising(tunnel.id)) {
				const [corrected] = await db
					.update(schema.tunnels)
					.set({
						enabled: false,
						status: TunnelStatuses.STOPPED,
						expiresAt: null,
						stoppedAt: tunnel.stoppedAt ?? new Date()
					})
					.where(eq(schema.tunnels.id, tunnel.id))
					.returning()
				tunnel = corrected
			}
		}

		const res: Sockets.Tunnels.Get.Response = {
			serverId: server.id,
			tunnel: tunnel ? toTunnelView(tunnel) : null,
			available: !unavailableReason,
			...(unavailableReason ? { unavailableReason } : {}),
			accountsEnabled: await accountsEnabled()
		}
		emitToUser("tunnels:get", res)
		return res
	}
}

export const tunnelsUpdateConfig: Handler<
	Sockets.Tunnels.UpdateConfig.Params,
	Sockets.Tunnels.UpdateConfig.Response
> = {
	event: "tunnels:updateConfig",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		assertTunnelsAvailable()

		const result = updateConfigSchema.safeParse(params)
		if (!result.success) {
			// The first issue's message, not the ZodError's own — that
			// serialises to a JSON blob no admin should have to read.
			const issue = result.error.issues[0]
			failWith(
				"tunnels:updateConfig",
				emitToUser,
				new Error(issue?.message ?? "Invalid tunnel configuration.")
			)
		}
		const parsed = result.data
		const server = await getLocalServer()
		const existing = await getLocalTunnel(server.id)

		// Reconfiguring underneath a live process is how the UI ends up
		// orphaning one (26 §6). Stop first — an explicit refusal, not a
		// silent restart the admin didn't ask for.
		if (existing && existing.enabled) {
			failWith(
				"tunnels:updateConfig",
				emitToUser,
				new Error(
					"Stop the running tunnel before changing its configuration."
				)
			)
		}

		// Omitted = leave the stored credential untouched; explicit null =
		// clear it. The distinction matters because the field is write-only:
		// the client can't round-trip what it never received, so "absent" has
		// to mean "unchanged" or every save would wipe the credential.
		const credentialPatch =
			parsed.credential === undefined
				? {}
				: {
						credential:
							parsed.credential === null
								? null
								: encryptToken(
										parsed.credential,
										TUNNEL_CREDENTIAL_KEY_INFO
									)
					}

		const values = {
			provider: parsed.provider as SelectTunnel["provider"],
			mode: parsed.mode as SelectTunnel["mode"],
			hostname: parsed.hostname ?? null,
			ttlSeconds: parsed.ttlSeconds ?? null,
			...(parsed.autoStart === undefined
				? {}
				: { autoStart: parsed.autoStart }),
			...credentialPatch
		}

		let row: SelectTunnel
		if (existing) {
			const [updated] = await db
				.update(schema.tunnels)
				.set(values)
				.where(eq(schema.tunnels.id, existing.id))
				.returning()
			row = updated
		} else {
			const [inserted] = await db
				.insert(schema.tunnels)
				.values({
					serverId: server.id,
					enabled: false,
					status: TunnelStatuses.STOPPED,
					...values
				})
				.returning()
			row = inserted
		}

		const res: Sockets.Tunnels.UpdateConfig.Response = {
			tunnel: toTunnelView(row)
		}
		emitToUser("tunnels:updateConfig", res)
		await tunnelsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const tunnelsEnable: Handler<
	Sockets.Tunnels.Enable.Params,
	Sockets.Tunnels.Enable.Response
> = {
	event: "tunnels:enable",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")

		let row: SelectTunnel
		try {
			assertTunnelsAvailable()
			await assertAccountsEnabled()

			const server = await getLocalServer()
			const tunnel = await getLocalTunnel(server.id)
			if (!tunnel) {
				throw new Error("Configure a tunnel before starting it.")
			}

			const { start } = await import("$lib/server/tunnels/supervisor")
			// start() writes status/hostname back itself, including on
			// failure, so there is exactly one writer for the fields the
			// supervisor owns.
			row = await start(tunnel.id)
		} catch (err) {
			// Refresh first: a failed start still moved the row to `error`
			// with a lastError, and the page should show that alongside the
			// toast rather than looking untouched.
			await tunnelsGet.handler(socket, {}, emitToUser)
			failWith("tunnels:enable", emitToUser, err)
		}

		const res: Sockets.Tunnels.Enable.Response = {
			tunnel: toTunnelView(row)
		}
		emitToUser("tunnels:enable", res)
		await tunnelsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export const tunnelsDisable: Handler<
	Sockets.Tunnels.Disable.Params,
	Sockets.Tunnels.Disable.Response
> = {
	event: "tunnels:disable",
	handler: async (socket, _params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")

		const server = await getLocalServer()
		const tunnel = await getLocalTunnel(server.id)
		if (!tunnel) throw new Error("No tunnel is configured.")

		// Deliberately *not* gated on availability or accounts. Stopping is the
		// safe direction: an admin who turned accounts off, or restored a
		// backup onto an Android build, must always be able to get a tunnel
		// row back to a stopped state. A guard that can strand a row in
		// `enabled` is worse than no guard.
		//
		// stop() kills whatever is live and writes the row; it tolerates there
		// being no process, which is the normal case on an instance that was
		// restarted while a tunnel was up.
		const { stop } = await import("$lib/server/tunnels/supervisor")
		await stop(tunnel.id)

		const row = await db.query.tunnels.findFirst({
			where: eq(schema.tunnels.id, tunnel.id)
		})
		if (!row) throw new Error("No tunnel is configured.")

		const res: Sockets.Tunnels.Disable.Response = {
			tunnel: toTunnelView(row)
		}
		emitToUser("tunnels:disable", res)
		await tunnelsGet.handler(socket, {}, emitToUser)
		return res
	}
}

export function registerTunnelHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, tunnelsGet, emitToUser)
	register(socket, tunnelsUpdateConfig, emitToUser)
	register(socket, tunnelsEnable, emitToUser)
	register(socket, tunnelsDisable, emitToUser)
}
