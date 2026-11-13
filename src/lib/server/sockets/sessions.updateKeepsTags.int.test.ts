/**
 * `sessions:update` without `tags` (the Author's note Scenario save, taking a
 * seat) leaves the owner's tags alone; an explicit empty list still clears them.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { STORY_GENRE_ID } from "@serene-pub/core-catalog"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-update-keeps-tags-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function fakeSocket(userId: number) {
	return {
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

async function tagNames(sessionId: number) {
	const rows = await testDb
		.select({ name: schema.tags.name })
		.from(schema.sessionTags)
		.innerJoin(schema.tags, eq(schema.tags.id, schema.sessionTags.tagId))
		.where(eq(schema.sessionTags.sessionId, sessionId))
	return rows.map((r) => r.name).sort()
}

describe("sessions:update and tags", () => {
	test("an update without tags keeps them; an explicit empty list clears them", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const [owner] = await testDb
			.insert(schema.users)
			.values({ username: "keeps-tags-owner" })
			.returning()
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner.id,
				isGroup: false,
				genreId: STORY_GENRE_ID
			} as any)
			.returning()
		const tagRows = await testDb
			.insert(schema.tags)
			.values([
				{ userId: owner.id, name: "alpha" },
				{ userId: owner.id, name: "beta" }
			])
			.returning()
		await testDb
			.insert(schema.sessionTags)
			.values(tagRows.map((t) => ({ sessionId: s.id, tagId: t.id })))
		expect(await tagNames(s.id)).toEqual(["alpha", "beta"])

		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ session: { id: s.id, scenario: "x" } } as any,
			() => {}
		)
		const [after] = await testDb
			.select({ scenario: schema.sessions.scenario })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, s.id))
		expect(after.scenario).toBe("x")
		expect(await tagNames(s.id)).toEqual(["alpha", "beta"])

		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ session: { id: s.id }, tags: [] } as any,
			() => {}
		)
		expect(await tagNames(s.id)).toEqual([])
	}, 60_000)
})
