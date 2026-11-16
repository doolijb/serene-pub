/**
 * 🚧 What stands on a made entry holds it against its run's undo, whichever
 * session or book it is in (`SUBJECTS.entry.holds`), and a made entry put back
 * by Forward finds a free position when its own was taken.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-imprints-holds-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
let n = 0

/** A user, a lorebook with a hall, two sessions on it, and session A's entry made straight in the lorebook, imprinted. */
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	const { imprintMade } = await import("$lib/server/lorebooks/imprints")
	const user = await createTestUser(testDb, `imprints-holds-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${n}` })
		.returning()
	const entryIn = async (
		title: string,
		position: number,
		typeId = LOCATION_TYPE_ID
	) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book!.id,
					typeId,
					typeVersion: 1,
					position,
					title,
					content: "…"
				})
				.returning()
		)[0]!
	const hall = await entryIn("The Hall", ++n)
	const session = async () => {
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				name: `S${++n}`,
				lorebookId: book!.id
			})
			.returning()
		const own = await insertOwnBook(db(), {
			sessionId: s!.id,
			userId: user.id,
			name: null,
			overlayOf: book!.id,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		return { session: s!, own }
	}
	const a = await session()
	const b = await session()
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId: a.session.id, role: "assistant", content: "…" })
		.returning()
	await testDb
		.insert(schema.messages)
		.values({ id: legacy!.id, sessionId: a.session.id, role: "assistant" })
	const make = async (title = "The Well", position = ++n) => {
		const well = await entryIn(title, position)
		await imprintMade(
			db(),
			{
				sessionId: a.session.id,
				messageId: legacy!.id,
				runId: `run-${++n}`
			},
			{ lorebookId: book!.id, subject: "entry", subjectId: well.id }
		)
		return well
	}
	return { user, book: book!, hall, a, b, message: legacy!, make, entryIn }
}

const entry = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]
const retract = async (messageId: number) => {
	const { retractImprints } = await import("$lib/server/lorebooks/imprints")
	return retractImprints(db(), { messageIds: [messageId] })
}
const statusesOf = async (sessionId: number) => {
	const { imprintsOf } = await import("$lib/server/lorebooks/imprints")
	return (await imprintsOf(db(), sessionId)).map((i) => i.status)
}

