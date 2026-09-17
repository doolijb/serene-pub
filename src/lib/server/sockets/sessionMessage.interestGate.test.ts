/**
 * The streamed reply through the scoped gate — `broadcastToSessionUsers` with
 * the real `GATED_EVENTS` and the real `SCOPED_EVENTS`.
 *
 * `sessionMessage` is the hot push in the application: one broadcast per
 * streamed chunk, and this helper reads the session's owner and then its guest
 * roster before it can emit anything. Two queries per chunk, for a session that
 * may be open in no view at all — which is why the gate for this event is asked
 * BEFORE them rather than at the emit, and why "the db was not touched" is the
 * assertion that matters here rather than "nothing was emitted".
 *
 * Only `$lib/server/db` is mocked, so the gate, the scope extraction and the
 * per-recipient redaction are all the real ones: a test that stubbed the gate
 * would pass against a gate that had been deleted.
 *
 * A gated broadcast is delivered PER SOCKET (plan ruling 5): the scope decides
 * which users are sent anything, whether the roster is read at all, AND which of
 * a user's tabs the row reaches. A second tab open on another session receives
 * nothing on the wire rather than a payload its registry then drops.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const seam = vi.hoisted(() => {
	/** Every roster read, in order — the cost the gate exists to skip. */
	const queries: string[] = []
	const roster = { ownerId: 1, guestIds: [] as number[] }
	return {
		queries,
		roster,
		db: {
			query: {
				sessions: {
					findFirst: async () => {
						queries.push("sessions")
						return { userId: roster.ownerId }
					}
				},
				sessionGuests: {
					findMany: async () => {
						queries.push("sessionGuests")
						return roster.guestIds.map((userId) => ({ userId }))
					}
				}
			},
			/**
			 * The admin roster, read only when a payload actually names a
			 * connection. A message row never has, so reaching this is a
			 * regression in `withoutConnectionIdentity`, not in the gate.
			 */
			select: () => {
				throw new Error(
					"the admin roster was read for a payload that names no connection"
				)
			}
		}
	}
})

vi.mock("$lib/server/db", () => ({ db: seam.db }))

import { broadcastToSessionUsers } from "./utils/broadcastHelpers"

/** The payload every caller of this event builds: the row, as it now stands. */
const row = (sessionId: number, id = 9) => ({
	sessionMessage: {
		id,
		sessionId,
		content: "half a sentence",
		isGenerating: true
	}
})

function harness() {
	const rooms = new Map<string, Set<string>>()
	const registry = new Map<string, any>()
	const emits: Array<{ target: string; event: string; data: any }> = []

	const io: any = {
		to: (target: string) => ({
			emit: (event: string, data: any) =>
				emits.push({ target, event, data })
		}),
		sockets: { adapter: { rooms }, sockets: registry }
	}

	let nextId = 0
	/** A connected tab: one user, one interest set, in that user's room. */
	function connect(userId: number, ...keys: string[]) {
		const id = `s${++nextId}`
		registry.set(id, {
			id,
			user: { id: userId, isAdmin: false },
			interest: new Set(keys)
		})
		const room = `user_${userId}`
		const members = rooms.get(room) ?? new Set<string>()
		members.add(id)
		rooms.set(room, members)
		return id
	}

	return { io, emits, connect, rooms: () => emits.map((e) => e.target) }
}

beforeEach(() => {
	seam.queries.length = 0
	seam.roster.ownerId = 1
	seam.roster.guestIds = []
})

