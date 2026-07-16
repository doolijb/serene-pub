import { dev } from "$app/environment"
import { loadSocketsServer } from "$lib/server/sockets/loadSockets.server"
import { appVersion } from "$lib/shared/constants/version"
import type { Handle } from "@sveltejs/kit"
// import { userAuthentication, routeGuard } from "$server/middleware"

const middleware: Middleware[] = [] // [userAuthentication, routeGuard]

loadSocketsServer()
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
			headers: { Accept: "application/vnd.github+json" }
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
		console.error("[VersionCheck] Error checking for new release:", err)
	}
}

let latestReleaseTag: string | undefined = undefined
let isNewerReleaseAvailable: boolean | undefined = undefined
let hasCheckedForUpdates = false

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

	if (!dev && !hasCheckedForUpdates) {
		hasCheckedForUpdates = true
		await checkForUpdates()
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
