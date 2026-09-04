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
		// Self-contained on purpose, and NOT phrased as "see the entry above".
		// This is the only spelling that any shipped 0.5.x actually read
		// (verified: `process.env.ALLOWED_ORIGINS` appears in zero files at
		// v0.5.0-beta, v0.5.1-beta and v0.5.2-beta, while SOCKETS_ALLOWED_ORIGINS
		// was read by originAllowlist.ts). So a real upgrader has only this one
		// set, the ALLOWED_ORIGINS line never prints for them, and a cross
		// reference to it would dangle.
		name: "SOCKETS_ALLOWED_ORIGINS",
		note:
			"origin trust is automatic now and there is NO replacement variable — an " +
			"origin whose hostname matches the one the request arrived on is always " +
			"allowed, and PUBLIC_URL's hostname is allowed alongside it, which covers " +
			"a proxy that rewrites Host to an internal name. A value of * used to " +
			"switch the check off entirely; that cannot be re-created. Non-browser " +
			"clients with no Origin header are restricted to the local network, and " +
			"that can no longer be widened"
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

/** Whether a variable carries a usable value. Trimmed, because a compose file
 * that leaves `TRUSTED_PROXIES: ""` behind has declared nothing. */
function isSet(name: string): boolean {
	return Boolean(process.env[name]?.trim())
}

/**
 * Retirements that were LOAD-BEARING in some deployments, paired with the live
 * settings that now do their job.
 *
 * RETIRED_VARS above fires for everyone who still has one of those names in
 * their compose file, which is correct but not sufficient: it prints the same
 * "no effect, can be removed" line for a leftover SOCKETS_PORT that genuinely
 * changes nothing and for the SOCKETS_HTTP_MODE that was the only thing telling
 * this deployment it is reached over HTTPS. An operator scrolling past six
 * identical "ignored" lines has no way to see which one mattered, and the
 * warning that matters is the one that trains them to ignore warnings.
 *
 * So each entry here prints only when a retired variable was actually doing
 * work AND none of its replacements is configured. A deployment that has
 * already migrated stays silent; a deployment about to lose something gets one
 * specific line naming the exact setting to add. `id` is printed verbatim so it
 * can be searched for or quoted in an issue and land on this case rather than
 * on the generic list.
 *
 * Being SET is not the same as having MATTERED, which is why each source
 * carries its own predicate: SOCKETS_HTTP_MODE=http never made anything HTTPS,
 * so an operator who has it set to that has nothing to lose and hears nothing.
 */
