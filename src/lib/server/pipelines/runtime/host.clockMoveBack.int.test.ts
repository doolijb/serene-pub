/**
 * 🚧 The clock outlet refuses a move back past the session's own dated writes
 * (P1): a Time passes… press skips with its sentence, any other cause halts
 * with the other; a move back past nothing still moves.
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
import { CLOCK_MOVE_BACK_REFUSALS } from "$lib/server/sessions/revision"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

const ADVANCE = {
	key: "advance",
	definitionId: "core:outlet/advance-story-clock",
	definitionVersion: 1
} as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-host-clock-move-back-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

/** A session at 10/4/1 that wrote a version dated 10/3/1 (when `wrote`). */
async function world(wrote: boolean) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `host-clock-move-back-${suffix}`)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id,
			storyClockYear: 10,
			storyClockMonth: 4,
			storyClockDay: 1
		})
		.returning()
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: session!.id, role: "assistant", content: "…" })
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
	if (wrote) {
		const [entry] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: book!.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "Hall",
				content: "As written.",
				fields: { category: "Rooms" }
			})
			.returning()
		const [v] = await db
			.insert(schema.entryAmendments)
			.values({
				lorebookId: book!.id,
				entryId: entry!.id,
				year: 10,
				month: 3,
				day: 1,
				fields: { content: "Later." }
			})
			.returning()
		await db.insert(schema.loreImprints).values({
			sessionId: session!.id,
			lorebookId: book!.id,
			subjectKind: "version",
			subjectId: v!.id
		})
	}
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = await createHost(
		db as unknown as Db,
		{
			sessionId: session!.id,
			userId: user.id,
			runId: `run-${suffix}`
		} as any
	)
	return { session: session!, host }
}

const clockOf = async (id: number) => {
	const [row] = await db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.id, id))
	return [row!.storyClockYear, row!.storyClockMonth, row!.storyClockDay]
}

describe("the clock outlet and a move back past the session's writes", () => {
	it("a Time passes… press under skip moves nothing and says why", async () => {
		const w = await world(true)
		const out: any = await w.host.commit!(
			{ by: -2, unit: "months", cause: "action", onRefusal: "skip" },
			ADVANCE
		)
		expect(out.skipped).toBe(CLOCK_MOVE_BACK_REFUSALS.action)
		expect(await clockOf(w.session.id)).toEqual([10, 4, 1])
		const rows = await db
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, w.session.id))
		expect(JSON.stringify(rows)).toContain(CLOCK_MOVE_BACK_REFUSALS.action)
	})

	it("a keeper or tick move under halt halts with the other sentence", async () => {
		for (const cause of ["keeper", "tick"]) {
			const w = await world(true)
			await expect(
				w.host.commit!(
					{ by: -2, unit: "months", cause, onRefusal: "halt" },
					ADVANCE
				)
			).rejects.toThrow(CLOCK_MOVE_BACK_REFUSALS.run)
			expect(await clockOf(w.session.id)).toEqual([10, 4, 1])
		}
	})

	it("a move back past nothing still moves", async () => {
		const w = await world(false)
		const out: any = await w.host.commit!(
			{ by: -2, unit: "months", cause: "action" },
			ADVANCE
		)
		expect(out.skipped ?? "").toBe("")
		expect(await clockOf(w.session.id)).toEqual([10, 2, 1])
	})
})
