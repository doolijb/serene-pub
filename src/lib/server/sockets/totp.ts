import { eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import {
	beginEnrollment,
	clearTotp,
	confirmEnrollment,
	getTotpState,
	regenerateRecoveryCodes,
	verifyForSession
} from "$lib/server/auth/totp/service"

/**
 * Two-factor authentication socket surface (plan 26 §10).
 *
 * Note which handlers are reachable while a session still owes its second
 * factor: `totp:status` and `totp:verify` only — see
 * MFA_PENDING_ALLOWED_EVENTS in sockets/index.ts. Everything else here assumes
 * a fully authenticated session, which is why none of them re-check it.
 */

/** Emit a specific `{event}:error` before re-throwing — see sockets/tunnels.ts. */
function failWith(
	event: string,
	emitToUser: (event: string, data: any) => void,
	err: unknown
): never {
	const message = err instanceof Error ? err.message : "Something went wrong."
	emitToUser(`${event}:error`, { error: message })
	throw err instanceof Error ? err : new Error(message)
}

export const totpStatus: Handler<
	Sockets.Totp.Status.Params,
	Sockets.Totp.Status.Response
> = {
	event: "totp:status",
	handler: async (socket, _params, emitToUser) => {
		const state = await getTotpState(socket.user!.id)
		const res: Sockets.Totp.Status.Response = {
			...state,
			// The client needs this to know whether to show the code prompt
			// instead of the app.
			verificationRequired: !!socket.pendingSetup?.includes("twoFactor")
		}
		emitToUser("totp:status", res)
		return res
	}
}

export const totpEnrollBegin: Handler<
	Sockets.Totp.EnrollBegin.Params,
	Sockets.Totp.EnrollBegin.Response
> = {
	event: "totp:enroll:begin",
	handler: async (socket, _params, emitToUser) => {
		try {
			const { secret, otpauthUri } = await beginEnrollment(
				socket.user!.id,
				socket.user!.username
			)
			// The secret is returned in the clear on purpose: the user has to
			// be able to type it into an authenticator that cannot scan a QR
			// code. It is the same secret the URI already carries.
			const res: Sockets.Totp.EnrollBegin.Response = {
				secret,
				otpauthUri
			}
			emitToUser("totp:enroll:begin", res)
			return res
		} catch (err) {
			failWith("totp:enroll:begin", emitToUser, err)
		}
	}
}

export const totpEnrollConfirm: Handler<
	Sockets.Totp.EnrollConfirm.Params,
	Sockets.Totp.EnrollConfirm.Response
> = {
	event: "totp:enroll:confirm",
	handler: async (socket, params, emitToUser) => {
		try {
			const { recoveryCodes } = await confirmEnrollment(
				socket.user!.id,
				params.code ?? ""
			)
			// This session is the one that just proved possession, so it is
			// verified by construction — without this the user would enable 2FA
			// and be immediately locked out of the tab they did it in.
			if (socket.tokenId) {
				await db
					.update(schema.userTokens)
					.set({ mfaVerifiedAt: new Date() })
					.where(eq(schema.userTokens.id, socket.tokenId))
			}
			socket.pendingSetup = []

			// Shown exactly once. Only hashes are stored.
			const res: Sockets.Totp.EnrollConfirm.Response = { recoveryCodes }
			emitToUser("totp:enroll:confirm", res)
			await totpStatus.handler(socket, {}, emitToUser)
			return res
		} catch (err) {
			failWith("totp:enroll:confirm", emitToUser, err)
		}
	}
}

export const totpVerify: Handler<
	Sockets.Totp.Verify.Params,
	Sockets.Totp.Verify.Response
> = {
	event: "totp:verify",
	handler: async (socket, params, emitToUser) => {
		const outcome = await verifyForSession({
			userId: socket.user!.id,
			tokenId: socket.tokenId!,
			code: params.code ?? ""
		})
		if (!outcome.ok) {
			failWith("totp:verify", emitToUser, new Error(outcome.error))
		}

		socket.pendingSetup = []
		const res: Sockets.Totp.Verify.Response = {
			usedRecoveryCode: outcome.usedRecoveryCode,
			remainingCodes: outcome.remainingCodes
		}
		emitToUser("totp:verify", res)
		return res
	}
}

export const totpRegenerateCodes: Handler<
	Sockets.Totp.RegenerateCodes.Params,
	Sockets.Totp.RegenerateCodes.Response
> = {
	event: "totp:regenerateCodes",
	handler: async (socket, _params, emitToUser) => {
		try {
			const recoveryCodes = await regenerateRecoveryCodes(socket.user!.id)
			const res: Sockets.Totp.RegenerateCodes.Response = { recoveryCodes }
			emitToUser("totp:regenerateCodes", res)
			await totpStatus.handler(socket, {}, emitToUser)
			return res
		} catch (err) {
			failWith("totp:regenerateCodes", emitToUser, err)
		}
	}
}

export const totpDisable: Handler<
	Sockets.Totp.Disable.Params,
	Sockets.Totp.Disable.Response
> = {
	event: "totp:disable",
	handler: async (socket, params, emitToUser) => {
		// Proof of possession before removing the factor, so a walked-up-to
		// unlocked session cannot strip it.
		const outcome = await verifyForSession({
			userId: socket.user!.id,
			tokenId: socket.tokenId!,
			code: params.code ?? ""
		})
		if (!outcome.ok) {
			failWith("totp:disable", emitToUser, new Error(outcome.error))
		}
		// Sessions are kept: the user is holding one and disabling their own
		// factor should not log them out of it.
		await clearTotp(socket.user!.id, { revokeSessions: false })
		socket.pendingSetup = []

		const res: Sockets.Totp.Disable.Response = { success: true }
		emitToUser("totp:disable", res)
		await totpStatus.handler(socket, {}, emitToUser)
		return res
	}
}

/**
 * Tier 2 recovery (26 §10): an admin clears someone else's second factor.
 *
 * The ordinary "lost my phone and my codes" case, which should not require
 * filesystem access. Gated on `isAdmin` alone for now — §13.4 ruled that step-up
 * re-authentication is added in phase G rather than holding this back, because
 * shipping 2FA with no admin-side recovery is strictly worse for the lockout
 * risk this tier exists to address.
 */
export const totpAdminClear: Handler<
	Sockets.Totp.AdminClear.Params,
	Sockets.Totp.AdminClear.Response
> = {
	event: "totp:adminClear",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const target = await db.query.users.findFirst({
			where: eq(schema.users.id, params.userId)
		})
		if (!target) {
			failWith(
				"totp:adminClear",
				emitToUser,
				new Error("That user does not exist.")
			)
		}

		// Every session of the target is revoked in the same transaction.
		// Leaving them alive would keep sessions authenticated under a
		// guarantee that no longer holds.
		await clearTotp(target.id, { revokeSessions: true })
		console.warn(
			`[totp] admin "${socket.user!.username}" cleared two-factor authentication for "${target.username}" and revoked their sessions`
		)

		const res: Sockets.Totp.AdminClear.Response = { success: true }
		emitToUser("totp:adminClear", res)
		return res
	}
}

export function registerTotpHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, totpStatus, emitToUser)
	register(socket, totpEnrollBegin, emitToUser)
	register(socket, totpEnrollConfirm, emitToUser)
	register(socket, totpVerify, emitToUser)
	register(socket, totpRegenerateCodes, emitToUser)
	register(socket, totpDisable, emitToUser)
	register(socket, totpAdminClear, emitToUser)
}
