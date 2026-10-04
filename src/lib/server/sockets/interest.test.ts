/**
 * The per-socket interest set: what a client may declare, and what the gate
 * reads back out.
 *
 * Two of these are boundaries rather than behaviour. **Restricted interest** is
 * the defence-in-depth half of a rule whose real boundary is each handler's own
 * admin check (plan ruling 6) — a non-admin must not be able to make the server
 * REMEMBER a key from an admin-only family, however it spells the sync. And the
 * set must be stored SYNCHRONOUSLY, because the whole protocol is "sync first,
 * then request, on one ordered connection" and there is no ack to fall back on;
 * `index.interestGate.test.ts` pins that end to end, and the first test below
 * asserts the cheap half of it — the handler is done when it returns.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import {
	ANY_SCOPE,
	anyInterestAnywhere,
	scopesWantedAnywhere,
	hasInterest,
	interestedSockets,
	registerInterestHandlers,
	socketWantsAnyScope,
	type InterestIo,
	type InterestSocket
} from "./interest"
import { isBlockedDuringSetup } from "$lib/server/auth/setupGate"
import {
	INTEREST_SYNC_EVENT,
	interestKey,
	isRestrictedInterest
} from "$lib/shared/sockets/interest"

const ADMIN = { id: 1, isAdmin: true }
const NON_ADMIN = { id: 2, isAdmin: false }

/**
 * A connected client, as `registerInterestHandlers` sees one.
 *
 * `register` here is a stand-in that calls the handler directly — the real one
 * lives in `sockets/index.ts` and is exercised by the gate test beside this.
 * What this needs from it is only that the handler is reached.
 */
function connect(user: { id: number; isAdmin: boolean }) {
	const emitted: Array<{ event: string; data: any }> = []
	const disconnects: Array<() => void> = []
	const listeners = new Map<string, (params: any) => unknown>()

	const socket: any = {
		id: `socket_${user.id}`,
		user,
		// Set at connect by `connectSockets`, so a walk never sees undefined.
		interest: new Set<string>(),
		on: (event: string, cb: () => void) => {
			if (event === "disconnect") disconnects.push(cb)
		}
	}

	registerInterestHandlers(
		socket,
		(event: string, data: any) => {
			emitted.push({ event, data })
		},
		(s: any, handler: any, emitToUser: any) => {
			listeners.set(handler.event, (params: any) =>
				handler.handler(s, params, emitToUser)
			)
		}
	)

	return {
		socket,
		emitted,
		/** Deliberately NOT awaited by the caller — see the file header. */
		sync: (params: any) => listeners.get(INTEREST_SYNC_EVENT)!(params),
		keys: () => [...(socket.interest as Set<string>)].sort(),
		disconnect: () => disconnects.forEach((cb) => cb())
	}
}

const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
afterEach(() => warn.mockClear())

