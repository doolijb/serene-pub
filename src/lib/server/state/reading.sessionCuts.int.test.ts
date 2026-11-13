/**
 * 🚧 `sessionCutsOf`, `overlayChainOf` and the session cuts a session's
 * reading carries (plan §32 §5b, §5d), over a real database.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { overlayChainOf, sessionCutsOf, sessionReadingOf } from "./reading"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-sessionCuts-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0
const uniq = (label: string) => `${label}-${++n}`

async function world() {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: uniq("cuts-user") })
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: uniq("Book") } as any)
		.returning()
	return { user: user!, book: book! }
}
type World = Awaited<ReturnType<typeof world>>

async function session(
	w: World,
	extra: Partial<typeof schema.sessions.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId: w.user.id,
			isGroup: false,
			name: uniq("Run"),
			lorebookId: w.book.id,
			...extra
		} as any)
		.returning()
	return row!
}

async function ownBook(w: World, sessionId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: w.user.id, name: uniq("Own"), sessionId } as any)
		.returning()
	return row!
}

async function line(
	sessionId: number,
	origin: { sessionId: number; messageId: number } | null,
	rewound = false
) {
	await testDb.insert(schema.sessionMessages).values({
		sessionId,
		role: "assistant",
		content: "x",
		originSessionId: origin?.sessionId ?? null,
		originMessageId: origin?.messageId ?? null,
		rewindOrdinal: rewound ? 1 : null
	} as any)
}

describe("sessionCutsOf", () => {
	test("a session with no ancestry has no cuts", async () => {
		const w = await world()
		const plain = await session(w)
		expect(await sessionCutsOf(db(), plain.id)).toEqual([])
		const empty = await session(w, { branchAncestry: [] })
		expect(await sessionCutsOf(db(), empty.id)).toEqual([])
		expect(await sessionCutsOf(db(), 98765432)).toEqual([])
	})

	test("through is the highest live origin per ancestor, nearest first; a rewound line is ignored; no copied lines is null", async () => {
		const w = await world()
		const root = await session(w)
		const parent = await session(w)
		const orphan = await session(w)
		const branch = await session(w, {
			branchAncestry: [
				{ sessionId: parent.id, mark: 40 },
				{ sessionId: root.id, mark: 12 },
				{ sessionId: orphan.id, mark: 3 }
			]
		})
		await line(branch.id, { sessionId: root.id, messageId: 5 })
		await line(branch.id, { sessionId: root.id, messageId: 9 })
		// Rewound by Back: not counted.
		await line(branch.id, { sessionId: root.id, messageId: 14 }, true)
		await line(branch.id, { sessionId: parent.id, messageId: 31 })
		await line(branch.id, { sessionId: parent.id, messageId: 27 })
		// A line played here, and another session's copy, count for nothing.
		await line(branch.id, null)
		await line(parent.id, { sessionId: root.id, messageId: 99 })

		expect(await sessionCutsOf(db(), branch.id)).toEqual([
			{ sessionId: parent.id, through: 31, mark: 40 },
			{ sessionId: root.id, through: 9, mark: 12 },
			{ sessionId: orphan.id, through: null, mark: 3 }
		])
	})
})

describe("sessionReadingOf carries the cuts", () => {
	test("a branch's reading has its session cuts; a session with no ancestry has no sessionCuts key", async () => {
		const w = await world()
		const root = await session(w)
		const plain = await session(w)
		const branch = await session(w, {
			branchAncestry: [{ sessionId: root.id, mark: 7 }]
		})
		await line(branch.id, { sessionId: root.id, messageId: 4 })

		const read = await sessionReadingOf(db(), branch.id)
		expect(read?.line.sessionCuts).toEqual([
			{ sessionId: root.id, through: 4, mark: 7 }
		])

		const plainRead = await sessionReadingOf(db(), plain.id)
		expect(plainRead).not.toBeNull()
		expect("sessionCuts" in plainRead!.line).toBe(false)
	})
})

describe("overlayChainOf", () => {
	test("the session's own book, then each ancestor's in ancestry order; a session with no own book is skipped", async () => {
		const w = await world()
		const root = await session(w)
		const parent = await session(w)
		const bare = await session(w)
		const branch = await session(w, {
			branchAncestry: [
				{ sessionId: parent.id, mark: 2 },
				{ sessionId: bare.id, mark: 1 },
				{ sessionId: root.id, mark: 1 }
			]
		})
		// Created out of order, so the chain order is the ancestry's.
		const rootBook = await ownBook(w, root.id)
		const branchBook = await ownBook(w, branch.id)
		const parentBook = await ownBook(w, parent.id)

		expect(await overlayChainOf(db(), branch.id)).toEqual([
			branchBook.id,
			parentBook.id,
			rootBook.id
		])
		// No own book of its own: starts with the nearest ancestor's.
		const lone = await session(w, {
			branchAncestry: [{ sessionId: parent.id, mark: 2 }]
		})
		expect(await overlayChainOf(db(), lone.id)).toEqual([parentBook.id])
		expect(await overlayChainOf(db(), bare.id)).toEqual([])
		expect(await overlayChainOf(db(), 98765432)).toEqual([])
	})
})
