import { and, eq, isNull } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	decryptToken,
	encryptToken,
	TOTP_SECRET_KEY_INFO
} from "$lib/server/utils/tokenCrypto"
import {
	buildOtpauthUri,
	generateRecoveryCodes,
	generateSecret,
	hashRecoveryCode,
	verifyTotp
} from "./index"

/**
 * Database-backed TOTP operations (plan 26 §10).
 *
 * The pure algorithm lives in ./index; this is where it meets rows, encryption
 * and sessions. Split so the RFC-conformance tests never need a database and
 * these never need to re-derive a code by hand.
 */

export interface TotpState {
	/** A secret exists — enrolment may be half-finished. */
	enrolled: boolean
	/** The factor is actually in force. */
	enabled: boolean
	/** Unused recovery codes left. Zero with `enabled` is a lockout waiting. */
	remainingCodes: number
}

export async function getTotpState(userId: number): Promise<TotpState> {
	const row = await db.query.userTotp.findFirst({
		where: eq(schema.userTotp.userId, userId)
	})
	if (!row) return { enrolled: false, enabled: false, remainingCodes: 0 }
	const unused = await db.query.userTotpRecoveryCodes.findMany({
		where: and(
			eq(schema.userTotpRecoveryCodes.userId, userId),
			isNull(schema.userTotpRecoveryCodes.usedAt)
		)
	})
	return {
		enrolled: true,
		enabled: row.enabledAt !== null,
		remainingCodes: unused.length
	}
}

/** Whether this user must clear a second factor to be fully authenticated. */
export async function isMfaEnabled(userId: number): Promise<boolean> {
	const row = await db.query.userTotp.findFirst({
		where: eq(schema.userTotp.userId, userId),
		columns: { enabledAt: true }
	})
	return !!row?.enabledAt
}

/**
 * Generate a secret and return what the user needs to scan.
 *
 * `enabledAt` stays null: the factor does not take effect until the user proves
 * they can produce a code from this secret. Enrolling first would lock someone
 * out with a secret their authenticator never actually received.
 *
 * Re-running before confirmation replaces the pending secret — a user who
 * abandoned a half-finished enrolment and started again should get a fresh QR
 * code, not the stale one their app failed to scan.
 */
export async function beginEnrollment(
	userId: number,
	username: string
): Promise<{ secret: string; otpauthUri: string }> {
	const existing = await db.query.userTotp.findFirst({
		where: eq(schema.userTotp.userId, userId)
	})
	if (existing?.enabledAt) {
		throw new Error(
			"Two-factor authentication is already enabled for this account."
		)
	}

	const secret = generateSecret()
	const encrypted = encryptToken(secret, TOTP_SECRET_KEY_INFO)

	if (existing) {
		await db
			.update(schema.userTotp)
			.set({ secret: encrypted, lastUsedStep: null })
			.where(eq(schema.userTotp.userId, userId))
	} else {
		await db.insert(schema.userTotp).values({ userId, secret: encrypted })
	}

	return { secret, otpauthUri: buildOtpauthUri({ username, secret }) }
}

/**
 * Confirm enrolment with a live code, and issue recovery codes.
 *
 * The codes are returned in plaintext exactly once — only their hashes are
 * stored — and are generated in the same transaction that enables the factor,
 * so there is no window in which 2FA is on with no way around it.
 */
export async function confirmEnrollment(
	userId: number,
	code: string
): Promise<{ recoveryCodes: string[] }> {
	const row = await db.query.userTotp.findFirst({
		where: eq(schema.userTotp.userId, userId)
	})
	if (!row) throw new Error("Start enrolment before confirming it.")
	if (row.enabledAt) {
		throw new Error(
			"Two-factor authentication is already enabled for this account."
		)
	}

	const secret = decryptToken(row.secret, TOTP_SECRET_KEY_INFO)
	const result = verifyTotp({ secret, code, lastUsedStep: row.lastUsedStep })
	if (!result.valid) {
		throw new Error(
			result.reason === "replayed"
				? "That code has already been used — wait for the next one."
				: "That code is not correct. Check your authenticator and try again."
		)
	}

	const recoveryCodes = generateRecoveryCodes()

	await db.transaction(async (tx) => {
		await tx
			.update(schema.userTotp)
			.set({ enabledAt: new Date(), lastUsedStep: result.step })
			.where(eq(schema.userTotp.userId, userId))
		// Replace rather than append: a re-enrolment must not leave codes from
		// a previous secret valid.
		await tx
			.delete(schema.userTotpRecoveryCodes)
			.where(eq(schema.userTotpRecoveryCodes.userId, userId))
		await tx.insert(schema.userTotpRecoveryCodes).values(
			recoveryCodes.map((c) => ({
				userId,
				codeHash: hashRecoveryCode(c)
			}))
		)
	})

	return { recoveryCodes }
}

export type MfaVerifyOutcome =
	| { ok: true; usedRecoveryCode: boolean; remainingCodes: number }
	| { ok: false; error: string }

/**
 * Clear the second factor for one session, with either a TOTP code or an
 * unused recovery code.
 *
 * Marks `mfaVerifiedAt` on the session row rather than reissuing anything: the
 * cookie only ever carried a reference to that row, so the row is the single
 * place this fact needs to live.
 */
