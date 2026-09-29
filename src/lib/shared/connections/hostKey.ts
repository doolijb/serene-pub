/**
 * Whether two connection addresses name the same host.
 *
 * One rule, read by the server (which refuses a second Ollama connection to a
 * host) and by the Ollama view (which says when two already point at one), so
 * the two can never disagree about what "the same host" means.
 *
 * ⚠ **Spelling, not network identity.** It forgives what an address typed
 * twice usually differs by — a trailing slash, the case of the scheme and host,
 * a default port written out — and nothing more. `localhost` and `127.0.0.1`
 * may be one machine, but deciding that means resolving names, and a rule that
 * sometimes resolves is a rule nobody can predict. Two spellings it cannot
 * equate are treated as two hosts, which is the safe direction: at worst the
 * app lets a duplicate through, never refuses a genuinely different host.
 */

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" }

export function hostKey(baseUrl: string | null | undefined): string | null {
	const raw = (baseUrl ?? "").trim()
	if (!raw) return null
	try {
		const url = new URL(raw)
		const port =
			url.port && url.port !== DEFAULT_PORTS[url.protocol] ? `:${url.port}` : ""
		const path = url.pathname.replace(/\/+$/, "")
		return `${url.protocol}//${url.hostname.toLowerCase()}${port}${path}`
	} catch {
		// Not a URL at all: compare it as typed, minus the one slip everybody
		// makes, so two identical malformed addresses still match each other.
		return raw.replace(/\/+$/, "").toLowerCase()
	}
}

export function sameHost(
	a: string | null | undefined,
	b: string | null | undefined
): boolean {
	const ka = hostKey(a)
	return ka !== null && ka === hostKey(b)
}
