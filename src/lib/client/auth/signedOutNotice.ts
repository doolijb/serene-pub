/**
 * 🚧 **Why you were signed out** (PLAN-dc-after-walk2 Q3-7, the walk's N17:
 * turning user accounts on signed the admin out with no word). A page that
 * knows the server is about to end this session notes the reason here; the
 * sign-in form says it once, after the reload, and forgets it.
 *
 * Per tab (`sessionStorage`) and best-effort: a private window or blocked
 * storage simply says nothing, as before.
 */
const KEY = "sp-signed-out-why"

/** Note why this tab is about to be signed out. */
export function noteSignedOutWhy(why: string): void {
	try {
		sessionStorage.setItem(KEY, why)
	} catch {
		/* storage unavailable: the form says nothing */
	}
}

/** The reason noted for this tab, once: read and forgotten. */
export function takeSignedOutWhy(): string | null {
	try {
		const why = sessionStorage.getItem(KEY)
		sessionStorage.removeItem(KEY)
		return why && why.trim() ? why : null
	} catch {
		return null
	}
}
