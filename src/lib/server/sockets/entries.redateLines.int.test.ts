/**
 * Re-dating a history entry never takes it away from a line whose rows use it
 * (plan A8, review fix-up).
 *
 * A line's scenes are filed under history entries it reads, and its links and
 * stats are dated by them (`scenes:create`, `assertLinkDate`, `writeDatingAt`).
 * An entry of an ancestor line reads on a fork only up to the fork's date, so
 * moving the entry past that date would leave the fork's rows under a moment
 * the fork never had — and deleting the ancestor would then take them along,
 * since `keepHistoryForForks` hands a fork only the entries it reads. So
 * `entries:update` refuses that move and allows every other.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})
vi.mock("./utils/broadcastHelpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("./utils/broadcastHelpers")>()),
	broadcastToSessionUsers: vi.fn(async () => {})
}))
vi.mock("$lib/server/sessions/rowPush", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/sessions/rowPush")>()),
	broadcastSessionRow: vi.fn(() => {})
}))
vi.mock("$lib/server/pipelines/runtime/sessionEvents", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/pipelines/runtime/sessionEvents")>()),
	emitSessionEvent: vi.fn(async () => {})
}))

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-redate-lines-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const asUser = (id: number) => ({ user: { id }, io: { tag: "io" } }) as any
const noop = () => {}

let seq = 0
async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `redate-lines-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Redate ${seq}`, userId: user.id })
		.returning()
	const am = await import("./amendments")
	let position = 0

	/** Fork a line through the handler and answer its id. */
	const fork = async (name: string, from: number | null, forkYear: number | null) =>
		(
			await am.amendmentsForkHandler.handler(
				asUser(user.id),
				{ lorebookId: lorebook!.id, name, forkedFromBranchId: from, forkYear },
				noop
			)
		).branches.find((b) => b.name === name)!.id

	const history = async (year: number, branchId: number | null = null) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: lorebook!.id,
					typeId: HISTORY_TYPE_ID,
					typeVersion: 1,
					title: `Year ${year}`,
					content: "",
					keys: [],
					position: ++position,
					fields: { year },
					branchId
				} as any)
				.returning()
		)[0]!

	const sessionOn = async (branchId: number | null) =>
		(
			await testDb
				.insert(schema.sessions)
				.values({ userId: user.id, isGroup: false, lorebookId: lorebook!.id, lorebookBranchId: branchId })
				.returning()
		)[0]!

	/** A scene saved from a session on `branchId`, under `historyEntryId`. */
	const scene = async (historyEntryId: number, branchId: number | null) => {
		const { sceneCreateHandler } = await import("./scenes")
		const session = await sessionOn(branchId)
		return (
			await sceneCreateHandler.handler(
				asUser(user.id),
				{
					scene: { lorebookId: lorebook!.id, sessionId: session.id, historyEntryId, summary: "What happened." }
				} as any,
				noop
			)
		).scene
	}

	const redate = async (id: number, year: number) => {
		const { updateEntryHandler } = await import("./entries")
		return updateEntryHandler.handler(
			asUser(user.id),
			{ entry: { id, typeId: HISTORY_TYPE_ID, year } } as any,
			noop
		)
	}

	const yearOf = async (id: number) =>
		((
			await testDb
				.select({ fields: schema.lorebookEntries.fields })
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, id))
		)[0]!.fields as { year: number }).year

	const deleteLine = async (id: number) =>
		am.amendmentsDeleteBranchHandler.handler(asUser(user.id), { lorebookId: lorebook!.id, id }, noop)

	return { user, lorebook: lorebook!, fork, history, sessionOn, scene, redate, yearOf, deleteLine }
}

