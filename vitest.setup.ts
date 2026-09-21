/**
 * Point every test run at a throwaway data directory — and take it away again.
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
 *
 * ⚠ The `afterAll` below is the other half, and it is not housekeeping. This
 * file is evaluated once per TEST FILE, so a full run made one directory per
 * file and the previous cleanup — `process.once("exit")` — never fired, because
 * the pool terminates a worker with a signal and a signal runs no exit handler.
 * They accumulated until the root filesystem hit 100% (63,768 directories,
 * 223 GB), which endangers every PGlite instance on the machine including the
 * developer's own. A crashed run is caught instead by the age-gated pass in
 * `scripts/testTempDirs.ts`, wired up as the global setup.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeEach } from "vitest"
import {
	holdsDatabase,
	isThrowawayDataDir,
	removeTempDir
} from "./scripts/testTempDirs"

/**
 * What was already set when this file loaded.
 *
 * Someone else's directory — a developer pointing the run at a scratch instance
 * they mean to inspect afterwards — and so never ours to remove.
 */
const inherited = process.env.SERENE_PUB_DATA_DIR

/** The directory this file made, if it made one. */
let created: string | undefined

if (!inherited) {
	// `mkdtemp` alone is what makes it unique; the worker id this name used to
	// carry added nothing but a second axis to glob over.
	created = fs.mkdtempSync(path.join(os.tmpdir(), "serene-pub-vitest-"))
	process.env.SERENE_PUB_DATA_DIR = created
}

/**
 * The KoboldCPP managers keep their mutable state on `globalThis` so a Vite
 * SSR re-evaluation shares one live process rather than orphaning it (see
 * `subprocessManager.ts`). Tests isolate themselves with `vi.resetModules()`
 * plus a fresh import, which that sharing would defeat: the re-imported module
 * would pick up the previous test's bag. Dropping the keys before each test
 * gives a fresh import a fresh bag, while a module a file imported once keeps
 * the reference it already holds — exactly the per-file persistence those
 * files expect.
 */
beforeEach(() => {
	const g = globalThis as Record<string, unknown>
	delete g.__SERENE_PUB_KCPP_SUBPROCESS__
	delete g.__SERENE_PUB_KCPP_MODELS__
})

afterAll(async () => {
	/**
	 * Both directories this file can be responsible for: the one made above,
	 * and whichever one the test file redirected `SERENE_PUB_DATA_DIR` at in
	 * its own `beforeAll` — that is where its database actually is, and ~20
	 * files create one and never remove it. Cleaning it from here is what
	 * needs no edit at those twenty call sites; the files that already remove
	 * their own run first (a file's hooks run before the setup file's) and are
	 * simply found gone.
	 */
	const dirs = new Set<string>()
	if (created) dirs.add(created)
	const inUse = process.env.SERENE_PUB_DATA_DIR
	if (inUse && inUse !== inherited && isThrowawayDataDir(inUse)) {
		dirs.add(inUse)
	}

	for (const dir of dirs) {
		// Only when a database is really in there, because this import is how
		// the module gets loaded if nothing else loaded it — which would OPEN a
		// database in the directory being deleted. An empty directory (the
		// common case: every unit file) is proof nothing opened one.
		if (holdsDatabase(dir)) {
			try {
				const mod = (await import("$lib/server/db")) as {
					closeDatabase?: () => Promise<void>
				}
				await mod.closeDatabase?.()
			} catch {
				// A suite that replaced the module wholesale has nothing to
				// close; the removal below does not depend on this succeeding.
			}
		}
		try {
			await removeTempDir(dir)
		} catch {
			// Still held, or already gone. The global setup's age-gated pass
			// will get it on a later run rather than fail this one.
		}
	}
})
