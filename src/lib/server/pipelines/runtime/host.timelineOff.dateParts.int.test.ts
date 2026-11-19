/**
 * Owner 2026-11-16 (D): with the timeline off an update's date parts are
 * ignored (a history entry's date; a Beginning's, which the host never takes as a
 * typed field), so stored dates survive a timeless session untouched. A part that would have changed
 * the stored date says so on the receipt; a null part, or the stored one, says
 * nothing. With the timeline on the dates are written as they always were.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { DATE_NOT_CHANGED_SENTENCE } from "./host"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

const UPDATE = { key: "change", definitionId: "core:outlet/update-lore-entry" } as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-host-timeline-off-dates-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function world(timelineEnabled: boolean) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `host-tl-off-dates-${suffix}`)
	await db.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}`, timelineEnabled })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, lorebookId: book!.id })
		.returning()
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: session!.id, role: "assistant", content: "…" })
		.returning()
	await db.insert(schema.messages).values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
	const [wall] = await db
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId: book!.id,
				name: "The Old Wall",
				content: "Built long ago.",
				year: 4,
				month: 2,
				day: 1,
				position: ++n
			} as any) as any
		)
		.returning()
	const [day] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: HISTORY_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: null,
			content: "A day.",
			fields: { year: 3, month: 1, day: 4 }
		})
		.returning()
	const host = async (runId: string) => {
		const { createHost } = await import("./host")
		return createHost(db as unknown as Db, { sessionId: session!.id, userId: user.id, runId })
	}
	const stored = async (id: number) =>
		(await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, id)))[0]!
	return { session: session!, wall: wall!, day: day!, host, stored, suffix }
}

describe("an update's date parts with the timeline off", () => {
	it("a history row sent back as it reads (its date null) changes no date, writes the rest, and says nothing", async () => {
		const w = await world(false)
		const out: any = await (await w.host(`run-a-${w.suffix}`)).commit!(
			{
				entry: w.day.id,
				content: "A day, mended.",
				fields: { year: null, month: null, day: null }
			},
			UPDATE
		)
		const after = await w.stored(w.day.id)
		expect(after.content).toBe("A day, mended.")
		expect(after.fields).toMatchObject({ year: 3, month: 1, day: 4 })
		expect(out.notes).toBeUndefined()
	})

	it("a non-null part that differs is ignored and the receipt says why; the stored date says nothing", async () => {
		const w = await world(false)
		const out: any = await (await w.host(`run-b-${w.suffix}`)).commit!(
			{ entry: w.day.id, content: "Same day, told again.", fields: { year: 8 } },
			UPDATE
		)
		expect(out.notes).toEqual([DATE_NOT_CHANGED_SENTENCE])
		const after = await w.stored(w.day.id)
		expect(after.content).toBe("Same day, told again.")
		expect(after.fields).toMatchObject({ year: 3, month: 1, day: 4 })
		const same: any = await (await w.host(`run-c-${w.suffix}`)).commit!(
			{ entry: w.day.id, content: "Told a third time.", fields: { year: 3, month: 1, day: 4 } },
			UPDATE
		)
		expect(same.notes).toBeUndefined()
	})

	it("a Beginning type: the host never takes a date part for it (not a typed field), so a stored Beginning is untouched either way", async () => {
		const w = await world(false)
		await expect(
			(await w.host(`run-d-${w.suffix}`)).commit!(
				{ entry: w.wall.id, content: "Rebuilt.", fields: { year: null, month: null, day: null } },
				UPDATE
			)
		).rejects.toThrow("is not a field of core:entry/world-lore")
		const after = await w.stored(w.wall.id)
		expect(after.content).toBe("Built long ago.")
		expect(after.fields).toMatchObject({ year: 4, month: 2, day: 1 })
	})

	it("with the timeline on the date part is not ignored: the host answers it as it always did", async () => {
		const w = await world(true)
		await expect(
			(await w.host(`run-e-${w.suffix}`)).commit!(
				{ entry: w.day.id, content: "Refused.", fields: { year: 6, month: 3, day: 2 } },
				UPDATE
			)
		).rejects.toThrow("keeps its date in the lorebook")
		const after = await w.stored(w.day.id)
		expect(after.content).toBe("A day.")
		expect(after.fields).toMatchObject({ year: 3, month: 1, day: 4 })
	})
})
