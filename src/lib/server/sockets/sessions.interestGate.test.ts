/**
 * The `sessions:*` cascades through the real gate — phase 2, slice 2.
 *
 * Every one of these handlers finishes by pushing something nobody asked for:
 * the session list after a rename, the whole session after a guest joins, who is
 * typing. Each push is a query — `sessions:list` is every session with its cast,
 * its personas and its tags; the `sessions:get` broadcast is the session with
 * every message in it, plus the owner and guest roster reads behind the
 * broadcast — and until this slice all of it was paid whether or not any view
 * was open to receive it. The cascades are now the thunk form, so these tests
 * assert on the QUERIES rather than on the emits: skipping the emit alone would
 * save nothing.
 *
 * The gate applies to a handler's own reply exactly as it does to its
 * cascades: the client holds the reply's key before the request even goes
 * out — the typed emit flushes the interest sync first — so the own reply
 * reaches the caller and only the cascades nobody wants are skipped.
 *
 * Driven through the real `connectSockets`, the real `register` and the real
 * `interest:sync` handler. `GATED_EVENTS` is mocked to add the three events this
 * slice converts — the architect adds them to the shared set once the client
 * half has landed too, and these tests are what say the server half is ready
 * for that. `SCOPED_EVENTS` is the real table: `sessions:get` keys off
 * `payload.session.id` — falling back to `payload.sessionId`, which the
 * not-found reply carries in place of a session — and `sessions:userTyping` off
 * `payload.sessionId`, so a socket open on another session is not served this
 * one's rows.
 *
 * `$lib/server/db` is a recording fake rather than PGlite: what is being pinned
 * here is which reads happen, and a fake that names each read is the only way to
 * assert that one did NOT. The gate itself is never stubbed — a test that
 * stubbed it would pass against a gate that had been deleted.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const seam = vi.hoisted(() => {
	/** Every read, in the order it happened — the cost the gate exists to skip. */
	const queries: string[] = []
	const rows = {
		/**
		 * Session 1, owned by user 1. Null is the session that does not exist —
		 * `checkSessionAccess` reads this row first and refuses without it.
		 */
		session: { id: 1, userId: 1 } as {
			id: number
			userId: number
		} | null,
		/** Who is typing. Null is the row that has gone. */
		persona: { id: 5, name: "Ada" } as { id: number; name: string } | null
	}

	/**
	 * A drizzle-ish builder: every method chains, awaiting it records the write.
	 * Reads go through `query.*` below, which is where the shapes matter.
	 */
	function chain(label: string, result: any = []) {
		const self: any = {
			from: () => self,
			where: () => self,
			limit: () => self,
			orderBy: () => self,
			set: () => self,
			values: () => self,
			onConflictDoNothing: () => self,
			returning: () => self,
			then: (ok: any, err: any) => {
				queries.push(label)
				return Promise.resolve(result).then(ok, err)
			}
		}
		return self
	}

	/** The session as `getSessionFromDB` asks for it: relations included. */
	const withRelations = () => ({
		...rows.session,
		sessionPersonas: [],
		sessionCharacters: [],
		sessionMessages: [],
		sessionTags: [],
		sessionGuests: []
	})

	return {
		queries,
		rows,
		db: {
			query: {
				sessions: {
					// The two reads are told apart by their shape, because that
					// is what tells the access check (`columns: { userId }`,
					// and the broadcast's roster read) from the session
					// re-read a cascade pays for (`with: { … }`).
					findFirst: async (config: any) => {
						queries.push(
							config?.with
								? "sessions.findFirst(relations)"
								: "sessions.findFirst(columns)"
						)
						return config?.with ? withRelations() : rows.session
					},
					findMany: async () => {
						queries.push("sessions.findMany")
						return []
					}
				},
				sessionGuests: {
					findFirst: async () => {
						queries.push("sessionGuests.findFirst")
						return undefined
					},
					findMany: async () => {
						queries.push("sessionGuests.findMany")
						return []
					}
				},
				sessionTags: {
					findMany: async () => {
						queries.push("sessionTags.findMany")
						return []
					}
				},
				users: {
					findFirst: async () => {
						queries.push("users.findFirst")
						return { id: 2, isDeleted: false }
					}
				},
				// The voiced character behind `sessions:userTyping` — a
				// `characters` read, named for the role it answers for.
				characters: {
					findFirst: async () => {
						queries.push("characters.findFirst(persona)")
						return rows.persona
					}
				}
			},
			select: () => chain("select"),
			update: () => chain("update"),
			insert: () => chain("insert"),
			delete: () => chain("delete")
		}
	}
})

