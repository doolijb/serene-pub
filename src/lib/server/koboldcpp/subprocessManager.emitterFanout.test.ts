/**
 * Round-10 audit fix (MEDIUM): subprocessManager used a single nullable
 * emitStatusFn slot — same single-slot-emitter anti-pattern as
 * binaryManager.ts/vectorizationQueue.ts, fixed with a Set<EmitFn>-based
 * registerEmitter/unregisterEmitter pattern.
 *
 * Round-11 audit fix (MEDIUM): that Set<EmitFn> fix overcorrected —
 * registration happens once per *connection*, but emitToUser already
 * broadcasts to every open tab for a user, so N tabs for the same admin
 * meant N entries in the Set, each independently re-broadcasting to all N
 * sockets. Fixed by keying registration on userId with a connection
 * refcount.
 *
 * stop() with nothing tracked as running is a plain synchronous no-op that
 * still calls the real emitStatus() call site, so this doesn't need to
 * spawn a real subprocess.
 */
import { describe, expect, test, vi } from "vitest"

// Pure emitter-registration test — doesn't touch the DB — but
// subprocessManager.ts imports the real `db` at module scope, which
// otherwise triggers a real connection/lock-check against the on-disk dev
// database purely as an import side effect (and can collide with other
// unmocked test files' locks when the full suite runs in parallel). A bare
// stub is enough since nothing here calls db.
vi.mock("$lib/server/db", () => ({ db: {} }))

import { registerEmitter, unregisterEmitter, stop } from "./subprocessManager"

describe("subprocessManager status emitter fan-out", () => {
	test("broadcasts to every distinct registered user", async () => {
		const emitterA = vi.fn()
		const emitterB = vi.fn()
		registerEmitter(1001, emitterA)
		registerEmitter(1002, emitterB)

		await stop()

		expect(emitterA).toHaveBeenCalledWith(
			expect.objectContaining({ status: "stopped" })
		)
		expect(emitterB).toHaveBeenCalledWith(
			expect.objectContaining({ status: "stopped" })
		)

		unregisterEmitter(1001)
		unregisterEmitter(1002)
	})

	test("unregistering a user's last connection stops it from receiving further broadcasts, while others still receive them", async () => {
		const staying = vi.fn()
		const leaving = vi.fn()
		registerEmitter(2001, staying)
		registerEmitter(2002, leaving)
		unregisterEmitter(2002)

		await stop()

		expect(staying).toHaveBeenCalled()
		expect(leaving).not.toHaveBeenCalled()

		unregisterEmitter(2001)
	})

	test("a second connection for the same admin doesn't double-broadcast, and only unregisters once every connection for that user has disconnected", async () => {
		const emit = vi.fn()
		registerEmitter(3001, emit)
		registerEmitter(3001, emit)

		await stop()
		expect(emit.mock.calls.length).toBe(1)

		// One of two connections (tabs) for this user disconnects — the
		// other is still open, so broadcasts must continue.
		unregisterEmitter(3001)
		emit.mockClear()
		await stop()
		expect(emit).toHaveBeenCalled()

		// The last connection disconnects — nothing should reach this user
		// anymore.
		unregisterEmitter(3001)
		emit.mockClear()
		await stop()
		expect(emit).not.toHaveBeenCalled()
	})
})
