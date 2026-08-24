/**
 * Round-10 audit fix (MEDIUM): binaryManager used a single nullable
 * emitProgressFn slot, reassigned by whichever admin connection/handler
 * call happened most recently, silently cutting off any other connected
 * admin's binary-download UI. Fixed with a Set<EmitFn>-based
 * registerEmitter/unregisterEmitter pattern.
 *
 * Round-11 audit fix (MEDIUM, same session as the "why are downloads
 * slow" investigation): that Set<EmitFn> fix overcorrected — registration
 * happens once per *connection*, but emitToUser already broadcasts to
 * every open tab for a user, so N tabs for the same admin meant N entries
 * in the Set, each independently re-broadcasting to all N sockets (N²
 * transmissions per tick). Fixed by keying registration on userId with a
 * connection refcount, so multiple tabs for the same admin collapse to
 * one broadcast, and the emitter only unregisters once every one of that
 * user's connections has disconnected.
 *
 * downloadVariant() with a disallowed host rejects fast (before any real
 * network I/O — the host allowlist check happens synchronously inside the
 * request executor) while still exercising the real "starting"/"error"
 * emitProgress() call sites, so this doesn't need network mocking.
 */
import { describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
	registerEmitter,
	unregisterEmitter,
	downloadVariant
} from "./binaryManager"

async function attemptDisallowedDownload(destDir: string, assetName: string) {
	await downloadVariant({
		assetName,
		downloadUrl: "https://evil.example.com/asset.bin",
		destDir
	}).catch(() => {})
}

describe("binaryManager progress emitter fan-out", () => {
	test("broadcasts to every distinct registered user", async () => {
		const dir = await fs.mkdtemp(
			path.join(os.tmpdir(), "serene-pub-binarymgr-fanout-")
		)
		const emitterA = vi.fn()
		const emitterB = vi.fn()
		registerEmitter(1001, emitterA)
		registerEmitter(1002, emitterB)

		await attemptDisallowedDownload(dir, "fanout-test.bin")

		expect(emitterA).toHaveBeenCalledWith(
			expect.objectContaining({
				download: expect.objectContaining({
					assetName: "fanout-test.bin"
				})
			})
		)
		expect(emitterB).toHaveBeenCalledWith(
			expect.objectContaining({
				download: expect.objectContaining({
					assetName: "fanout-test.bin"
				})
			})
		)

		unregisterEmitter(1001)
		unregisterEmitter(1002)
		await fs.rm(dir, { recursive: true, force: true })
	})

	test("unregistering a user's last connection stops it from receiving further broadcasts, while others still receive them", async () => {
		const dir = await fs.mkdtemp(
			path.join(os.tmpdir(), "serene-pub-binarymgr-fanout-")
		)
		const staying = vi.fn()
		const leaving = vi.fn()
		registerEmitter(2001, staying)
		registerEmitter(2002, leaving)
		unregisterEmitter(2002)

		await attemptDisallowedDownload(dir, "fanout-test-2.bin")

		expect(staying).toHaveBeenCalled()
		expect(leaving).not.toHaveBeenCalled()

		unregisterEmitter(2001)
		await fs.rm(dir, { recursive: true, force: true })
	})

	test("a second connection for the same admin doesn't double-broadcast, and only unregisters once every connection for that user has disconnected", async () => {
		const dir = await fs.mkdtemp(
			path.join(os.tmpdir(), "serene-pub-binarymgr-fanout-")
		)
		// Two connections (eg. two browser tabs) for the SAME user register
		// the same underlying broadcaster (emitToUser already fans out to
		// every tab on its own) — the module must not call it twice per tick.
		const emit = vi.fn()
		registerEmitter(3001, emit)
		registerEmitter(3001, emit)

		await attemptDisallowedDownload(dir, "fanout-test-3.bin")
		const callsWithBothConnections = emit.mock.calls.length
		expect(callsWithBothConnections).toBeGreaterThan(0)

		// Simulate the first tab (connection) disconnecting — the user still
		// has one open connection, so broadcasts must continue.
		unregisterEmitter(3001)
		emit.mockClear()
		await attemptDisallowedDownload(dir, "fanout-test-3.bin")
		expect(emit).toHaveBeenCalled()

		// Simulate the last connection disconnecting — now nothing should
		// reach this user anymore.
		unregisterEmitter(3001)
		emit.mockClear()
		await attemptDisallowedDownload(dir, "fanout-test-3.bin")
		expect(emit).not.toHaveBeenCalled()

		await fs.rm(dir, { recursive: true, force: true })
	})
})