vi.mock("$lib/shared/sockets/interest", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/shared/sockets/interest")>()
	// The real set, plus this slice's three — spelled here rather than in a
	// module const, because this factory is hoisted above every one of them.
	// Everything else — the scope table, the restricted prefixes, the key
	// helpers — stays exactly as it ships.
	const gated = new Set([
		...actual.GATED_EVENTS,
		"sessions:list",
		"sessions:get",
		"sessions:userTyping"
	])
	return {
		...actual,
		GATED_EVENTS: gated,
		isGatedEvent: (event: string) => gated.has(event)
	}
})

// The db module is more than `db`: `auth/tokens` derives its secret from it at
// import time, and `connectSockets` reaches auth. Nothing here may import the
// real module — doing so opens PGlite — so the handful of exports the graph
// actually loads are stood in for.
vi.mock("$lib/server/db", async () => {
	const schema = await import("$lib/server/db/schema")
	return {
		db: seam.db,
		schema,
		dbReady: Promise.resolve(),
		getCryptoSecretKey: () => "sessions-interest-gate-test-secret",
		closeDatabase: async () => {},
		reopenDatabase: async () => {}
	}
})

// The genre registry, stubbed to the two things the list builder reads off it.
// Nothing in these paths depends on a real genre: the list would name one in
// `genreName`, and an unreachable registry already degrades to "Chat".
vi.mock("$lib/server/pipelines/entities/sessionGenres", () => ({
	listSessionGenres: async () => [],
	STANDARD_GENRE_ID: "core:genre/chat"
}))

import { connectSockets } from "./index"

const OWNER = { id: 1, username: "owner", isAdmin: true }
/** The same owner in a second tab — two sockets in one user room. */
const SECOND_TAB = { id: 1, username: "owner", isAdmin: true }

/** The same fake io the other interest-gate tests drive `connectSockets` with. */
function harness() {
	const rooms = new Map<string, Set<string>>()
	const registry = new Map<string, any>()
	const emits: Array<{ target: string; event: string; data: any }> = []
	let onConnect: ((socket: any) => void) | null = null

	const io: any = {
		on: (event: string, cb: (socket: any) => void) => {
			if (event === "connect") onConnect = cb
		},
		to: (target: string) => ({
			emit: (event: string, data: any) =>
				emits.push({ target, event, data })
		}),
		sockets: { adapter: { rooms }, sockets: registry }
	}

	connectSockets(io)

	const live: Array<() => void> = []

	function connect(id: string, user: typeof OWNER) {
		// A multimap: several modules hook "disconnect" on the same socket.
		const listeners = new Map<string, Array<(msg?: any) => any>>()
		const socket: any = {
			id,
			user,
			pendingSetup: [],
			emit: () => {},
			disconnect: () => {},
			join: (room: string) => {
				const members = rooms.get(room) ?? new Set<string>()
				members.add(id)
				rooms.set(room, members)
			},
			on: (event: string, cb: (msg?: any) => any) => {
				listeners.set(event, [...(listeners.get(event) ?? []), cb])
			}
		}
		registry.set(id, socket)
		onConnect!(socket)

		const disconnect = () => {
			for (const cb of listeners.get("disconnect") ?? []) void cb()
			registry.delete(id)
			rooms.get(`user_${user.id}`)?.delete(id)
		}
		live.push(disconnect)

		return {
			socket,
			fire: (event: string, msg?: any) =>
				Promise.all((listeners.get(event) ?? []).map((cb) => cb(msg))),
			declare: (...keys: string[]) =>
				Promise.all(
					(listeners.get("interest:sync") ?? []).map((cb) =>
						cb({ keys })
					)
				),
			disconnect
		}
	}

	return {
		io,
		emits,
		connect,
		teardown: () => live.splice(0).forEach((f) => f())
	}
}

const harnesses: Array<{ teardown: () => void }> = []
function fresh() {
	const h = harness()
	harnesses.push(h)
	return h
}

