/**
 * 🚧 The clock door and a clock moved back past the session's own dated
 * writes: the read with `moveTo` answers the notice, `setStoryClock` refuses
 * until confirmed, then follows On revision (Overwrite writes as today;
 * Branch sets the branch's clock and leaves the parent's).
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
		path.join(os.tmpdir(), "serene-pub-vitest-clock-door-move-back-")
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

function fakeSocket(userId: number) {
	return {
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

async function ask(
	handler: any,
	userId: number,
	params: Record<string, unknown>
) {
	const emits: Array<[string, any]> = []
	await handler.handler(
		fakeSocket(userId),
		params,
		(event: string, data: any) => emits.push([event, data])
	)
	return emits
}

async function world(
	opts: {
		clock?: typeof NOW | null
		timeline?: boolean
		onRevision?: "overwrite" | "branch"
	} = {}
) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `clock-door-${suffix}`)
	const guest = await createTestUser(db, `clock-door-guest-${suffix}`)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({
			userId: user.id,
			name: `World ${suffix}`,
			...(opts.timeline === false ? { timelineEnabled: false } : {})
		})
		.returning()
	const clock = opts.clock === undefined ? NOW : opts.clock
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Crawl ${suffix}`,
			lorebookId: book!.id,
			...(opts.onRevision ? { onRevision: opts.onRevision } : {}),
			...(clock
				? {
						storyClockYear: clock.year,
						storyClockMonth: clock.month,
						storyClockDay: clock.day
					}
				: {})
		})
		.returning()
	await db
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id } as any)
	const { insertLegacy } = await import("$lib/server/messages/store")
	await insertLegacy(
		db as any,
		{ sessionId: session!.id, role: "assistant", content: "…" } as any
	)
	return { user, guest, book: book!, session: session! }
}
type World = Awaited<ReturnType<typeof world>>

async function versionBy(w: World, sessionId: number, date: typeof NOW) {
	const [entry] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: w.book.id,
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
			lorebookId: w.book.id,
			entryId: entry!.id,
			...date,
			fields: { content: "Later." }
		})
		.returning()
	await db.insert(schema.loreImprints).values({
		sessionId,
		lorebookId: w.book.id,
		subjectKind: "version",
		subjectId: v!.id
	})
	return v!
}

const clockOfRow = async (sessionId: number) => {
	const [r] = await db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return [r!.storyClockYear, r!.storyClockMonth, r!.storyClockDay]
}
const versionsOf = async (bookId: number) =>
	(
		await db
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.lorebookId, bookId))
	).length

const set = async (w: World, params: Record<string, unknown>) => {
	const { sessionsSetStoryClock } = await import("./storyClock")
	return (
		await ask(sessionsSetStoryClock, w.user.id, {
			sessionId: w.session.id,
			...params
		})
	)[0]!
}

describe("a person's move of the clock", () => {
	it("is as today for a move back past nothing, a forward move, no clock, the Timeline off", async () => {
		const w = await world()
		const [event, res] = await set(w, { to: BACK })
		expect(event).toBe("sessions:setStoryClock")
		expect(res.clockMoveBack).toBeUndefined()
		expect(await clockOfRow(w.session.id)).toEqual([10, 2, 1])

		const f = await world()
		await versionBy(f, f.session.id, LATER)
		expect((await set(f, { to: { year: 10, month: 5, day: 1 } }))[0]).toBe(
			"sessions:setStoryClock"
		)
		expect(await clockOfRow(f.session.id)).toEqual([10, 5, 1])

		const bare = await world({ clock: null })
		await versionBy(bare, bare.session.id, LATER)
		expect((await set(bare, { to: BACK }))[0]).toBe(
			"sessions:setStoryClock"
		)

		const off = await world({ timeline: false })
		await versionBy(off, off.session.id, LATER)
		expect((await set(off, { follow: true }))[0]).toBe(
			"sessions:setStoryClock"
		)
	})

	it("refuses a set back past the session's dated version with the notice; nothing moves", async () => {
		const w = await world()
		await versionBy(w, w.session.id, LATER)
		const [event, res] = await set(w, { to: BACK, request: "q" })
		expect(event).toBe("sessions:setStoryClock:error")
		expect(res).toMatchObject({
			sessionId: w.session.id,
			request: "q",
			clockMoveBack: { mode: "overwrite", count: 1 }
		})
		expect(res.error).toBe(res.clockMoveBack.sentence)
		expect(await clockOfRow(w.session.id)).toEqual([10, 4, 1])
	})

	it("confirmed under Overwrite moves the clock and removes nothing", async () => {
		const w = await world()
		await versionBy(w, w.session.id, LATER)
		const [event, res] = await set(w, {
			to: BACK,
			confirmClockMoveBack: true
		})
		expect(event).toBe("sessions:setStoryClock")
		expect(res.branchedTo).toBeUndefined()
		expect(await clockOfRow(w.session.id)).toEqual([10, 2, 1])
		expect(await versionsOf(w.book.id)).toBe(1)
	})

	it("confirmed under Branch answers branchedTo, sets the branch's clock and leaves the parent's", async () => {
		const w = await world({ onRevision: "branch" })
		await versionBy(w, w.session.id, LATER)
		const [event, res] = await set(w, {
			to: BACK,
			confirmClockMoveBack: true
		})
		expect(event).toBe("sessions:setStoryClock")
		expect(res.branchedTo).toEqual(expect.any(Number))
		expect(res.branchedTo).not.toBe(w.session.id)
		expect(res.own).toMatchObject({ year: 10, month: 4, day: 1 })
		expect(await clockOfRow(res.branchedTo)).toEqual([10, 2, 1])
		expect(await clockOfRow(w.session.id)).toEqual([10, 4, 1])
	})

	it("judges a step back and a follow the same way", async () => {
		const w = await world()
		await versionBy(w, w.session.id, LATER)
		const stepped = await set(w, { by: -2, unit: "months" })
		expect(stepped[0]).toBe("sessions:setStoryClock:error")
		expect(stepped[1].clockMoveBack).toMatchObject({ count: 1 })
		expect(await clockOfRow(w.session.id)).toEqual([10, 4, 1])
		// A step back that passes nothing the session wrote (a free-form book cannot count back past day 1, so move to day 5 first).
		await db
			.update(schema.sessions)
			.set({ storyClockDay: 5 })
			.where(eq(schema.sessions.id, w.session.id))
		const day = await set(w, { by: -1, unit: "days" })
		expect(day[1].error).toBeUndefined()
		expect(day[0]).toBe("sessions:setStoryClock")

		const b = await world({ onRevision: "branch" })
		await versionBy(b, b.session.id, LATER)
		const branched = await set(b, {
			by: -2,
			unit: "months",
			confirmClockMoveBack: true
		})
		expect(branched[1].branchedTo).toEqual(expect.any(Number))
		expect(await clockOfRow(branched[1].branchedTo)).toEqual([10, 2, 1])
		expect(await clockOfRow(b.session.id)).toEqual([10, 4, 1])

		const f = await world()
		await versionBy(f, f.session.id, LATER)
		await db
			.update(schema.lorebooks)
			.set({ storyClockYear: 10, storyClockMonth: 2, storyClockDay: 1 })
			.where(eq(schema.lorebooks.id, f.book.id))
		const follow = await set(f, { follow: true })
		expect(follow[0]).toBe("sessions:setStoryClock:error")
		expect(follow[1].clockMoveBack).toMatchObject({ count: 1 })
		expect(await clockOfRow(f.session.id)).toEqual([10, 4, 1])
		expect(
			(await set(f, { follow: true, confirmClockMoveBack: true }))[0]
		).toBe("sessions:setStoryClock")
		expect(await clockOfRow(f.session.id)).toEqual([null, null, null])
	})

	it("does not count another session's later write", async () => {
		const w = await world()
		const other = await world()
		await versionBy(w, other.session.id, LATER)
		expect((await set(w, { to: BACK }))[0]).toBe("sessions:setStoryClock")
	})
})

describe("the read with moveTo", () => {
	it("answers the notice to the owner, none to a guest, and nothing without moveTo", async () => {
		const { sessionsStoryClock } = await import("./storyClock")
		const w = await world()
		await versionBy(w, w.session.id, LATER)
		const read = async (userId: number, extra: Record<string, unknown>) =>
			(
				await ask(sessionsStoryClock, userId, {
					sessionId: w.session.id,
					...extra
				})
			)[0]![1]
		expect(
			(await read(w.user.id, { moveTo: BACK })).clockMoveBack
		).toMatchObject({
			mode: "overwrite",
			count: 1
		})
		expect(
			(await read(w.user.id, { moveTo: LATER })).clockMoveBack
		).toBeNull()
		expect(
			(await read(w.user.id, { moveTo: { year: "x" } })).clockMoveBack
		).toBeNull()
		expect(
			(await read(w.guest.id, { moveTo: BACK })).clockMoveBack
		).toBeUndefined()
		expect("clockMoveBack" in (await read(w.user.id, {}))).toBe(false)
		expect(await clockOfRow(w.session.id)).toEqual([10, 4, 1])
	})
})
