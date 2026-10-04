/**
 * A link's description is text, never NULL.
 *
 * The column is `NOT NULL DEFAULT ''` (`0096_link_description_not_null`), and
 * the wire can still carry a missing one: the canvas's edit form sends back
 * `description: null` for a link it read with none. Every writer that meets
 * one writes the empty string, so no edit is refused for it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-empty-link-description-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

describe("a link sent back with no description", () => {
	test("an edit that sends a null description saves the empty string", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "empty-link-description")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Harbor", userId: user.id })
			.returning()
		const members = await testDb
			.insert(schema.lorebookBindings)
			.values([
				{
					lorebookId: lorebook!.id,
					binding: "{{char:1}}",
					name: "Maren"
				},
				{
					lorebookId: lorebook!.id,
					binding: "{{char:2}}",
					name: "Tobin"
				}
			])
			.returning()
		const [link] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: lorebook!.id,
				fromNodeId: members[0]!.id,
				toNodeId: members[1]!.id,
				relationshipType: "ally",
				visibility: "acknowledged",
				status: "active"
			})
			.returning()

		// The canvas's edit form sends a missing description back as null,
		// with the field the person changed.
		const { narrativeGraphUpdateRelationshipHandler } = await import(
			"./narrativeGraph"
		)
		const { relationship } =
			await narrativeGraphUpdateRelationshipHandler.handler(
				fakeSocket(user.id),
				{
					relationship: {
						id: link!.id,
						name: "Old friends",
						description: null
					},
					branchId: null
				} as any,
				() => {}
			)

		expect(relationship.description).toBe("")
		const [row] = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, link!.id))
		expect(row!.title).toBe("Old friends")
		expect(row!.description).toBe("")
	})
})
