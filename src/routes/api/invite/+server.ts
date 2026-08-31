import type { RequestHandler } from "@sveltejs/kit"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { claimInvite, peekInvite } from "$lib/server/auth/invites"
import { passphraseSchema } from "$lib/shared/validation/passphrase"
import { set as setPassphrase } from "$lib/server/providers/users/passphrase/set"
import { clearTotp } from "$lib/server/auth/totp/service"
import { create as createUserToken } from "$lib/server/providers/users/tokens/create"
import { setUserTokenCookie } from "$lib/server/auth/cookies"

/**
 * Invite redemption (plan 27 §3).
 *
 * HTTP rather than socket, necessarily: this runs before any session exists,
 * and the socket layer requires one. It is the one authenticated-by-token entry
 * point in the app, so everything about it is deliberately narrow.
 */

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-store"
		}
	})

const FAILURE_MESSAGES: Record<string, string> = {
	"not-found": "This invite link isn't valid.",
	used: "This invite has already been used.",
	revoked: "This invite was revoked.",
	expired: "This invite has expired. Ask for a new one.",
	"no-user": "This invite is no longer attached to an account."
}

/** Inspect an invite so the page can render the right form. Never consumes it. */
export const GET: RequestHandler = async ({ url }) => {
	const token = url.searchParams.get("token") ?? ""
	const res = await peekInvite(token)
	if (!res.ok) {
		return json({ valid: false, error: FAILURE_MESSAGES[res.reason] }, 200)
	}

	let username: string | null = null
	if (res.invite.kind === "account" && res.invite.userId) {
		const u = await db.query.users.findFirst({
			where: eq(schema.users.id, res.invite.userId),
			columns: { username: true }
		})
		username = u?.username ?? null
	}
	// Deliberately minimal: the kind decides which form to show, and the
	// username is only echoed for an account invite so the recipient can see
	// which account they are about to take over.
	return json({ valid: true, kind: res.invite.kind, username })
}

/**
 * Redeem. For `register` this creates the account; for `account` it replaces
 * the password and wipes two-factor. Either way the caller ends up signed in.
 */
export const POST: RequestHandler = async (event) => {
	const { request } = event
	const body = await request.json().catch(() => ({}))
	const token: string = body.token ?? ""
	const passphrase: string = body.passphrase ?? ""
	const username: string = (body.username ?? "").trim()

	const peeked = await peekInvite(token)
	if (!peeked.ok) {
		return json({ error: FAILURE_MESSAGES[peeked.reason] }, 400)
	}

	const parsed = passphraseSchema.safeParse(passphrase)
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0]?.message }, 400)
	}

	if (peeked.invite.kind === "register") {
		if (username.length < 3) {
			return json(
				{ error: "Choose a username of at least 3 characters." },
				400
			)
		}
		const taken = await db.query.users.findFirst({
			where: eq(schema.users.username, username)
		})
		if (taken) return json({ error: "That username is taken." }, 400)
	}

	// Claimed only now, after everything that could fail has passed — a
	// rejected password must not burn a single-use invite.
	const claim = await claimInvite(token)
	if (!claim.ok) return json({ error: FAILURE_MESSAGES[claim.reason] }, 400)

	let userId: number
	if (claim.invite.kind === "register") {
		try {
			const [created] = await db
				.insert(schema.users)
				// Never an admin (27 §5). Promotion requires a prior sign-in,
				// which by definition has not happened yet.
				.values({ username, isAdmin: false })
				.returning()
			userId = created.id
		} catch {
			// The unique index is the real guard against two people claiming
			// the same username between the check above and here.
			return json({ error: "That username is taken." }, 400)
		}
		await setPassphrase({ userId: String(userId), passphrase: parsed.data })
	} else {
		userId = claim.invite.userId!
		// An account invite is a handover: the previous holder's credentials
		// must not survive it. Two-factor goes too, or someone recovering a
		// lost authenticator would still be stopped by it.
		await setPassphrase({ userId: String(userId), passphrase: parsed.data })
		await clearTotp(userId, { revokeSessions: true })
	}

	const user = await db.query.users.findFirst({
		where: eq(schema.users.id, userId)
	})
	if (!user) return json({ error: "Account could not be created." }, 500)

	// Sign them in. `lastLoginAt` is stamped here because redemption *is* a
	// successful authentication — and it is what later allows promotion to
	// admin (27 §5).
	await db
		.update(schema.users)
		.set({ lastLoginAt: new Date() })
		.where(eq(schema.users.id, userId))

	const [session] = await createUserToken({ userId: String(userId), event })

	// Through the shared helper, never a hand-rolled cookies.set: it decides
	// `secure`/`sameSite` from the real request scheme, and getting that wrong
	// has silently broken login in packaged builds twice before (see the
	// comments in setUserTokenCookie).
	setUserTokenCookie({ event, token: session.token })

	return json({ ok: true, username: user.username })
}
