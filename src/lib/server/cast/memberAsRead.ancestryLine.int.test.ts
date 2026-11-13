/**
 * 🚧 A branch reads the people its parent reads on the parent's line
 * (★s4-fold2-1): the parent's entry in `sessions.branch_ancestry` may name the
 * line (`lineId`) the parent read its own notes on at the fork. Missing, or
 * naming a deleted or foreign line, the notes read at their main, as before.
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
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { MAIN_HEAD } from "$lib/server/state/entriesOnReading"
import { membersAsRead } from "./memberAsRead"

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
		path.join(os.tmpdir(), "serene-pub-vitest-member-ancestry-line-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

afterEach(() => {
	vi.restoreAllMocks()
})

const db = () => testDb as unknown as Db
let n = 0
const uniq = (label: string) => `${label}-${++n}`
let order = 0

async function world() {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: uniq("mav-user") })
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: uniq("Book") })
		.returning()
	return { user: user!, book: book! }
}
type World = Awaited<ReturnType<typeof world>>

async function member(
	w: World,
	characterId: number | null,
	extra: Partial<typeof schema.lorebookBindings.$inferInsert> = {},
	lorebookId = w.book.id
) {
	const [row] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId,
			binding: uniq("{{char:x}}"),
			characterId,
			name: "",
			...extra
		})
		.returning()
	return row!
}

/** A cast version of `memberId` held in `lorebookId`. */
async function castVersion(
	memberId: number,
	lorebookId: number,
	extra: Partial<typeof schema.characterVersions.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.characterVersions)
		.values({
			castMemberId: memberId,
			lorebookId,
			nodeState: "active",
			nodeVisibility: "normal",
			writeOrder: ++order,
			...extra
		})
		.returning()
	return row!
}

async function readOne(
	memberId: number,
	opts: Parameters<typeof membersAsRead>[2]
) {
	return (await membersAsRead(db(), [memberId], opts)).get(memberId)!
}

async function scene() {
	const w = await world()
	const [parent] = await testDb
		.insert(schema.sessions)
		.values({
			userId: w.user.id,
			isGroup: false,
			name: uniq("Parent")
		} as any)
		.returning()
	const [notes] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: w.user.id,
			name: uniq("Notes"),
			sessionId: parent!.id
		})
		.returning()
	const [night] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: notes!.id, name: uniq("Night") })
		.returning()
	await testDb
		.update(schema.sessions)
		.set({ lorebookBranchId: night!.id })
		.where(eq(schema.sessions.id, parent!.id))
	const m = await member(w, null, {}, notes!.id)
	await castVersion(m.id, notes!.id, { name: "Anna" })
	await castVersion(m.id, notes!.id, {
		name: "Anna by night",
		branchId: night!.id,
		year: 5
	})
	const child = async (lineId?: number) => {
		const [row] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.user.id,
				isGroup: false,
				name: uniq("Child"),
				branchAncestry: [
					{
						sessionId: parent!.id,
						mark: 1_000_000,
						...(lineId ? { lineId } : {})
					}
				]
			} as any)
			.returning()
		return row!
	}
	return { w, parent: parent!, notes: notes!, night: night!, m, child }
}

describe("a branch reads an ancestor's own notes along the line its ancestry names", () => {
	test("an ancestry entry with no line reads the notes at their main, as it always did", async () => {
		const s = await scene()
		const c = await s.child()
		const read = await readOne(s.m.id, { sessionId: c.id })
		expect(read).toEqual(await readOne(s.m.id, { reading: MAIN_HEAD }))
		expect(read.name).toBe("Anna")
		// The parent itself reads its notes along its line.
		expect((await readOne(s.m.id, { sessionId: s.parent.id })).name).toBe(
			"Anna by night"
		)
	})

	test("an entry naming the line reads the line's version, as the parent does", async () => {
		const s = await scene()
		const c = await s.child(s.night.id)
		const read = await readOne(s.m.id, { sessionId: c.id })
		expect(read.name).toBe("Anna by night")
		expect(read).toEqual(await readOne(s.m.id, { sessionId: s.parent.id }))
	})

	test("an entry naming a deleted or foreign line reads main", async () => {
		const s = await scene()
		const main = await readOne(s.m.id, { reading: MAIN_HEAD })
		const deleted = await s.child(987_654)
		expect(await readOne(s.m.id, { sessionId: deleted.id })).toEqual(main)
		const other = await world()
		const [foreign] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: other.book.id, name: uniq("Foreign") })
			.returning()
		const foreignChild = await s.child(foreign!.id)
		expect(await readOne(s.m.id, { sessionId: foreignChild.id })).toEqual(
			main
		)
	})
})
