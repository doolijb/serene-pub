/**
 * Round-12 audit fix (MEDIUM): graphBuilder.ts's LLM-output parsers
 * (parseCharacterPerspectives/parseNodeStateChanges) do pure String(...)
 * coercion with no length cap on description/reason/summary, and no
 * validation of visibility/nodeState against the real
 * RelationshipVisibility/NodeState unions. narrativeGraphApplyProposalHandler
 * is the actual DB commit point for a reviewed/approved proposal — fixed by
 * capping text length and falling back to the existing default for an
 * invalid enum value there, mirroring the defensive checks that handler
 * already has for other client-supplied proposal fields.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
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
		path.join(os.tmpdir(), "serene-pub-applyproposal-validation-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

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

describe("narrativeGraphApplyProposalHandler — proposal length caps + enum validation (Round-12 audit fix, PGlite integration)", () => {
	test("caps an oversized node name/summary and falls back on an invalid nodeState", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("applyproposal-validation-node-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Validation Book", userId: user.id })
			.returning()

		const hugeName = "N".repeat(5000)
		const hugeSummary = "S".repeat(10000)

		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: lorebook.id,
				proposal: {
					nodes: [
						{
							tempId: "new_1",
							name: hugeName,
							nodeState: "not-a-real-state",
							summary: hugeSummary
						}
					],
					relationships: []
				} as any,
				mode: "replace"
			},
			noopEmit
		)

		const rows = await testDb.query.lorebookBindings.findMany({
			where: eq(schema.lorebookBindings.lorebookId, lorebook.id)
		})
		expect(rows).toHaveLength(1)
		expect(rows[0].name.length).toBeLessThanOrEqual(200)
		expect(rows[0].name.length).toBeLessThan(hugeName.length)
		expect(rows[0].summary!.length).toBeLessThanOrEqual(2000)
		expect(rows[0].summary!.length).toBeLessThan(hugeSummary.length)
		// Invalid nodeState falls back to the existing default, not a raw
		// passthrough of the garbage value.
		expect(rows[0].nodeState).toBe("active")
	})

	test("caps an oversized relationship description/reason and falls back on an invalid visibility", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("applyproposal-validation-rel-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Validation Rel Book", userId: user.id })
			.returning()

		const hugeDescription = "D".repeat(10000)
		const hugeReason = "R".repeat(10000)

		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: lorebook.id,
				proposal: {
					nodes: [
						{ tempId: "new_a", name: "A", nodeState: "active", summary: "" },
						{ tempId: "new_b", name: "B", nodeState: "active", summary: "" }
					],
					relationships: [
						{
							fromTempId: "new_a",
							toTempId: "new_b",
							relationshipType: "ally",
							description: hugeDescription,
							visibility: "TOP_SECRET_NOT_REAL",
							status: "active",
							reason: hugeReason
						}
					]
				} as any,
				mode: "replace"
			},
			noopEmit
		)

		const rels = await testDb.query.narrativeRelationships.findMany({
			where: eq(schema.narrativeRelationships.lorebookId, lorebook.id)
		})
		expect(rels).toHaveLength(1)
		expect(rels[0].description.length).toBeLessThanOrEqual(2000)
		expect(rels[0].description.length).toBeLessThan(
			hugeDescription.length
		)
		expect(rels[0].reason!.length).toBeLessThanOrEqual(2000)
		expect(rels[0].reason!.length).toBeLessThan(hugeReason.length)
		// Invalid visibility falls back to the existing default, and — since
		// it fails closed downstream (graphContextFormatter.ts's allowlist
		// filter) — this also prevents a mistyped value from silently and
		// permanently never surfacing in generated context.
		expect(rels[0].visibility).toBe("acknowledged")
	})

	test("valid nodeState/visibility values pass through unchanged", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("applyproposal-validation-valid-user")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Validation Valid Book", userId: user.id })
			.returning()

		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: lorebook.id,
				proposal: {
					nodes: [
						{
							tempId: "new_a",
							name: "A",
							nodeState: "deceased",
							summary: "short summary"
						},
						{
							tempId: "new_b",
							name: "B",
							nodeState: "active",
							summary: ""
						}
					],
					relationships: [
						{
							fromTempId: "new_a",
							toTempId: "new_b",
							relationshipType: "ally",
							description: "a short description",
							visibility: "public",
							status: "active",
							reason: "a short reason"
						}
					]
				} as any,
				mode: "replace"
			},
			noopEmit
		)

		const nodeA = await testDb.query.lorebookBindings.findFirst({
			where: and(
				eq(schema.lorebookBindings.lorebookId, lorebook.id),
				eq(schema.lorebookBindings.name, "A")
			)
		})
		expect(nodeA?.nodeState).toBe("deceased")
		expect(nodeA?.summary).toBe("short summary")

		const rel = await testDb.query.narrativeRelationships.findFirst({
			where: eq(schema.narrativeRelationships.lorebookId, lorebook.id)
		})
		expect(rel?.visibility).toBe("public")
		expect(rel?.description).toBe("a short description")
		expect(rel?.reason).toBe("a short reason")
	})
})
