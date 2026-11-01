/**
 * 🚧 Hourly steps wait for a clock (M0, lane T1): a clockless session
 * whose ruleset uses `core:function/recurring@1` every hour gets ONE ledger
 * note, however many times the ruleset resolves.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineRuleset } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const HOURLY = "test:ruleset/hourly-int@1"
const GENRE = "test:genre/hourly-int"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-hourly-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	defineRuleset(HOURLY, {
		name: { en: "Hourly" },
		voice: { prose: "Hourly, in words.", mechanics: "Hourly decides." },
		attributes: [{ id: "hunger", name: { en: "Hunger" }, kind: "tally", bounds: { min: 0 }, start: 0, owner: "cast", scope: "session", prose: "Hunger: how long since they ate." }],
		repertoires: [],
		functions: [{ ref: "core:function/recurring@1", key: "hungry", bindings: { what: "hunger" }, options: { every: "hour", by: 1 } }]
	} as never)
	genreKeeping(GENRE, { name: { en: "Hourly" }, family: "test", slots: [], events: {} })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("hourly steps wait for a clock", () => {
	test("two resolves of a clockless session leave exactly one note row", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(db, "hourly-int")
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, name: "Hourly", genreId: GENRE, primaryRuleset: HOURLY, rigour: "mechanics" })
			.returning()
		const { resolveRulesetTurn } = await import("./resolve")
		for (let i = 0; i < 2; i++) await resolveRulesetTurn(db as any, { owners: [`session:${session!.id}`], mode: "apply" }, { runId: `hourly-${i}` })
		const rows = await db
			.select()
			.from(schema.stateProposals)
			.where(and(eq(schema.stateProposals.sessionId, session!.id), eq(schema.stateProposals.kind, "clock")))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ status: "skipped" })
		expect((rows[0]!.payload as any).skipped).toBe("The story has no clock yet; hourly routines wait.")
	}, 60_000)
})
