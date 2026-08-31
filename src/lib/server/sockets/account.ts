import { and, eq, isNull } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { passphraseSchema } from "$lib/shared/validation/passphrase"
import { set as setPassphrase } from "$lib/server/providers/users/passphrase/set"
import { pendingSetupSteps } from "$lib/server/auth/setupGate"

/**
 * Finishing an account (plan 27 §1).
 *
 * These are the handlers a session may reach while the setup gate is closed —
 * everything else is refused until `pendingSetup` empties.
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

export const accountSetupState: Handler<
	Sockets.Account.SetupState.Params,
	Sockets.Account.SetupState.Response
> = {
	event: "account:setupState",
	handler: async (socket, _params, emitToUser) => {
		const settings = await db.query.systemSettings.findFirst({
			where: eq(schema.systemSettings.id, 1),
			columns: { requireTwoFactor: true }
		})
		const res: Sockets.Account.SetupState.Response = {
			pending: socket.pendingSetup ?? [],
			// Drives the "recommended but optional" prompt after registration —
			// the client needs to know whether declining is allowed.
			twoFactorRequired: settings?.requireTwoFactor ?? false
		}
		emitToUser("account:setupState", res)
		return res
	}
}

export const accountSetPassword: Handler<
	Sockets.Account.SetPassword.Params,
	Sockets.Account.SetPassword.Response
> = {
	event: "account:setPassword",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		try {
			// Only reachable while a password is actually owed. Without this an
			// ordinary session could set a password with no current-password
			// check — the existing change-password handler is where that lives.
			const pending = await pendingSetupSteps(userId)
			if (!pending.includes("password")) {
				throw new Error("This account already has a password set.")
			}

			const parsed = passphraseSchema.safeParse(params.passphrase ?? "")
			if (!parsed.success) {
				throw new Error(
					parsed.error.issues[0]?.message ?? "Invalid passphrase."
				)
			}

			// `set` clears prior rows, so the invalidated one is replaced
			// rather than accumulating beside the new one.
			await setPassphrase({
				userId: String(userId),
				passphrase: parsed.data
			})

			socket.pendingSetup = await pendingSetupSteps(userId)
			const res: Sockets.Account.SetPassword.Response = {
				pending: socket.pendingSetup
			}
			emitToUser("account:setPassword", res)
			return res
		} catch (err) {
			failWith("account:setPassword", emitToUser, err)
		}
	}
}

export function registerAccountHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, accountSetupState, emitToUser)
	register(socket, accountSetPassword, emitToUser)
}
