/**
 * A lorebook refusal reaches the person who acted, as its sentence (A24).
 *
 * Driven through the real `connectSockets` and every real registration, so
 * what is asserted is what a tab receives: one user with two tabs open, the
 * first tab asks for something the server refuses, and
 *
 * - the first tab gets `<event>:error` carrying the handler's own sentence —
 *   never the socket's generic "An error occurred while processing your
 *   request.", which is what every family below answered with;
 * - the second tab gets nothing, so its Layout has nothing to toast and no
 *   wait of its own settles on another tab's refusal.
 *
 * One case per family, each a refusal a person can meet from the UI.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		db,
		dbReady: Promise.resolve(),
		getCryptoSecretKey: () => "refusals-test-secret"
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-refusals-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const logged = vi.spyOn(console, "error").mockImplementation(() => {})

/** A Socket.IO server with one user's tabs connected to it, emits recorded. */
async function twoTabs(user: { id: number; username: string }) {
	const { connectSockets } = await import("./index")
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

	const connect = (id: string) => {
		const listeners = new Map<string, Array<(msg?: any) => any>>()
		const socket: any = {
			id,
			user: { ...user, isAdmin: false },
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
		return {
			fire: (event: string, msg?: any) =>
				Promise.all((listeners.get(event) ?? []).map((cb) => cb(msg))),
			close: () => {
				for (const cb of listeners.get("disconnect") ?? []) void cb()
				registry.delete(id)
				rooms.get(`user_${user.id}`)?.delete(id)
			}
		}
	}

	const acting = connect("tab-acting")
	const other = connect("tab-other")
	open.push(acting.close, other.close)
	return {
		/** Every `<event>:error` the server sent while tab one asked. */
		async refusalsOf(event: string, params: unknown) {
			await acting.fire(event, params)
			return emits.filter((e) => e.event === `${event}:error`)
		}
	}
}

/** Several modules hook singletons per socket and release them on disconnect. */
const open: Array<() => void> = []
afterEach(() => {
	open.splice(0).forEach((close) => close())
	logged.mockClear()
})

/** What tab one, and only tab one, should have received. */
const toActingTab = (event: string, sentence: string) => [
	{ target: "tab-acting", event: `${event}:error`, data: { error: sentence } }
]

let seq = 0
async function makeUser() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `refusals-${++seq}`)
}

