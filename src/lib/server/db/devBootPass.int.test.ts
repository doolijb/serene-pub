/**
 * The dev double-boot guard, through the real `./index` module.
 *
 * `./devBootPass` on its own is two lines of state and asserting it proves
 * nothing; what was actually broken is the WIRING. `openBootPass()` was called
 * at module scope and its answer thrown away, and `closeBootPass()` was
 * imported and never called — so the flag latched `true` on the first boot and
 * no second pass was ever refused, which is the failure this file exists to
 * catch a second time.
 *
 * **How a reload is reproduced.** `vite dev` invalidates the module that
 * changed and everything importing it, never its dependencies — so `./index` is
 * re-executed while `./devBootPass`, and the flag inside it, survive. That is
 * exactly one module surviving a `vi.resetModules()`, which `vi.doMock` can
 * express: the live namespace object is captured first and handed back to the
 * re-imported `./index`. Nothing here simulates the guard itself; only Vite.
 *
 * `SERENE_PUB_DATA_DIR` is redirected per test, because a refusal is asserted
 * partly by what is NOT written into that directory.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

/**
 * `getDbDataDir()` ignores `SERENE_PUB_DATA_DIR` when `CI=true` and answers
 * `~/SerenePubData` instead — somebody's real data directory, not this test's
 * to boot against. Same carve-out as ./unopenableBoot.int.test.ts.
 */
const underCI = process.env.CI === "true"

let root: string
const originalDataDir = process.env.SERENE_PUB_DATA_DIR

/** A data directory whose database exists and will not open. */
let brokenRoot: string

beforeAll(async () => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-bootpass-"))

	// A real database with `global/pg_control` emptied — the same failed open
	// ./unopenableBoot.int.test.ts uses. Used here for its speed rather than
	// its damage: it takes a boot all the way through the pass and out the
	// other side without the seconds a full migrate-and-seed costs.
	brokenRoot = path.join(root, "broken")
	const brokenData = path.join(brokenRoot, "data")
	fs.mkdirSync(brokenData, { recursive: true })
	const pg = new PGlite(path.join(brokenData, "serene-pub.db"))
	await pg.waitReady
	await pg.exec(`CREATE TABLE keepsake (id int)`)
	await pg.close()
	fs.writeFileSync(
		path.join(brokenData, "serene-pub.db", "global", "pg_control"),
		""
	)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.doUnmock("./devBootPass")
	vi.resetModules()
	if (originalDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
	else process.env.SERENE_PUB_DATA_DIR = originalDataDir
})

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true })
})

describe.skipIf(underCI)("a reload that lands mid-boot", () => {
	test("is refused, without deadlocking and without exiting", async () => {
		const freshRoot = path.join(root, "refused")
		fs.mkdirSync(freshRoot, { recursive: true })
		process.env.SERENE_PUB_DATA_DIR = freshRoot

		vi.resetModules()
		// The module Vite would keep, captured before the one Vite replaces is
		// ever loaded. Opening a pass on it is the outgoing evaluation.
		const surviving = await import("./devBootPass")
		expect(surviving.openBootPass()).toBe(false)

		vi.resetModules()
		vi.doMock("./devBootPass", () => surviving)

		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: number
		) => {
			throw new Error(`process.exit(${code})`)
		}) as never)
		const errors: string[] = []
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			errors.push(args.map(String).join(" "))
		})

		// Settling at all is half the assertion: the reported symptom was a
		// `[500] GET /` that never cleared, so a refusal that hung would be the
		// same bug wearing a message. Raced against a deadline rather than left
		// to the file's 60s budget, which would report it as a timeout with no
		// indication of which half failed.
		const outcome = await Promise.race([
			import("./index").then(
				() => ({ kind: "resolved" as const }),
				(error: unknown) => ({ kind: "rejected" as const, error })
			),
			new Promise<{ kind: "hung" }>((resolve) =>
				setTimeout(() => resolve({ kind: "hung" }), 20_000)
			)
		])

		// Module evaluation fails, and that IS the refusal: `dbReady` rejects
		// with something that is not a `DatabaseUnopenableError`, so the
		// dev-only await at the bottom of ./index rethrows it rather than
		// letting an app boot against a database this pass never opened.
		expect(outcome.kind).toBe("rejected")
		if (outcome.kind !== "rejected") throw new Error("unreachable")
		const message = String(
			(outcome.error as { message?: unknown })?.message ?? outcome.error
		)
		expect(message).toContain("Refusing a second database startup pass")
		expect(message).toContain("Restart the dev server")

		// Not by taking the process down with it. The lock path's answer to a
		// directory somebody else holds is `process.exit(1)`; this is the same
		// process, and killing the dev server would take the pass that IS
		// working with it.
		expect(exit).not.toHaveBeenCalled()

		// Said once on the console too, because the browser may be showing a
		// stack trace to nobody.
		expect(
			errors.some((line) =>
				line.includes("Refusing a second database startup pass")
			)
		).toBe(true)

		// Nothing was opened, locked, migrated or seeded. `meta.json` is
		// written above the guard (it is what the lock lives in), so its
		// CONTENTS are the assertion: no `lock`, no `lastShutdown`.
		const dataDir = path.join(freshRoot, "data")
		expect(fs.existsSync(path.join(dataDir, "serene-pub.db"))).toBe(false)
		const meta = JSON.parse(
			fs.readFileSync(path.join(dataDir, "meta.json"), "utf-8")
		)
		expect(meta.lock).toBeUndefined()
		expect(meta.lastShutdown).toBeUndefined()

		// And the outgoing pass's flag is still its own. A refusal that cleared
		// it would wave the next reload straight into the collision.
		expect(surviving.openBootPass()).toBe(true)
		surviving.closeBootPass()
	})
})

describe.skipIf(underCI)("a pass that settles", () => {
	test("closes the flag even when the boot failed", async () => {
		process.env.SERENE_PUB_DATA_DIR = brokenRoot

		vi.resetModules()
		const surviving = await import("./devBootPass")

		vi.spyOn(console, "error").mockImplementation(() => {})
		const mod = await import("./index")

		// This boot fails — the database exists and will not open — which is
		// the case the flag is easiest to leak on. `dbReady` rejects; module
		// evaluation does not, because a `DatabaseUnopenableError` is the one
		// error ./index's dev await swallows so the recovery page can be served.
		await expect(mod.dbReady).rejects.toThrow()

		// Settled, so the flag is closed and the next reload is a normal boot
		// rather than a refusal. Before this was wired, `closeBootPass` was
		// never called and this answered `true` forever after the first boot.
		expect(surviving.openBootPass()).toBe(false)
		surviving.closeBootPass()

		await mod.closeDatabase()
	})
})