describe("what stands on a made entry holds it for another session's undo", () => {
	test("nothing stands on it: the entry is removed", async () => {
		const w = await world()
		const well = await w.make()
		const taken = await retract(w.message.id)
		expect(taken.map((t) => t.act)).toEqual(["unmade"])
		expect(await entry(well.id)).toBeUndefined()
	})

	test("another session's held change holds it; the held row stays; the imprint is kept", async () => {
		const w = await world()
		const well = await w.make()
		const [held] = await testDb
			.insert(schema.entryAmendments)
			.values({
				lorebookId: w.b.own.id,
				entryId: well.id,
				year: null,
				fields: { title: "The Held Well" },
				base: { title: { v: "The Well" } },
				sourceMessageId: 9
			})
			.returning()
		await retract(w.message.id)
		expect(await entry(well.id)).toBeDefined()
		expect(
			(
				await testDb
					.select()
					.from(schema.entryAmendments)
					.where(eq(schema.entryAmendments.id, held!.id))
			).length
		).toBe(1)
		expect(await statusesOf(w.a.session.id)).toEqual(["kept"])
	})

	test("this session's own held change does not hold it; with another session's held change as well, it stays", async () => {
		// A alone: its own held change is taken with its turn, after the imprints.
		const w = await world()
		const well = await w.make()
		await testDb.insert(schema.entryAmendments).values({
			lorebookId: w.a.own.id,
			entryId: well.id,
			year: null,
			fields: { title: "The Held Well" },
			base: { title: { v: "The Well" } },
			sourceMessageId: w.message.id
		})
		const taken = await retract(w.message.id)
		expect(taken.map((t) => t.act)).toContain("unmade")
		expect(await entry(well.id)).toBeUndefined()

		// With B's held change on it as well, it stays.
		const x = await world()
		const kept = await x.make()
		for (const [ownId, messageId] of [
			[x.a.own.id, x.message.id],
			[x.b.own.id, 9]
		] as const)
			await testDb.insert(schema.entryAmendments).values({
				lorebookId: ownId,
				entryId: kept.id,
				year: null,
				fields: { title: "The Held Well" },
				base: { title: { v: "The Well" } },
				sourceMessageId: messageId
			})
		await retract(x.message.id)
		expect(await entry(kept.id)).toBeDefined()
		expect(await statusesOf(x.a.session.id)).toEqual(["kept"])
	})

	test("a dated amendment of the lorebook holds it", async () => {
		const w = await world()
		const well = await w.make()
		await testDb.insert(schema.entryAmendments).values({
			lorebookId: w.book.id,
			entryId: well.id,
			year: 4,
			fields: { keys: ["well"] }
		})
		await retract(w.message.id)
		expect(await entry(well.id)).toBeDefined()
		expect(await statusesOf(w.a.session.id)).toEqual(["kept"])
	})

	test("a link from another session's notes holds it; the link stays", async () => {
		const w = await world()
		const well = await w.make()
		const [link] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: w.b.own.id,
				fromEntryId: w.hall.id,
				toEntryId: well.id,
				relationshipType: "leads to"
			})
			.returning()
		await retract(w.message.id)
		expect(await entry(well.id)).toBeDefined()
		expect(
			(
				await testDb
					.select()
					.from(schema.narrativeRelationships)
					.where(eq(schema.narrativeRelationships.id, link!.id))
			).length
		).toBe(1)
		expect(await statusesOf(w.a.session.id)).toEqual(["kept"])
	})

	test("a place value another session keeps on it holds it; the value stays", async () => {
		const w = await world()
		const well = await w.make()
		const [value] = await testDb
			.insert(schema.attributeValues)
			.values({
				ownerKind: "location",
				ownerId: well.id,
				slotId: "danger",
				value: { v: 3 },
				sessionId: w.b.session.id
			})
			.returning()
		await retract(w.message.id)
		expect(await entry(well.id)).toBeDefined()
		expect(
			(
				await testDb
					.select()
					.from(schema.attributeValues)
					.where(eq(schema.attributeValues.id, value!.id))
			).length
		).toBe(1)
		expect(await statusesOf(w.a.session.id)).toEqual(["kept"])
	})

	test("this session's own place value does not hold it", async () => {
		const w = await world()
		const well = await w.make()
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "location",
			ownerId: well.id,
			slotId: "danger",
			value: { v: 3 },
			sessionId: w.a.session.id
		})
		await retract(w.message.id)
		expect(await entry(well.id)).toBeUndefined()
	})

	test("another session's message annotation naming it holds it", async () => {
		const w = await world()
		const well = await w.make()
		const [theirs] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: w.b.session.id,
				role: "assistant",
				content: "…"
			})
			.returning()
		await testDb.insert(schema.messages).values({
			id: theirs!.id,
			sessionId: w.b.session.id,
			role: "assistant"
		})
		await testDb.insert(schema.messageAnnotations).values({
			messageId: theirs!.id,
			entityKey: "the-well",
			tier: "entry",
			refEntryId: well.id,
			extractorVersion: "test",
			sourceHash: "x",
			gazetteerHash: "y"
		})
		await retract(w.message.id)
		expect(await entry(well.id)).toBeDefined()
	})
})

