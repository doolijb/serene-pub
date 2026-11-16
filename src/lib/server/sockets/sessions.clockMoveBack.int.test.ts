/**
 * 🚧 Session settings' save and a clock moved back past the session's own
 * dated writes: refused with the sentence until confirmed; confirmed
 * Overwrite saves as today; confirmed Branch saves the other fields on this
 * session, keeps its clock and sets the branch's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-update-clock-move-back-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const NOW = { year: 10, month: 4, day: 1 }
const BACK = { year: 10, month: 2, day: 1 }
const LATER = { year: 10, month: 3, day: 1 }

const columns = (c: typeof NOW) => ({
	storyClockYear: c.year,
	storyClockMonth: c.month,
	storyClockDay: c.day
})

function fakeSocket(userId: number) {
	return {
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

async function world(onRevision?: "overwrite" | "branch") {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `update-clock-${suffix}`)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Crawl ${suffix}`,
			lorebookId: book!.id,
			...(onRevision ? { onRevision } : {}),
			...columns(NOW)
		})
		.returning()
	const { insertLegacy } = await import("$lib/server/messages/store")
	await insertLegacy(
		db as any,
		{ sessionId: session!.id, role: "assistant", content: "…" } as any
	)
	const [entry] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: `Hall ${n}`,
			content: "As written.",
			fields: { category: "Rooms" }
		})
		.returning()
	const [v] = await db
		.insert(schema.entryAmendments)
		.values({
			lorebookId: book!.id,
			entryId: entry!.id,
			...LATER,
			fields: { content: "Later." }
		})
		.returning()
	await db.insert(schema.loreImprints).values({
		sessionId: session!.id,
		lorebookId: book!.id,
		subjectKind: "version",
		subjectId: v!.id
	})
	return { user, book: book!, session: session! }
}
type World = Awaited<ReturnType<typeof world>>

async function update(w: World, session: Record<string, unknown>, extra = {}) {
	const { sessionsUpdateHandler } = await import("./sessions")
	const emits: Array<[string, any]> = []
	let result: any
	try {
		result = await sessionsUpdateHandler.handler(
			fakeSocket(w.user.id),
			{ session: { id: w.session.id, ...session }, ...extra } as any,
			(event: string, data: any) => emits.push([event, data])
		)
	} catch (error) {
		result = { thrown: error }
	}
	return { emits, result }
}

const row = async (id: number) =>
	(
		await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!
const clockOfRow = async (id: number) => {
	const r = await row(id)
	return [r.storyClockYear, r.storyClockMonth, r.storyClockDay]
}
const errorOf = (e: { emits: Array<[string, any]>; result: any }) =>
	e.result?.thrown?.message ??
	e.emits.find(([event]) => event.endsWith(":error"))?.[1]?.error ??
	e.result?.error

describe("sessions:update and a clock moved back", () => {
	it("is refused with the sentence, writing nothing, until confirmed", async () => {
		const w = await world()
		const got = await update(w, { name: "Renamed", ...columns(BACK) })
		const { clockMoveBackNotice } = await import(
			"$lib/server/sessions/clockMoveBack"
		)
		const notice = await clockMoveBackNotice(
			db as unknown as Db,
			w.session.id,
			{
				to: BACK
			}
		)
		expect(notice).not.toBeNull()
		expect(errorOf(got)).toBe(notice!.sentence)
		expect((await row(w.session.id)).name).toBe(w.session.name)
		expect(await clockOfRow(w.session.id)).toEqual([10, 4, 1])
	})

	it("confirmed under Overwrite saves the name and the clock; the version stays", async () => {
		const w = await world()
		const got = await update(
			w,
			{ name: "Renamed", ...columns(BACK) },
			{ confirmClockMoveBack: true }
		)
		expect(errorOf(got)).toBeUndefined()
		expect((await row(w.session.id)).name).toBe("Renamed")
		expect(await clockOfRow(w.session.id)).toEqual([10, 2, 1])
		expect(got.result?.branchedTo).toBeUndefined()
		expect(
			await db
				.select()
				.from(schema.entryAmendments)
				.where(eq(schema.entryAmendments.lorebookId, w.book.id))
		).toHaveLength(1)
	})

	it("confirmed under Branch saves the rest here, keeps this clock, sets the branch's and answers branchedTo", async () => {
		const w = await world("branch")
		const got = await update(
			w,
			{ name: "Renamed", ...columns(BACK) },
			{ confirmClockMoveBack: true }
		)
		expect(errorOf(got)).toBeUndefined()
		const reply = got.emits.find(
			([event]) => event === "sessions:update"
		)![1]
		expect(reply.branchedTo).toEqual(expect.any(Number))
		expect(reply.branchedTo).not.toBe(w.session.id)
		expect((await row(w.session.id)).name).toBe("Renamed")
		expect(await clockOfRow(w.session.id)).toEqual([10, 4, 1])
		expect(await clockOfRow(reply.branchedTo)).toEqual([10, 2, 1])
	})

	it("an update that does not touch the clock, or sends it unchanged, behaves as before", async () => {
		const w = await world()
		const plain = await update(w, { name: "Only a name" })
		expect(errorOf(plain)).toBeUndefined()
		expect((await row(w.session.id)).name).toBe("Only a name")
		const same = await update(w, { name: "Again", ...columns(NOW) })
		expect(errorOf(same)).toBeUndefined()
		expect((await row(w.session.id)).name).toBe("Again")
		const forward = await update(w, columns({ year: 10, month: 5, day: 1 }))
		expect(errorOf(forward)).toBeUndefined()
		expect(await clockOfRow(w.session.id)).toEqual([10, 5, 1])
	})
})
