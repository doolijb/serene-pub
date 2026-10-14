/**
 * `sessions:attendance` (W10) — who of a session's people has it open now.
 *
 * Pinned here, through the real interest handler rather than a stand-in:
 *
 *   1. **The signal.** A socket syncing `sessions:attendance#<id>` is that
 *      person opening the session; its disconnect (or a sync without the key)
 *      is them leaving — and the leaver's last-seen time is the moment they
 *      went, while everyone here reads the frame's own time.
 *   2. **Who is told.** The session's people holding the key, per socket — a
 *      tab on another session is not sent this one's attendance.
 *   3. **A burst is one push**, and a sync that keeps the same keys is none.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-session-attendance-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { installAttendance } = await import("./attendance")
	installAttendance()
}, 60_000)

afterAll(async () => {
	const { __resetAttendanceForTests } = await import("./attendance")
	const { observeInterestChanges } = await import(
		"$lib/server/sockets/interest"
	)
	__resetAttendanceForTests()
	observeInterestChanges("attendance", null)
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string, displayName?: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, username)
	if (displayName) {
		const { eq } = await import("drizzle-orm")
		await testDb
			.update(schema.users)
			.set({ displayName })
			.where(eq(schema.users.id, user.id))
	}
	return user
}

async function makeSession(userId: number, guestIds: number[] = []) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: "The Taproom" })
		.returning()
	for (const guestId of guestIds)
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session.id, userId: guestId })
	return session
}

type FakeSocket = {
	id: string
	user: { id: number; isAdmin: boolean }
	interest: Set<string>
	io: any
	listeners: Map<string, () => void>
	on: (event: string, fn: () => void) => void
}

/** The half of a Socket.IO server the gate, the walk and the emit read. */
function fakeIo() {
	const sockets = new Map<string, FakeSocket>()
	const emitted: Array<{ to: string; event: string; payload: any }> = []
	const io: any = {
		sockets: {
			adapter: {
				rooms: {
					get: (room: string) =>
						new Set(
							[...sockets.values()]
								.filter((s) => `user_${s.user.id}` === room)
								.map((s) => s.id)
						)
				}
			},
			sockets: {
				get: (id: string) => sockets.get(id),
				values: () => sockets.values()
			}
		},
		to: (to: string) => ({
			emit: (event: string, payload: any) =>
				emitted.push({ to, event, payload })
		})
	}
	/** A tab connecting: in the registry, with the real interest handlers on it. */
	async function connect(id: string, userId: number): Promise<FakeSocket> {
		const { registerInterestHandlers } = await import(
			"$lib/server/sockets/interest"
		)
		const socket: FakeSocket = {
			id,
			user: { id: userId, isAdmin: false },
			interest: new Set(),
			io,
			listeners: new Map(),
			on(event, fn) {
				this.listeners.set(event, fn)
			}
		}
		sockets.set(id, socket)
		registerInterestHandlers(
			socket,
			() => {},
			() => {}
		)
		return socket
	}
	/** A tab closing, in Socket.IO's order: out of the registry, then `disconnect`. */
	function disconnect(socket: FakeSocket) {
		sockets.delete(socket.id)
		socket.listeners.get("disconnect")?.()
	}
	return { io, emitted, connect, disconnect }
}

async function sync(socket: FakeSocket, keys: string[]) {
	const { interestSync } = await import("$lib/server/sockets/interest")
	await interestSync.handler(socket as any, { keys }, () => {})
}

