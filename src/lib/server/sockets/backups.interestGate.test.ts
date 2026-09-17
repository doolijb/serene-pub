/**
 * `backups:*` through the real gate — the first family whose cascade is lazy.
 *
 * `backupsCreate` and `backupsDelete` each finish by re-sending the list, and
 * that list is a directory walk. Phase 2 slice 1 makes the two of them the
 * thunk form (`emitToUser("backups:list", () => listResponse())`), so the walk
 * happens only when some socket in the room declared the key — which for this
 * family means "Settings → Data is open somewhere". Skipping the emit alone
 * would save nothing; the walk is the cost, which is what these tests assert.
 *
 * Driven through the real `connectSockets`, the real `GATED_EVENTS` (no mocked
 * set here — `backups:list` is genuinely in it) and the real `interest:sync`
 * handler, with only `db/recovery` mocked: a test that stubbed the gate would
 * pass against a gate that had been deleted.
 *
 * `backups:` is also RESTRICTED interest, so the last test is the one that
 * matters for the boundary: a non-admin socket CLAIMING the key does not open
 * the gate, because the sync handler drops it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const recovery = vi.hoisted(() => ({
	listBackups: vi.fn(() => []),
	listBrokenDirs: vi.fn(() => []),
	recoveryPaths: vi.fn(() => ({
		dataDir: "/data",
		dbPath: "/data/serene-pub.db",
		metaPath: "/data/meta.json",
		backupsDir: "/data/backups"
	})),
	backupNow: vi.fn(async () => ({
		name: "serene-pub-0.6.0-2026-09-14T12-00-00.tgz",
		path: "/data/backups/serene-pub-0.6.0-2026-09-14T12-00-00.tgz",
		bytes: 4_800_000,
		modifiedAt: "2026-09-14T12:00:00.000Z",
		hasMeta: true,
		hasUsers: false,
		usersBytes: 0
	})),
	deleteBackup: vi.fn(),
	deleteBrokenDir: vi.fn()
}))

vi.mock("$lib/server/db/recovery", () => recovery)

import { connectSockets } from "./index"

const ADMIN = { id: 1, username: "owner", isAdmin: true }
/** The same admin in a second tab — two sockets in one user room. */
const SECOND_TAB = { id: 1, username: "owner", isAdmin: true }
const NON_ADMIN = { id: 2, username: "reader", isAdmin: false }

/** The same fake io the interest-gate tests drive `connectSockets` with. */
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

	function connect(id: string, user: typeof ADMIN) {
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

	return { io, emits, connect, teardown: () => live.splice(0).forEach((f) => f()) }
}

const harnesses: Array<{ teardown: () => void }> = []
function fresh() {
	const h = harness()
	harnesses.push(h)
	return h
}

beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(() => {
	harnesses.splice(0).forEach((h) => h.teardown())
})

/** The one call that says the directory was actually walked. */
const walked = () => recovery.listBackups.mock.calls.length

describe("backups:create", () => {
	test("takes the backup and walks no directory when nobody is listening", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)

		await admin.fire("backups:create", {})

		// The command still ran — the gate is on outputs, never on commands.
		expect(recovery.backupNow).toHaveBeenCalledTimes(1)
		// The cascade did not: no interest, no thunk, no walk, no emit.
		expect(walked()).toBe(0)
		expect(h.emits).toEqual([])
	})

	test("walks it once for a socket that declared the key", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		await admin.declare("backups:create", "backups:list")

		await admin.fire("backups:create", {})

		expect(walked()).toBe(1)
		expect(h.emits.map((e) => e.event)).toEqual([
			"backups:create",
			"backups:list"
		])
		expect(h.emits.every((e) => e.target === "s1")).toBe(true)
		// The list carries the payload, not the thunk that built it.
		const list = h.emits.find((e) => e.event === "backups:list")!
		expect(list.data.backupsDir).toBe("/data/backups")
	})

	test("walks it ONCE for two interested sockets, and reaches both", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		const two = h.connect("s2", SECOND_TAB)
		await one.declare("backups:list")
		await two.declare("backups:list")

		await one.fire("backups:create", {})

		expect(walked()).toBe(1)
		expect(
			h.emits.filter((e) => e.event === "backups:list").map((e) => e.target)
		).toEqual(["s1", "s2"])
	})
})

describe("backups:delete", () => {
	test("deletes and walks no directory when nobody is listening", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)

		await admin.fire("backups:delete", { name: "x.tgz", kind: "backup" })

		expect(recovery.deleteBackup).toHaveBeenCalledWith("x.tgz")
		expect(walked()).toBe(0)
		expect(h.emits).toEqual([])
	})

	test("walks it once for a socket that declared the key", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		await admin.declare("backups:list")

		await admin.fire("backups:delete", { name: "x.tgz", kind: "backup" })

		expect(walked()).toBe(1)
		expect(h.emits.map((e) => e.event)).toEqual(["backups:list"])
	})
})

describe("restricted interest, end to end", () => {
	test("a non-admin claiming the key does not open the gate", async () => {
		// Three checks stand between a non-admin and this list, and this is the
		// third: the sync handler drops a restricted key from a non-admin
		// socket, so even a client that lies about what it wants leaves the
		// thunk unevaluated. (The first is the client registry refusing to
		// declare it; the second is `requireAdmin` in the handler.)
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		const reader = h.connect("s2", NON_ADMIN)
		await reader.declare("backups:list")

		await admin.fire("backups:create", {})

		expect(recovery.backupNow).toHaveBeenCalledTimes(1)
		expect(walked()).toBe(0)
		expect(h.emits).toEqual([])
	})

	test("and asking for it directly is refused, listening or not", async () => {
		const h = fresh()
		const reader = h.connect("s2", NON_ADMIN)

		await reader.fire("backups:list", {})

		expect(walked()).toBe(0)
		// The generic `{event}:error` fallback is never gated — a client
		// waiting on a request has to be told it failed.
		expect(h.emits.map((e) => e.event)).toEqual(["backups:list:error"])
	})
})
