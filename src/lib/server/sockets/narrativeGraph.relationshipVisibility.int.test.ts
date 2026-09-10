/**
 * The publicity bound at the commit point (plan §6).
 *
 * `utils/relationshipVisibility.test.ts` pins the rule; this pins that the
 * apply path actually reaches for it, and — the half a unit test cannot see —
 * that it reads presence from the right place. Two sources feed it:
 * `resolvedSceneCast` for a scene this build re-derived, and the stored
 * `scene_characters` rows for every scene it did not touch. An extend-mode build
 * legitimately updates an edge belonging to a scene it never looked at, so
 * missing the second source would silently mark those edges `secret`.
 *
 * ⚠ Presence is taken from PARTICIPANTS, never from the derived mentions. That
 * is deliberate and load-bearing: mentions come from a background lane and can
 * legitimately answer "not yet", and a bound that moved with the lane's progress
 * would make the same edge public on one build and private on the next.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let seq = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-rel-visibility-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

/**
 * A book with one scene, `present` in its cast and `absent` deliberately not.
 *
 * The asymmetry is the fixture: both are real bindings in the same lorebook, so
 * the only thing that can distinguish the edges pointing at them is the cast row.
 */
async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const label = `rel-vis-${seq++}`
	const user = await createTestUser(testDb, label)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: label, userId: user.id })
		.returning()
	const bind = async (name: string, token: string) =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({ lorebookId: lorebook.id, binding: token, name })
				.returning()
		)[0]
	const speaker = await bind("Speaker", "{{char:1}}")
	const present = await bind("Present", "{{char:2}}")
	const absent = await bind("Absent", "{{char:3}}")
	const [historyEntry] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id }]))
		.returning()
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({ lorebookId: lorebook.id, historyEntryId: historyEntry.id })
		.returning()
	await testDb.insert(schema.sceneCharacters).values([
		{
			sceneId: scene.id,
			bindingId: speaker.id,
			role: "participant",
			ordinal: 0
		},
		{
			sceneId: scene.id,
			bindingId: present.id,
			role: "participant",
			ordinal: 1
		}
	])
	return { user, lorebook, scene, speaker, present, absent }
}

async function apply(
	userId: number,
	lorebookId: number,
	proposal: unknown,
	mode: "replace" | "extend" = "extend"
) {
	const { narrativeGraphApplyProposalHandler } = await import(
		"./narrativeGraph"
	)
	return narrativeGraphApplyProposalHandler.handler(
		fakeSocket(userId),
		{ lorebookId, proposal, mode } as any,
		noopEmit
	)
}

const relBetween = async (
	lorebookId: number,
	fromNodeId: number,
	toNodeId: number
) =>
	await testDb.query.narrativeRelationships.findFirst({
		where: and(
			eq(schema.narrativeRelationships.lorebookId, lorebookId),
			eq(schema.narrativeRelationships.fromNodeId, fromNodeId),
			eq(schema.narrativeRelationships.toNodeId, toNodeId)
		)
	})

