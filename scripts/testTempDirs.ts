/**
 * The temp directories a test run makes, and how a run gets rid of its own.
 *
 * Every test file is pointed at a throwaway data directory (see
 * `../vitest.setup.ts`), and a file that actually opens PGlite fills its one
 * with tens of megabytes. Nothing expired them: one machine reached 63,768
 * directories and 223 GB, and the root filesystem hit 100% — which is not a
 * tidiness problem, it takes out every PGlite instance on the box, the
 * developer's own live database included.
 *
 * Two mechanisms, because either alone has a hole:
 *
 *   - the per-file teardown in `../vitest.setup.ts` removes what that file
 *     used, which covers every run that reaches the end of a file;
 *   - `removeStaleTempEntries()` below runs as the global setup and removes
 *     what an EARLIER run left when it never got to that teardown — a crash,
 *     a SIGKILL, a `q` in watch mode. Age-gated, so it cannot touch a run
 *     happening right now.
 *
 * ⚠ Node builtins only. This module is loaded by the global setup and again by
 * every test file's setup; pulling the app's module graph in here would put a
 * database import in front of all ~900 of them.
 */
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * The leftovers the startup pass will remove.
 *
 * Deliberately just the two names this harness creates unattended — the
 * per-worker data directory (`../vitest.setup.ts`) and the shutdown-marker
 * scratch (`src/lib/server/db/shutdownMarker.int.test.ts`). Every other
 * `serene-pub-*` temp directory belongs to a test file that names it and
 * removes it, and a blanket prefix here would race those.
 */
export const STALE_PREFIXES = [
	"serene-pub-vitest-",
	"sp-shutdown-marker-"
] as const

/**
 * How old a leftover must be before the startup pass will remove it.
 *
 * Long enough that no run in progress can be inside it — a full sweep is
 * minutes — and short enough that a machine cannot accumulate a day's worth of
 * crashed runs.
 */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000

/**
 * Remove leftovers older than `olderThanMs`, and say how many went.
 *
 * Every failure is swallowed on purpose: on a shared machine `/tmp` holds other
 * users' entries, and a permission error reading or removing one is not a
 * reason to fail the test run that was merely tidying up.
 */
export function removeStaleTempEntries(options?: {
	root?: string
	olderThanMs?: number
	now?: number
}): number {
	const root = options?.root ?? os.tmpdir()
	const olderThanMs = options?.olderThanMs ?? STALE_AFTER_MS
	const now = options?.now ?? Date.now()

	let names: string[]
	try {
		names = fs.readdirSync(root)
	} catch {
		return 0
	}

	let removed = 0
	for (const name of names) {
		if (!STALE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue
		const entry = path.join(root, name)
		let mtimeMs: number
		try {
			// `lstat`, so a symlink is judged on itself and never followed out
			// of the temp root.
			mtimeMs = fs.lstatSync(entry).mtimeMs
		} catch {
			continue
		}
		if (now - mtimeMs < olderThanMs) continue
		try {
			fs.rmSync(entry, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 50
			})
			removed++
		} catch {
			// Someone else's, or still held. Leave it for the next run.
		}
	}
	return removed
}

/** The global setup hook (`vitest.config.ts` → `test.globalSetup`). */
export function setup(): void {
	const removed = removeStaleTempEntries()
	if (removed > 0) {
		console.log(
			`[vitest] removed ${removed} stale temp ${removed === 1 ? "entry" : "entries"} from ${os.tmpdir()}`
		)
	}
}

/**
 * Is this a throwaway data directory a test made, or somebody's real one?
 *
 * The gate on removal, and it has to be narrow: `SERENE_PUB_DATA_DIR` is the
 * variable a developer exports to point a run at a scratch instance — or, on
 * the day it goes wrong, at their actual instance. So: a direct child of the
 * temp root (never the root, never a path that walks out of it) whose name
 * carries one of the prefixes this repo's test files use.
 */
export function isThrowawayDataDir(dir: string | undefined): boolean {
	if (!dir) return false
	const resolved = path.resolve(dir)
	if (path.dirname(resolved) !== path.resolve(os.tmpdir())) return false
	return /^(serene-pub|sp)-/.test(path.basename(resolved))
}

/**
 * Did anything open a real database in here?
 *
 * The layout is `src/lib/server/db/drizzle.config.ts`: the data directory is
 * `<SERENE_PUB_DATA_DIR>/data` and PGlite's own tree is `serene-pub.db` inside
 * it. Used to decide whether a close is owed before the removal — the answer is
 * no for the ~170 unit files that never touch a database, and asking the
 * question this way costs one `stat` instead of an import.
 */
export function holdsDatabase(dir: string): boolean {
	return fs.existsSync(path.join(dir, "data", "serene-pub.db"))
}

/**
 * Remove one throwaway directory, tolerating a writer that has not stopped yet.
 *
 * The retries are the lock heartbeat: it rewrites `meta.json` every four
 * seconds, and a write that lands between the walk and the final `rmdir` fails
 * it with `ENOTEMPTY`. Closing the database first (see `releaseDataDir` in
 * `$lib/server/utils/testDb`) is what actually prevents that; this is the
 * belt-and-braces for anything else still holding a handle.
 *
 * Refuses anything `isThrowawayDataDir()` does not vouch for, and returns
 * whether it removed something.
 */
export async function removeTempDir(dir: string): Promise<boolean> {
	if (!isThrowawayDataDir(dir)) return false
	if (!fs.existsSync(dir)) return false
	await fsp.rm(dir, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 50
	})
	return true
}
