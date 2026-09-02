/**
 * Loads .env before anything else in the server process, and derives the
 * reverse-proxy variables the server framework reads at its own module load.
 *
 * PLAIN JAVASCRIPT ON PURPOSE. scripts/customize-build.js copies this file
 * verbatim into build/ and prepends an import of it as the first line of
 * build/index.js, so it must run with no compilation, no $lib aliases and no
 * dependency beyond real PRODUCTION packages (dotenv and env-paths).
 *
 * Why it has to be this early: @sveltejs/adapter-node reads ORIGIN,
 * PROTOCOL_HEADER, HOST_HEADER, ADDRESS_HEADER, XFF_DEPTH and PORT at the
 * module scope of its own handler, before any application code runs. The app's
 * only dotenv.config() used to live in the socket module, which is imported
 * exclusively by /api/sockets-endpoint — so .env was not read until the first
 * request to that one route, by which point the adapter had long since
 * snapshotted its configuration and $env/dynamic/public had been frozen.
 * Under Docker and bare `node build/index.js`, every one of those variables
 * set only in .env was therefore silently ignored.
 *
 * ESM evaluates imports depth-first in source order, so an import placed on
 * line 1 of build/index.js runs before the handler module it imports next.
 *
 * ── WHERE .env LIVES ────────────────────────────────────────────────────────
 *
 * The install directory is not a safe place to keep configuration. A self
 * updater swaps that folder wholesale; the portable zip extracts over it; a
 * Homebrew cask replaces the whole .app; an AppImage is a read-only squashfs
 * and a signed macOS bundle breaks its signature when edited. Anything the
 * user typed in there is destroyed or unwritable in every one of those cases.
 * So .env now belongs beside the database, in the OS data directory, which
 * nothing in an upgrade touches.
 *
 * Precedence, highest first:
 *   1. the real process environment (Docker `environment:`, systemd, export)
 *   2. <dataDir>/.env
 *   3. <installRoot>/.env, else <cwd>/.env  — legacy, still honored, reported
 *      as deprecated
 *
 * The awkward part is that SERENE_PUB_DATA_DIR chooses the data directory, so
 * it cannot be read from a file inside it. Hence the three passes in
 * planEnvLoad(): the legacy file is PARSED first purely to discover a possible
 * SERENE_PUB_DATA_DIR, and only afterwards are the two files applied in
 * precedence order.
 *
 * ── WHAT "THE INSTALL DIRECTORY" MEANS ──────────────────────────────────────
 *
 * It used to be process.cwd(), which was the same thing as "the folder the
 * user extracted" only because the release bundle put run.sh and build/ in one
 * flat directory. A release now keeps everything that IS the application in an
 * app/ subdirectory, so that an update can replace it with a single rename —
 * and its entrypoint cd's into app/ (the server resolves ./drizzle and
 * ./build/client against the working directory). process.cwd() therefore
 * became <root>/app: a directory an update DELETES.
 *
 * Two things broke as a result, both of them silent data loss:
 *   - an upgraded user's .env, still sitting at <root>/.env, stopped being read
 *   - a relative SERENE_PUB_DATA_DIR resolved inside app/, so the next update
 *     would take the database with it
 *
 * So the entrypoint that knows the layout states it: dist-assets/*\/app/run.*
 * export SERENE_PUB_INSTALL_ROOT as the absolute parent of app/. Nothing is
 * inferred from directory names — a source checkout, Docker, or a hand-rolled
 * entrypoint exports nothing, installRoot falls back to process.cwd(), and
 * behavior is exactly what it has always been there.
 */
import fs from "node:fs"
import path from "node:path"
import dotenv from "dotenv"
import envPaths from "env-paths"

/**
 * The OS data directory, when SERENE_PUB_DATA_DIR does not name one.
 *
 * MUST stay identical to getAppDataDir() in src/lib/server/utils/index.ts.
 * If the two ever disagree the app reads its database from one directory and
 * its configuration from another — a failure that looks like "my settings do
 * nothing" and is very hard to trace. preloadEnv.js cannot import $lib (it is
 * copied unbundled), so the shared implementation is the env-paths package
 * itself, called with identical arguments in both places.
 * preloadEnv.test.ts guards the two call sites against drifting apart.
 */
export function defaultDataDir() {
	return envPaths("SerenePub", { suffix: "" }).data
}

/**
 * @typedef {object} EnvPlan
 * @property {string} installRoot The directory a relative data directory and
 *   the legacy .env are anchored to. Absolute.
 * @property {string} dataDir Resolved data directory. Always ABSOLUTE — a
 *   relative value is anchored to `installRoot` here, once, so that
 *   getAppDataDir(), drizzle.config.ts and every other reader downstream can
 *   never resolve it against a different working directory.
 * @property {"environment" | "install-env" | "default"} dataDirSource Which of
 *   the three sources decided `dataDir`.
 * @property {string} dataEnvPath Absolute path of the data-directory .env.
 * @property {string[]} legacyCandidates The legacy locations considered, in the
 *   order they were consulted.
 * @property {string | null} legacyEnvPath The legacy .env actually used, or
 *   null when none of the candidates exist.
 * @property {string[]} legacyIgnoredPaths Legacy files that exist but lost to
 *   `legacyEnvPath`. Worth naming: two .env files disagreeing, with only one of
 *   them in effect, is otherwise invisible.
 * @property {string[]} load Files that exist, in the order dotenv must read
 *   them. Deduplicated, so a data directory that IS the install directory is
 *   listed once.
 * @property {Record<string, string>} applied What those files actually
 *   contribute — parsed keys not already present in the process environment.
 * @property {string[]} legacyKeys The subset of `applied` that only the legacy
 *   file supplied. Empty when that file is absent, or when everything in it was
 *   already set elsewhere.
 */

