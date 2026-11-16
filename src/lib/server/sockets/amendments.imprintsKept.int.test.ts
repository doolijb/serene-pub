/**
 * A person's write on a dated version turns the session's record of it `kept`
 * (create that merges, edit of fields, re-date, delete); retracting the turn
 * then leaves the person's text.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let testDb: TestDb
let dataDir: string
let seq = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-amendments-imprints-kept-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socketOf = (userId: number) => ({ user: { id: userId } }) as any
const emit = (() => {}) as any

/** A lorebook with one entry, a session on it, one session message, and a dated version the session's turn wrote. */
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `amend-kept-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${seq}`, userId: user.id })
		.returning()
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			title: "Verity",
			content: "A novice.",
			keys: [],
			position: 1,
			fields: {}
		} as any)
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${seq}`,
			lorebookId: book!.id
		})
		.returning()
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId: session!.id, role: "assistant", content: "…" })
		.returning()
	await testDb
		.insert(schema.messages)
		.values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
	const [version] = await testDb
		.insert(schema.entryAmendments)
		.values({
			lorebookId: book!.id,
			entryId: entry!.id,
			branchId: null,
			year: 5,
			fields: {
				content: "The turn's text.",
				summary: "The turn's summary."
			},
			base: null
		} as any)
		.returning()
	const { imprintMade, imprintField } = await import(
		"$lib/server/lorebooks/imprints"
	)
	const anchor = {
		sessionId: session!.id,
		messageId: legacy!.id,
		runId: null
	}
	const at = {
		lorebookId: book!.id,
		subject: "version" as const,
		subjectId: version!.id
	}
	await imprintMade(testDb as unknown as Db, anchor, at)
	await imprintField(
		testDb as unknown as Db,
		anchor,
		{ ...at, field: "content" },
		"A novice.",
		"The turn's text."
	)
	await imprintField(
		testDb as unknown as Db,
		anchor,
		{ ...at, field: "summary" },
		null,
		"The turn's summary."
	)
	const m = await import("./amendments")
	const call = <T>(h: any, params: Record<string, unknown>): Promise<T> =>
		h.handler(
			socketOf(user.id),
			{ lorebookId: book!.id, ...params } as any,
			emit
		)
	return {
		user,
		book: book!,
		entry: entry!,
		session: session!,
		message: legacy!,
		version: version!,
		create: (year: number, fields: Record<string, unknown>) =>
			call(m.amendmentsCreateHandler, {
				entryId: entry!.id,
				year,
				fields
			}),
		update: (params: Record<string, unknown>) =>
			call(m.amendmentsUpdateHandler, {
				subject: "entry",
				id: version!.id,
				...params
			}),
		remove: () =>
			call(m.amendmentsDeleteHandler, {
				subject: "entry",
				id: version!.id
			})
	}
}
type World = Awaited<ReturnType<typeof world>>

const recordsOf = (w: World) =>
	testDb
		.select()
		.from(schema.loreImprints)
		.where(
			and(
				eq(schema.loreImprints.subjectKind, "version"),
				eq(schema.loreImprints.subjectId, w.version.id)
			)
		)
const statusOf = async (w: World, field: string | null) =>
	(await recordsOf(w)).filter((r) => r.field === field).map((r) => r.status)
const versionOf = async (w: World) =>
	(
		await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, w.version.id))
	)[0]

async function retractTurn(w: World) {
	const { retractImprints } = await import("$lib/server/lorebooks/imprints")
	await retractImprints(testDb as unknown as Db, {
		messageIds: [w.message.id]
	})
}

describe("a person's write on a version keeps the turn's record of it", () => {
	test("a create at the same date (merge) keeps the written keys' records and the made row's; retracting leaves the text", async () => {
		const w = await world()
		await w.create(5, { content: "Person's text." })
		expect(await statusOf(w, "content")).toEqual(["kept"])
		expect(await statusOf(w, null)).toEqual(["kept"])
		// A key the person did not write still stands.
		expect(await statusOf(w, "summary")).toEqual(["standing"])
		await retractTurn(w)
		expect((await versionOf(w))!.fields).toMatchObject({
			content: "Person's text."
		})
	})

	test("an update of fields keeps the records of the keys before and after", async () => {
		const w = await world()
		await w.update({
			fields: { content: "Edited.", summary: "Edited summary." }
		})
		expect(await statusOf(w, "content")).toEqual(["kept"])
		expect(await statusOf(w, "summary")).toEqual(["kept"])
		expect(await statusOf(w, null)).toEqual(["kept"])
		await retractTurn(w)
		expect((await versionOf(w))!.fields).toMatchObject({
			content: "Edited.",
			summary: "Edited summary."
		})
	})

	test("a re-date keeps the records of every key the version holds; retracting leaves it where the person put it", async () => {
		const w = await world()
		await w.update({ year: 7 })
		expect(await statusOf(w, "content")).toEqual(["kept"])
		expect(await statusOf(w, "summary")).toEqual(["kept"])
		await retractTurn(w)
		expect((await versionOf(w))!.year).toBe(7)
	})

	test("a delete takes the version's records with it", async () => {
		const w = await world()
		await w.remove()
		expect(await versionOf(w)).toBeUndefined()
		expect(await recordsOf(w)).toEqual([])
	})
})