describe("an inferred edge is bounded by where its object stood", () => {
	test("an object who was only mentioned is capped to secret", async () => {
		const { user, lorebook, scene, speaker, absent } = await makeBook()
		await apply(user.id, lorebook.id, {
			nodes: [],
			relationships: [
				{
					fromTempId: `existing_${speaker.id}`,
					toTempId: `existing_${absent.id}`,
					relationshipType: "rival",
					description: "Speaker has decided he cannot be trusted.",
					// The default the column carries, and the over-scoping this
					// bound exists to stop: Absent was not in the scene, so he
					// cannot be said to acknowledge anything about it.
					visibility: "acknowledged",
					status: "active",
					sceneId: scene.id
				}
			]
		})
		const rel = await relBetween(lorebook.id, speaker.id, absent.id)
		expect(rel?.visibility).toBe("secret")
	}, 60_000)

	test("an object who was present keeps acknowledged", async () => {
		const { user, lorebook, scene, speaker, present } = await makeBook()
		await apply(user.id, lorebook.id, {
			nodes: [],
			relationships: [
				{
					fromTempId: `existing_${speaker.id}`,
					toTempId: `existing_${present.id}`,
					relationshipType: "ally",
					description: "They fought back to back.",
					visibility: "acknowledged",
					status: "active",
					sceneId: scene.id
				}
			]
		})
		const rel = await relBetween(lorebook.id, speaker.id, present.id)
		expect(rel?.visibility).toBe("acknowledged")
	}, 60_000)

	test("public is never inferred, however present everyone was", async () => {
		const { user, lorebook, scene, speaker, present } = await makeBook()
		await apply(user.id, lorebook.id, {
			nodes: [],
			relationships: [
				{
					fromTempId: `existing_${speaker.id}`,
					toTempId: `existing_${present.id}`,
					relationshipType: "ally",
					description: "Everyone saw it.",
					// A model asserting the whole world knows. One scene cannot
					// establish that; only an author can.
					visibility: "public",
					status: "active",
					sceneId: scene.id
				}
			]
		})
		const rel = await relBetween(lorebook.id, speaker.id, present.id)
		expect(rel?.visibility).toBe("acknowledged")
	}, 60_000)

	test("takes presence from the build's own resolved cast", async () => {
		// A scene the build re-derived has no stored participants yet — the
		// write-back happens later in the same transaction — so the bound has to
		// read `resolvedSceneCast`, mapped through the same tempId map the
		// relationships used, or every edge of a freshly-processed scene would
		// come out `secret`.
		const { user, lorebook, speaker, present } = await makeBook()
		const [freshEntry] = await testDb
			.insert(schema.lorebookEntries)
			.values(historyValues([{ lorebookId: lorebook.id }]))
			.returning()
		const [freshScene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: lorebook.id,
				historyEntryId: freshEntry.id
			})
			.returning()

		await apply(user.id, lorebook.id, {
			nodes: [],
			relationships: [
				{
					fromTempId: `existing_${speaker.id}`,
					toTempId: `existing_${present.id}`,
					relationshipType: "mentor",
					description: "She showed him the ropes.",
					visibility: "acknowledged",
					status: "active",
					sceneId: freshScene.id
				}
			],
			resolvedSceneCast: [
				{
					sceneId: freshScene.id,
					historyEntryId: null,
					participantTempIds: [
						`existing_${speaker.id}`,
						`existing_${present.id}`
					],
					mentionedTempIds: []
				}
			]
		})
		const rel = await relBetween(lorebook.id, speaker.id, present.id)
		expect(rel?.visibility).toBe("acknowledged")
	}, 60_000)

	test("an edge with no scene is left at the column's own default", async () => {
		// A direct history entry has no cast row to read. Bounding it at
		// `secret` would invent privacy from an absence of evidence and hide
		// edges nobody claimed were private; `public` is still refused.
		const { user, lorebook, speaker, absent } = await makeBook()
		await apply(user.id, lorebook.id, {
			nodes: [],
			relationships: [
				{
					fromTempId: `existing_${speaker.id}`,
					toTempId: `existing_${absent.id}`,
					relationshipType: "family",
					description: "Cousins, apparently.",
					visibility: "acknowledged",
					status: "active"
				}
			]
		})
		const rel = await relBetween(lorebook.id, speaker.id, absent.id)
		expect(rel?.visibility).toBe("acknowledged")
	}, 60_000)
})