/**
 * Decide which .env files to read, in which order, and what they will
 * contribute.
 *
 * Pure: every input arrives as an argument, so the precedence rules are
 * testable without a filesystem, a real process environment, or a particular
 * operating system.
 *
 * `applied` mirrors dotenv's own assignment rule (verified against dotenv
 * 16.6.1: it skips any key the target environment already has as an own
 * property, and the first file to supply a key wins). It exists for reporting
 * — the values are applied by dotenv.config() below, not from this map.
 *
 * @param {object} args
 * @param {Record<string, string | undefined>} args.processEnv Real environment.
 * @param {string} args.installRoot The top of the install — the directory the
 *   application folder sits in, stated by the entrypoint. A relative data
 *   directory and the preferred legacy .env are both anchored here.
 * @param {string} [args.cwd] The working directory, when it differs from
 *   `installRoot` (a release entrypoint cd's into app/). Defaults to
 *   `installRoot`, which is the source/Docker case where they are the same.
 * @param {(filePath: string) => string | null} args.readFile File contents, or
 *   null when the file does not exist / cannot be read.
 * @param {string} args.dataDirFallback Used when nothing names a data directory.
 * @returns {EnvPlan}
 */
export function planEnvLoad({
	processEnv,
	installRoot,
	cwd = installRoot,
	readFile,
	dataDirFallback
}) {
	const resolvedRoot = path.resolve(installRoot)

	// Both legacy locations, install root first. The root is where an upgraded
	// user's file actually is (it predates app/, and extracting a new zip over
	// the old folder leaves it exactly there); the working directory covers a
	// source checkout or Docker, where it is the same file, and a hand-rolled
	// entrypoint that cd's somewhere else.
	const rootEnvPath = path.resolve(resolvedRoot, ".env")
	const cwdEnvPath = path.resolve(cwd, ".env")
	const legacyCandidates =
		rootEnvPath === cwdEnvPath ? [rootEnvPath] : [rootEnvPath, cwdEnvPath]

	/** @type {string | null} */
	let legacyEnvPath = null
	/** @type {string | null} */
	let legacySource = null
	/** @type {string[]} */
	const legacyIgnoredPaths = []
	for (const candidate of legacyCandidates) {
		const source = readFile(candidate)
		if (source === null) continue
		if (legacyEnvPath === null) {
			legacyEnvPath = candidate
			legacySource = source
		} else {
			// Deliberately not merged. One legacy file in effect and the other
			// named in the banner beats silently interleaving two deprecated
			// files whose precedence nobody could reason about.
			legacyIgnoredPaths.push(candidate)
		}
	}

	// Pass A: parsed, never applied. Its only job here is to reveal a
	// SERENE_PUB_DATA_DIR, which has to be known before the data-directory
	// file can even be located.
	const legacyParsed =
		legacySource === null ? null : dotenv.parse(legacySource)

	/** @type {EnvPlan["dataDirSource"]} */
	let dataDirSource = "default"
	let rawDataDir = dataDirFallback
	if (processEnv.SERENE_PUB_DATA_DIR) {
		rawDataDir = processEnv.SERENE_PUB_DATA_DIR
		dataDirSource = "environment"
	} else if (legacyParsed?.SERENE_PUB_DATA_DIR) {
		rawDataDir = legacyParsed.SERENE_PUB_DATA_DIR
		dataDirSource = "install-env"
	}

	// A relative value (the portable `SERENE_PUB_DATA_DIR=./data`) is anchored
	// to the install root, NOT to the working directory. In a release that
	// working directory is the app/ folder an update replaces wholesale, so
	// resolving `./data` there would put the user's database inside the thing
	// being deleted. Anchoring it once, here, is also what lets every reader
	// downstream stay unchanged: `dataDir` leaves this function absolute.
	const dataDir = path.resolve(resolvedRoot, rawDataDir)

	const dataEnvPath = path.resolve(dataDir, ".env")
	const sameFile = dataEnvPath === legacyEnvPath
	const dataSource = sameFile ? legacySource : readFile(dataEnvPath)
	const dataParsed = sameFile
		? legacyParsed
		: dataSource === null
			? null
			: dotenv.parse(dataSource)

	/** @type {Record<string, string>} */
	const applied = {}
	/** @type {string[]} */
	const legacyKeys = []
	/** @type {[boolean, Record<string, string> | null][]} */
	const passes = [
		[false, dataParsed],
		[!sameFile, legacyParsed]
	]
	for (const [isLegacy, parsed] of passes) {
		if (!parsed) continue
		for (const key of Object.keys(parsed)) {
			if (Object.prototype.hasOwnProperty.call(processEnv, key)) continue
			if (Object.prototype.hasOwnProperty.call(applied, key)) continue
			applied[key] = parsed[key]
			if (isLegacy) legacyKeys.push(key)
		}
	}

	/** @type {string[]} */
	const load = []
	if (dataParsed !== null) load.push(dataEnvPath)
	if (legacyParsed !== null && !sameFile && legacyEnvPath !== null) {
		load.push(legacyEnvPath)
	}

	return {
		installRoot: resolvedRoot,
		dataDir,
		dataDirSource,
		dataEnvPath,
		legacyCandidates,
		legacyEnvPath,
		legacyIgnoredPaths,
		load,
		applied,
		legacyKeys
	}
}