describe("a gated, scoped broadcast", () => {
	test("reads no roster and emits nothing when nobody wants that session", async () => {
		const h = harness()
		// A tab IS open and listening — just on another session. Before phase 3
		// this was indistinguishable from watching this one.
		h.connect(1, "sessionMessage#7")

		await broadcastToSessionUsers(h.io, 42, "sessionMessage", row(42))

		expect(seam.queries).toEqual([])
		expect(h.emits).toEqual([])
	})

	test("reads each roster once and reaches only the users watching that session", async () => {
		const h = harness()
		seam.roster.guestIds = [2]
		const owner = h.connect(1, "sessionMessage#42") // on this session
		h.connect(2, "sessionMessage#7") // a guest, on another one

		await broadcastToSessionUsers(h.io, 42, "sessionMessage", row(42))

		// Once for the owner, once for the guests — no more than before, and
		// only because somebody wanted it.
		expect(seam.queries).toEqual(["sessions", "sessionGuests"])
		expect(h.emits).toHaveLength(1)
		expect(h.emits[0].target).toBe(owner)
		expect(h.emits[0].data.sessionMessage.sessionId).toBe(42)
	})

	test("reaches the tab watching this session and not the user's other tab", async () => {
		// One user, two tabs — the case a room emit cannot narrow, and the whole
		// of ruling 5 applied to a broadcast: the second tab is not sent a row
		// for a session it is not looking at, rather than being sent one and
		// dropping it in the registry.
		const h = harness()
		const onOne = h.connect(1, "sessionMessage#1")
		h.connect(1, "sessionMessage#2")

		await broadcastToSessionUsers(h.io, 1, "sessionMessage", row(1))

		expect(h.emits).toHaveLength(1)
		expect(h.emits[0].target).toBe(onOne)
		// Never the room, which would reach both tabs.
		expect(h.emits.map((e) => e.target)).not.toContain("user_1")
	})

	test("takes the scope from the row rather than from its own argument", async () => {
		// The trap the shared table exists to close: `sessionMessage` carries
		// its session INSIDE the message, and a gate reading `payload.sessionId`
		// would find nothing there. Asserted on a contrived mismatch, because
		// the fallback to the broadcast's own session id would otherwise hide a
		// broken extractor — the payload is what the client keys off, so the
		// payload decides.
		const h = harness()
		const watching = h.connect(1, "sessionMessage#42")

		await broadcastToSessionUsers(h.io, 7, "sessionMessage", row(42))

		expect(h.emits.map((e) => e.target)).toEqual([watching])
	})

	test("serves every scope to a socket that declared the bare key", async () => {
		const h = harness()
		h.connect(1, "sessionMessage")

		await broadcastToSessionUsers(h.io, 42, "sessionMessage", row(42))
		await broadcastToSessionUsers(h.io, 7, "sessionMessage", row(7))

		expect(h.emits.map((e) => e.data.sessionMessage.sessionId)).toEqual([
			42, 7
		])
	})

	test("falls back to the session it was called for when a payload names none", async () => {
		// Fails towards sending: an event whose payload shape drifts should
		// cost a roster read, never go silent.
		const h = harness()
		const watching = h.connect(1, "sessionMessage#42")

		await broadcastToSessionUsers(h.io, 42, "sessionMessage", {
			error: "generation failed"
		})

		expect(seam.queries).toEqual(["sessions", "sessionGuests"])
		expect(h.emits.map((e) => e.target)).toEqual([watching])
	})

	test("a session nobody has open anywhere costs nothing at all", async () => {
		const h = harness()
		// Not one connected socket: the shape of a background generation whose
		// tab has been closed. The row is still written by the caller; only the
		// push is skipped.
		await broadcastToSessionUsers(h.io, 42, "sessionMessage", row(42))

		expect(seam.queries).toEqual([])
		expect(h.emits).toEqual([])
	})
})

describe("an ungated event", () => {
	test("is the broadcast it has always been, interest or no interest", async () => {
		// `pipelines:progress` is neither gated nor scoped — this fake harness
		// accepts any event name — so it must still reach every participant's
		// ROOM with nothing declared, which is the half of this helper ruling 5
		// does not touch.
		const h = harness()
		seam.roster.guestIds = [2]
		h.connect(1)

		await broadcastToSessionUsers(h.io, 42, "harness:ungated", {
			session: { id: 42 }
		})

		expect(seam.queries).toEqual(["sessions", "sessionGuests"])
		expect(h.emits.map((e) => e.target)).toEqual(["user_1", "user_2"])
	})
})
