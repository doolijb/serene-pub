import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import {
	decryptToken,
	CHARAVAULT_KEY_INFO
} from "$lib/server/utils/tokenCrypto"
import { CardSourceUnavailableError } from "../types"
import { acquire } from "./rateLimiter"

const API_BASE = "https://charavault.net"
// Undocumented lifetime — conservative estimate, refreshed proactively
// before it can expire mid-request.
const SESSION_TTL_MS = 30 * 60_000
// A rejected login (bad/revoked credential) or an unreachable CharaVault
// isn't cached as a session, but the *failure itself* still needs to be
// remembered for a while — otherwise every single search re-attempts the
// full login (DB read, decrypt, POST to charavault.net) from scratch, which
// is both wasteful and, under rapid searching, the exact kind of repeated-
// network-call pileup that made search feel like it hung.
const LOGIN_FAILURE_COOLDOWN_MS = 5 * 60_000
// Node's fetch has no default timeout — an upstream connection that accepts
// the TCP handshake but never responds would otherwise hang this call
// forever. That's especially bad here: a login attempt is de-duplicated
// through the shared loginPromise below, so every concurrent CharaVault
// caller across the whole instance would be stuck awaiting the same dead
// promise. Shared with charaVaultSource.ts's own fetch for the same reason.
export const CHARAVAULT_FETCH_TIMEOUT_MS = 20_000
// Card *file* fetches (fetchCharaVaultCardResponse in charaVaultSource.ts —
// the image proxy, card detail view, and import all go through it) read the
// FULL response body within this same kind of window, not just headers —
// small JSON responses (search, login) finish well under
// CHARAVAULT_FETCH_TIMEOUT_MS, but a multi-MB card file can legitimately
// take longer to fully transfer, especially under any per-connection
// throttling on CharaVault's end. fetchCharaVaultCardResponse defaults to
// this value rather than the shorter one.
export const CHARAVAULT_IMAGE_FETCH_TIMEOUT_MS = 45_000

interface CachedSession {
	cookie: string
	expiresAt: number
}

let cachedSession: CachedSession | null = null
// In-flight de-dup: concurrent getSessionCookie() calls while no session is
// cached yet all await the same login attempt instead of each independently
// hitting the DB, decrypting the token, and POSTing to charavault.net — a
// stampede that also meant every one of those concurrent logins had to
// individually fight over the 15/min rate-limit floor (see acquire() in
// rateLimiter.ts), which is what actually caused a burst of rapid searches
// to feel like the whole backend had hung.
let loginPromise: Promise<string | null> | null = null
let loginFailedUntil: number | null = null

/** Cheap synchronous check — used by the rate limiter to pick its ceiling without triggering a login call. */
export function hasActiveSession(): boolean {
	return cachedSession !== null && cachedSession.expiresAt > Date.now()
}

export function invalidateSession(): void {
	cachedSession = null
	// Also clear the cooldown: every caller of invalidateSession() is about
	// to immediately retry a login (a 401-triggered retry in
	// withCharaVaultSession, or an admin verifying a just-saved credential
	// in cardSourcesCharaVaultConnect) — a stale cooldown from an earlier,
	// unrelated failure would otherwise block that retry regardless of
	// whether the new attempt would actually succeed. If this attempt fails
	// too, the cooldown re-arms itself from within loginAndCacheSession().
	loginFailedUntil = null
}