beforeEach(() => {
	seam.queries.length = 0
	seam.rows.persona = { id: 5, name: "Ada" }
	seam.rows.session = { id: 1, userId: 1 }
})

afterEach(() => {
	harnesses.splice(0).forEach((h) => h.teardown())
	vi.clearAllMocks()
})

/** The one read that says the session list was actually built. */
const listBuilt = () =>
	seam.queries.filter((q) => q === "sessions.findMany").length
/** The one read that says a session was re-read for a cascade. */
const sessionReread = () =>
	seam.queries.filter((q) => q === "sessions.findFirst(relations)").length
const events = (h: { emits: Array<{ event: string }> }) =>
	h.emits.map((e) => e.event)

describe("sessions:update — the session list cascade", () => {
	test("delivers the caller's own reply and builds no list when nobody wants the list", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		// The caller always holds its own reply's key before the request ships
		// (the typed emit flushes the interest sync first) — declared here, but
		// not `sessions:list`, so the cascade stays closed.
		await owner.declare("sessions:update")

		await owner.fire("sessions:update", { session: { id: 1 } })

		// The command ran and the caller's own reply reached it.
		expect(seam.queries).toContain("update")
		expect(events(h)).toEqual(["sessions:update"])
		// The cascade did not: no interest in the list, no thunk, no query, no emit.
		expect(listBuilt()).toBe(0)
	})

	test("builds it once for a socket that declared the key", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("sessions:update", "sessions:list")

		await owner.fire("sessions:update", { session: { id: 1 } })

		expect(listBuilt()).toBe(1)
		// The reply first, then the refreshed list — the order this handler has
		// always sent them in.
		expect(events(h)).toEqual(["sessions:update", "sessions:list"])
		const list = h.emits.find((e) => e.event === "sessions:list")!
		// Delivered per socket (ruling 5), carrying the payload rather than the
		// thunk that built it.
		expect(list.target).toBe("s1")
		expect(list.data.sessionList).toEqual([])
	})

	test("builds it ONCE for two interested tabs, and reaches both", async () => {
		const h = fresh()
		const one = h.connect("s1", OWNER)
		const two = h.connect("s2", SECOND_TAB)
		await one.declare("sessions:list")
		await two.declare("sessions:list")

		await one.fire("sessions:update", { session: { id: 1 } })

		expect(listBuilt()).toBe(1)
		expect(
			h.emits
				.filter((e) => e.event === "sessions:list")
				.map((e) => e.target)
		).toEqual(["s1", "s2"])
	})
})

describe("sessions:addGuest — the session broadcast and the guest's list", () => {
	test("adds the guest and re-reads nothing when nobody wants the session", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		// The caller holds its own reply's key before the request ships, plus
		// — same as the fixture above — interest in another session entirely,
		// which stays indistinguishable from watching this one until the scope
		// table is consulted.
		await owner.declare("sessions:addGuest", "sessions:get#7")

		await owner.fire("sessions:addGuest", { sessionId: 1, guestUserId: 2 })

		expect(seam.queries).toContain("insert")
		expect(events(h)).toEqual(["sessions:addGuest"])
		// Neither the session re-read nor the roster reads behind the
		// broadcast, which is where the gate sits for this one.
		expect(sessionReread()).toBe(0)
		expect(seam.queries).not.toContain("sessionGuests.findMany")
		// And no list for the guest either: they have no tab open to show one.
		expect(listBuilt()).toBe(0)
	})

	test("re-reads it once and delivers to the tab watching that session", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		const elsewhere = h.connect("s2", SECOND_TAB)
		await owner.declare("sessions:get#1")
		await elsewhere.declare("sessions:get#7")

		await owner.fire("sessions:addGuest", { sessionId: 1, guestUserId: 2 })

		expect(sessionReread()).toBe(1)
		// Read once for the owner, once for the guests — the roster reads the
		// gate was skipping.
		expect(seam.queries).toContain("sessionGuests.findMany")
		const get = h.emits.filter((e) => e.event === "sessions:get")
		expect(get.map((e) => e.target)).toEqual(["s1"])
		expect(get[0].data.session.id).toBe(1)
	})

	test("pushes the guest's own list only when the GUEST is listening", async () => {
		// The one cascade aimed at somebody else's room: the new guest's
		// sidebar. The owner's interest cannot open it, and does not.
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		const guest = h.connect("s3", {
			id: 2,
			username: "guest",
			isAdmin: false
		})
		await owner.declare("sessions:list")
		await guest.declare("sessions:list")

		await owner.fire("sessions:addGuest", { sessionId: 1, guestUserId: 2 })

		// Once, for the guest — the owner's own list is not re-sent by this
		// verb at all, then or now.
		expect(listBuilt()).toBe(1)
		expect(
			h.emits
				.filter((e) => e.event === "sessions:list")
				.map((e) => e.target)
		).toEqual(["s3"])
	})
})

