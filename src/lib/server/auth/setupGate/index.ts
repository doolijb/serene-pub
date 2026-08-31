import { and, eq, isNull } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { isMfaEnabled } from "$lib/server/auth/totp/service"

/**
 * The setup gate (plan 27 §1).
 *
 * Generalises the two-factor gate from 26 §10. Both answer the same question —
 * is this session authenticated but not yet *finished*? — so there is one
 * mechanism rather than two that have to agree.
 *
 * Steps are derived on every handshake, never stored. That matters: an admin
 * clearing someone's two-factor, or turning on the site-wide requirement,
 * changes what a session owes without anything having to go back and update it.
 */

export type SetupStep = "password" | "twoFactor"

/**
 * Ordered: password first.
 *
 * Asking for a code before the password is set would strand someone handed an
 * account invite — they have no credential yet and no enrolled authenticator,
 * so the password step is the only one that can be satisfied first.
 */
export async function pendingSetupSteps(userId: number): Promise<SetupStep[]> {
	const steps: SetupStep[] = []

	// No *active* passphrase means one must be set. Redeeming an account invite
	// invalidates the old row rather than deleting it, so this is the same
	// predicate every passphrase lookup already uses.
	const passphrase = await db.query.passphrases.findFirst({
		where: and(
			eq(schema.passphrases.userId, userId),
			isNull(schema.passphrases.invalidatedAt)
		)
	})
	if (!passphrase) steps.push("password")

	const settings = await db.query.systemSettings.findFirst({
		where: eq(schema.systemSettings.id, 1),
		columns: { requireTwoFactor: true }
	})
	if (settings?.requireTwoFactor && !(await isMfaEnabled(userId))) {
		steps.push("twoFactor")
	}

	return steps
}

/**
 * Events a session may still use while it owes setup.
 *
 * Wider than the two-factor-only allowlist it replaces, because a session may
 * now owe a password as well — but still closed by default, so a handler added
 * later is gated without knowing this list exists.
 */
export const SETUP_ALLOWED_EVENTS = new Set([
	"users:current",
	"auth:logout",
	"account:setupState",
	"account:setPassword",
	"totp:status",
	"totp:verify",
	"totp:enroll:begin",
	"totp:enroll:confirm"
])

export function isBlockedDuringSetup(event: string): boolean {
	return !SETUP_ALLOWED_EVENTS.has(event)
}