/**
 * Only fill in a variable the operator has not set themselves.
 *
 * @param {Record<string, string>} record collects what was actually applied,
 *   so the startup banner can report it
 * @param {string} key
 * @param {string | undefined} value
 */
function derive(record, key, value) {
	if (!value) return
	if (process.env[key]) return
	process.env[key] = value
	record[key] = value
}

// Stated by the entrypoint that knows the layout (dist-assets/*/app/run.*),
// never inferred: an entrypoint that says nothing gets process.cwd(), which is
// what a source checkout, Docker, and every pre-app/ release already relied on.
const plan = planEnvLoad({
	processEnv: process.env,
	installRoot: process.env.SERENE_PUB_INSTALL_ROOT || process.cwd(),
	cwd: process.cwd(),
	readFile: (filePath) => {
		try {
			return fs.readFileSync(filePath, "utf8")
		} catch {
			// Absent, or unreadable — either way there is nothing to apply.
			return null
		}
	},
	dataDirFallback: defaultDataDir()
})

// dotenv never overwrites a key the environment already has, so reading the
// data-directory file first and the legacy file second produces exactly the
// documented precedence, while still honoring anything only the legacy file
// supplies.
for (const file of plan.load) dotenv.config({ path: file })

// SERENE_PUB_DATA_DIR is the one variable whose VALUE has to be rewritten
// rather than merely applied. Everything downstream — getAppDataDir() in
// utils/index.ts and in drizzle.config.ts, RuntimeManager's plugin storage
// root — reads it straight from the environment and resolves a relative value
// against whatever the working directory happens to be by then. That is how
// `SERENE_PUB_DATA_DIR=./data` would land inside the app/ folder an update
// deletes. Writing the already-anchored absolute path back means no reader
// downstream has to know any of this.
//
// Guarded on it already being set, so a default install is left with the
// variable genuinely absent — RuntimeManager treats presence as "the operator
// chose a data directory" and enabling plugin storage as a side effect of a
// path fix would be an unrelated behavior change.
if (process.env.SERENE_PUB_DATA_DIR) {
	process.env.SERENE_PUB_DATA_DIR = plan.dataDir
}

/** @type {Record<string, string>} */
const derived = {}

// Declaring TRUSTED_PROXIES means "there is a reverse proxy in front of me and
// these are its addresses". That statement implies every forwarded header the
// framework needs, so setting them by hand as well is pure ceremony — and
// forgetting one produces confusing partial behavior (the classic being
// correct hostnames but every user sharing one login rate-limit bucket).
// Each derivation is reported in the startup banner so it is never invisible.
if (process.env.TRUSTED_PROXIES?.trim()) {
	derive(derived, "ADDRESS_HEADER", "x-forwarded-for")
	derive(derived, "HOST_HEADER", "x-forwarded-host")
	derive(derived, "PROTOCOL_HEADER", "x-forwarded-proto")
}

// ORIGIN is what SvelteKit uses for CSRF origin checks. PUBLIC_URL already
// states the same fact, so keep them in agreement rather than making the
// operator write it twice.
const publicUrl = (
	process.env.PUBLIC_URL ||
	process.env.SERENE_PUB_PUBLIC_URL ||
	""
).trim()
if (publicUrl) {
	try {
		derive(derived, "ORIGIN", new URL(publicUrl).origin)
	} catch {
		// Malformed value; getConfiguredPublicUrl() warns about it once.
	}
}

// Read by the startup banner to report whether this ran at all. A hand-rolled
// entrypoint that bypasses build/index.js will not have it, and the banner
// tells the operator their adapter-level variables were not applied. The env
// file fields let the banner name the files that were read and flag the
// deprecated install-dir location when something actually came from it.
globalThis.__serenePubEnvPreloaded = {
	derived,
	installRoot: plan.installRoot,
	dataDir: plan.dataDir,
	dataDirSource: plan.dataDirSource,
	dataEnvPath: plan.dataEnvPath,
	loaded: plan.load,
	legacyEnvPath: plan.legacyKeys.length > 0 ? plan.legacyEnvPath : null,
	legacyIgnoredPaths: plan.legacyIgnoredPaths,
	legacyKeys: plan.legacyKeys
}