/** Long enough for the trailing debounce plus the reads behind it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 700))

const pushesTo = (
	emitted: Array<{ to: string; event: string; payload: any }>,
	socketId: string
) =>
	emitted
		.filter((e) => e.to === socketId && e.event === "sessions:attendance")
		.map((e) => e.payload)

describe("sessions:attendance (PGlite integration)", () => {
	test("opening the session is being here; leaving is being away since then", async () => {
		const mira = await makeUser("attendance-mira", "Mira")
		const marco = await makeUser("attendance-marco")
		const session = await makeSession(mira.id, [marco.id])
		const key = `sessions:attendance#${session.id}`
		const { io, emitted, connect, disconnect } = fakeIo()

		const miraTab = await connect("mira-tab", mira.id)
		const before = Date.now()
		await sync(miraTab, ["sessions:get#" + session.id, key])
		await settle()
		const first = pushesTo(emitted, "mira-tab").at(-1)
		expect(first).toMatchObject({
			sessionId: session.id,
			people: [
				{ userId: mira.id, name: "Mira", role: "owner", here: true },
				{
					userId: marco.id,
					name: "attendance-marco",
					role: "guest",
					here: false,
					lastSeenAt: null
				}
			]
		})
		expect(first.people[0].lastSeenAt).toBeGreaterThanOrEqual(before)

		const marcoTab = await connect("marco-tab", marco.id)
		await sync(marcoTab, [key])
		await settle()
		for (const tab of ["mira-tab", "marco-tab"])
			expect(
				pushesTo(emitted, tab)
					.at(-1)
					.people.map((p: any) => p.here)
			).toEqual([true, true])

		const leftAt = Date.now()
		disconnect(marcoTab)
		await settle()
		const after = pushesTo(emitted, "mira-tab").at(-1)
		expect(after.people[1]).toMatchObject({ userId: marco.id, here: false })
		expect(after.people[1].lastSeenAt).toBeGreaterThanOrEqual(leftAt - 5)
		expect(after.people[1].lastSeenAt).toBeLessThanOrEqual(Date.now())
		// Nothing was sent to the tab that is gone.
		expect(pushesTo(emitted, "marco-tab")).toHaveLength(1)
		void io
	})

	test("a tab on another session is not told, and dropping the key is leaving", async () => {
		const ana = await makeUser("attendance-ana", "Ana")
		const zed = await makeUser("attendance-zed", "Zed")
		const here = await makeSession(ana.id, [zed.id])
		const elsewhere = await makeSession(zed.id)
		const { emitted, connect } = fakeIo()

		const anaTab = await connect("ana-tab", ana.id)
		const zedTab = await connect("zed-tab", zed.id)
		await sync(zedTab, [`sessions:attendance#${elsewhere.id}`])
		await sync(anaTab, [`sessions:attendance#${here.id}`])
		await settle()
		expect(
			pushesTo(emitted, "zed-tab").filter((p) => p.sessionId === here.id)
		).toEqual([])
		expect(
			pushesTo(emitted, "ana-tab")
				.at(-1)
				.people.map((p: any) => [p.name, p.here])
		).toEqual([
			["Ana", true],
			["Zed", false]
		])

		// Zed opens Ana's session in the same tab — a navigation: one sync.
		await sync(zedTab, [`sessions:attendance#${here.id}`])
		await settle()
		expect(
			pushesTo(emitted, "ana-tab")
				.at(-1)
				.people.map((p: any) => p.here)
		).toEqual([true, true])
		// …and away again.
		await sync(zedTab, [])
		await settle()
		const last = pushesTo(emitted, "ana-tab").at(-1)
		expect(last.people[1]).toMatchObject({ name: "Zed", here: false })
		expect(typeof last.people[1].lastSeenAt).toBe("number")
	})

	test("a burst is one push, and a sync that keeps the same keys is none", async () => {
		const kit = await makeUser("attendance-kit", "Kit")
		const session = await makeSession(kit.id)
		const key = `sessions:attendance#${session.id}`
		const { emitted, connect } = fakeIo()
		const tab = await connect("kit-tab", kit.id)
		const second = await connect("kit-tab-2", kit.id)

		await sync(tab, [key])
		await sync(second, [key])
		await settle()
		expect(pushesTo(emitted, "kit-tab")).toHaveLength(1)

		// The periodic re-sync: the same keys — nobody came or went.
		await sync(tab, [key, "sessions:get#" + session.id])
		await settle()
		expect(pushesTo(emitted, "kit-tab")).toHaveLength(1)
	})

	test("sessionsHeldOpen reads only attendance keys with a session id", async () => {
		const { sessionsHeldOpen } = await import("./attendance")
		expect([
			...sessionsHeldOpen([
				"sessions:attendance#4",
				"sessions:attendance",
				"sessions:attendance#x",
				"sessions:get#5",
				"sessions:attendance#12"
			])
		]).toEqual([4, 12])
	})
})
