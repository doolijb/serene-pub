/**
 * The per-run directory that holds the test database template.
 *
 * `createTestDb` (`src/lib/server/utils/testDb.ts`) builds the template, by
 * running the real migrations, the first time any worker of the run needs it
 * and writes it here; every later call loads that file instead of replaying
 * the migrations. This module only makes the directory, tells the workers
 * where it is, and removes it when the run ends — it builds nothing, so a run
 * that never opens a database pays nothing.
 *
 * ⚠ Node builtins only, like `testTempDirs.ts`: no application import.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { TestProject } from "vitest/node"

/** One directory per run; the prefix is the one the stale-entry sweep knows. */
export function setup(project: TestProject): () => void {
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), "serene-pub-vitest-template-")
	)
	project.provide("testDbTemplateDir", dir)
	return () => fs.rmSync(dir, { recursive: true, force: true })
}
