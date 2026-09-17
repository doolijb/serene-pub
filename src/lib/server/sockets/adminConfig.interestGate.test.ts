/**
 * The admin/config cascades through the real gate — phase 2, the admin/config
 * batch (`users`, `userSettings`, `systemSettings`, `samplingConfigs`, `totp`
 * and the rest).
 *
 * These seventeen families end almost every write by pushing something nobody
 * asked for: the whole sampling list after a rename, the entire system-settings
 * view after one boolean flips, the user row after an active config moves. Each
 * push is a query — `systemSettings:get` alone is five reads plus an
 * embedding-target resolution — and until this slice all of it was paid whether
 * or not any view was open to receive it. The cascades are now the thunk form,
 * so these tests assert on the QUERIES rather than on the emits: skipping the
 * emit alone would save nothing.
 *
 * One of them was worse than unpaid. `users.ts`'s `user()` helper — the refresh
 * five other config families call after a write — emitted RAW:
 * `socket.server.to("user_" + userId).emit("users:current", …)`, past
 * `redactConnections` and past the gate, the only emit in `sockets/` that did.
 * It goes through `emitToUser` now, and the two `users:current` cases below are
 * what say so.
 *
 * The gate applies to a handler's own reply exactly as it does to its cascades:
 * the client holds the reply's key before the request even goes out — the typed
 * emit flushes the interest sync first — so the own reply reaches the caller and
 * only the cascades nobody wants are skipped.
 *
 * Driven through the real `connectSockets`, the real `register` and the real
 * `interest:sync` handler. `GATED_EVENTS` is mocked to add this batch's events —
 * the architect adds them to the shared set once the client half has landed too,
 * and these tests are what say the server half is ready for that. The mocked set
 * is MUTABLE so one case can ungate `users:current` and pin what the room emit
 * used to look like.
 *
 * `$lib/server/db` is a recording fake rather than PGlite: what is being pinned
 * here is which reads happen, and a fake that names each read is the only way to
 * assert that one did NOT. The gate itself is never stubbed — a test that
 * stubbed it would pass against a gate that had been deleted.
 *
 * ⚠ Harness gotcha (shared with `sessions.interestGate.test.ts`): mocking
 * `$lib/server/db` while importing `sockets/index` needs `getCryptoSecretKey`,
 * `schema` and `dbReady` in the factory — `auth/tokens` derives its secret at
 * import time and `connectSockets` reaches auth.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const seam = vi.hoisted(() => {
	/** Every read, in the order it happened — the cost the gate exists to skip. */
	const queries: string[] = []

	/**
	 * The gated set, mutable so a case can ungate one event. Spelled here rather
	 * than in a module const because the `vi.mock` factory below is hoisted
	 * above every one of them.
	 */
	const gated = new Set<string>()

	const rows = {
		/**
		 * The user row as `buildUsersCurrent` reads it — with a connection
		 * named on it, which the real row has no column for. It is here so the
		 * per-recipient `redactConnections` has something to remove: a payload
		 * with nothing to strip comes back as the same object, and a redaction
		 * that is a no-op proves nothing about whether it ran.
		 */
		user: {
			id: 1,
			username: "owner",
			isAdmin: true,
			connectionId: 7
		} as Record<string, unknown>,
		sampling: {
			id: 1,
			name: "Preset",
			isImmutable: false
		} as Record<string, unknown> | undefined
	}

	/** A drizzle-ish builder: every method chains, awaiting it records the write. */
	function chain(label: string, result: any = []) {
		const self: any = {
			from: () => self,
			where: () => self,
			limit: () => self,
			orderBy: () => self,
			set: () => self,
			values: () => self,
			onConflictDoNothing: () => self,
			onConflictDoUpdate: () => self,
			returning: () => self,
			then: (ok: any, err: any) => {
				queries.push(label)
				return Promise.resolve(result).then(ok, err)
			}
		}
		return self
	}

	const table = (name: string, first: () => any, many: () => any) => ({
		findFirst: async () => {
			queries.push(`${name}.findFirst`)
			return first()
		},
		findMany: async () => {
			queries.push(`${name}.findMany`)
			return many()
		}
	})

	return {
		queries,
		gated,
		rows,
		db: {
			query: {
				users: table(
					"users",
					() => rows.user,
					() => []
				),
				samplingConfigs: table(
					"samplingConfigs",
					() => rows.sampling,
					() => []
				),
				systemSettings: table(
					"systemSettings",
					() => ({ id: 1 }),
					() => []
				),
				ollamaSettings: table(
					"ollamaSettings",
					() => ({}),
					() => []
				),
				koboldCppSettings: table(
					"koboldCppSettings",
					() => ({}),
					() => []
				),
				userSettings: table(
					"userSettings",
					() => ({ userId: 1 }),
					() => []
				)
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
	for (const event of actual.GATED_EVENTS) seam.gated.add(event)
	// This batch's five, the ones these cases turn on. Everything else — the
	// scope table, the restricted prefixes, the key helpers — stays as it ships.
	for (const event of [
		"users:current",
		"systemSettings:get",
		"userSettings:get",
		"samplingConfigs:list",
		"samplingConfigs:get",
		"samplingConfigs:update",
		"totp:status"
	])
		seam.gated.add(event)
	return {
		...actual,
		GATED_EVENTS: seam.gated,
		isGatedEvent: (event: string) => seam.gated.has(event)
	}
})

vi.mock("$lib/server/db", async () => {
	const schema = await import("$lib/server/db/schema")
	return {
		db: seam.db,
		schema,
		dbReady: Promise.resolve(),
		getCryptoSecretKey: () => "admin-config-interest-gate-test-secret",
		closeDatabase: async () => {},
		reopenDatabase: async () => {}
	}
})

// The enrolment service, stubbed to the two calls `totp:enroll:confirm` makes.
// `getTotpState` is the read the status builder pays for, so it records itself
// the same way a query does — that is the whole assertion in the totp case.
vi.mock("$lib/server/auth/totp/service", () => ({
	getTotpState: async () => {
		seam.queries.push("totp.getTotpState")
		return { enabled: true, recoveryCodesRemaining: 8 }
	},
	confirmEnrollment: async () => ({ recoveryCodes: ["aaaa-bbbb"] }),
	beginEnrollment: async () => ({ secret: "s", otpauthUri: "otpauth://x" }),
	verifyForSession: async () => ({ ok: true }),
	regenerateRecoveryCodes: async () => ["cccc-dddd"],
	clearTotp: async () => {},
	isMfaEnabled: async () => true,
	isMfaPending: async () => false
}))

vi.mock("$lib/server/pipelines/entities/sessionGenres", () => ({
	listSessionGenres: async () => [],
	STANDARD_GENRE_ID: "core:genre/chat"
}))

import { connectSockets } from "./index"

const ADMIN = { id: 1, username: "owner", isAdmin: true }
/** The same admin in a second tab — two sockets in one user room. */
const SECOND_TAB = { id: 1, username: "owner", isAdmin: true }
/** A whole different account, and not an administrator. */
const MEMBER = { id: 2, username: "member", isAdmin: false }

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

	function connect(id: string, user: typeof ADMIN | typeof MEMBER) {
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
	seam.gated.add("users:current")
	seam.rows.user = {
		id: 1,
		username: "owner",
		isAdmin: true,
		connectionId: 7
	}
	seam.rows.sampling = { id: 1, name: "Preset", isImmutable: false }
})

