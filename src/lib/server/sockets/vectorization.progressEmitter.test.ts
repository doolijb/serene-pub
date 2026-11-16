import { describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({ db: {} }))

import { registerVectorizationHandlers } from "./vectorization"
import { embeddingLane } from "$lib/server/embedding/vectorizationQueue"

function adminSocket() {
	const handlers: Array<() => void> = []
	return {
		user: { id: 77, isAdmin: true },
		on: (e: string, cb: () => void) => {
			if (e === "disconnect") handlers.push(cb)
		},
		close: () => handlers.forEach((h) => h())
	}
}
const broadcast = () => (embeddingLane as any).broadcast("idle")

describe("progress emitter is one per admin user", () => {
	test("two tabs: one emitter; handover on close; none after both close", () => {
		const emitA = vi.fn()
		const emitB = vi.fn()
		const a = adminSocket()
		const b = adminSocket()
		registerVectorizationHandlers(a, emitA, () => {})
		registerVectorizationHandlers(b, emitB, () => {})

		broadcast()
		expect(emitA).toHaveBeenCalledTimes(1)
		expect(emitB).not.toHaveBeenCalled()

		a.close()
		emitA.mockClear()
		broadcast()
		expect(emitA).not.toHaveBeenCalled()
		expect(emitB).toHaveBeenCalledTimes(1)

		b.close()
		emitB.mockClear()
		broadcast()
		expect(emitB).not.toHaveBeenCalled()
	})
})
