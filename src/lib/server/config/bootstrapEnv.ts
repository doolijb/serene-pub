/**
 * Startup configuration reporting: what public URL this deployment resolved
 * to, which proxies it trusts, and which deprecated variables are still in
 * play. Imported first by hooks.server.ts so it runs once, before any request.
 *
 * The banner exists because the hosting configuration was previously
 * unknowable from the outside: an operator could set two overlapping hosting
 * variables, have one of them silently not apply, and have no way to tell short
 * of curling an internal API route. Printing the resolved answer turns "why is
 * my public URL wrong" into a line of log output.
 */
import dotenv from "dotenv"
import { dev } from "$app/environment"
import { installPrettyConsole } from "$lib/server/utils/prettyConsole"
import { describePublicUrlConfig } from "$lib/server/net/publicUrl"
import { describeOriginAllowlistConfig } from "$lib/server/sockets/originAllowlist"

/** What preloadEnv.js recorded, when it ran. Absent under `vite dev` (no
 * build/index.js) and under a hand-rolled entrypoint. */
function preloadRecord(): { derived: Record<string, string> } | null {
	const record = (
		globalThis as unknown as {
			__serenePubEnvPreloaded?: { derived: Record<string, string> }
		}
	).__serenePubEnvPreloaded
	return record ?? null
}

const PREFIX = "[Serene Pub]"

/**
 * Deprecated hosting variables, in the order they should be reported, each
 * with the modern setting that replaces it. Kept as data so the startup
 * notice, the docs and .env.example can't drift into disagreeing about what
 * replaces what.
 */
const DEPRECATED_VARS: {
	name: string
	replacement: (value: string) => string
}[] = [
	{
		name: "SERENE_PUB_SECURE_COOKIES",
		replacement: () => "PUBLIC_URL=https://<your public hostname>"
	}
]

/**
 * Variables that are no longer read at all, as opposed to the deprecated-but-
 * honored one above. Two generations of socket-specific configuration ended up
 * here: the ones that named the second HTTP listener Socket.IO used to run on,
 * and the ones that gave the real-time layer its own origin and protocol trust.
 * Both are answered by ordinary HTTP facts now — PORT binds the one server, and
 * PUBLIC_URL/TRUSTED_PROXIES say what this deployment is reached as.
 *
 * Reported separately and worded differently on purpose. "Still works, but
 * there's a better name for it" and "this value is being ignored" are different
 * facts, and an operator whose compose file still says SOCKETS_PORT: 3001
 * deserves the second one rather than silence.
 *
 * ALLOWED_ORIGINS is the one entry here that has no replacement to point at,
 * and its note has to say so plainly: every other retired variable is a thing
 * to re-express, whereas origin trust is now derived and there is nothing left
 * to set. An operator told only "ignored" would reasonably go looking for the
 * new spelling of it, and there isn't one.
 */
const RETIRED_VARS: { name: string; note: string }[] = [
	{
		name: "SOCKETS_PORT",
		note: "no second listener exists — PORT binds the one server, which serves /socket.io/ too"
	},
	{
		name: "SOCKETS_ENDPOINT",
		note: "the browser now opens its socket against the page's own origin"
	},
	{
		name: "PUBLIC_SOCKETS_ENDPOINT",
		note: "the browser now opens its socket against the page's own origin"
	},
	{
		name: "ALLOWED_ORIGINS",
		note:
			"origin trust is automatic now and there is NO replacement variable — an " +
			"origin whose hostname matches the one the request arrived on is always " +
			"allowed, and PUBLIC_URL's hostname is allowed alongside it, which covers " +
			"a proxy that rewrites Host to an internal name. Non-browser clients with " +
			"no Origin header are restricted to the local network, and that can no " +
			"longer be widened"
	},
	{
		name: "SOCKETS_ALLOWED_ORIGINS",
		note: "the older spelling of ALLOWED_ORIGINS; see above — there is no replacement for either"
	},
	{
		name: "SOCKETS_HTTPS_HOSTS",
		note: "use PUBLIC_URL=https://<your public hostname>, which says scheme and host together"
	},
	{
		name: "SOCKETS_HTTP_MODE",
		note: "use PUBLIC_URL=https://<your public hostname>; a global protocol override never suited an install reached both directly and through a proxy"
	}
]

