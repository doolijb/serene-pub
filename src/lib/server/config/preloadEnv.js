/**
 * Loads .env before anything else in the server process, and derives the
 * reverse-proxy variables the server framework reads at its own module load.
 *
 * PLAIN JAVASCRIPT ON PURPOSE. scripts/customize-build.js copies this file
 * verbatim into build/ and prepends an import of it as the first line of
 * build/index.js, so it must run with no compilation, no $lib aliases and no
 * dependency beyond dotenv (a production dependency).
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
 */
import dotenv from "dotenv"

dotenv.config()

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
// tells the operator their adapter-level variables were not applied.
globalThis.__serenePubEnvPreloaded = { derived }