async function loginAndCacheSession(): Promise<string | null> {
	const settings = await db.query.systemSettings.findFirst({
		where: eq(schema.systemSettings.id, 1),
		columns: {
			charaVaultEmail: true,
			charaVaultEncryptedToken: true,
			charaVaultTokenIv: true,
			charaVaultTokenAuthTag: true
		}
	})

	if (
		!settings?.charaVaultEmail ||
		!settings.charaVaultEncryptedToken ||
		!settings.charaVaultTokenIv ||
		!settings.charaVaultTokenAuthTag
	) {
		// Not a failure — no credential is configured at all, cheap to
		// re-check every time (no network call), and should pick up the
		// moment an admin connects one, so no cooldown here.
		return null
	}

	let password: string
	try {
		password = decryptToken(
			{
				ciphertext: settings.charaVaultEncryptedToken,
				iv: settings.charaVaultTokenIv,
				authTag: settings.charaVaultTokenAuthTag
			},
			CHARAVAULT_KEY_INFO
		)
	} catch (e) {
		// The stored token is corrupt or the app's crypto secret changed
		// since it was encrypted (eg. a redeploy with a regenerated .env) —
		// this will fail identically on every call until an admin
		// reconnects the credential, so cool down the same as any other
		// login failure rather than re-attempting the decrypt (and
		// re-throwing) on every single search.
		loginFailedUntil = Date.now() + LOGIN_FAILURE_COOLDOWN_MS
		throw new CardSourceUnavailableError(
			`Stored CharaVault credential could not be decrypted: ${(e as Error).message}`
		)
	}

	// A fresh login is always the very first CharaVault call of a session
	// (hasActiveSession() is false here by construction), so this
	// conservatively costs one slot against the 15/min floor rather than
	// risking a circular "would login succeed" check against the ceiling
	// it's meant to gate.
	await acquire(false)

	let response: Response
	try {
		response = await fetch(`${API_BASE}/api/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: settings.charaVaultEmail, password }),
			signal: AbortSignal.timeout(CHARAVAULT_FETCH_TIMEOUT_MS)
		})
	} catch (e) {
		// CharaVault unreachable — cool down before retrying so a network
		// blip (or an outage) doesn't turn every search into another failed
		// round trip.
		loginFailedUntil = Date.now() + LOGIN_FAILURE_COOLDOWN_MS
		throw new CardSourceUnavailableError(
			`Failed to reach CharaVault: ${(e as Error).message}`
		)
	}

	if (!response.ok) {
		// Wrong/revoked credential — not a "CharaVault is down" condition.
		// Callers fall back to anonymous rather than throwing here, but
		// still cool down so a broken credential doesn't get retried on
		// every single search.
		loginFailedUntil = Date.now() + LOGIN_FAILURE_COOLDOWN_MS
		return null
	}

	const setCookie = response.headers.get("set-cookie")
	if (!setCookie) {
		loginFailedUntil = Date.now() + LOGIN_FAILURE_COOLDOWN_MS
		return null
	}

	// We only need the name=value pair to replay on subsequent requests.
	const cookiePair = setCookie.split(";")[0]

	loginFailedUntil = null
	cachedSession = {
		cookie: cookiePair,
		expiresAt: Date.now() + SESSION_TTL_MS
	}
	return cookiePair
}

/** Returns a Cookie header value if an admin-configured credential is available and login succeeds, else null (anonymous fallback). */
export async function getSessionCookie(): Promise<string | null> {
	if (hasActiveSession()) {
		return cachedSession!.cookie
	}
	if (loginFailedUntil && Date.now() < loginFailedUntil) {
		return null
	}
	if (loginPromise) return loginPromise

	loginPromise = loginAndCacheSession().finally(() => {
		loginPromise = null
	})
	return loginPromise
}

/**
 * Wraps an authenticated CharaVault request, retrying once with a fresh
 * login on a 401 (covers both ordinary expiry and the admin having revoked
 * the App Password on charavault.net's own site). If the retry also 401s,
 * the cached session is dropped and subsequent calls fall back to
 * anonymous rather than retrying a dead credential every request.
 */
export async function withCharaVaultSession<T>(
	requestFn: (cookie: string | null) => Promise<Response>,
	parseResponse: (response: Response) => Promise<T>
): Promise<T> {
	const cookie = await getSessionCookie()
	let response = await requestFn(cookie)

	if (response.status === 401 && cookie) {
		invalidateSession()
		const retryCookie = await getSessionCookie()
		response = await requestFn(retryCookie)
		if (response.status === 401) {
			invalidateSession()
		}
	}

	return parseResponse(response)
}