async function makeBook(userId: number) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Refusals ${++seq}`, userId })
		.returning()
	return book!
}

describe("a refusal reaches the tab that acted, as its sentence", () => {
	test("amendments: deleting an amendment the book does not hold", async () => {
		const user = await makeUser()
		const book = await makeBook(user.id)
		const tabs = await twoTabs(user)
		expect(
			await tabs.refusalsOf("amendments:delete", {
				lorebookId: book.id,
				subject: "entry",
				id: 987_654
			})
		).toEqual(
			toActingTab(
				"amendments:delete",
				"That amendment is not in this lorebook."
			)
		)
	})

	test("amendments: renaming a line to main", async () => {
		const user = await makeUser()
		const book = await makeBook(user.id)
		const [line] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: book.id, name: "Dark timeline" })
			.returning()
		const tabs = await twoTabs(user)
		expect(
			await tabs.refusalsOf("amendments:renameBranch", {
				lorebookId: book.id,
				id: line!.id,
				name: "main"
			})
		).toEqual(
			toActingTab(
				"amendments:renameBranch",
				"main is the line every book already has; a fork needs its own name."
			)
		)
	})

	test("story time: reading another person's book", async () => {
		const owner = await makeUser()
		const book = await makeBook(owner.id)
		const stranger = await makeUser()
		const tabs = await twoTabs(stranger)
		expect(
			await tabs.refusalsOf("lorebooks:storyTime", {
				lorebookId: book.id
			})
		).toEqual(
			toActingTab(
				"lorebooks:storyTime",
				"Lorebook not found."
			)
		)
	})

	test("story time: a calendar that is not one", async () => {
		const user = await makeUser()
		const book = await makeBook(user.id)
		const calendar = { months: [] }
		const { storyCalendarProblems } = await import("@serene-pub/sdk")
		const tabs = await twoTabs(user)
		expect(
			await tabs.refusalsOf("lorebooks:setCalendar", {
				lorebookId: book.id,
				calendar
			})
		).toEqual(
			toActingTab(
				"lorebooks:setCalendar",
				storyCalendarProblems(calendar).join(" ")
			)
		)
	})

	test("graph: a place linked to itself", async () => {
		const user = await makeUser()
		const book = await makeBook(user.id)
		const { entryInsert, WORLD_LORE_TYPE_ID } = await import(
			"$lib/server/utils/lorebookEntries"
		)
		const [hall] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				entryInsert({
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: book.id,
					name: "The Hall",
					content: "Stone.",
					position: 0
				})
			)
			.returning()
		const end = { kind: "entry", entryId: hall!.id }
		const tabs = await twoTabs(user)
		expect(
			await tabs.refusalsOf("narrativeGraph:createRelationship", {
				lorebookId: book.id,
				from: end,
				to: end,
				relationshipType: "leads to",
				status: "active",
				branchId: null
			})
		).toEqual(
			toActingTab(
				"narrativeGraph:createRelationship",
				"Nothing can be linked to itself."
			)
		)
	})

	test("graph: building with nothing set to write it", async () => {
		const user = await makeUser()
		const book = await makeBook(user.id)
		const { entryInsert, HISTORY_TYPE_ID } = await import(
			"$lib/server/utils/lorebookEntries"
		)
		await testDb.insert(schema.lorebookEntries).values(
			entryInsert({
				typeId: HISTORY_TYPE_ID,
				lorebookId: book.id,
				name: "The siege",
				content: "Aria held the gate.",
				position: 0
			})
		)
		const { resolveCapabilityTarget, TEXT_CAPABILITY } = await import(
			"$lib/server/connections/capabilityTarget"
		)
		const target = await resolveCapabilityTarget(testDb as any, {
			capability: TEXT_CAPABILITY
		})
		expect(target.ok).toBe(false)
		const tabs = await twoTabs(user)
		expect(
			await tabs.refusalsOf("narrativeGraph:build", {
				lorebookId: book.id,
				mode: "replace"
			})
		).toEqual([
			{
				target: "tab-acting",
				event: "narrativeGraph:build:error",
				data: {
					lorebookId: book.id,
					error: (target as { problem: { message: string } }).problem
						.message
				}
			}
		])
		// Refused before a build began, so nothing is left building.
		const { activityStore } = await import(
			"$lib/server/utils/activityStore"
		)
		expect(
			activityStore
				.getFor(user.id, false)
				.filter((a: any) => a.lorebookId === book.id)
		).toEqual([])
	})

	test("graph: a link that is not in the book", async () => {
		const user = await makeUser()
		const tabs = await twoTabs(user)
		expect(
			await tabs.refusalsOf("narrativeGraph:updateRelationship", {
				relationship: { id: 987_654, description: "Old friends." }
			})
		).toEqual(
			toActingTab(
				"narrativeGraph:updateRelationship",
				"That link is not in this lorebook."
			)
		)
	})

	test("lorebooks: a cast member that is not there", async () => {
		const user = await makeUser()
		const tabs = await twoTabs(user)
		expect(
			await tabs.refusalsOf("lorebooks:updateBinding", {
				lorebookBinding: { id: 987_654, name: "Aria" }
			})
		).toEqual(
			toActingTab(
				"lorebooks:updateBinding",
				"That cast member is not in this lorebook."
			)
		)
	})

	test("entries: the session's lore, refused, names the ask it answers", async () => {
		const user = await makeUser()
		const book = await makeBook(user.id)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				isGroup: false,
				userId: user.id,
				lorebookId: book.id
			} as any)
			.returning()
		const tabs = await twoTabs(user)
		const refusals = await tabs.refusalsOf("entries:sessionEntries", {
			sessionId: session!.id,
			request: "widget-entries:x:1",
			query: 5
		})
		expect(refusals).toEqual([
			{
				target: "tab-acting",
				event: "entries:sessionEntries:error",
				data: {
					sessionId: session!.id,
					request: "widget-entries:x:1",
					error: "The session's lore could not be read."
				}
			}
		])
	})

	test("lorebooks: another person's cast", async () => {
		const owner = await makeUser()
		const book = await makeBook(owner.id)
		const stranger = await makeUser()
		const tabs = await twoTabs(stranger)
		expect(
			await tabs.refusalsOf("lorebooks:bindingList", {
				lorebookId: book.id
			})
		).toEqual(toActingTab("lorebooks:bindingList", "Lorebook not found."))
		expect(
			await tabs.refusalsOf("lorebooks:resolveOrCreateBindingByName", {
				lorebookId: book.id,
				name: "Aria"
			})
		).toEqual(
			toActingTab(
				"lorebooks:resolveOrCreateBindingByName",
				"Lorebook not found."
			)
		)
	})

	test("lorebooks: a create the database refuses says so plainly", async () => {
		const user = await makeUser()
		const tabs = await twoTabs(user)
		expect(
			await tabs.refusalsOf("lorebooks:create", { name: null })
		).toEqual(
			toActingTab(
				"lorebooks:create",
				"The lorebook could not be created."
			)
		)
	})

	test("entries: deleting an entry that is not there", async () => {
		const user = await makeUser()
		const { WORLD_LORE_TYPE_ID } = await import("$lib/shared/entries/types")
		const tabs = await twoTabs(user)
		expect(
			await tabs.refusalsOf("entries:delete", {
				id: 987_654,
				typeId: WORLD_LORE_TYPE_ID
			})
		).toEqual(
			toActingTab("entries:delete", "Entry not found or access denied.")
		)
	})

	test("scenes: deleting a scene that is not there", async () => {
		const user = await makeUser()
		const tabs = await twoTabs(user)
		expect(await tabs.refusalsOf("scenes:delete", { id: 987_654 })).toEqual(
			toActingTab("scenes:delete", "Scene not found.")
		)
	})

	test("sessions: a story clock the book cannot place", async () => {
		const user = await makeUser()
		const book = await makeBook(user.id)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				isGroup: false,
				userId: user.id,
				lorebookId: book.id
			} as any)
			.returning()
		const { clockProblem } = await import("$lib/server/state/storyTime")
		const clock = { year: 1, month: 0, day: null, hour: null, minute: null }
		const problem = clockProblem(clock as any, null)
		expect(problem).toBeTruthy()
		const tabs = await twoTabs(user)
		expect(
			await tabs.refusalsOf("sessions:update", {
				session: {
					id: session!.id,
					storyClockYear: 1,
					storyClockMonth: 0,
					storyClockDay: null,
					storyClockHour: null,
					storyClockMinute: null
				}
			})
		).toEqual(
			toActingTab(
				"sessions:update",
				`That clock does not fit this lorebook. ${problem}`
			)
		)
	})
})
