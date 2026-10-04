/**
 * What the graph's link writers and its list promise, pinned.
 *
 * - **The list is read-only.** It used to "bootstrap" — stamp every
 *   summarized scene as graphed whenever the book had a cast member and no
 *   scene was graphed yet — so a book with a cast and no graph at all had
 *   nothing left for Extend to read.
 * - **The list counts what a Rebuild would delete**: replace deletes the cast
 *   ties only — a link with an entry at either end is out of its reach (owner
 *   ruling 2026-09-29, Q1; places plan L1) — and the confirmation warns with
 *   that count first. `narrativeGraph.rebuildLeavesPlaces.int.test.ts` pins
 *   the places half in both modes.
 * - **Apply stamps what the build READ**, not everything ungraphed at apply
 *   time — a scene summarized mid-build stays for the next Extend.
 * - **Extend never rewrites an old dated version** of a link; a proposal at a
 *   new date inserts a new row.
 * - **A hand-drawn link is on the line it was drawn on**, and only a line of
 *   this book.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { applyAtReview, buildAtReview } from "./fixtures/graphReview"
import {
	historyValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"
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
		path.join(os.tmpdir(), "serene-pub-graph-links-lines-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

let seq = 0
async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `graph-links-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Links Book ${seq}`, userId: user.id })
		.returning()
	const member = async (name: string, token: string) =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({ lorebookId: lorebook.id, binding: token, name })
				.returning()
		)[0]
	const history = async (year: number) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(historyValues([{ lorebookId: lorebook.id, year }]))
				.returning()
		)[0]
	const place = async (name: string) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(
					worldLoreValues([
						{ lorebookId: lorebook.id, name, content: name, keys: "" }
					])
				)
				.returning()
		)[0]
	return { user, lorebook, member, history, place }
}

describe("narrativeGraph:list", () => {
	test("is read-only: a book with a cast and summarized scenes but no links keeps its scenes ungraphed", async () => {
		const { narrativeGraphListHandler } = await import("./narrativeGraph")
		const b = await makeBook()
		await b.member("Aria", "{{char:1}}")
		const h1 = await b.history(1)
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: b.lorebook.id,
				historyEntryId: h1.id,
				summary: "Aria arrived."
			})
			.returning()

		const res = await narrativeGraphListHandler.handler(
			fakeSocket(b.user.id),
			{ lorebookId: b.lorebook.id },
			noopEmit
		)

		expect(res.ungraphedSceneCount).toBe(1)
		const [after] = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, scene.id))
		expect(after.graphed).toBe(false)
	}, 60_000)

	test("counts the links a Rebuild would delete, and replace deletes the cast ties only (L1)", async () => {
		const { narrativeGraphListHandler, narrativeGraphApplyProposalHandler } =
			await import("./narrativeGraph")
		const b = await makeBook()
		const aria = await b.member("Aria", "{{char:1}}")
		const bram = await b.member("Bram", "{{char:2}}")
		const ford = await b.place("The Ford")
		const mill = await b.place("The Mill")
		await testDb.insert(schema.narrativeRelationships).values([
			// cast to cast — the one kind a rebuild re-derives
			{
				lorebookId: b.lorebook.id,
				fromNodeId: aria.id,
				toNodeId: bram.id,
				relationshipType: "ally"
			},
			// entry to entry — a road
			{
				lorebookId: b.lorebook.id,
				fromEntryId: ford.id,
				toEntryId: mill.id,
				relationshipType: "leads to"
			},
			// cast to entry — a keeper
			{
				lorebookId: b.lorebook.id,
				fromNodeId: aria.id,
				toEntryId: ford.id,
				relationshipType: "keeps"
			}
		])

		const listed = await narrativeGraphListHandler.handler(
			fakeSocket(b.user.id),
			{ lorebookId: b.lorebook.id },
			noopEmit
		)
		expect(listed.relationshipCounts).toEqual({ castToCast: 1 })

		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(b.user.id),
			applyAtReview(b.user.id, {
				lorebookId: b.lorebook.id,
				mode: "replace",
				proposal: { nodes: [], relationships: [] }
			}),
			noopEmit
		)
		const left = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, b.lorebook.id))
		// The road and the keeper stay; the tie went.
		expect(left.map((r) => r.relationshipType).sort()).toEqual([
			"keeps",
			"leads to"
		])
	}, 60_000)
})

describe("narrativeGraph:applyProposal — what gets marked graphed", () => {
	test("stamps only the scenes the build read, not one summarized while it ran", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const b = await makeBook()
		const h1 = await b.history(1)
		const [read, lateComer] = await testDb
			.insert(schema.scenes)
			.values([
				{
					lorebookId: b.lorebook.id,
					historyEntryId: h1.id,
					summary: "Read by the build."
				},
				{
					lorebookId: b.lorebook.id,
					historyEntryId: h1.id,
					summary: "Summarized while the build was running."
				}
			])
			.returning()
		const activityId = buildAtReview({
			userId: b.user.id,
			lorebookId: b.lorebook.id,
			mode: "extend",
			proposal: { nodes: [], relationships: [] },
			processedSceneIds: [read.id]
		})

		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(b.user.id),
			{
				lorebookId: b.lorebook.id,
				proposal: { nodes: [], relationships: [] },
				activityId
			},
			noopEmit
		)
		// The apply consumed the build.
		expect(activityStore.getById(activityId)).toBeUndefined()

		const rows = await testDb
			.select({ id: schema.scenes.id, graphed: schema.scenes.graphed })
			.from(schema.scenes)
			.where(eq(schema.scenes.lorebookId, b.lorebook.id))
		const graphed = Object.fromEntries(rows.map((r) => [r.id, r.graphed]))
		expect(graphed[read.id]).toBe(true)
		expect(graphed[lateComer.id]).toBe(false)
	}, 60_000)
})

describe("narrativeGraph:applyProposal — Extend and dated versions", () => {
	test("a proposal at a new date inserts a new version; one at the same date updates that version", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const b = await makeBook()
		const aria = await b.member("Aria", "{{char:1}}")
		const bram = await b.member("Bram", "{{char:2}}")
		const y1 = await b.history(1)
		const y5 = await b.history(5)
		const [old] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: b.lorebook.id,
				fromNodeId: aria.id,
				toNodeId: bram.id,
				relationshipType: "ally",
				description: "Sworn at the ford.",
				historyEntryId: y1.id
			})
			.returning()
		const propose = (historyEntryId: number, description: string) =>
			narrativeGraphApplyProposalHandler.handler(
				fakeSocket(b.user.id),
				applyAtReview(b.user.id, {
					lorebookId: b.lorebook.id,
					mode: "extend",
					proposal: {
						nodes: [],
						relationships: [
							{
								fromTempId: `existing_${aria.id}`,
								toTempId: `existing_${bram.id}`,
								relationshipType: "ally",
								description,
								visibility: "acknowledged",
								status: "active",
								historyEntryId
							}
						]
					}
				}),
				noopEmit
			)

		await propose(y5.id, "Strained by the war.")
		let rows = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, b.lorebook.id))
		expect(rows).toHaveLength(2)
		expect(rows.find((r) => r.id === old.id)?.description).toBe(
			"Sworn at the ford."
		)
		expect(
			rows.find((r) => r.historyEntryId === y5.id)?.description
		).toBe("Strained by the war.")

		await propose(y1.id, "Sworn at the ford, in blood.")
		rows = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, b.lorebook.id))
		expect(rows).toHaveLength(2)
		expect(rows.find((r) => r.id === old.id)?.description).toBe(
			"Sworn at the ford, in blood."
		)
	}, 60_000)
})

describe("narrativeGraph:createRelationship — the line", () => {
	test("a link drawn on a fork is that fork's; another book's branch is refused", async () => {
		const { narrativeGraphCreateRelationshipHandler } = await import(
			"./narrativeGraph"
		)
		const b = await makeBook()
		const other = await makeBook()
		const aria = await b.member("Aria", "{{char:1}}")
		const bram = await b.member("Bram", "{{char:2}}")
		const [fork] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: b.lorebook.id, name: "What if" })
			.returning()
		const [foreign] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: other.lorebook.id, name: "Elsewhere" })
			.returning()
		const draw = (branchId: number | null) =>
			narrativeGraphCreateRelationshipHandler.handler(
				fakeSocket(b.user.id),
				{
					lorebookId: b.lorebook.id,
					from: { kind: "cast", bindingId: aria.id },
					to: { kind: "cast", bindingId: bram.id },
					relationshipType: "rival",
					status: "active",
					branchId
				},
				noopEmit
			)

		const { relationship } = await draw(fork.id)
		expect(relationship.branchId).toBe(fork.id)
		await expect(draw(foreign.id)).rejects.toThrow(/branch not found/i)
		const onMain = await draw(null)
		expect(onMain.relationship.branchId).toBeNull()
	}, 60_000)
})