afterEach(() => {
	harnesses.splice(0).forEach((h) => h.teardown())
	vi.clearAllMocks()
})

type Emitted = { target: string; event: string; data: any }

const count = (q: string) => seam.queries.filter((x) => x === q).length
const events = (h: { emits: Emitted[] }) => h.emits.map((e) => e.event)
const of = (h: { emits: Emitted[] }, event: string) =>
	h.emits.filter((e) => e.event === event)

describe("samplingConfigs:update — the sampling list cascade", () => {
	/**
	 * An id-only payload: a mutable row, nothing to set, so the handler reads
	 * the row, writes nothing, and goes straight to its three cascades. That is
	 * the shape this suite wants — the cascades with no write noise around them.
	 */
	const ID_ONLY = { sampling: { id: 1 } }

	test("delivers the caller's own reply and builds no list when nobody wants one", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		// The caller always holds its own reply's key before the request ships
		// (the typed emit flushes the interest sync first) — declared here, but
		// none of the three cascades, so all three stay closed.
		await admin.declare("samplingConfigs:update")

		await admin.fire("samplingConfigs:update", ID_ONLY)

		// The handler ran: it read the row it was asked to update.
		expect(count("samplingConfigs.findFirst")).toBe(1)
		// The caller's own reply reached it, and nothing else went out.
		expect(events(h)).toEqual(["samplingConfigs:update"])
		expect(of(h, "samplingConfigs:update")[0].target).toBe("s1")
		// No interest in the list, so no thunk, no query, no emit — and the
		// same for the two other cascades behind this verb.
		expect(count("samplingConfigs.findMany")).toBe(0)
		expect(count("users.findFirst")).toBe(0)
	})

	test("builds the list once for a socket that declared the key", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		await admin.declare("samplingConfigs:update", "samplingConfigs:list")

		await admin.fire("samplingConfigs:update", ID_ONLY)

		expect(count("samplingConfigs.findMany")).toBe(1)
		// The list before the reply — the order this handler has always sent
		// them in, cascades first.
		expect(events(h)).toEqual([
			"samplingConfigs:list",
			"samplingConfigs:update"
		])
		const list = of(h, "samplingConfigs:list")[0]
		// Delivered per socket (ruling 5), carrying the payload rather than the
		// thunk that built it.
		expect(list.target).toBe("s1")
		expect(list.data.samplingConfigsList).toEqual([])
	})

	test("builds it ONCE for two interested tabs, and reaches both", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		const two = h.connect("s2", SECOND_TAB)
		await one.declare("samplingConfigs:list")
		await two.declare("samplingConfigs:list")

		await one.fire("samplingConfigs:update", ID_ONLY)

		expect(count("samplingConfigs.findMany")).toBe(1)
		expect(of(h, "samplingConfigs:list").map((e) => e.target)).toEqual([
			"s1",
			"s2"
		])
	})
})