/** The always-printed configuration summary. Pure, so it can be tested. */
export function buildStartupBanner(): string[] {
	const lines: string[] = []
	lines.push(`${PREFIX} Public URL:  ${describePublicUrlConfig()}`)
	lines.push(
		`${PREFIX} Local URL:   http://localhost:${process.env.PORT || "3000"}`
	)

	// Not a URL of its own any more: Socket.IO is attached to the server the
	// two lines above describe. Stated rather than dropped, because "which
	// address do I point my proxy at for websockets" was the single most
	// common hosting question this banner exists to answer — and the answer
	// changed.
	lines.push(
		`${PREFIX} Socket URL:  same origin as above — route /socket.io/ to ` +
			`port ${process.env.PORT || "3000"} and forward the WebSocket upgrade`
	)

	const proxies = process.env.TRUSTED_PROXIES?.trim()
	lines.push(
		`${PREFIX} Trusted proxies: ${
			proxies
				? proxies
				: "private ranges (default — set TRUSTED_PROXIES to declare yours)"
		}`
	)
	lines.push(`${PREFIX} ${describeOriginAllowlistConfig()}`)

	const record = preloadRecord()
	const derived = record ? Object.entries(record.derived) : []
	if (derived.length > 0) {
		lines.push(
			`${PREFIX} Derived from TRUSTED_PROXIES/PUBLIC_URL: ` +
				derived.map(([k, v]) => `${k}=${v}`).join(", ")
		)
	}

	// Only meaningful for a built server; under `vite dev` there is no
	// adapter-node reading env at module scope, so the warning would be noise.
	if (!dev && !record) {
		lines.push(
			`${PREFIX} WARNING: .env was loaded late — PORT, ORIGIN, ` +
				"PROTOCOL_HEADER, HOST_HEADER, ADDRESS_HEADER and XFF_DEPTH from " +
				".env were NOT seen by the server framework. Launch with: " +
				"node --env-file=.env build/index.js"
		)
	}

	return lines
}

/**
 * The one-time migration notice. Returns null when no deprecated variable is
 * set, so a modern install prints nothing. Deliberately not a per-request
 * warning: these are configuration facts, not events.
 */
export function buildLegacyMigrationNotice(): string[] | null {
	const lines: string[] = []

	const active = DEPRECATED_VARS.filter((v) => process.env[v.name]?.trim())
	if (active.length > 0) {
		lines.push(
			`${PREFIX} DEPRECATED hosting variables are in use. They still work and ` +
				"nothing is broken, but there is a current setting for each:"
		)
		for (const v of active) {
			const value = process.env[v.name]!.trim()
			lines.push(`${PREFIX}   ${v.name}=${value}`)
			lines.push(`${PREFIX}       -> ${v.replacement(value)}`)
		}
	}

	const retired = RETIRED_VARS.filter((v) => process.env[v.name]?.trim())
	if (retired.length > 0) {
		lines.push(
			`${PREFIX} IGNORED hosting variables are set. Real-time updates share ` +
				"the app's own server, port and origin trust, so these have no " +
				"effect and can be removed:"
		)
		for (const v of retired) {
			lines.push(
				`${PREFIX}   ${v.name}=${process.env[v.name]!.trim()} — ${v.note}`
			)
		}
	}

	if (lines.length === 0) return null
	lines.push(`${PREFIX}   See docs/hosting.md for the full migration guide.`)
	return lines
}

// buildWildcardWarning() lived here, warning that ALLOWED_ORIGINS=* had
// switched the origin allowlist off. There is no longer any variable that can
// do that, so the warning has no reachable condition; ALLOWED_ORIGINS is
// reported by RETIRED_VARS above instead, which is the accurate thing to tell
// an operator who still has it set.

let bootstrapped = false

function bootstrap() {
	if (bootstrapped) return
	bootstrapped = true

	installPrettyConsole()

	// Fallback for paths where preloadEnv.js did not run (vite dev, or a
	// custom entrypoint). dotenv never overwrites an already-set key, so this
	// cannot clobber real environment variables from Docker or systemd.
	if (!preloadRecord()) dotenv.config()

	for (const line of buildStartupBanner()) console.log(line)
	const notice = buildLegacyMigrationNotice()
	if (notice) for (const line of notice) console.warn(line)
}

bootstrap()
