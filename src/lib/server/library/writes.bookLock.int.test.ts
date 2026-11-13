/**
 * 🚧 The library's attach-lorebook op is removed (★B-4, owner 2026-11-08): a
 * session keeps the lorebook it started with (★B-5). A stored row or a pending
 * proposal that names it is refused in the SDK's sentence; Back and Forward of
 * a stored row leave the book and do not throw; its ledger line still reads.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { removedNodeDefinitionSentence } from "@serene-pub/sdk"
import { ledgerLines } from "$lib/shared/state/ledgerLines"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {},
	autoEnqueueCharacter: async () => {}
}))

const db = () => testDb as unknown as Db

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-library-booklock-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
async function world(startsWith: "own" | "first") {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `library-booklock-${++n}`)
	const [first] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `First ${n}` })
		.returning()
	const [second] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Second ${n}` })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${n}`,
			lorebookId: startsWith === "first" ? first!.id : null
		})
		.returning()
	const person = { userId: user.id, isAdmin: false, via: "press" } as any
	return { user, first: first!, second: second!, session: session!, person }
}
const bookOf = async (sessionId: number) =>
	(
		await testDb
			.select({ b: schema.sessions.lorebookId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!.b
const rowOf = (
	w: Awaited<ReturnType<typeof world>>,
	lorebookId: number,
	before: number | null
) =>
	({
		payload: {
			kind: "library",
			op: "attach-lorebook",
			input: { lorebookId, sessionId: w.session.id },
			by: w.user.id,
			label: "x",
			result: { lorebookId, sessionId: w.session.id },
			before: { lorebookId: before }
		}
	}) as any

const SENTENCE = removedNodeDefinitionSentence("core:outlet/attach-lorebook")!
const OP = "attach-lorebook" as never

describe("the removed attach-lorebook op", () => {
	test("applying and describing it are refused with the SDK sentence; the book stays", async () => {
		const {
			applyLibraryChange,
			describeLibraryChange,
			LibraryWriteRefusal
		} = await import("./writes")
		for (const startsWith of ["own", "first"] as const) {
			const w = await world(startsWith)
			const input = { lorebookId: w.second.id, sessionId: w.session.id }
			const before = await bookOf(w.session.id)
			const err = await applyLibraryChange(
				db(),
				w.person,
				OP,
				input
			).catch((e) => e)
			expect(err).toBeInstanceOf(LibraryWriteRefusal)
			expect(err.message).toBe(SENTENCE)
			await expect(
				describeLibraryChange(db(), w.person, OP, input)
			).rejects.toThrow(SENTENCE)
			expect(await bookOf(w.session.id)).toBe(before)
		}
	})

	test("an op nobody ever had is refused in plain words", async () => {
		const { applyLibraryChange } = await import("./writes")
		const w = await world("first")
		await expect(
			applyLibraryChange(db(), w.person, "nonsense" as never, {})
		).rejects.toThrow("That library change is not known.")
	})

	test("Back and Forward of a stored applied row leave the book and do not throw", async () => {
		const { undoLibraryChange, redoLibraryChange } = await import(
			"./writes"
		)
		const a = await world("first")
		await expect(
			undoLibraryChange(db(), rowOf(a, a.first.id, null))
		).resolves.toBeUndefined()
		expect(await bookOf(a.session.id)).toBe(a.first.id)
		await expect(
			redoLibraryChange(db(), rowOf(a, a.second.id, a.first.id))
		).resolves.toBeUndefined()
		expect(await bookOf(a.session.id)).toBe(a.first.id)
	})

	test("a stored row's ledger line still reads", () => {
		const [line] = ledgerLines([
			{
				id: 1,
				kind: "library",
				messageId: 10,
				ownerKey: "world",
				ownerLabel: "Library",
				updatedBy: "run",
				library: { op: "attach-lorebook", label: "Saltmarsh" }
			} as never
		])
		expect(line!.text).toBe("Read Saltmarsh into this session")
	})
})
