/**
 * `sessions:foldInParent` (★B-2, 2026-11-08): the owner is answered once and toasted once through
 * the central `success` event; anyone else, and a refusal from the fold itself, reach
 * `sessions:foldInParent:error` with their sentence. The fold is mocked; its steps are tested beside it.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const { foldInParent, checkSessionAccess, announceSeatChanges } = vi.hoisted(
	() => ({
		foldInParent: vi.fn(),
		checkSessionAccess: vi.fn(),
		announceSeatChanges: vi.fn(async () => {})
	})
)

vi.mock("$lib/server/db", () => ({ db: {}, dbReady: Promise.resolve() }))
vi.mock("$lib/server/lorebooks/foldInParent", () => ({ foldInParent }))
vi.mock("$lib/server/utils/sessionAccess", () => ({ checkSessionAccess }))
vi.mock("$lib/server/sessions/seats", () => ({ announceSeatChanges }))
vi.mock("$lib/server/sessions/rowPush", () => ({
	broadcastSessionRow: vi.fn()
}))
vi.mock("./lorebooks", () => ({
	relistLorebooks: vi.fn(),
	relistSessionNotes: vi.fn()
}))
vi.mock("./sessions", () => ({
	pushSessionToParticipants: vi.fn(async () => {})
}))

import { sessionsFoldInParentHandler } from "./ownBooks"
import { OwnBookRefusal } from "$lib/server/lorebooks/ownBook"
import { FOLD_DONE, FOLD_REFUSALS } from "$lib/shared/lorebooks/sessionNotes"

const socket = { user: { id: 4 }, io: {} }
let emits: Array<{ event: string; data: any }>
const emitToUser = (event: string, data: any) => {
	emits.push({ event, data })
}
const call = (params: unknown) =>
	sessionsFoldInParentHandler.handler(socket, params as any, emitToUser)

beforeEach(() => {
	emits = []
	foldInParent.mockReset()
	checkSessionAccess.mockReset()
	announceSeatChanges.mockClear()
})

describe("sessions:foldInParent", () => {
	test("the owner gets the reply, and one success toast naming the book", async () => {
		checkSessionAccess.mockResolvedValue({
			isOwner: true,
			isGuest: false,
			hasAccess: true
		})
		const seatChanges = [{ kind: "removed" }, { kind: "added" }]
		foldInParent.mockResolvedValue({
			lorebookId: 31,
			foldedFrom: { id: 5, name: "Brackenvale" },
			seatChanges
		})
		const res = await call({ sessionId: 12 })
		// The re-pointed seats are announced once, after the fold committed (★s4-seat-ev).
		expect(announceSeatChanges).toHaveBeenCalledTimes(1)
		expect(announceSeatChanges).toHaveBeenCalledWith(
			{},
			socket.io,
			{ sessionId: 12, userId: 4 },
			seatChanges
		)
		expect(foldInParent).toHaveBeenCalledWith(
			{},
			{ sessionId: 12, userId: 4 }
		)
		expect(res).toEqual({ sessionId: 12, lorebookId: 31 })
		expect(
			emits.filter((e) => e.event === "sessions:foldInParent")
		).toEqual([
			{
				event: "sessions:foldInParent",
				data: { sessionId: 12, lorebookId: 31 }
			}
		])
		const toasts = emits.filter((e) => e.event === "success")
		expect(toasts).toHaveLength(1)
		expect(toasts[0].data.title).toBe(FOLD_DONE("Brackenvale"))
		expect(
			emits.some((e) => e.event === "sessions:foldInParent:error")
		).toBe(false)
	})

	test("a non-owner is refused with the owner sentence, and nothing is merged", async () => {
		checkSessionAccess.mockResolvedValue({
			isOwner: false,
			isGuest: true,
			hasAccess: true
		})
		await expect(call({ sessionId: 12 })).rejects.toThrow(
			FOLD_REFUSALS.notOwner
		)
		expect(foldInParent).not.toHaveBeenCalled()
		expect(announceSeatChanges).not.toHaveBeenCalled()
		expect(emits).toEqual([
			{
				event: "sessions:foldInParent:error",
				data: { sessionId: 12, error: FOLD_REFUSALS.notOwner }
			}
		])
	})

	test("a refusal from the fold reaches the error event with its sentence", async () => {
		checkSessionAccess.mockResolvedValue({
			isOwner: true,
			isGuest: false,
			hasAccess: true
		})
		foldInParent.mockRejectedValue(
			new OwnBookRefusal(FOLD_REFUSALS.alreadyOwn)
		)
		await expect(call({ sessionId: 12 })).rejects.toThrow(
			FOLD_REFUSALS.alreadyOwn
		)
		expect(emits).toEqual([
			{
				event: "sessions:foldInParent:error",
				data: { sessionId: 12, error: FOLD_REFUSALS.alreadyOwn }
			}
		])
		expect(emits.some((e) => e.event === "success")).toBe(false)
	})
})
