/**
 * The harness's own housekeeping, tested like anything else.
 *
 * What it is defending: a run that leaves its data directories behind does not
 * fail, it fails LATER and somewhere else — 63,768 leftovers and 223 GB took
 * the root filesystem to 100%, which endangers every PGlite instance on the
 * machine, the developer's live one included. A silent mechanism that only
 * matters when it is missing is exactly the kind that needs a test.
 */
import { afterEach, describe, expect, test } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
	holdsDatabase,
	isThrowawayDataDir,
	removeStaleTempEntries,
	removeTempDir,
	STALE_AFTER_MS
} from "./testTempDirs"

const HOUR = 60 * 60 * 1000

/** Everything this file made, removed whatever the assertions did. */
const made: string[] = []

/**
 * A throwaway directory made exactly the way the harness makes one.
 *
 * ⚠ Named with a prefix the startup pass does NOT collect, so a fixture of this
 * file's can never be swept out from under it by a concurrent run.
 */
function scratchRoot(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-temp-dirs-test-"))
	made.push(dir)
	return dir
}

function age(entry: string, ms: number): void {
	const when = new Date(Date.now() - ms)
	fs.utimesSync(entry, when, when)
}

afterEach(() => {
	while (made.length) {
		fs.rmSync(made.pop()!, { recursive: true, force: true })
	}
})

describe("the startup pass over leftovers", () => {
	test("removes the old ones and leaves a run in progress alone", () => {
		const root = scratchRoot()

		// Two leftovers from runs that never reached their teardown...
		const oldDir = path.join(root, "serene-pub-vitest-AbCdEf")
		fs.mkdirSync(path.join(oldDir, "data", "serene-pub.db"), {
			recursive: true
		})
		fs.writeFileSync(path.join(oldDir, "data", "meta.json"), "{}")
		const oldMarker = path.join(root, "sp-shutdown-marker-GhIjKl")
		fs.mkdirSync(oldMarker)

		// ...and one from the run happening right now.
		const fresh = path.join(root, "serene-pub-vitest-MnOpQr")
		fs.mkdirSync(fresh)

		// Set the times last: writing into a directory bumps its mtime.
		age(oldDir, 7 * HOUR)
		age(oldMarker, 7 * HOUR)

		const removed = removeStaleTempEntries({
			root,
			olderThanMs: STALE_AFTER_MS
		})

		expect(removed).toBe(2)
		expect(fs.existsSync(oldDir)).toBe(false)
		expect(fs.existsSync(oldMarker)).toBe(false)
		expect(fs.existsSync(fresh)).toBe(true)
	})

	test("touches nothing it does not recognise, however old", () => {
		const root = scratchRoot()
		const strangers = [
			// A name that merely starts the same way.
			"serene-pub-browse-cache",
			// Another tool's, and the developer's own.
			"sp-forwarder-XyZ",
			"vscode-typescript1000"
		].map((name) => {
			const entry = path.join(root, name)
			fs.mkdirSync(entry)
			age(entry, 30 * 24 * HOUR)
			return entry
		})

		expect(removeStaleTempEntries({ root })).toBe(0)
		for (const entry of strangers) {
			expect(fs.existsSync(entry)).toBe(true)
		}
	})

	test("reports zero for a temp root that is not there", () => {
		const root = scratchRoot()
		fs.rmSync(root, { recursive: true, force: true })
		expect(removeStaleTempEntries({ root })).toBe(0)
	})
})

describe("what counts as a throwaway data directory", () => {
	test("the one this very run is using does", () => {
		// The link between the two halves: if the prefix in vitest.setup.ts ever
		// drifts away from what the removal vouches for, the leak comes back
		// silently. Here it fails instead.
		expect(isThrowawayDataDir(process.env.SERENE_PUB_DATA_DIR)).toBe(true)
	})

	test("the temp root itself, a grandchild and a real data directory do not", () => {
		const root = scratchRoot()
		const nested = path.join(root, "serene-pub-vitest-deep")
		fs.mkdirSync(nested)

		expect(isThrowawayDataDir(os.tmpdir())).toBe(false)
		expect(isThrowawayDataDir(nested)).toBe(false)
		expect(
			isThrowawayDataDir(path.join(os.homedir(), "serene-pub-vitest-x"))
		).toBe(false)
		expect(isThrowawayDataDir(path.join(os.tmpdir(), "my-notes"))).toBe(
			false
		)
		expect(isThrowawayDataDir(undefined)).toBe(false)
	})
})

describe("removing a directory the harness made", () => {
	test("it is gone once the cleanup has run", async () => {
		// Made exactly as vitest.setup.ts makes one, contents and all.
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-pub-vitest-"))
		made.push(dir)
		fs.mkdirSync(path.join(dir, "data", "serene-pub.db"), {
			recursive: true
		})
		fs.writeFileSync(path.join(dir, "data", "meta.json"), "{}")

		expect(holdsDatabase(dir)).toBe(true)
		await expect(removeTempDir(dir)).resolves.toBe(true)
		expect(fs.existsSync(dir)).toBe(false)
	})

	test("refuses a path it cannot vouch for", async () => {
		const root = scratchRoot()
		const nested = path.join(root, "serene-pub-vitest-deep")
		fs.mkdirSync(nested)

		await expect(removeTempDir(nested)).resolves.toBe(false)
		expect(fs.existsSync(nested)).toBe(true)
	})

	test("says no rather than throwing when it has already gone", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "serene-pub-vitest-"))
		fs.rmSync(dir, { recursive: true, force: true })
		await expect(removeTempDir(dir)).resolves.toBe(false)
	})

	test("an untouched directory holds no database", () => {
		const root = scratchRoot()
		expect(holdsDatabase(root)).toBe(false)
	})
})