const LOAD_BEARING_RETIREMENTS: {
	id: string
	sources: { name: string; wasLoadBearing: (value: string) => boolean }[]
	replacements: string[]
	/** What the retired variable used to do, and what does that job now. */
	before: string
	/** What the operator actually loses. Stated as an observable effect, since
	 * "HTTPS detection degrades" is not something anyone can look for. */
	effect: string
	/** The one line to add to their environment. */
	fix: string
}[] = [
	{
		// The dangerous one: these two were the LAST resort inside
		// isRequestHttps(), checked after the forwarded-proto header, so they
		// were exactly what covered the deployments where that header does not
		// arrive or cannot be trusted. Their loss is silent by construction —
		// nothing errors, HTTPS simply stops being detected, and the cookie
		// Secure flag and HSTS go with it.
		id: "SP-HOSTING-HTTPS-DETECTION",
		sources: [
			{
				name: "SOCKETS_HTTP_MODE",
				wasLoadBearing: (v) => v.toLowerCase() === "https"
			},
			{ name: "SOCKETS_HTTPS_HOSTS", wasLoadBearing: () => true }
		],
		replacements: [
			"PUBLIC_URL",
			"SERENE_PUB_PUBLIC_URL",
			"ORIGIN",
			"TRUSTED_PROXIES",
			"SERENE_PUB_SECURE_COOKIES"
		],
		before:
			"declared that this deployment is reached over HTTPS. That is now " +
			"detected from an X-Forwarded-Proto: https header, and only when " +
			"the proxy that sent it is itself trusted (by default, on a private " +
			"range) — so a proxy that omits the header, or sits on a public " +
			"address, leaves this deployment believing it is plain HTTP",
		effect:
			"the userToken cookie is set without the Secure flag (and SameSite " +
			"drops from strict to lax), and Strict-Transport-Security is no " +
			"longer sent. Logging in still works; the session cookie is simply " +
			"no longer marked HTTPS-only",
		fix: "PUBLIC_URL=https://<the hostname your users type>"
	},
	{
		// Easy to miss because it is a side effect: SOCKETS_HTTPS_HOSTS and
		// SOCKETS_ALLOWED_ORIGINS were both folded into the socket origin
		// allowlist, and `*` switched that allowlist off outright. Retiring them
		// therefore costs an origin, not just a protocol. Harmless wherever
		// `Host` reaches the app intact — which is most installs, hence the
		// conditional wording rather than a flat "you are broken".
		//
		// TRUSTED_PROXIES is deliberately NOT a replacement here: the allowlist
		// reads PUBLIC_URL only. Declaring your proxies fixes HTTPS detection
		// and does nothing for this.
		id: "SP-HOSTING-ORIGIN-ALLOWLIST",
		sources: [
			{ name: "SOCKETS_HTTPS_HOSTS", wasLoadBearing: () => true },
			{ name: "SOCKETS_ALLOWED_ORIGINS", wasLoadBearing: () => true }
		],
		replacements: ["PUBLIC_URL", "SERENE_PUB_PUBLIC_URL", "ORIGIN"],
		before:
			"also added the hostnames they named to the socket origin " +
			"allowlist, and a value of * switched that allowlist off entirely. " +
			"Origin trust is derived now: an Origin whose hostname equals the " +
			"request's own Host header is allowed, plus PUBLIC_URL's hostname",
		effect:
			"nothing, if your reverse proxy forwards the real Host header. If " +
			"it rewrites Host to an internal name, every browser's socket " +
			"handshake is rejected — the page loads and then never updates",
		fix: "PUBLIC_URL=https://<the hostname your users type>"
	}
]

/**
 * The targeted half of the migration notice: one block per retirement that was
 * actually load-bearing here and has no live replacement. Empty for a modern
 * install, and empty for an upgrading one that already sets PUBLIC_URL or
 * TRUSTED_PROXIES. Pure, so it can be tested.
 *
 * Names variables rather than echoing their values — the IGNORED list above
 * already prints each value once, and repeating them here would put hostnames
 * (and anything else an operator has stuffed into these) on screen twice.
 */
export function buildLoadBearingRetirementWarnings(): string[] {
	const lines: string[] = []
	for (const entry of LOAD_BEARING_RETIREMENTS) {
		const active = entry.sources.filter((source) => {
			const value = process.env[source.name]?.trim()
			return value ? source.wasLoadBearing(value) : false
		})
		if (active.length === 0) continue
		if (entry.replacements.some(isSet)) continue

		const names = active.map((s) => s.name)
		lines.push(
			`${PREFIX} WARNING [${entry.id}]: ${names.join(" and ")} ` +
				`${names.length === 1 ? "is" : "are"} no longer read. ` +
				`${names.length === 1 ? "It" : "They"} ${entry.before}.`
		)
		lines.push(
			`${PREFIX}     Nothing here replaces ` +
				`${names.length === 1 ? "it" : "them"}: ` +
				`${entry.replacements.join(", ")} are all unset.`
		)
		lines.push(`${PREFIX}     Effect: ${entry.effect}.`)
		lines.push(`${PREFIX}     Fix: ${entry.fix}`)
	}
	return lines
}

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

	// Last, deliberately: the two lists above are inventories, and this is the
	// subset of them that needs the operator to do something. Printing it after
	// them makes it the final word rather than one line inside a list whose
	// heading already said "no effect".
	lines.push(...buildLoadBearingRetirementWarnings())

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
