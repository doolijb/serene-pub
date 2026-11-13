/**
 * 🚧 `sessions:applyOverlay` hands `linkIds` to `applyOverlayItems` (filtered as the other lists are)
 * and returns the link and paragraph fields of its result.
 */
import { describe, expect, it, vi } from "vitest"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const applyOverlayItems = vi.fn()
vi.mock("$lib/server/lorebooks/ownBook", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/lorebooks/ownBook")>()),
	applyOverlayItems: (...args: unknown[]) => applyOverlayItems(...args)
}))

describe("sessions:applyOverlay linkIds", () => {
	it("passes the filtered linkIds on and returns the new result fields", async () => {
		applyOverlayItems.mockResolvedValue({
			lorebookId: 5,
			applied: [],
			appliedChanges: [],
			stillHeld: [],
			appliedLinks: [7],
			mergedDays: [9],
			droppedLinks: [8],
			heldDays: [{ notesEntryId: 4, reason: "held" }],
			batch: "b1",
			settled: null
		})
		const { sessionsApplyOverlayHandler: apply } = await import(
			"./sessions"
		)
		const res = await apply.handler(
			{ user: { id: 1 }, io: {} } as any,
			{ sessionId: 3, linkIds: [7, "x" as unknown as number, 1.5] },
			vi.fn()
		)
		expect(applyOverlayItems.mock.calls[0]![1]).toMatchObject({
			sessionId: 3,
			userId: 1,
			entryIds: null,
			amendmentIds: null,
			linkIds: [7]
		})
		expect(res).toMatchObject({
			appliedLinks: [7],
			mergedDays: [9],
			droppedLinks: [8],
			heldDays: [{ notesEntryId: 4, reason: "held" }]
		})
	})
})