describe("users:current — the emit that used to bypass emitToUser", () => {
	/**
	 * The helper path. `samplingConfigs:update` finishes by calling `user()`,
	 * which is the function that held the raw room emit. What is pinned here is
	 * that it now answers to the gate at all: no interest, no read, no frame.
	 */
	test("reads no user row when nobody wants the current user", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		await admin.declare("samplingConfigs:update")

		await admin.fire("samplingConfigs:update", { sampling: { id: 1 } })

		expect(count("users.findFirst")).toBe(0)
		expect(events(h)).not.toContain("users:current")
	})

	test("delivers it per interested socket, never to the room", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		const other = h.connect("s2", SECOND_TAB)
		await admin.declare("samplingConfigs:update", "users:current")
		// The second tab is open on something else and wants no user row.
		await other.declare("samplingConfigs:list")

		await admin.fire("samplingConfigs:update", { sampling: { id: 1 } })

		const current = of(h, "users:current")
		expect(current.map((e) => e.target)).toEqual(["s1"])
		// The raw emit this replaces addressed `user_1`, so every tab of this
		// user got a frame whether or not anything was showing the row.
		expect(h.emits.some((e) => e.target === "user_1")).toBe(false)
		expect(count("users.findFirst")).toBe(1)
		// An administrator is shown connection identity, so nothing is removed.
		expect(current[0].data.user.connectionId).toBe(7)
	})

	test("falls back to today's room emit when the event is not gated", async () => {
		// What this looked like before the event joins `GATED_EVENTS`: one emit
		// to the whole user room, thunk still evaluated. The migration has no
		// dark period, and this is the half that says so.
		const h = fresh()
		seam.gated.delete("users:current")
		const admin = h.connect("s1", ADMIN)

		await admin.fire("samplingConfigs:update", { sampling: { id: 1 } })

		const current = of(h, "users:current")
		expect(current.map((e) => e.target)).toEqual(["user_1"])
		expect(current[0].data.user.id).toBe(1)
	})

	test("redacts connection identity for a recipient who is not an admin", async () => {
		/**
		 * Driven through `users:current:updateDisplayName` rather than through
		 * the helper, and deliberately: every socket in one user room carries
		 * the same subject, so the only honest way to watch a NON-admin receive
		 * this event is to have a non-admin cause it — and every handler that
		 * calls the helper is admin-only. The event, the builder
		 * (`buildUsersCurrent`) and the emit path are the same ones the helper
		 * now uses; what differs is only who is holding the socket.
		 */
		const h = fresh()
		seam.rows.user = {
			id: 2,
			username: "member",
			isAdmin: false,
			connectionId: 7
		}
		const member = h.connect("s3", MEMBER)
		await member.declare("users:current:updateDisplayName", "users:current")

		await member.fire("users:current:updateDisplayName", {
			displayName: "A New Name"
		})

		const current = of(h, "users:current")
		expect(current.map((e) => e.target)).toEqual(["s3"])
		expect(current[0].data.user.username).toBe("member")
		// The whole point: the payload left the server without it.
		expect(current[0].data.user).not.toHaveProperty("connectionId")
	})
})

describe("systemSettings:updateScriptsEnabled — the settings-view cascade", () => {
	test("writes the setting and re-reads nothing when nobody is showing it", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		await admin.declare("systemSettings:updateScriptsEnabled")

		await admin.fire("systemSettings:updateScriptsEnabled", {
			enabled: true
		})

		// The command ran.
		expect(seam.queries).toContain("update")
		expect(events(h)).toEqual(["systemSettings:updateScriptsEnabled"])
		// The five reads behind `systemSettings:get` did not.
		expect(count("systemSettings.findFirst")).toBe(0)
		expect(count("ollamaSettings.findFirst")).toBe(0)
		expect(count("koboldCppSettings.findFirst")).toBe(0)
	})
})

describe("totp:enroll:confirm — the status cascade", () => {
	test("confirms the enrolment and reads no status when nobody wants one", async () => {
		const h = fresh()
		const member = h.connect("s3", MEMBER)
		await member.declare("totp:enroll:confirm")

		await member.fire("totp:enroll:confirm", { code: "123456" })

		expect(events(h)).toEqual(["totp:enroll:confirm"])
		expect(count("totp.getTotpState")).toBe(0)
	})

	test("reads it once for a socket that declared the key", async () => {
		const h = fresh()
		const member = h.connect("s3", MEMBER)
		await member.declare("totp:enroll:confirm", "totp:status")

		await member.fire("totp:enroll:confirm", { code: "123456" })

		expect(count("totp.getTotpState")).toBe(1)
		expect(events(h)).toEqual(["totp:enroll:confirm", "totp:status"])
		const status = of(h, "totp:status")[0]
		expect(status.target).toBe("s3")
		// `verificationRequired` is a property of THIS connection, and the
		// handler emptied `pendingSetup` before the thunk ran.
		expect(status.data).toEqual({
			enabled: true,
			recoveryCodesRemaining: 8,
			verificationRequired: false
		})
	})
})
