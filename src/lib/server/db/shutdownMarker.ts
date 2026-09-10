/**
 * Did the last run end properly?
 *
 * A SIGINT or SIGTERM shutdown closes PGlite last and leaves the data directory
 * consistent (`services/index.ts`, `./index.ts`'s `closeDatabase()`). SIGKILL,
 * an OOM kill, a pulled plug and a force-quit run **nothing at all** — so there
 * is no code that can notice at the time, and by the next boot the only
 * difference between the two endings is whatever the previous run left on disk
 * before it died.
 *
 * So the marker is written the other way round from how it reads: `"unclean"`
 * goes in as soon as the database opens and stays there for the whole run;
 * `"clean"` replaces it only once PGlite has actually closed. A boot that finds
 * `"unclean"` is a boot after a kill, whether or not the directory still opens.
 *
 * It lives in `meta.json` beside `cryptoSecretKey`, which unlocks every stored
 * passphrase on the instance. That is why both functions here go through
 * `./lock.js`'s read/write pair — read-modify-write, atomic rename — and why
 * the write **refuses** a file it cannot parse instead of replacing it. A
 * diagnostic is never worth minting a new secret key over.
 */
import { readMetaFile, writeMetaFile } from "./lock.js"

/** `"unknown"` covers a fresh install and any meta.json we could not read. */
export type ShutdownMarker = "clean" | "unclean" | "unknown"

/** The key this is stored under in `meta.json`. */
export const SHUTDOWN_MARKER_KEY = "lastShutdown"

export type ShutdownMarkerWrite = { ok: true } | { ok: false; reason: string }

/**
 * What the previous run's ending was, according to `meta.json`.
 *
 * Read **before** the database is opened — the open is what overwrites it.
 */
export function readShutdownMarker(metaPath: string): ShutdownMarker {
	const read = readMetaFile(metaPath)
	if (!read.ok) return "unknown"
	const value = read.meta[SHUTDOWN_MARKER_KEY]
	return value === "clean" || value === "unclean" ? value : "unknown"
}

/**
 * Record how this run stands, keeping every other key in `meta.json`.
 *
 * Never creates the file and never rewrites one that will not parse: both are
 * the same act — replacing a `meta.json` whose `cryptoSecretKey` is the only
 * copy of the key backing sessions and stored passphrases. The caller logs the
 * returned reason and carries on without a marker.
 */
export function writeShutdownMarker(
	metaPath: string,
	marker: "clean" | "unclean"
): ShutdownMarkerWrite {
	const read = readMetaFile(metaPath)
	if (!read.ok) {
		return {
			ok: false,
			reason: read.missing
				? `${metaPath} does not exist`
				: `${metaPath} could not be read (${String(
						(read.error as Error)?.message ?? read.error
					)})`
		}
	}
	try {
		read.meta[SHUTDOWN_MARKER_KEY] = marker
		writeMetaFile(metaPath, read.meta)
		return { ok: true }
	} catch (error) {
		return { ok: false, reason: String((error as Error)?.message ?? error) }
	}
}