describe("interest:sync", () => {
	test("replaces the set rather than merging into it", () => {
		const client = connect(NON_ADMIN)

		client.sync({ keys: ["sessions:list", "characters:list"] })
		expect(client.keys()).toEqual(["characters:list", "sessions:list"])

		// The periodic sync is idempotent self-healing, so a key the client
		// dropped while the socket was busy has to actually go.
		client.sync({ keys: ["characterFolders:list"] })
		expect(client.keys()).toEqual(["characterFolders:list"])

		client.sync({ keys: [] })
		expect(client.keys()).toEqual([])
	})

	test("has stored the set by the time it returns, with nothing awaited", () => {
		const client = connect(NON_ADMIN)

		// The promise is left pending on purpose: a client's next packet is
		// dispatched without anybody awaiting this one, so what matters is the
		// state at the moment the call returns.
		void client.sync({ keys: ["sessions:streamChunk"] })

		expect(client.keys()).toEqual(["sessions:streamChunk"])
	})

	test("emits nothing at all", () => {
		// An echo would be a reply nobody declared interest in, on the one
		// event that exists so replies can be skipped.
		const client = connect(NON_ADMIN)
		client.sync({ keys: ["sessions:list"] })
		expect(client.emitted).toEqual([])
	})

	test("drops restricted keys from a non-admin and says whose they were", () => {
		const client = connect(NON_ADMIN)

		client.sync({
			keys: [
				"backups:list",
				"sessions:list",
				"koboldcpp:downloadProgress",
				"tunnels:get"
			]
		})

		expect(client.keys()).toEqual(["sessions:list"])
		expect(warn).toHaveBeenCalledTimes(1)
		const said = warn.mock.calls[0].join(" ")
		expect(said).toContain("backups:list")
		expect(said).toContain("koboldcpp:downloadProgress")
		expect(said).toContain("tunnels:get")
		// Which account tried, so a log line is actionable.
		expect(said).toContain(String(NON_ADMIN.id))
	})

	test("keeps the same keys for an administrator, and says nothing", () => {
		const client = connect(ADMIN)

		client.sync({ keys: ["backups:list", "tunnels:get", "sessions:list"] })

		expect(client.keys()).toEqual([
			"backups:list",
			"sessions:list",
			"tunnels:get"
		])
		expect(warn).not.toHaveBeenCalled()
	})

	test("keeps a restricted key out even when the rest of the sync is fine", () => {
		// The shape an attempt actually takes: a client that holds a legitimate
		// set and appends one key it may not have.
		const client = connect(NON_ADMIN)
		client.sync({ keys: ["sessions:list"] })
		client.sync({ keys: ["sessions:list", "invites:list"] })

		expect(client.keys()).toEqual(["sessions:list"])
	})
})

describe("a malformed sync", () => {
	test("is ignored rather than thrown on, whatever shape it arrives in", () => {
		const client = connect(NON_ADMIN)
		client.sync({ keys: ["sessions:list"] })

		for (const garbage of [
			undefined,
			null,
			{},
			{ keys: null },
			{ keys: "sessions:list" },
			{ keys: 42 },
			"sessions:list"
		]) {
			expect(() => client.sync(garbage)).not.toThrow()
			// A sync that says nothing usable establishes nothing, rather than
			// leaving the previous set standing as if it had been re-declared.
			expect(client.keys()).toEqual([])
		}
	})

	test("keeps the valid strings out of a mixed array and drops the rest", () => {
		const client = connect(NON_ADMIN)

		client.sync({
			keys: ["sessions:list", 42, null, undefined, {}, ["nested"], "ok"]
		})

		expect(client.keys()).toEqual(["ok", "sessions:list"])
	})

	test("complains at most once per socket", () => {
		// A client looping on a bad payload would otherwise write the log a
		// hundred times a minute, and the hundredth line says nothing new.
		const client = connect(NON_ADMIN)
		for (let i = 0; i < 5; i++) client.sync({ keys: "nope" })
		expect(warn).toHaveBeenCalledTimes(1)
	})
})

describe("disconnect", () => {
	test("clears the set — expiry is disconnect, never silence", () => {
		const client = connect(NON_ADMIN)
		client.sync({ keys: ["sessions:list", "characterFolders:list"] })
		expect(client.keys()).toHaveLength(2)

		client.disconnect()

		expect(client.keys()).toEqual([])
		// Cleared rather than replaced: a walk already holding the Set empties
		// with it, and the field is never momentarily undefined.
		expect(client.socket.interest).toBeInstanceOf(Set)
	})
})

/** A room of sockets, as `hasInterest` reads one off the server. */
function room(userId: number, sockets: InterestSocket[]) {
	const io: InterestIo = {
		sockets: {
			adapter: {
				rooms: new Map([
					[`user_${userId}`, new Set(sockets.map((s) => s.id))]
				])
			},
			sockets: new Map(sockets.map((s) => [s.id, s]))
		}
	}
	return io
}

const socketWith = (id: string, keys: string[]): InterestSocket => ({
	id,
	interest: new Set(keys),
	user: { id: 2, isAdmin: false }
})

