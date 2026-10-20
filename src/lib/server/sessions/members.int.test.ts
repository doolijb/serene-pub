/**
 * Who may sit at a session (`GenreDecl.members`, ruled 2026-10-19): the
 * guest door reads the policy from `members.ts`, off the genre listing.
 */
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "$lib/server/db/schema"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { sessionMembersPolicy } from "./members"

let db: TestDb
let owner: number

async function session(genreId: string | null) {
	const [row] = await db
		.insert(schema.sessions)
		.values({ userId: owner, isGroup: false, ...(genreId ? { genreId } : {}) } as any)
		.returning()
	return row!.id
}

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
	owner = (await createTestUser(db, "members-owner")).id
}, 60_000)

describe("sessionMembersPolicy", () => {
	it("is solo for a genre that seats its owner alone — the Guide, and Chat (the assistant)", async () => {
		expect(await sessionMembersPolicy(db as any, await session("core:genre/guide"))).toBe("solo")
		expect(await sessionMembersPolicy(db as any, await session("core:genre/chat"))).toBe("solo")
	}, 60_000)

	it("is group for every other genre, a session with none, and a session that is not there", async () => {
		expect(await sessionMembersPolicy(db as any, await session("core:genre/story"))).toBe("group")
		expect(await sessionMembersPolicy(db as any, await session("core:genre/lair"))).toBe("group")
		expect(await sessionMembersPolicy(db as any, await session(null))).toBe("group")
		expect(await sessionMembersPolicy(db as any, 999_999)).toBe("group")
	}, 60_000)
})
