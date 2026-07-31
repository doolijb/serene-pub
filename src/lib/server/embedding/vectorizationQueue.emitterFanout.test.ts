/**
 * Round-10 audit fix (HIGH): registerVectorizationHandlers used to call
 * setProgressEmitter(emitToUser) unconditionally for EVERY connecting
 * socket (admin or not), overwriting one module-level `emitProgress`
 * variable — last writer wins, globally, and any non-admin who happened to
 * (re)connect most recently became the sole recipient of instance-wide
 * vectorization telemetry belonging to other users. Fixed with a
 * Set<EmitFn>-backed registerProgressEmitter/unregisterProgressEmitter,
 * mirroring utils/taskQueue.ts's already-correct pattern.
 */
import { describe, expect, test, vi } from "vitest"

// Pure emitter-registration test — doesn't touch the DB — but
// vectorizationQueue.ts imports the real `db` at module scope. A bare stub
// (not a real createTestDb() PGlite instance — nothing here calls it) is
// enough to short-circuit that import.
vi.mock("$lib/server/db", () => ({ db: {} }))

describe("vectorizationQueue progress emitter fan-out", () => {
	test("broadcasts to every registered emitter", async () => {
		const { registerProgressEmitter, pauseVectorization } = await import(
			"./vectorizationQueue"
		)
		const emitterA = vi.fn()
		const emitterB = vi.fn()
		registerProgressEmitter(emitterA)
		registerProgressEmitter(emitterB)

		pauseVectorization()

		expect(emitterA).toHaveBeenCalledWith(
			"vectorization:progress",
			expect.objectContaining({ status: "paused" })
		)
		expect(emitterB).toHaveBeenCalledWith(
			"vectorization:progress",
			expect.objectContaining({ status: "paused" })
		)
	})

	test("unregistering an emitter stops it from receiving further broadcasts, while others still receive them", async () => {
		const {
			registerProgressEmitter,
			unregisterProgressEmitter,
			pauseVectorization
		} = await import("./vectorizationQueue")
		const staying = vi.fn()
		const leaving = vi.fn()
		registerProgressEmitter(staying)
		registerProgressEmitter(leaving)

		unregisterProgressEmitter(leaving)
		pauseVectorization()

		expect(staying).toHaveBeenCalled()
		expect(leaving).not.toHaveBeenCalled()
	})

	test("one emitter throwing doesn't prevent the others from receiving the broadcast", async () => {
		const { registerProgressEmitter, pauseVectorization } = await import(
			"./vectorizationQueue"
		)
		const throwing = vi.fn(() => {
			throw new Error("boom")
		})
		const healthy = vi.fn()
		registerProgressEmitter(throwing)
		registerProgressEmitter(healthy)

		expect(() => pauseVectorization()).not.toThrow()
		expect(healthy).toHaveBeenCalled()
	})
})
