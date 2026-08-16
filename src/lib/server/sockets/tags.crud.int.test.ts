/**
 * Round-10 audit fix (HIGH — data integrity): tagsCreate now adopts an
 * existing case-insensitive/whitespace-variant tag instead of duplicating
 * it, and tagsUpdate rejects renaming a tag into a collision with a
 * DIFFERENT existing tag (using the identical case-insensitive predicate
 * the tags_user_id_name_unique index itself uses — see findMatchingTag in
 * sockets/tags.ts).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-tags-crud-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

describe("tags:create — adopt-on-collision", () => {
	test("adopts an existing case-insensitive/whitespace-variant tag instead of duplicating", async () => {
		const { tagsCreate } = await import("./tags")
		const user = await makeUser("tags-crud-create-adopt-user")

		const first = await tagsCreate.handler(
			fakeSocket(user.id),
			{ tag: { name: "Fantasy" } as any },
			noopEmit
		)
		const second = await tagsCreate.handler(
			fakeSocket(user.id),
			{ tag: { name: "  fantasy  " } as any },
			noopEmit
		)

		expect(second.tag.id).toBe(first.tag.id)
	})

	test("creates a genuinely new tag", async () => {
		const { tagsCreate } = await import("./tags")
		const user = await makeUser("tags-crud-create-new-user")

		const res = await tagsCreate.handler(
			fakeSocket(user.id),
			{ tag: { name: "Noir" } as any },
			noopEmit
		)
		expect(res.tag.name).toBe("Noir")
	})
})

describe("tags:update — rename-collision rejection", () => {
	test("rejects renaming into a collision with a different existing tag", async () => {
		const { tagsCreate, tagsUpdate } = await import("./tags")
		const user = await makeUser("tags-crud-update-collision-user")

		const tagA = await tagsCreate.handler(
			fakeSocket(user.id),
			{ tag: { name: "Horror" } as any },
			noopEmit
		)
		const tagB = await tagsCreate.handler(
			fakeSocket(user.id),
			{ tag: { name: "Comedy" } as any },
			noopEmit
		)

		await expect(
			tagsUpdate.handler(
				fakeSocket(user.id),
				{ tag: { id: tagB.tag.id, name: "  horror  " } as any },
				noopEmit
			)
		).rejects.toThrow(/already exists/i)
	})

	test("allows renaming a tag to itself (no-op case) without throwing", async () => {
		const { tagsCreate, tagsUpdate } = await import("./tags")
		const user = await makeUser("tags-crud-update-self-user")

		const tag = await tagsCreate.handler(
			fakeSocket(user.id),
			{ tag: { name: "Slice of Life" } as any },
			noopEmit
		)

		const res = await tagsUpdate.handler(
			fakeSocket(user.id),
			{
				tag: {
					id: tag.tag.id,
					name: "Slice of Life",
					description: "cozy"
				} as any
			},
			noopEmit
		)
		expect(res.tag.id).toBe(tag.tag.id)
		expect(res.tag.description).toBe("cozy")
	})

	test("allows renaming to a genuinely unique name", async () => {
		const { tagsCreate, tagsUpdate } = await import("./tags")
		const user = await makeUser("tags-crud-update-unique-user")

		const tag = await tagsCreate.handler(
			fakeSocket(user.id),
			{ tag: { name: "Drama" } as any },
			noopEmit
		)

		const res = await tagsUpdate.handler(
			fakeSocket(user.id),
			{ tag: { id: tag.tag.id, name: "Melodrama" } as any },
			noopEmit
		)
		expect(res.tag.name).toBe("Melodrama")
	})
})