describe("hasInterest", () => {
	test("is true when any one socket in the room declared the key", () => {
		const io = room(2, [
			socketWith("a", ["characterFolders:list"]),
			socketWith("b", ["sessions:list"])
		])
		expect(hasInterest(io, 2, "sessions:list")).toBe(true)
		expect(hasInterest(io, 2, "characters:list")).toBe(false)
	})

	test("is false for a user with no room, and for an empty set", () => {
		const io = room(2, [socketWith("a", [])])
		expect(hasInterest(io, 2, "sessions:list")).toBe(false)
		expect(hasInterest(io, 99, "sessions:list")).toBe(false)
	})

	test("ignores a room entry whose socket has already gone", () => {
		const io = room(2, [socketWith("a", ["sessions:list"])])
		io.sockets.adapter.rooms.get("user_2")!.add("vanished")
		expect(hasInterest(io, 2, "sessions:list")).toBe(true)
		expect(hasInterest(io, 2, "characters:list")).toBe(false)
	})

	test("treats a bare key as every scope, and a scoped key as only its own", () => {
		// Phase 1 declares bare keys only; this is what stops phase 3's scopes
		// from silently narrowing a consumer that never asked for one.
		const bare = room(2, [socketWith("a", ["sessions:streamChunk"])])
		expect(hasInterest(bare, 2, "sessions:streamChunk", "42")).toBe(true)
		expect(hasInterest(bare, 2, "sessions:streamChunk")).toBe(true)

		const scoped = room(2, [
			socketWith("a", [interestKey("sessions:streamChunk", 42)])
		])
		expect(hasInterest(scoped, 2, "sessions:streamChunk", "42")).toBe(true)
		expect(hasInterest(scoped, 2, "sessions:streamChunk", "7")).toBe(false)
		// A caller that asks without a scope is asking for the bare key, which
		// this socket did not declare.
		expect(hasInterest(scoped, 2, "sessions:streamChunk")).toBe(false)
	})
})

describe("interestedSockets", () => {
	test("returns only the sockets that declared the key", () => {
		const io = room(2, [
			socketWith("a", ["sessions:list"]),
			socketWith("b", []),
			socketWith("c", ["sessions:list", "characterFolders:list"])
		])
		expect(
			interestedSockets(io, 2, "sessions:list").map((s) => s.id)
		).toEqual(["a", "c"])
		expect(interestedSockets(io, 2, "characters:list")).toEqual([])
	})
})

describe("socketWantsAnyScope", () => {
	test("is true for a bare key and for any scope of the event", () => {
		expect(
			socketWantsAnyScope(
				socketWith("a", ["sessionMessage"]),
				"sessionMessage"
			)
		).toBe(true)
		expect(
			socketWantsAnyScope(
				socketWith("a", ["sessionMessage#42"]),
				"sessionMessage"
			)
		).toBe(true)
	})

	test("is false for another event, and for one whose name this only prefixes", () => {
		expect(
			socketWantsAnyScope(
				socketWith("a", ["sessions:list"]),
				"sessionMessage"
			)
		).toBe(false)
		// `sessionMessages:delete` starts with `sessionMessage` — the separator
		// is what stops a scope check from matching a different event.
		expect(
			socketWantsAnyScope(
				socketWith("a", ["sessionMessages:delete"]),
				"sessionMessage"
			)
		).toBe(false)
		expect(socketWantsAnyScope(socketWith("a", []), "sessionMessage")).toBe(
			false
		)
	})
})

