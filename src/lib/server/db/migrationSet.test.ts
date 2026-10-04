/**
 * The stale-build check (`migrationSet.ts`): a build carries the fingerprint
 * of the `drizzle/` it was made with, and boot compares it with the one on
 * disk. Its wiring — that a production boot refuses BEFORE any write — is
 * asserted in `staleBuildBoot.int.test.ts`.
 */
import { afterEach, describe, expect, test } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
	assertBuildMatchesMigrations,
	readMigrationSet,
	STALE_BUILD_MESSAGE,
	StaleBuildError
} from "./migrationSet"

const made: string[] = []
afterEach(() => {
	while (made.length) fs.rmSync(made.pop()!, { recursive: true, force: true })
})

/** A `drizzle/` folder holding `tags`, each with a one-line SQL file. */
function folderWith(tags: string[]): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-migration-set-"))
	made.push(dir)
	fs.mkdirSync(path.join(dir, "meta"))
	fs.writeFileSync(
		path.join(dir, "meta/_journal.json"),
		JSON.stringify({
			version: "7",
			dialect: "postgresql",
			entries: tags.map((tag, idx) => ({
				idx,
				version: "7",
				when: 1_700_000_000_000 + idx,
				tag,
				breakpoints: true
			}))
		})
	)
	for (const tag of tags)
		fs.writeFileSync(path.join(dir, `${tag}.sql`), `-- ${tag}\nSELECT 1;\n`)
	return dir
}

describe("assertBuildMatchesMigrations", () => {
	test("the set the build was made with passes", () => {
		const dir = folderWith(["0000_a", "0001_b"])
		expect(() =>
			assertBuildMatchesMigrations(readMigrationSet(dir), dir)
		).not.toThrow()
	})

	test("a build older than the migrations on disk is refused, naming both", () => {
		const built = readMigrationSet(folderWith(["0000_a"]))
		const dir = folderWith(["0000_a", "0001_b"])
		let thrown: unknown
		try {
			assertBuildMatchesMigrations(built, dir)
		} catch (e) {
			thrown = e
		}
		expect(thrown).toBeInstanceOf(StaleBuildError)
		const message = (thrown as Error).message
		expect(message.startsWith(STALE_BUILD_MESSAGE)).toBe(true)
		expect(message).toContain("1 migrations (newest 0000_a)")
		expect(message).toContain("has 2 (newest 0001_b)")
	})

	test("a build newer than the migrations on disk is refused", () => {
		const built = readMigrationSet(folderWith(["0000_a", "0001_b"]))
		expect(() =>
			assertBuildMatchesMigrations(built, folderWith(["0000_a"]))
		).toThrow(StaleBuildError)
	})

	test("an edited migration is a different set; a CRLF checkout of it is not", () => {
		const dir = folderWith(["0000_a"])
		const built = readMigrationSet(dir)
		fs.writeFileSync(path.join(dir, "0000_a.sql"), "-- 0000_a\r\nSELECT 1;\r\n")
		expect(() => assertBuildMatchesMigrations(built, dir)).not.toThrow()
		fs.writeFileSync(path.join(dir, "0000_a.sql"), "-- 0000_a\nSELECT 2;\n")
		expect(() => assertBuildMatchesMigrations(built, dir)).toThrow(StaleBuildError)
	})

	test("unreadable migrations are refused, not waved through", () => {
		const built = readMigrationSet(folderWith(["0000_a"]))
		const missing = path.join(os.tmpdir(), "sp-migration-set-missing-x")
		expect(() => assertBuildMatchesMigrations(built, missing)).toThrow(StaleBuildError)
	})

	test("nothing to compare (no build-time define, as under vitest) passes", () => {
		expect(() =>
			assertBuildMatchesMigrations(undefined, "/nowhere")
		).not.toThrow()
	})

	test("the repository's own drizzle/ reads", () => {
		const set = readMigrationSet("./drizzle")
		expect(set.count).toBeGreaterThan(0)
		expect(set.fingerprint).toMatch(/^[0-9a-f]{64}$/)
	})
})