export async function verifyForSession({
	userId,
	tokenId,
	code,
	now = new Date()
}: {
	userId: number
	tokenId: string
	code: string
	now?: Date
}): Promise<MfaVerifyOutcome> {
	const row = await db.query.userTotp.findFirst({
		where: eq(schema.userTotp.userId, userId)
	})
	if (!row?.enabledAt) {
		return { ok: false, error: "Two-factor authentication is not enabled." }
	}

	const secret = decryptToken(row.secret, TOTP_SECRET_KEY_INFO)
	const totp = verifyTotp({
		secret,
		code,
		now,
		lastUsedStep: row.lastUsedStep
	})

	if (totp.valid) {
		await db
			.update(schema.userTotp)
			.set({ lastUsedStep: totp.step })
			.where(eq(schema.userTotp.userId, userId))
		await markSessionVerified(tokenId, now)
		const { remainingCodes } = await getTotpState(userId)
		return { ok: true, usedRecoveryCode: false, remainingCodes }
	}

	// Fall through to recovery codes only after the TOTP attempt fails, so a
	// valid authenticator code never consumes one.
	const consumed = await consumeRecoveryCode(userId, code, now)
	if (consumed) {
		await markSessionVerified(tokenId, now)
		const { remainingCodes } = await getTotpState(userId)
		return { ok: true, usedRecoveryCode: true, remainingCodes }
	}

	return {
		ok: false,
		error:
			totp.reason === "replayed"
				? "That code has already been used — wait for the next one."
				: "That code is not correct."
	}
}

async function markSessionVerified(tokenId: string, now: Date) {
	await db
		.update(schema.userTokens)
		.set({ mfaVerifiedAt: now })
		.where(eq(schema.userTokens.id, tokenId))
}

/**
 * Spend a recovery code if it matches an unused one.
 *
 * Conditioned on `usedAt IS NULL` in the UPDATE itself rather than checked and
 * then written: two concurrent submissions of the same code would otherwise
 * both find it unused and both succeed.
 */
async function consumeRecoveryCode(
	userId: number,
	code: string,
	now: Date
): Promise<boolean> {
	const hash = hashRecoveryCode(code)
	const updated = await db
		.update(schema.userTotpRecoveryCodes)
		.set({ usedAt: now })
		.where(
			and(
				eq(schema.userTotpRecoveryCodes.userId, userId),
				eq(schema.userTotpRecoveryCodes.codeHash, hash),
				isNull(schema.userTotpRecoveryCodes.usedAt)
			)
		)
		.returning({ id: schema.userTotpRecoveryCodes.id })
	return updated.length > 0
}

/** Issue a fresh set, invalidating every previous code in one transaction. */
export async function regenerateRecoveryCodes(
	userId: number
): Promise<string[]> {
	if (!(await isMfaEnabled(userId))) {
		throw new Error("Two-factor authentication is not enabled.")
	}
	const codes = generateRecoveryCodes()
	await db.transaction(async (tx) => {
		// All-or-nothing: a half-replaced set is worse than either state.
		await tx
			.delete(schema.userTotpRecoveryCodes)
			.where(eq(schema.userTotpRecoveryCodes.userId, userId))
		await tx
			.insert(schema.userTotpRecoveryCodes)
			.values(
				codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) }))
			)
	})
	return codes
}

/**
 * Remove the factor entirely.
 *
 * `revokeSessions` is not optional in spirit: clearing a factor while existing
 * sessions keep their `mfaVerifiedAt` leaves them authenticated under a
 * guarantee that no longer holds. It is a parameter only because a user
 * disabling their own 2FA is already holding one of those sessions and should
 * not be logged out of it.
 */
export async function clearTotp(
	userId: number,
	{ revokeSessions }: { revokeSessions: boolean }
): Promise<void> {
	await db.transaction(async (tx) => {
		await tx
			.delete(schema.userTotpRecoveryCodes)
			.where(eq(schema.userTotpRecoveryCodes.userId, userId))
		await tx
			.delete(schema.userTotp)
			.where(eq(schema.userTotp.userId, userId))
		if (revokeSessions) {
			await tx
				.delete(schema.userTokens)
				.where(eq(schema.userTokens.userId, userId))
		} else {
			// The factor is gone, so no session should still claim to have
			// cleared it — otherwise a later re-enrolment would find sessions
			// pre-verified against a secret that no longer exists.
			await tx
				.update(schema.userTokens)
				.set({ mfaVerifiedAt: null })
				.where(eq(schema.userTokens.userId, userId))
		}
	})
}

/**
 * Whether this session still owes a second factor.
 *
 * The answer is "no" for everyone without 2FA enabled, which is what keeps this
 * gate invisible to the overwhelming majority of instances.
 */
export async function isMfaPending(
	userId: number,
	tokenId: string | null
): Promise<boolean> {
	if (!(await isMfaEnabled(userId))) return false
	if (!tokenId) return true
	const token = await db.query.userTokens.findFirst({
		where: eq(schema.userTokens.id, tokenId),
		columns: { mfaVerifiedAt: true }
	})
	return !token?.mfaVerifiedAt
}
