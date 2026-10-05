/**
 * The recorded-event push (R56, E1d): a package's event goes to the
 * session's users as recorded, under the scoped key the session page
 * declares; with no socket server there is nobody to tell.
 */
import { describe, expect, it, vi } from "vitest"

const broadcast = vi.fn(async () => {})
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	// annexViews pushes per-user views through this; a stub keeps that push quiet.
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: broadcast
}))

describe("pushRecordedEvent", () => {
	it("broadcasts the event to the session, payload as recorded", async () => {
		const { pushRecordedEvent } = await import("./recordedEventPush")
		const io = {} as any
		const push = {
			sessionId: 4,
			event: "twenty:event/guessed@1",
			payload: { verdict: "no" },
			at: 9
		}
		await pushRecordedEvent(io, push)
		expect(broadcast).toHaveBeenCalledWith(
			io,
			4,
			"sessions:recordedEvent",
			push
		)
	})

	it("is a no-op with no socket server", async () => {
		broadcast.mockClear()
		const { pushRecordedEvent } = await import("./recordedEventPush")
		await pushRecordedEvent(undefined, {
			sessionId: 4,
			event: "x:event/y@1",
			payload: null,
			at: 1
		})
		expect(broadcast).not.toHaveBeenCalled()
	})

	it("pushes only a package's event, with the author's payload and not the envelope", async () => {
		const { defineSessionEvent, S, sessionEvents } = await import(
			"@serene-pub/sdk"
		)
		const { recordedEventPushOf } = await import("./recordedEventPush")
		defineSessionEvent({
			id: "pushtest:event/rolled@1",
			payload: S.json,
			name: "Rolled",
			description: "A test event."
		})
		const envelope = {
			event: "pushtest:event/rolled@1",
			sessionId: 4,
			payload: { total: 12 },
			cause: { kind: "run", runId: "r" },
			lineage: { parentRunId: "p", rootRunId: "p", depth: 1 }
		}
		expect(
			recordedEventPushOf("pushtest:event/rolled@1", envelope, 4, 9)
		).toEqual({
			sessionId: 4,
			event: "pushtest:event/rolled@1",
			payload: { total: 12 },
			at: 9
		})
		// Core's events ride their own pushes, never this one.
		expect(
			recordedEventPushOf(sessionEvents.annexChanged, envelope, 4, 9)
		).toBeNull()
		// An event no package declares pushes nothing.
		expect(
			recordedEventPushOf("pushtest:event/nope@1", envelope, 4, 9)
		).toBeNull()
	})
})
