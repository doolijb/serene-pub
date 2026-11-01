import { describe, expect, test, vi } from "vitest"

const m = vi.hoisted(() => ({ modelPresence: vi.fn(async () => []) }))
vi.mock("$lib/server/db", () => ({ db: {} }))
vi.mock("$lib/server/connections/modelPresence", () => ({
	MAX_PRESENCE_QUERIES: 200,
	modelPresence: m.modelPresence
}))

import { modelsPresence } from "./modelPresence"

describe("models:presence handler", () => {
	test("refuses a non-admin without reading anything", async () => {
		const emit = vi.fn()
		await expect(
			modelsPresence.handler(
				{ user: { id: 2, isAdmin: false } } as any,
				{ queries: [{ key: "k", file: "a.gguf" }] },
				emit
			)
		).rejects.toThrow(/admin/i)
		expect(m.modelPresence).not.toHaveBeenCalled()
		expect(emit).toHaveBeenCalledWith(
			"models:presence:error",
			expect.objectContaining({ error: expect.any(String) })
		)
	})

	test("an admin gets results; over the cap gets an error sentence", async () => {
		const emit = vi.fn()
		const admin = { user: { id: 1, isAdmin: true } } as any
		const ok: any = await modelsPresence.handler(admin, { queries: [] }, emit)
		expect(ok.results).toEqual([])
		const many = Array.from({ length: 201 }, (_, i) => ({ key: String(i) }))
		const over: any = await modelsPresence.handler(admin, { queries: many }, emit)
		expect(over.error).toMatch(/at most 200/)
	})
})