describe("Back and Forward on a session's own notes", () => {
	/** A session's notes take its writes: an entry made by an earlier turn, then a turn that makes an entry and a link from the earlier one. */
	async function turns() {
		const w = await world()
		const { imprintMade } = await import("$lib/server/lorebooks/imprints")
		const messageIn = async () => {
			const [m] = await testDb
				.insert(schema.sessionMessages)
				.values({ sessionId: w.a.session.id, role: "assistant", content: "…" })
				.returning()
			await testDb.insert(schema.messages).values({ id: m!.id, sessionId: w.a.session.id, role: "assistant" })
			return m!
		}
		const noteIn = async (title: string) =>
			(
				await testDb
					.insert(schema.lorebookEntries)
					.values({
						lorebookId: w.a.own.id,
						typeId: LOCATION_TYPE_ID,
						typeVersion: 1,
						position: ++n,
						title,
						content: "…"
					})
					.returning()
			)[0]!
		const earlier = await messageIn()
		const first = await noteIn("The Cellar")
		await imprintMade(
			db(),
			{ sessionId: w.a.session.id, messageId: earlier.id, runId: `run-${++n}` },
			{ lorebookId: w.a.own.id, subject: "entry", subjectId: first.id }
		)
		const turn = await messageIn()
		const made = await noteIn("The Crypt")
		const anchor = { sessionId: w.a.session.id, messageId: turn.id, runId: `run-${++n}` }
		await imprintMade(db(), anchor, { lorebookId: w.a.own.id, subject: "entry", subjectId: made.id })
		const [link] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: w.a.own.id,
				fromEntryId: first.id,
				toEntryId: made.id,
				relationshipType: "leads to"
			})
			.returning()
		await imprintMade(db(), anchor, { lorebookId: w.a.own.id, subject: "relationship", subjectId: link!.id })
		return { w, turn, first, made, link: link! }
	}
	const linkRow = async (id: number) =>
		(await testDb.select().from(schema.narrativeRelationships).where(eq(schema.narrativeRelationships.id, id))).length

	test("Back past the turn removes the entry and its link, with no replaced note; Forward puts them back", async () => {
		const { w, turn, first, made, link } = await turns()
		const taken = await retract(turn.id)
		expect(await entry(made.id)).toBeUndefined()
		expect(await linkRow(link.id)).toBe(0)
		expect(await entry(first.id)).toBeDefined()
		expect(await statusesOf(w.a.session.id)).not.toContain("kept")
		const { restoreImprints } = await import("$lib/server/lorebooks/imprints")
		expect(await restoreImprints(db(), taken)).toBe(true)
		expect((await entry(made.id))?.title).toBe("The Crypt")
		expect(await linkRow(link.id)).toBe(1)
	})

	test("a notes entry that another session's held change does not touch is removed by Back", async () => {
		const { w, turn, made } = await turns()
		await testDb.insert(schema.entryAmendments).values({
			lorebookId: w.b.own.id,
			entryId: w.hall.id,
			year: null,
			fields: { title: "The Great Hall" },
			base: { title: { v: "The Hall" } },
			sourceMessageId: 9
		})
		await retract(turn.id)
		expect(await entry(made.id)).toBeUndefined()
		expect(await statusesOf(w.a.session.id)).not.toContain("kept")
	})
})

describe("Forward puts a made entry back at a free position", () => {
	test("the stored position was taken meanwhile: the entry comes back at the next free one", async () => {
		const w = await world()
		const well = await w.make("The Well", 40)
		const taken = await retract(w.message.id)
		expect(await entry(well.id)).toBeUndefined()
		// Another session's entry of the same type takes the slot.
		const squatter = await w.entryIn("The Squatter", 40)
		const { restoreImprints } = await import(
			"$lib/server/lorebooks/imprints"
		)
		expect(await restoreImprints(db(), taken)).toBe(true)
		const back = await entry(well.id)
		expect(back?.title).toBe("The Well")
		expect(back!.position).not.toBe(40)
		expect((await entry(squatter.id))!.position).toBe(40)
	})

	test("the stored position is still free: it is kept", async () => {
		const w = await world()
		const well = await w.make("The Well", 41)
		const taken = await retract(w.message.id)
		const { restoreImprints } = await import(
			"$lib/server/lorebooks/imprints"
		)
		await restoreImprints(db(), taken)
		expect((await entry(well.id))!.position).toBe(41)
	})

	test("another entry type at that position does not count as taken", async () => {
		const w = await world()
		const well = await w.make("The Well", 42)
		const taken = await retract(w.message.id)
		await w.entryIn("Other kind", 42, WORLD_LORE_TYPE_ID)
		const { restoreImprints } = await import(
			"$lib/server/lorebooks/imprints"
		)
		await restoreImprints(db(), taken)
		expect((await entry(well.id))!.position).toBe(42)
	})
})
