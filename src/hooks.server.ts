import { dev } from "$app/environment"
import { appVersion } from "$lib/shared/constants/version"
import type { Handle, RequestEvent } from "@sveltejs/kit"
import { installPrettyConsole } from "$lib/server/utils/prettyConsole"
// import { userAuthentication, routeGuard } from "$server/middleware"

// Installed here, at module scope, so it runs once during server startup —
// before any request is handled and (critically) before the first
// request-triggered import of $lib/server/db or the socket server, both of
// which log at their own module-load time (see loadSockets.server.ts /
// db/index.ts). Everything server-side logs through console.*, so patching
// it here covers all of it in one place.
installPrettyConsole()

type Middleware = (event: RequestEvent) => Promise<void> | void

// Intentionally empty — there's no generic HTTP-route auth backstop here.
// Every sensitive surface in this app is a socket handler, gated by
// authMiddleware (src/lib/server/sockets/auth.ts), not an HTTP route; the
// few HTTP routes that do need auth (e.g. /api/login) call
// authenticateRequest() themselves. A generic allowlist-based backstop here
// would need permanent upkeep to stay in sync with every future route, or
// duplicate a check with no clear behavioral difference — not worth adding
// speculatively. Revisit if a genuinely sensitive HTTP route is added that
// can't call authenticateRequest() itself.
const middleware: Middleware[] = [] // [userAuthentication, routeGuard]

declare module "@sveltejs/kit" {
	interface Locals {
		latestRelease?: string
		isNewerReleaseAvailable?: boolean
	}
}

const GITHUB_API_URL =
	"https://api.github.com/repos/doolijb/serene-pub/releases/latest"

/**
 * Compare two semver strings (e.g., v0.2.0-alpha)
 * Returns 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
	const stripV = (s: string) => s.replace(/^v/, "")
	const parse = (s: string) =>
		stripV(s).split(/[-+]/)[0].split(".").map(Number)
	const [aMajor, aMinor, aPatch] = parse(a)
	const [bMajor, bMinor, bPatch] = parse(b)
	if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1
	if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1
	if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1
	return 0
}

async function checkForUpdates() {
	try {
		console.log("[VersionCheck] Checking for new release...")
		const res = await fetch(GITHUB_API_URL, {
			headers: { Accept: "application/vnd.github+json" },
			signal: AbortSignal.timeout(5000)
		})
		if (res.ok) {
			const data = await res.json()
			const latestTag = data.tag_name
			console.log(
				`[VersionCheck] Current: ${appVersion}, Latest: ${latestTag}`
			)
			if (
				typeof latestTag === "string" &&
				typeof appVersion === "string"
			) {
				const isNewer = compareVersions(latestTag, appVersion) === 1
				latestReleaseTag = latestTag
				isNewerReleaseAvailable = isNewer
				if (isNewer) {
					console.log(
						`[VersionCheck] Newer release available: ${latestTag}`
					)
				} else {
					console.log("[VersionCheck] No newer release available.")
				}
			}
		} else {
			console.warn(
				`[VersionCheck] Failed to fetch latest release: HTTP ${res.status}`
			)
		}
	} catch (err) {
		// Most likely cause is no internet connection (DNS failure, timeout,
		// offline); this is expected in offline/air-gapped deployments, so
		// don't log a scary stack trace for it.
		const reason = err instanceof Error ? err.message : String(err)
		console.warn(
			`[VersionCheck] Could not check for new release (likely no internet connection): ${reason}`
		)
	}
}

let latestReleaseTag: string | undefined = undefined
let isNewerReleaseAvailable: boolean | undefined = undefined
let hasCheckedForUpdates = false

// One-time warning (same pattern as hasCheckedForUpdates above) for a
// login-rate-limiting footgun: loginRateLimit.ts keys its buckets on
// getClientAddress(), which only reflects the real client IP if
// ADDRESS_HEADER is set to match a trusted reverse proxy's forwarded-for
// header. Unset (the default) behind a real proxy, every real user shares
// the proxy's address — one bad actor's failed logins lock out everyone.
// This can't safely auto-detect "is there a trusted proxy" (that's a
// deployment fact, not something inferable from a single request), but an
// X-Forwarded-For header arriving at all, while ADDRESS_HEADER is unset, is
// an always-correct-direction signal: an unproxied direct client should
// never send that header itself under normal use.
let hasWarnedAboutAddressHeader = false

// Content-Security-Policy is configured via svelte.config.js's kit.csp
// instead of set here — SvelteKit needs to own that header so it can inject
// a correct hash/nonce for its own generated inline hydration script; a
// hand-rolled header here has no way to know that value and silently breaks
// hydration (confirmed the hard way — see CSP_EXTRA_*_SRC in HOSTING.md for
// the escape hatch covering hosting-injected third-party scripts/styles).
const SECURITY_HEADERS: Record<string, string> = {
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY"
}

export const handle: Handle = async ({ event, resolve }) => {
	if (
		event.url.pathname.startsWith(
			"/.well-known/appspecific/com.chrome.devtools"
		)
	) {
		return new Response(null, { status: 204 }) // Return empty response with 204 No Content
	}

	// Startup no longer blocks this module's import (see db/index.ts for why it
	// can't), so every request states the dependency explicitly instead of
	// inheriting it. Imported dynamically, not statically, to keep the server
	// modules out of the SSR entry's graph — a static import here would also
	// load them before installPrettyConsole() above has run, losing the
	// formatting on their own startup logs. Resolved after the first request,
	// so this costs a microtask thereafter.
	const { appReady } = await import("$lib/server/startup")
	await appReady

	if (!dev && !hasCheckedForUpdates) {
		hasCheckedForUpdates = true
		// Fire-and-forget: don't let a slow/unreachable network delay this
		// (or any) request. Results populate event.locals on later requests.
		void checkForUpdates()
	}

	if (
		!hasWarnedAboutAddressHeader &&
		!process.env.ADDRESS_HEADER &&
		event.request.headers.has("x-forwarded-for")
	) {
		hasWarnedAboutAddressHeader = true
		console.warn(
			"[Security] This request arrived with an X-Forwarded-For header, but ADDRESS_HEADER is not set — " +
				"login rate limiting is keying on the wrong address (most likely your reverse proxy's, bucketing every real user together). " +
				"See HOSTING.md's reverse-proxy section: set ADDRESS_HEADER=x-forwarded-for, but only if you're actually behind a trusted proxy — " +
				"setting it without one lets a client bypass rate limiting entirely by spoofing the header."
		)
	}
	event.locals.latestReleaseTag = latestReleaseTag
	event.locals.isNewerReleaseAvailable = isNewerReleaseAvailable

	for (const handler of middleware) {
		await handler(event)
	}

	const response = await resolve(event)

	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(name, value)
	}
	// Only advertise HSTS when this request actually arrived over HTTPS —
	// forcing it on a plain-http local/dev/LAN deployment would make the
	// browser refuse to fall back to http on a future visit.
	if (event.url.protocol === "https:") {
		response.headers.set(
			"Strict-Transport-Security",
			"max-age=31536000; includeSubDomains"
		)
	}

	return response
}
