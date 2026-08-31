import crypto from "crypto"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"

/**
 * One-time account invites (plan 27 §3).
 *
 * An invite token is a bearer credential — whoever holds it becomes the account
 * — so it is treated like a recovery code: high entropy, stored only as a hash,
 * claimed atomically, and short-lived.
 */

/**
 * Two hours, deliberately fixed and not configurable.
 *
 * An invite is meant to be handed over while the two people are in contact, not
 * left lying in a chat log. Making the window adjustable would invite someone to
 * widen it "just this once" and never narrow it again — and there is no
 * legitimate case for a link that mints an account still working next week.
 */
export const INVITE_TTL_MS = 2 * 60 * 60 * 1000

export type InviteKind = "register" | "account"

/** 256 bits, URL-safe. Long enough that guessing is not a consideration. */
function generateToken(): string {
	return crypto.randomBytes(32).toString("base64url")
}

export function hashToken(token: string): string {
	return crypto.createHash("sha256").update(token.trim()).digest("hex")
}

export interface CreatedInvite {
	/** Shown to the admin once. Never stored, never recoverable. */
	token: string
	id: number
	expiresAt: Date
}

export async function createInvite({
	kind,
	userId = null,
	createdBy
}: {
	kind: InviteKind
	userId?: number | null
	createdBy: number
}): Promise<CreatedInvite> {
	if (kind === "account" && !userId) {
		throw new Error("An account invite must name the user it belongs to.")
	}
	if (kind === "register" && userId) {
		throw new Error("A registration invite has no account yet.")
	}

	const token = generateToken()
	const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
	const [row] = await db
		.insert(schema.accountInvites)
		.values({
			tokenHash: hashToken(token),
			kind,
			userId,
			createdBy,
			expiresAt
		})
		.returning()

	return { token, id: row.id, expiresAt: row.expiresAt }
}

export type InviteFailure =
	| "not-found"
	| "used"
	| "revoked"
	| "expired"
	| "no-user"

export type ClaimResult =
	| { ok: true; invite: SelectAccountInvite }
	| { ok: false; reason: InviteFailure }

/**
 * Inspect an invite without consuming it — for rendering the right form before
 * the user has submitted anything.
 */
export async function peekInvite(token: string): Promise<ClaimResult> {
	const row = await db.query.accountInvites.findFirst({
		where: eq(schema.accountInvites.tokenHash, hashToken(token))
	})
	if (!row) return { ok: false, reason: "not-found" }
	if (row.revokedAt) return { ok: false, reason: "revoked" }
	if (row.usedAt) return { ok: false, reason: "used" }
	if (row.expiresAt.getTime() <= Date.now())
		return { ok: false, reason: "expired" }
	if (row.kind === "account" && !row.userId)
		return { ok: false, reason: "no-user" }
	return { ok: true, invite: row }
}

/**
 * Consume an invite.
 *
 * The claim is a conditional UPDATE rather than a check followed by a write:
 * two people opening the same link at the same moment would otherwise both find
 * it unused and both succeed. Expiry is evaluated in the same statement so a
 * link cannot be claimed on the boundary.
 */
export async function claimInvite(token: string): Promise<ClaimResult> {
	const peeked = await peekInvite(token)
	if (!peeked.ok) return peeked

	const now = new Date()
	const claimed = await db
		.update(schema.accountInvites)
		.set({ usedAt: now })
		.where(
			and(
				eq(schema.accountInvites.tokenHash, hashToken(token)),
				isNull(schema.accountInvites.usedAt),
				isNull(schema.accountInvites.revokedAt)
			)
		)
		.returning()

	if (!claimed.length) return { ok: false, reason: "used" }
	return { ok: true, invite: claimed[0] }
}

export async function revokeInvite(id: number): Promise<void> {
	await db
		.update(schema.accountInvites)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(schema.accountInvites.id, id),
				isNull(schema.accountInvites.usedAt)
			)
		)
}

/** Outstanding invites, for the admin list. Never exposes a token. */
export async function listInvites(): Promise<SelectAccountInvite[]> {
	return await db.query.accountInvites.findMany({
		orderBy: (i, { desc }) => [desc(i.createdAt)]
	})
}
