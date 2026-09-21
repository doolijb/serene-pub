/**
 * The clean-shutdown marker in `meta.json`.
 *
 * SIGKILL and an OOM kill run nothing — no handler, no flush, no log line — so
 * the only way to know afterwards that the last run ended badly is to have
 * written "this run is in progress" at the start of it and cleared it on the
 * way out. That is the whole mechanism: `lastShutdown` says `"unclean"` from
 * the moment the database opens until `closeDatabase()` sets it to `"clean"`,
 * and a boot that finds `"unclean"` was force-quit.
 *
 * The file it lives in also holds `cryptoSecretKey`, which unlocks every stored
 * passphrase on the instance — so "every other key survives" is not tidiness,
 * it is the reason these writes are read-modify-write rather than a dump of
 * whatever this process happens to have in memory.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as dbConfig from "./drizzle.config"
import { readShutdownMarker, writeShutdownMarker } from "./shutdownMarker"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let scratch: string
let metaPath: string

beforeEach(() => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sp-shutdown-marker-"))
	metaPath = path.join(scratch, "meta.json")
})

/**
 * Per test, not per file: `beforeEach` mints a NEW scratch directory for every
 * test, so an `afterAll` here only ever removed the last one and left the rest
 * in the temp root for good. Multiply by every run on the machine and they were
 * a measurable share of the leftovers that filled the root filesystem.
 */
afterEach(() => {
	fs.rmSync(scratch, { recursive: true, force: true })
})

function meta(): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(metaPath, "utf-8"))
}

describe("the marker file", () => {
	test("reads as unknown when no marker has ever been written", () => {
		fs.writeFileSync(metaPath, JSON.stringify({ version: "0.6.0" }))
		expect(readShutdownMarker(metaPath)).toBe("unknown")
	})

	test("reads as unknown when meta.json is not there at all", () => {
		expect(readShutdownMarker(metaPath)).toBe("unknown")
	})

	test("reads as unknown when the value is not one we wrote", () => {
		fs.writeFileSync(
			metaPath,
			JSON.stringify({ version: "0.6.0", lastShutdown: "maybe" })
		)
		expect(readShutdownMarker(metaPath)).toBe("unknown")
	})

	test("keeps every other key when it writes", () => {
		fs.writeFileSync(
			metaPath,
			JSON.stringify({
				version: "0.6.0",
				cryptoSecretKey: "the-key-that-unlocks-everything",
				lock: { timestamp: 1, lockLength: 10_000 }
			})
		)

		expect(writeShutdownMarker(metaPath, "unclean")).toEqual({ ok: true })

		expect(meta()).toEqual({
			version: "0.6.0",
			cryptoSecretKey: "the-key-that-unlocks-everything",
			lock: { timestamp: 1, lockLength: 10_000 },
			lastShutdown: "unclean"
		})

		expect(writeShutdownMarker(metaPath, "clean")).toEqual({ ok: true })
		expect(meta().lastShutdown).toBe("clean")
		expect(meta().cryptoSecretKey).toBe("the-key-that-unlocks-everything")
	})

	test("refuses to write over a meta.json it cannot read", () => {
		// Recreating the file here would mint a new cryptoSecretKey and lock the
		// user out of every stored passphrase, to record a diagnostic. The
		// marker is the thing that gets skipped.
		fs.writeFileSync(metaPath, "{ this is not json")

		const result = writeShutdownMarker(metaPath, "unclean")

		expect(result.ok).toBe(false)
		expect(fs.readFileSync(metaPath, "utf-8")).toBe("{ this is not json")
	})

	test("does not create a meta.json that was never there", () => {
		const result = writeShutdownMarker(metaPath, "clean")

		expect(result.ok).toBe(false)
		expect(fs.existsSync(metaPath)).toBe(false)
	})
})

describe("a real database open and close", () => {
	test("marks the run unclean while it is running and clean on the way out", async () => {
		const logs: string[] = []
		const log = vi
			.spyOn(console, "log")
			.mockImplementation((...args: unknown[]) => {
				logs.push(args.map(String).join(" "))
			})

		let mod: typeof import("./index")
		try {
			mod = await import("./index")
			await mod.dbReady
		} finally {
			log.mockRestore()
		}

		const live = path.join(dbConfig.dataDir, "meta.json")
		const read = () => JSON.parse(fs.readFileSync(live, "utf-8"))

		// A throwaway data directory has no prior marker, so the boot line is
		// the honest "unknown" rather than a guess either way.
		expect(logs).toContain("[db] previous shutdown: unknown")

		const opened = read()
		expect(opened.lastShutdown).toBe("unclean")
		expect(typeof opened.cryptoSecretKey).toBe("string")

		await mod.closeDatabase()

		const closed = read()
		expect(closed.lastShutdown).toBe("clean")
		expect(closed.cryptoSecretKey).toBe(opened.cryptoSecretKey)
		expect(closed.version).toBe(opened.version)
	})
})
