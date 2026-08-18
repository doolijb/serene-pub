// MUST stay the first import. It loads .env (when the build-level preload
// didn't), installs the console wrapper, and prints the configuration banner —
// all at module scope, so it has to run before any other module here logs at
// ITS module scope ($lib/server/db and the socket server both do). The console
// patching used to live directly in this file for exactly that reason; it
// moved into bootstrapEnv so the ordering is expressed in one place instead of
// depending on import order between two unrelated concerns.
import "$lib/server/config/bootstrapEnv"
import { dev } from "$app/environment"
import { appVersion } from "$lib/shared/constants/version"
import { pickNotifiableRelease } from "$lib/shared/utils/releaseChannel"
import type { Handle, RequestEvent } from "@sveltejs/kit"
import { isRequestHttps } from "$lib/server/net/publicUrl"
import { mergeCspExtras } from "$lib/server/security/csp"
// import { userAuthentication, routeGuard } from "$server/middleware"

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

// The full release list, NOT /releases/latest. GitHub's "latest" endpoint
// excludes pre-releases by definition, so a beta install could never be told
// about a newer beta through it — the channel filtering below needs to see
// every release and decide for itself.
const GITHUB_API_URL =
	"https://api.github.com/repos/doolijb/serene-pub/releases?per_page=30"

/** Re-check no more than once a day. Deliberately lazy rather than a timer:
 * an idle server has nobody to notify, and this keeps the check tied to
 * someone actually loading the app. */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

async function checkForUpdates() {
	try {
		console.log("[VersionCheck] Checking for new release...")
		const res = await fetch(GITHUB_API_URL, {
			headers: { Accept: "application/vnd.github+json" },
			signal: AbortSignal.timeout(5000)
		})
		if (!res.ok) {
			console.warn(
				`[VersionCheck] Failed to fetch releases: HTTP ${res.status}`
			)
			return
		}

		const data = await res.json()
		if (!Array.isArray(data)) {
			console.warn("[VersionCheck] Unexpected response shape; ignoring.")
			return
		}

		// Drafts are not published to anyone. `prerelease` is NOT used to filter
		// here — the tag name is the authority, since that is what encodes the
		// channel (-beta / -rc-N / -pr-N) and what the ladder understands.
		const tags: string[] = data
			.filter((r: any) => r && !r.draft && typeof r.tag_name === "string")
			.map((r: any) => r.tag_name)

		const notifiable =
			typeof appVersion === "string"
				? pickNotifiableRelease(appVersion, tags)
				: null

		latestReleaseTag = notifiable ?? undefined
		isNewerReleaseAvailable = notifiable !== null

		if (notifiable) {
			console.log(
				`[VersionCheck] Current: ${appVersion} — update available: ${notifiable}`
			)
		} else {
			console.log(
				`[VersionCheck] Current: ${appVersion} — no newer release on this channel.`
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
	} finally {
		// Stamped even on failure, so an offline server retries once a day
		// rather than on every single request.
		lastUpdateCheckAt = Date.now()
	}
}

let latestReleaseTag: string | undefined = undefined
let isNewerReleaseAvailable: boolean | undefined = undefined
/** 0 means "never checked". Compared against UPDATE_CHECK_INTERVAL_MS so a
 * long-lived server re-checks daily instead of once per process. */
let lastUpdateCheckAt = 0
let updateCheckInFlight: Promise<void> | null = null

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
//
// The advice here used to carry a "setting it without a proxy lets anyone
// bypass rate limiting by spoofing the header" caveat. That's no longer
// true: getHttpClientAddress() only honors the header when the direct peer
// is itself local, so a remote client's claimed value is ignored outright.
// Setting it also no longer breaks direct/unproxied logins, which it did
// for as long as this route called adapter-node's throwing
// getClientAddress() directly.
let hasWarnedAboutAddressHeader = false

// Content-Security-Policy is configured via svelte.config.js's kit.csp
// instead of set here — SvelteKit needs to own that header so it can inject
// a correct hash/nonce for its own generated inline hydration script; a
// hand-rolled header here has no way to know that value and silently breaks
// hydration (confirmed the hard way — see CSP_EXTRA_*_SRC in docs/hosting.md for
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

	if (
		!dev &&
		!updateCheckInFlight &&
		Date.now() - lastUpdateCheckAt > UPDATE_CHECK_INTERVAL_MS
	) {
		// Fire-and-forget: don't let a slow/unreachable network delay this
		// (or any) request. Results populate event.locals on later requests.
		// The in-flight guard keeps a burst of concurrent requests from
		// launching several fetches at once.
		updateCheckInFlight = checkForUpdates().finally(() => {
			updateCheckInFlight = null
		})
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
				"If you are behind a reverse proxy or tunnel, set ADDRESS_HEADER=x-forwarded-for. " +
				"A claimed header is only trusted when the request's direct peer is on the local network, so this is safe to set on an " +
				"install that is also reached directly, and safe to leave set if the proxy is later removed. " +
				"See docs/hosting.md's reverse-proxy section."
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

	// Extend — never replace — the CSP SvelteKit generated, so its own
	// nonce/hash survives. This is what makes CSP_EXTRA_* actually work on a
	// prebuilt artifact: they are read in svelte.config.js at BUILD time, and
	// nothing passes them at build, so on every published Docker image and
	// desktop zip the baked-in value was empty and a user's .env setting was
	// silently inert. Non-HTML responses carry no CSP header, so this no-ops.
	for (const name of [
		"content-security-policy",
		"content-security-policy-report-only"
	]) {
		const existing = response.headers.get(name)
		if (existing) response.headers.set(name, mergeCspExtras(existing))
	}
	// Only advertise HSTS when this request actually arrived over HTTPS —
	// forcing it on a plain-http local/dev/LAN deployment would make the
	// browser refuse to fall back to http on a future visit.
	//
	// This used to test `event.url.protocol === "https:"`, which did NOT do
	// what the paragraph above says: under adapter-node that property reports
	// "https:" for plain-http requests whenever PROTOCOL_HEADER/ORIGIN are
	// unset, so every desktop and Docker install was advertising HSTS over
	// plain HTTP — pinning http://localhost:3000 to https in the visitor's
	// browser for a year. isRequestHttps() is the shared, measured answer, and
	// requires HTTPS to actually announce itself.
	if (isRequestHttps(event)) {
		response.headers.set(
			"Strict-Transport-Security",
			"max-age=31536000; includeSubDomains"
		)
	}

	return response
}
