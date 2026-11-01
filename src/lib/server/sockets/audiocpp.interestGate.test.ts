/**
 * audio.cpp, run by Serene Pub through the REAL interest gate.
 *
 * `audiocpp:` is a restricted interest prefix. The server answers a
 * non-admin's `interest:sync` by DROPPING every restricted key (quietly, with a
 * warning — a sync has no reply) so the key is never remembered and no push for
 * it can be delivered to that socket. An admin's keys are held.
 *
 * Driven through the real `connectSockets`, the real `register` and the real
 * `interest:sync` handler; the gate is never stubbed. `$lib/server/db` is a
 * recording fake (harness shared with koboldcppOllama.interestGate.test.ts).
 *
 * ⚠ Harness gotcha: mocking `$lib/server/db` while importing `sockets/index`
 * needs `getCryptoSecretKey`, `schema` and `dbReady` in the factory —
 * `auth/tokens` derives its secret at import time and `connectSockets` reaches
 * auth.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const seam = vi.hoisted(() => {
	function chain(result: any = []) {
		const self: any = {
			from: () => self,
			innerJoin: () => self,
			leftJoin: () => self,
			where: () => self,
			limit: () => self,
			orderBy: () => self,
			groupBy: () => self,
			set: () => self,
			values: () => self,
			onConflictDoNothing: () => self,
			onConflictDoUpdate: () => self,
			returning: () => self,
			then: (ok: any, err: any) => Promise.resolve(result).then(ok, err)
		}
		return self
	}
	const table = (first: () => any) => ({
		findFirst: async () => first(),
		findMany: async () => []
	})
	const db: any = {
		query: {
			systemSettings: table(() => ({ id: 1 })),
			ollamaSettings: table(() => ({})),
			koboldCppSettings: table(() => ({})),
			localModels: table(() => undefined),
			connections: table(() => undefined),
			users: table(() => ({ id: 1, username: "owner", isAdmin: true })),
			userSettings: table(() => ({ userId: 1 }))
		},
		select: () => chain(),
		update: () => chain(),
		insert: () => chain(),
		delete: () => chain()
	}
	return { db }
})

vi.mock("$lib/server/db", async () => {
	const schema = await import("$lib/server/db/schema")
	return {
		db: seam.db,
		schema,
		dbReady: Promise.resolve(),
		getCryptoSecretKey: () => "audiocpp-interest-gate-secret",
		closeDatabase: async () => {},
		reopenDatabase: async () => {}
	}
})

vi.mock("$lib/server/embedding", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/embedding")>()
	return { ...actual, isLocalEmbeddingSupported: async () => false }
})

vi.mock("$lib/server/auth/totp/service", () => ({
	getTotpState: async () => ({ enabled: false, recoveryCodesRemaining: 0 }),
	confirmEnrollment: async () => ({ recoveryCodes: [] }),
	beginEnrollment: async () => ({ secret: "s", otpauthUri: "otpauth://x" }),
	verifyForSession: async () => ({ ok: true }),
	regenerateRecoveryCodes: async () => [],
	clearTotp: async () => {},
	isMfaEnabled: async () => false,
	isMfaPending: async () => false
}))

vi.mock("$lib/server/pipelines/entities/sessionGenres", () => ({
	listSessionGenres: async () => [],
	STANDARD_GENRE_ID: "core:genre/story"
}))

import { connectSockets } from "./index"
import { interestedSockets } from "./interest"
import * as binary from "$lib/server/audiocpp/binary"
import * as packages from "$lib/server/audiocpp/packages"
import { isRestrictedInterest, GATED_EVENTS } from "$lib/shared/sockets/interest"

const ADMIN = { id: 1, username: "owner", isAdmin: true }
const MEMBER = { id: 2, username: "guest", isAdmin: false }

const PUSHES = [
	"audiocpp:subprocessStatus",
	"audiocpp:packageDownloadProgress",
	"audiocpp:binaryDownloadProgress"
]
const KEYS = [...PUSHES, "audiocpp:getStatus"]

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

	function connect(id: string, user: { id: number; username: string; isAdmin: boolean }) {
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
					(listeners.get("interest:sync") ?? []).map((cb) => cb({ keys }))
				)
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
	vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
	harnesses.splice(0).forEach((h) => h.teardown())
	vi.restoreAllMocks()
})

describe("the shared tables", () => {
	test("every audiocpp key is restricted and gated", () => {
		for (const k of KEYS) {
			expect(isRestrictedInterest(k), k).toBe(true)
			expect(GATED_EVENTS.has(k as any), k).toBe(true)
		}
	})
})

describe("interest:sync through the real gate", () => {
	test("a member's audiocpp keys are dropped: nothing is held, with a warning", async () => {
		const h = fresh()
		const member = h.connect("m1", MEMBER)
		await member.declare(...KEYS, "connections:list")

		for (const k of KEYS)
			expect(interestedSockets(h.io, 2, k), k).toHaveLength(0)
		// The ordinary key beside them is kept, so the drop is the prefix's doing.
		expect(interestedSockets(h.io, 2, "connections:list")).toHaveLength(1)

		const warned = (console.warn as any).mock.calls.map((c: any[]) => c.join(" "))
		expect(
			warned.some(
				(w: string) =>
					w.includes("dropped restricted interest keys") &&
					w.includes("audiocpp:subprocessStatus")
			)
		).toBe(true)
	})

	test("an admin's audiocpp keys are held", async () => {
		const h = fresh()
		const admin = h.connect("a1", ADMIN)
		await admin.declare(...KEYS)

		for (const k of KEYS)
			expect(interestedSockets(h.io, 1, k).map((s) => s.id), k).toEqual(["a1"])
	})

	test("a member re-declaring after an admin elsewhere holds still nothing", async () => {
		const h = fresh()
		const admin = h.connect("a1", ADMIN)
		const member = h.connect("m1", MEMBER)
		await admin.declare(...PUSHES)
		await member.declare(...PUSHES)

		for (const k of PUSHES) {
			expect(interestedSockets(h.io, 2, k), k).toHaveLength(0)
			expect(interestedSockets(h.io, 1, k).map((s) => s.id), k).toEqual(["a1"])
		}
	})
})

describe("pushes", () => {
	test("an admin's download progress lands on the admin's socket only; a member binds no emitter", async () => {
		const binReg = vi.spyOn(binary.binaryDownloadEmitters, "register")
		const pkgReg = vi.spyOn(packages.packageDownloadEmitters, "register")
		const h = fresh()
		const member = h.connect("m1", MEMBER)
		await member.declare(...PUSHES)
		// Nothing bound for a member's connection.
		expect(binReg).not.toHaveBeenCalled()
		expect(pkgReg).not.toHaveBeenCalled()

		const admin = h.connect("a1", ADMIN)
		await admin.declare(...PUSHES)
		expect(binReg).toHaveBeenCalledTimes(1)
		expect(pkgReg).toHaveBeenCalledTimes(1)

		binReg.mock.calls[0][1]({ progress: 1 } as any)
		pkgReg.mock.calls[0][1]({ progress: 2 } as any)

		const got = h.emits.filter((e) => e.event.startsWith("audiocpp:"))
		expect(got.map((e) => [e.target, e.event])).toEqual([
			["a1", "audiocpp:binaryDownloadProgress"],
			["a1", "audiocpp:packageDownloadProgress"]
		])
		expect(h.emits.some((e) => e.target === "m1" && e.event.startsWith("audiocpp:"))).toBe(false)
	})

	test("a member's request is refused on :error and no push event is emitted", async () => {
		const h = fresh()
		const member = h.connect("m1", MEMBER)
		await member.declare("audiocpp:getStatus")
		await member.fire("audiocpp:getStatus", {}).catch(() => {})

		const mine = h.emits.filter((e) => e.event.startsWith("audiocpp:"))
		expect(mine.every((e) => e.event === "audiocpp:getStatus:error")).toBe(true)
	})
})