describe("anyInterestAnywhere", () => {
	/** Sockets connected to the server, in nobody's room in particular. */
	function connected(sockets: InterestSocket[]): InterestIo {
		return {
			sockets: {
				adapter: { rooms: new Map() },
				sockets: new Map(sockets.map((s) => [s.id, s]))
			}
		}
	}

	test("sees a socket that is in no room this broadcast knows about", () => {
		// The question `broadcastToSessionUsers` has to answer BEFORE it reads
		// the session's roster: at that point it does not know whose rooms are
		// involved, which is exactly what the queries it is trying to skip are
		// for. A room walk would answer "nobody" here and go dark.
		const io = connected([socketWith("a", ["sessionMessage#42"])])
		expect(anyInterestAnywhere(io, "sessionMessage", "42")).toBe(true)
		expect(anyInterestAnywhere(io, "sessionMessage", "7")).toBe(false)
		expect(hasInterest(io, 2, "sessionMessage", "42")).toBe(false)
	})

	test("takes a bare declaration as every scope", () => {
		const io = connected([socketWith("a", ["sessionMessage"])])
		expect(anyInterestAnywhere(io, "sessionMessage", "42")).toBe(true)
		expect(anyInterestAnywhere(io, "sessionMessage", "7")).toBe(true)
	})

	test("ANY_SCOPE asks whether anybody wants any scope of it at all", () => {
		// The gate a push asks before it knows which sessions it is about
		// (`sessions/startedFromPush.ts`): one scoped declaration anywhere is
		// enough; another event's, or nothing, is not.
		const io = connected([socketWith("a", ["sessionMessage#42"])])
		expect(anyInterestAnywhere(io, "sessionMessage", ANY_SCOPE)).toBe(true)
		expect(anyInterestAnywhere(io, "sessionMessages:delete", ANY_SCOPE)).toBe(false)
		expect(
			anyInterestAnywhere(connected([socketWith("a", ["sessionMessage"])]), "sessionMessage", ANY_SCOPE)
		).toBe(true)
		expect(anyInterestAnywhere(connected([]), "sessionMessage", ANY_SCOPE)).toBe(false)
	})

	test("is false with nothing connected, and on an io with no registry", () => {
		expect(anyInterestAnywhere(connected([]), "sessionMessage", "42")).toBe(
			false
		)
		// Fails CLOSED rather than throwing: a test double with no socket
		// registry is "nobody is listening", which shows up as an emit that did
		// not happen rather than as a delivery to somebody who never asked.
		expect(anyInterestAnywhere({} as unknown as InterestIo, "x", "1")).toBe(
			false
		)
	})
})

describe("scopesWantedAnywhere", () => {
	test("says which scopes of an event each connected person declared", () => {
		const io: InterestIo = {
			sockets: {
				adapter: { rooms: new Map() },
				sockets: new Map(
					[
						{ ...socketWith("a", ["sessionMessage#42", "sessions:get#42"]), user: { id: 7 } },
						{ ...socketWith("b", ["sessionMessage#43"]), user: { id: 7 } },
						{ ...socketWith("c", ["sessionMessage#42"]), user: { id: 8 } },
						// A bare key names no session to look up; a socket with no
						// user is nobody's.
						{ ...socketWith("d", ["sessionMessage"]), user: { id: 9 } },
						{ id: "e", interest: new Set(["sessionMessage#44"]), user: null }
					].map((s) => [s.id, s as InterestSocket])
				)
			}
		}
		const wanted = scopesWantedAnywhere(io, "sessionMessage")
		expect([...wanted.keys()].sort()).toEqual([7, 8])
		expect([...wanted.get(7)!].sort()).toEqual(["42", "43"])
		expect([...wanted.get(8)!]).toEqual(["42"])
		expect(scopesWantedAnywhere(io, "sessions:typing").size).toBe(0)
		expect(scopesWantedAnywhere({} as unknown as InterestIo, "x").size).toBe(0)
	})
})

describe("interest:sync is exempt from the setup gate in register", () => {
	test("is allowed while a session still owes setup", () => {
		// A setup screen is still a view: gate its sync and it declares nothing,
		// so the replies to the handful of events it MAY use never arrive.
		expect(isBlockedDuringSetup(INTEREST_SYNC_EVENT)).toBe(false)
	})
})

describe("restricted interest covers whole families and nothing else", () => {
	test("holds the admin-only families, verified handler by handler", () => {
		for (const key of [
			"backups:list",
			"tunnels:get",
			"allowedHosts:get",
			"invites:list",
			"koboldcpp:downloadProgress",
			"ollama:modelsList",
			"ner:status",
			"plugins:list",
			"sessionGenres:detail"
		])
			expect(isRestrictedInterest(key), key).toBe(true)
	})

	test("leaves every family with a non-admin reader alone", () => {
		// Each of these has at least one handler that serves a non-admin, so
		// listing its prefix would take that person's screen dark. See the
		// audit recorded in `shared/sockets/interest.ts`.
		for (const key of [
			"activity:update",
			"systemSettings:get",
			"vectorization:checkRagStatus",
			"users:current",
			"totp:status",
			"sessionPresets:list",
			"connections:list",
			"pipelines:list",
			"sessions:list"
		])
			expect(isRestrictedInterest(key), key).toBe(false)
	})
})
