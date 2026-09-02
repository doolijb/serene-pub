/**
 * Startup configuration reporting: what public URL this deployment resolved
 * to, which proxies it trusts, and which deprecated variables are still in
 * play. Imported first by hooks.server.ts so it runs once, before any request.
 *
 * The banner exists because the hosting configuration was previously
 * unknowable from the outside: an operator could set SOCKETS_HTTPS_HOSTS and
 * HOST_HEADER, have one of them silently not apply, and have no way to tell
 * short of curling an internal API route. Printing the resolved answer turns
 * "why is my socket URL wrong" into a line of log output.
 */
import dotenv from "dotenv"
import { dev } from "$app/environment"
import { installPrettyConsole } from "$lib/server/utils/prettyConsole"
import {
	describePublicUrlConfig,
	getConfiguredPublicUrl,
	getPublicSocketsEndpoint,
	getSocketsPort
} from "$lib/server/net/publicUrl"
import {
	describeOriginAllowlistConfig,
	isWildcardAllowed
} from "$lib/server/sockets/originAllowlist"

/**
 * What preloadEnv.js recorded, when it ran. Absent under `vite dev` (no
 * build/index.js) and under a hand-rolled entrypoint.
 *
 * Everything past `derived` is optional because a build from before the .env
 * relocation — or a test that fabricates the marker — publishes the old
 * one-field shape.
 */
type EnvPreloadRecord = {
	derived: Record<string, string>
	/** Resolved data directory. */
	dataDir?: string
	/** Where <dataDir>/.env is looked for. */
	dataEnvPath?: string
	/** .env files actually read, in precedence order. */
	loaded?: string[]
	/** The deprecated install-dir .env, only when it supplied something. */
	legacyEnvPath?: string | null
	/** Which keys it supplied. Names only — never values. */
	legacyKeys?: string[]
}

function preloadRecord(): EnvPreloadRecord | null {
	const record = (
		globalThis as unknown as {
			__serenePubEnvPreloaded?: EnvPreloadRecord
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
		name: "SOCKETS_HTTPS_HOSTS",
		replacement: (v) => `PUBLIC_URL=https://${v.split(",")[0].trim()}`
	},
	{
		name: "SOCKETS_HTTP_MODE",
		replacement: () => "PUBLIC_URL=https://<your public hostname>"
	},
	{
		name: "SERENE_PUB_SECURE_COOKIES",
		replacement: () => "PUBLIC_URL=https://<your public hostname>"
	},
	{
		name: "PUBLIC_SOCKETS_ENDPOINT",
		replacement: () =>
			"SOCKETS_ENDPOINT=<same value>, or drop it — PUBLIC_URL covers same-origin setups"
	}
]

/** The always-printed configuration summary. Pure, so it can be tested. */
export function buildStartupBanner(): string[] {
	const lines: string[] = []
	lines.push(`${PREFIX} Public URL:  ${describePublicUrlConfig()}`)
	lines.push(
		`${PREFIX} Local URL:   http://localhost:${process.env.PORT || "3000"}`
	)

	const socketUrl = getPublicSocketsEndpoint()
	const sameOrigin =
		getConfiguredPublicUrl() !== null &&
		!process.env.SOCKETS_ENDPOINT &&
		!process.env.PUBLIC_SOCKETS_ENDPOINT
	lines.push(
		sameOrigin
			? `${PREFIX} Socket URL:  ${socketUrl}   (same origin — your proxy must route /socket.io/ to port ${getSocketsPort()})`
			: `${PREFIX} Socket URL:  ${socketUrl}`
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

	// Which .env files were read is otherwise unknowable from the outside, and
	// there are now two candidate locations — so say it rather than making the
	// operator guess which of their files the running server picked up.
	if (record?.loaded) {
		const files = record.loaded.map((file) =>
			file === record.dataEnvPath
				? file
				: `${file} (install dir — deprecated)`
		)
		lines.push(
			`${PREFIX} Env files:   ` +
				(files.length > 0
					? files.join(", ")
					: `none found (looked in ${record.dataEnvPath})`)
		)
	}

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
 * The deprecated .env LOCATION, as opposed to the deprecated variables above.
 *
 * Fires only when the install-directory file actually supplied a value —
 * having one that is fully shadowed by the environment or by <dataDir>/.env
 * changes nothing, so warning about it would be noise. Key names only: this
 * file holds admin passwords and recovery keys.
 */
function buildLegacyEnvFileNotice(): string[] | null {
	const record = preloadRecord()
	const legacyPath = record?.legacyEnvPath
	const keys = record?.legacyKeys ?? []
	if (!legacyPath || keys.length === 0) return null

	const lines = [
		`${PREFIX} DEPRECATED .env location: ${legacyPath} supplied ` +
			`${keys.join(", ")}.`
	]

	// SERENE_PUB_DATA_DIR is the one key that genuinely cannot move: it
	// chooses the directory the other file is read from.
	const movable = keys.filter((k) => k !== "SERENE_PUB_DATA_DIR")
	if (movable.length > 0) {
		lines.push(
			`${PREFIX}   Updating Serene Pub replaces the install directory ` +
				"wholesale, which deletes that file. Move " +
				`${movable.join(", ")} to:`
		)
		lines.push(`${PREFIX}       ${record?.dataEnvPath}`)
	}
	if (keys.includes("SERENE_PUB_DATA_DIR")) {
		lines.push(
			`${PREFIX}   SERENE_PUB_DATA_DIR has to stay in the install ` +
				"directory — it chooses the data directory, so it cannot be " +
				"read from a file inside it. Set it in the real environment " +
				"instead, or keep a copy: an update replaces that file."
		)
	}
	lines.push(
		`${PREFIX}   See docs/environment-variables.md for where .env now lives.`
	)
	return lines
}

/**
 * The one-time migration notice. Returns null when nothing deprecated is in
 * use, so a modern install prints nothing. Deliberately not a per-request
 * warning: these are configuration facts, not events.
 */
export function buildLegacyMigrationNotice(): string[] | null {
	const lines: string[] = []

	const active = DEPRECATED_VARS.filter((v) => process.env[v.name]?.trim())
	if (active.length > 0) {
		lines.push(
			`${PREFIX} DEPRECATED hosting variables are in use. They still work and ` +
				"nothing is broken, but one PUBLIC_URL replaces all of them:"
		)
		for (const v of active) {
			const value = process.env[v.name]!.trim()
			lines.push(`${PREFIX}   ${v.name}=${value}`)
			lines.push(`${PREFIX}       -> ${v.replacement(value)}`)
		}
		lines.push(
			`${PREFIX}   See docs/hosting.md for the full migration guide.`
		)
	}

	// Same reporting path on purpose: one deprecation notice, not two
	// competing ones.
	lines.push(...(buildLegacyEnvFileNotice() ?? []))

	return lines.length > 0 ? lines : null
}

/** Warning for the origin allowlist being switched off entirely. */
export function buildWildcardWarning(): string[] | null {
	if (!isWildcardAllowed()) return null
	return [
		`${PREFIX} WARNING: ALLOWED_ORIGINS=* — the origin ` +
			"allowlist is disabled, so any web page can open a socket to this " +
			"server. The Docker compose files no longer set this; same-hostname " +
			"origins are allowed automatically with no configuration. Remove it " +
			"unless you specifically need cross-hostname access."
	]
}

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
	const wildcard = buildWildcardWarning()
	if (wildcard) for (const line of wildcard) console.warn(line)
}

bootstrap()
