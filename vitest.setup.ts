/**
 * Point every test run at a throwaway data directory.
 *
 * `src/lib/server/db/index.ts` opens PGlite and runs `migrate()` at MODULE
 * SCOPE, so merely importing anything that transitively reaches it is enough to
 * touch a database. With `SERENE_PUB_DATA_DIR` unset that database is the
 * developer's real one: `npm test` on a fresh clone silently migrates live user
 * data, and if their app happens to be running it instead dies with
 * "Database remains locked after waiting. Exiting application." and reports the
 * file as zero tests. Both were observed in the same session.
 *
 * Individual integration tests already mkdtemp their own directories, but that
 * only protects the tests that thought to do it — `koboldcpp.allowedHost.test.ts`
 * reaches the db through `sockets/koboldcpp` without ever mentioning it. Setting
 * this globally is what makes the guarantee unconditional.
 *
 * Assigned at module top level, and BEFORE any import that could pull in the db
 * module, because `getAppDataDir()` is read during that module's evaluation —
 * setting it inside a `beforeAll` would already be too late.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

if (!process.env.SERENE_PUB_DATA_DIR) {
	// Per-worker, so parallel test files cannot collide on one PGlite lock.
	const workerId = process.env.VITEST_WORKER_ID ?? "0"
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), `serene-pub-vitest-${workerId}-`)
	)
	process.env.SERENE_PUB_DATA_DIR = dir

	// Best-effort cleanup. Not critical — these live under the OS temp dir —
	// but a long test session should not leave dozens of PGlite trees behind.
	const cleanup = () => {
		try {
			fs.rmSync(dir, { recursive: true, force: true })
		} catch {
			// A worker may still hold the directory open; the OS reclaims it.
		}
	}
	process.once("exit", cleanup)
}