describe("re-dating a history entry a fork's rows use", () => {
	test("past the fork's date is refused, and the fork's scene then survives its parent's delete", async () => {
		const b = await makeBook()
		// main ─(now)─ B ─Y5─ C
		const parent = await b.fork("B", null, null)
		const c = await b.fork("C", parent, 5)
		const y3 = await b.history(3, parent)
		const onC = await b.scene(y3.id, c)

		await expect(b.redate(y3.id, 7)).rejects.toThrow(
			"C has scenes, links, stats or amendments tied to this history entry, but C reads B only up to Year 5, so the entry cannot move past Year 5."
		)
		expect(await b.yearOf(y3.id)).toBe(3)

		await b.deleteLine(parent)
		const kept = await testDb
			.select({ id: schema.scenes.id, historyEntryId: schema.scenes.historyEntryId })
			.from(schema.scenes)
			.where(eq(schema.scenes.id, onC.id))
		expect(kept).toEqual([{ id: onC.id, historyEntryId: y3.id }])
	}, 60_000)

	test("up to the fork's date, earlier, or with nothing on the fork using it, the move is allowed", async () => {
		const b = await makeBook()
		const parent = await b.fork("B", null, null)
		const c = await b.fork("C", parent, 5)
		const used = await b.history(3, parent)
		const unused = await b.history(2, parent)
		await b.scene(used.id, c)

		await b.redate(used.id, 5)
		expect(await b.yearOf(used.id)).toBe(5)
		await b.redate(used.id, 1)
		expect(await b.yearOf(used.id)).toBe(1)
		// Nothing on C is dated by it: C loses nothing it wrote.
		await b.redate(unused.id, 9)
		expect(await b.yearOf(unused.id)).toBe(9)
	}, 60_000)

	test("a link or a stat on the fork, dated by the entry, holds it the same way", async () => {
		const b = await makeBook()
		const c = await b.fork("C", null, 4)
		const linked = await b.history(2)
		const statted = await b.history(3)
		const lore = async (title: string, position: number) =>
			(
				await testDb
					.insert(schema.lorebookEntries)
					.values({
						lorebookId: b.lorebook.id,
						typeId: WORLD_LORE_TYPE_ID,
						typeVersion: 1,
						title,
						content: "",
						keys: [],
						position
					} as any)
					.returning()
			)[0]!
		const hall = await lore("The Hall", 1)
		const cellar = await lore("The Cellar", 2)
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: b.lorebook.id,
			branchId: c,
			fromEntryId: hall.id,
			toEntryId: cellar.id,
			relationshipType: "above",
			historyEntryId: linked.id
		})
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "lorebook",
			ownerId: b.lorebook.id,
			slotId: "test:slot/weather@1",
			value: { v: "storm" },
			branchId: c,
			historyEntryId: statted.id
		})

		await expect(b.redate(linked.id, 6)).rejects.toThrow(
			"C has scenes, links, stats or amendments tied to this history entry, but C reads main only up to Year 4, so the entry cannot move past Year 4."
		)
		await expect(b.redate(statted.id, 6)).rejects.toThrow(/cannot move past Year 4/)
		expect([await b.yearOf(linked.id), await b.yearOf(statted.id)]).toEqual([2, 3])
	}, 60_000)

	test("a fork of a fork reads main only up to the earlier fork, and every line using the entry is named", async () => {
		const b = await makeBook()
		// main ─Y2─ B ─Y5─ C ; main ─Y6─ D
		const parent = await b.fork("B", null, 2)
		const c = await b.fork("C", parent, 5)
		const d = await b.fork("D", null, 6)
		const y1 = await b.history(1)
		await b.scene(y1.id, c)
		await b.scene(y1.id, d)

		await expect(b.redate(y1.id, 3)).rejects.toThrow(
			"C has scenes, links, stats or amendments tied to this history entry, but C reads main only up to Year 2, so the entry cannot move past Year 2."
		)
		await expect(b.redate(y1.id, 7)).rejects.toThrow(
			"C and D have scenes, links, stats or amendments tied to this history entry, but they read main only up to Year 2, so the entry cannot move past Year 2."
		)
		await b.redate(y1.id, 2)
		expect(await b.yearOf(y1.id)).toBe(2)
	}, 60_000)
})