describe("an author's widening survives every subsequent scan", () => {
	test("a stored public is not pulled back down by a re-scan", async () => {
		const { user, lorebook, scene, speaker, absent } = await makeBook()
		// What `narrativeGraph:updateRelationship` writes when a person widens
		// an edge by hand. `public` is unreachable by inference, so a row
		// holding it was authored by construction — that is what makes leaving
		// it alone sound rather than a heuristic.
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: lorebook.id,
			fromNodeId: speaker.id,
			toNodeId: absent.id,
			relationshipType: "rival",
			description: "Everyone in the city knows.",
			visibility: "public",
			status: "active",
			sceneId: scene.id
		})

		// The build comes round again over the same pair. Its object was NOT in
		// the scene, so the bound it would otherwise apply is the tightest one
		// there is — which is exactly the case that must not fire.
		await apply(user.id, lorebook.id, {
			nodes: [],
			relationships: [
				{
					fromTempId: `existing_${speaker.id}`,
					toTempId: `existing_${absent.id}`,
					relationshipType: "rival",
					description: "Still bitter about the bridge.",
					visibility: "acknowledged",
					status: "active",
					sceneId: scene.id
				}
			]
		})

		const rel = await relBetween(lorebook.id, speaker.id, absent.id)
		expect(rel?.visibility).toBe("public")
		// The rest of the update still landed — the guard leaves the visibility
		// column out of the SET list, it does not skip the row.
		expect(rel?.description).toBe("Still bitter about the bridge.")
	}, 60_000)

	test("but a stored acknowledged is still tightened", async () => {
		// The counterweight. If the guard were "never touch a stored value" the
		// bound would be unreachable on every edge that already exists, which is
		// most of them in extend mode.
		const { user, lorebook, scene, speaker, absent } = await makeBook()
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: lorebook.id,
			fromNodeId: speaker.id,
			toNodeId: absent.id,
			relationshipType: "rival",
			description: "An earlier build's guess.",
			visibility: "acknowledged",
			status: "active",
			sceneId: scene.id
		})

		await apply(user.id, lorebook.id, {
			nodes: [],
			relationships: [
				{
					fromTempId: `existing_${speaker.id}`,
					toTempId: `existing_${absent.id}`,
					relationshipType: "rival",
					description: "Still bitter about the bridge.",
					visibility: "acknowledged",
					status: "active",
					sceneId: scene.id
				}
			]
		})

		const rel = await relBetween(lorebook.id, speaker.id, absent.id)
		expect(rel?.visibility).toBe("secret")
	}, 60_000)
})

/**
 * The other side of the same rule.
 *
 * The bound above is a ceiling on what an *inference* may claim; it is not a
 * validator, and `narrativeGraph:updateRelationship` is not an inference. So
 * the authoring path sanitises — the column is an enum and the payload is
 * whatever arrived over the socket — and it must do no more than that.
 * Capping here would take `public` away from the only actor allowed to say it.
 */
describe("the authoring path sanitises, and does not bound", () => {
	const update = async (userId: number, relationship: object) => {
		const { narrativeGraphUpdateRelationshipHandler } = await import(
			"./narrativeGraph"
		)
		return narrativeGraphUpdateRelationshipHandler.handler(
			fakeSocket(userId),
			{ relationship } as any,
			noopEmit
		)
	}

	/** An edge whose object was NOT in the scene — the tightest ceiling there is. */
	async function authoredEdge() {
		const book = await makeBook()
		const [rel] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: book.lorebook.id,
				fromNodeId: book.speaker.id,
				toNodeId: book.absent.id,
				relationshipType: "rival",
				description: "An earlier build's guess.",
				visibility: "acknowledged",
				status: "active",
				sceneId: book.scene.id
			})
			.returning()
		return { ...book, rel }
	}

	test("an author can still widen an edge to public", async () => {
		const { user, lorebook, speaker, absent, rel } = await authoredEdge()
		await update(user.id, { id: rel.id, visibility: "public" })
		// The inference would have capped this pair at `secret`. A person
		// saying it is a claim about the world, which is theirs to make.
		expect(
			(await relBetween(lorebook.id, speaker.id, absent.id))?.visibility
		).toBe("public")
	}, 60_000)

	test("a value the enum does not have never reaches the column", async () => {
		const { user, lorebook, speaker, absent, rel } = await authoredEdge()
		await update(user.id, { id: rel.id, visibility: "notorious" })
		expect(
			(await relBetween(lorebook.id, speaker.id, absent.id))?.visibility
		).toBe("acknowledged")
	}, 60_000)
})