describe("sessions:typing — the persona read behind the push", () => {
	test("reads no persona when nobody wants this session's typing", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("sessions:userTyping#7")

		await owner.fire("sessions:typing", { sessionId: 1, personaId: 5 })

		// The access check still ran; the payload's own read did not, and
		// neither did the roster behind the broadcast.
		expect(seam.queries).toContain("sessions.findFirst(columns)")
		expect(seam.queries).not.toContain("characters.findFirst(persona)")
		expect(seam.queries).not.toContain("sessionGuests.findMany")
		expect(h.emits).toEqual([])
	})

	test("reads it once and names who is typing", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("sessions:userTyping#1")

		await owner.fire("sessions:typing", { sessionId: 1, personaId: 5 })

		expect(
			seam.queries.filter((q) => q === "characters.findFirst(persona)")
		).toHaveLength(1)
		expect(h.emits).toHaveLength(1)
		expect(h.emits[0].target).toBe("s1")
		expect(h.emits[0].data).toEqual({
			sessionId: 1,
			personaId: 5,
			personaName: "Ada"
		})
	})

	test("broadcasts nothing when the persona has gone", async () => {
		// The thunk's nullish answer IS the `if (persona)` guard the eager form
		// held: a payload that cannot be built is not a payload of nulls.
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("sessions:userTyping#1")
		seam.rows.persona = null

		await owner.fire("sessions:typing", { sessionId: 1, personaId: 5 })

		expect(seam.queries).toContain("characters.findFirst(persona)")
		expect(h.emits).toEqual([])
	})
})

describe("sessions:get — the not-found reply still has a scope", () => {
	/**
	 * The reply with no session in it, which is the one payload with no
	 * `session.id` to be scoped by. The server puts the requested id on
	 * `sessionId` so the scope survives. Without it this reply reaches only a
	 * BARE `sessions:get` key, and a bare key matches every OTHER session's
	 * reply too — so every view with a not-found branch would have to hold one,
	 * and the gate would pass for every session id while any of them is open.
	 *
	 * The FOUND half of the same extractor is pinned by `sessions:addGuest` above
	 * (delivered to `sessions:get#1`, not to `#7`) and by the shared table's own
	 * test, not here: the handler's success path counts messages through
	 * `db.select`, and this fake's chain has no pagination-count row to give it.
	 */
	test("delivers it to the socket watching that very id", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		seam.rows.session = null
		await owner.declare("sessions:get#999999")

		await owner.fire("sessions:get", { id: 999999 })

		const get = h.emits.filter((e) => e.event === "sessions:get")
		expect(get.map((e) => e.target)).toEqual(["s1"])
		expect(get[0].data.session).toBeNull()
		expect(get[0].data.sessionId).toBe(999999)
	})

	test("does not deliver it to a socket watching another session", async () => {
		// The whole point of the scope: the tab on session 1 is not told that
		// somebody else's 999999 is missing.
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		const elsewhere = h.connect("s2", SECOND_TAB)
		seam.rows.session = null
		await owner.declare("sessions:get#999999")
		await elsewhere.declare("sessions:get#1")

		await owner.fire("sessions:get", { id: 999999 })

		expect(
			h.emits
				.filter((e) => e.event === "sessions:get")
				.map((e) => e.target)
		).toEqual(["s1"])
	})

	test("returns without throwing when no socket wants it", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		seam.rows.session = null

		// No declare at all. The gate finds nobody, emits nothing, and the
		// handler still completes — a throw here would reach `register`'s catch
		// and push a generic `sessions:get:error` at a client that asked for a
		// session which simply is not there.
		await expect(
			owner.fire("sessions:get", { id: 999999 })
		).resolves.toBeDefined()

		expect(events(h)).toEqual([])
	})
})
