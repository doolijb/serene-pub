/**
 * The graph review round trip, driven with what the CLIENT sends (plan A21).
 *
 * Every apply here is built by `applyProposalParams` — the one function
 * GraphBuildModal's Apply calls — from the build as Layout copies it out of
 * `activity:update` and the review as the modal restores it, then sent through
 * a JSON round trip as the socket would. The older apply tests called the
 * handler with hand-made params that carried `resolvedSceneCast`, which the
 * modal never sent, so none of them saw that:
 *
 * - no scene's cast was ever saved (`castResolvedAt` stayed null, so every
 *   build re-extracted every scene), and presence fell back to an empty stored
 *   cast — new edges were born `secret` and Extend demoted `acknowledged` ones;
 * - the mode came from the modal, not the build — a parked Rebuild reopened
 *   from a session's Extend button applied as Extend;
 * - nothing consumed the build, so a retry or a second tab applied it twice;
 * - removing a proposed character in review made Apply fail outright.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	applyProposalParams,
	nextApplyRequestId,
	type ReviewedProposal
} from "$lib/client/components/modals/graphProposalApply"
import { buildAtReview } from "./fixtures/graphReview"
import { writeSceneCast } from "$lib/server/utils/sceneCast"

let testDb: TestDb
let dataDir: string
let seq = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

/** The guard, passed through — so a test can see the apply ask it. */
vi.mock("$lib/server/utils/relationshipGuards", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/utils/relationshipGuards")
		>()
	return {
		...actual,
		assertRelationshipWrite: vi.fn(actual.assertRelationshipWrite)
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-review-round-trip-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

/**
 * A book the way a first build finds it: three members, two summarized
 * scenes whose cast was never resolved (so the build derived it), one of
 * which has a single character in it — Lone, who has nobody to relate to.
 */
async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const label = `review-rt-${seq++}`
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
	const aria = await bind("Aria", "{{char:1}}")
	const kael = await bind("Kael", "{{char:2}}")
	const lone = await bind("Lone", "{{char:3}}")
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id }]))
		.returning()
	const [together, alone] = await testDb
		.insert(schema.scenes)
		.values([
			{
				lorebookId: lorebook.id,
				historyEntryId: history.id,
				summary: "Aria and Kael meet Mira."
			},
			{
				lorebookId: lorebook.id,
				historyEntryId: history.id,
				summary: "Lone keeps watch."
			}
		])
		.returning()
	const ex = (b: { id: number }) => `existing_${b.id}`
	/** What the build proposed, as `narrativeGraph:build` parks it. */
	const proposal: Sockets.NarrativeGraph.GraphProposal = {
		nodes: [
			{
				tempId: "new_1",
				name: "Mira",
				nodeState: "active",
				summary: "A traveller.",
				sceneIndex: 0,
				sceneId: together.id
			}
		],
		relationships: [
			{
				fromTempId: ex(aria),
				toTempId: ex(kael),
				relationshipType: "ally",
				description: "They fought side by side.",
				visibility: "acknowledged",
				status: "active",
				sceneIndex: 0,
				sceneId: together.id,
				historyEntryId: history.id
			},
			{
				fromTempId: ex(aria),
				toTempId: "new_1",
				relationshipType: "mentor",
				description: "Aria teaches Mira.",
				visibility: "acknowledged",
				status: "active",
				sceneIndex: 0,
				sceneId: together.id,
				historyEntryId: history.id
			},
			{
				fromTempId: "new_1",
				toTempId: ex(kael),
				relationshipType: "rival",
				description: "Mira distrusts Kael.",
				visibility: "acknowledged",
				status: "active",
				sceneIndex: 0,
				sceneId: together.id,
				historyEntryId: history.id
			}
		],
		updatedNodes: [],
		resolvedSceneCast: [
			{
				sceneId: together.id,
				historyEntryId: null,
				participantTempIds: [ex(aria), ex(kael), "new_1"],
				mentionedTempIds: []
			},
			{
				sceneId: alone.id,
				historyEntryId: null,
				participantTempIds: [ex(lone)],
				mentionedTempIds: []
			}
		]
	}
	return { user, lorebook, aria, kael, lone, history, together, alone, proposal }
}

type Book = Awaited<ReturnType<typeof makeBook>>

/** Every member's name by tempId, as a build records the cast it read. */
const seedNodeNamesOf = (b: Book) =>
	Object.fromEntries(
		[b.aria, b.kael, b.lone].map((m) => [`existing_${m.id}`, m.name])
	)

/** The build at review, as `narrativeGraph:build` leaves it. */
function atReview(b: Book, mode: "replace" | "extend", proposal = b.proposal) {
	return buildAtReview({
		userId: b.user.id,
		lorebookId: b.lorebook.id,
		mode,
		proposal,
		processedSceneIds: [b.together.id, b.alone.id],
		seedNodeNames: seedNodeNamesOf(b)
	})
}

/**
 * The params GraphBuildModal's Apply emits for the build parked as
 * `activityId`: the build as Layout copies it, the review as the modal's
 * restore copies it (then `edit` for what the person did), a fresh
 * `requestId` — and the JSON round trip the socket puts it through. The
 * modal's own mode prop is not an input: Apply does not send one.
 */
async function modalParams(
	b: Book,
	activityId: string,
	opts: { edit?: (review: ReviewedProposal) => void } = {}
): Promise<Sockets.NarrativeGraph.ApplyProposal.Params> {
	const { activityStore } = await import("$lib/server/utils/activityStore")
	const a = activityStore.getById(activityId) as any
	const build: GraphBuildState = {
		activityId: a.id,
		userId: a.userId,
		lorebookId: a.lorebookId,
		mode: a.mode,
		status: a.status,
		phase: a.phase,
		sceneIndex: a.sceneIndex,
		totalScenes: a.totalScenes,
		nodesFound: a.nodesFound,
		relsFound: a.relsFound,
		proposal: JSON.parse(JSON.stringify(a.proposal)),
		sceneLabels: a.sceneLabels,
		seedTempIdMap: a.seedTempIdMap,
		seedNodeNames: a.seedNodeNames,
		startedAt: a.startedAt
	}
	const review: ReviewedProposal = {
		nodes: (build.proposal?.nodes ?? []).map((n) => ({ ...n })),
		relationships: (build.proposal?.relationships ?? []).map((r) => ({
			...r
		})),
		updatedNodes: (build.proposal?.updatedNodes ?? []).map((u) => ({
			...u
		}))
	}
	opts.edit?.(review)
	const params = applyProposalParams({
		lorebookId: b.lorebook.id,
		build,
		review,
		requestId: nextApplyRequestId()
	})
	return JSON.parse(JSON.stringify(params))
}

/** Run the handler as `register()` would, recording every emit. */
async function send(userId: number, params: unknown) {
	const { narrativeGraphApplyProposalHandler } = await import(
		"./narrativeGraph"
	)
	const emits: { event: string; data: any }[] = []
	const emit = (event: string, data: any) => {
		if (typeof data !== "function") emits.push({ event, data })
	}
	let error: unknown
	let reply: any
	try {
		reply = await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(userId),
			params as any,
			emit
		)
	} catch (e) {
		error = e
	}
	const refusal = emits.find(
		(e) => e.event === "narrativeGraph:applyProposal:error"
	)?.data
	return { reply, error, emits, refusal }
}

const membersNamed = async (lorebookId: number, name: string) =>
	testDb.query.lorebookBindings.findMany({
		where: and(
			eq(schema.lorebookBindings.lorebookId, lorebookId),
			eq(schema.lorebookBindings.name, name)
		)
	})

const tie = async (lorebookId: number, fromId: number, toId: number) =>
	testDb.query.narrativeRelationships.findMany({
		where: and(
			eq(schema.narrativeRelationships.lorebookId, lorebookId),
			eq(schema.narrativeRelationships.fromNodeId, fromId),
			eq(schema.narrativeRelationships.toNodeId, toId)
		)
	})

const participantsOf = async (sceneId: number) =>
	(
		await testDb.query.sceneCharacters.findMany({
			where: and(
				eq(schema.sceneCharacters.sceneId, sceneId),
				eq(schema.sceneCharacters.role, "participant")
			)
		})
	)
		.map((r) => r.bindingId)
		.sort((x, y) => x - y)

describe("the modal's apply carries the build's cast", () => {
	test("scene casts are saved — the lone participant too — and new edges are not born secret", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const params = await modalParams(b, activityId)
		const { error } = await send(b.user.id, params)
		expect(error).toBeUndefined()

		const scenes = await testDb.query.scenes.findMany({
			where: eq(schema.scenes.lorebookId, b.lorebook.id)
		})
		for (const s of scenes) expect(s.castResolvedAt).not.toBeNull()
		const [mira] = await membersNamed(b.lorebook.id, "Mira")
		expect(await participantsOf(b.together.id)).toEqual(
			[b.aria.id, b.kael.id, mira.id].sort((x, y) => x - y)
		)
		// Lone is in no relationship and no update — still in his scene.
		expect(await participantsOf(b.alone.id)).toEqual([b.lone.id])

		const [ally] = await tie(b.lorebook.id, b.aria.id, b.kael.id)
		expect(ally.visibility).toBe("acknowledged")
		const [mentor] = await tie(b.lorebook.id, b.aria.id, mira.id)
		expect(mentor.visibility).toBe("acknowledged")
	}, 60_000)

	test("Extend does not demote an acknowledged edge the build re-states", async () => {
		const b = await makeBook()
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: b.lorebook.id,
			fromNodeId: b.aria.id,
			toNodeId: b.kael.id,
			relationshipType: "ally",
			description: "Old friends.",
			visibility: "acknowledged",
			status: "active",
			sceneId: b.together.id,
			historyEntryId: b.history.id
		})
		const activityId = atReview(b, "extend")
		const { error } = await send(b.user.id, await modalParams(b, activityId))
		expect(error).toBeUndefined()

		const rows = await tie(b.lorebook.id, b.aria.id, b.kael.id)
		expect(rows).toHaveLength(1)
		expect(rows[0].visibility).toBe("acknowledged")
		expect(rows[0].description).toBe("They fought side by side.")
	}, 60_000)
})

describe("the build decides the mode, never the modal", () => {
	test("a parked Rebuild applied from a session's Extend button still rebuilds", async () => {
		const b = await makeBook()
		// A tie the rebuild does not re-derive: Rebuild deletes it, Extend keeps it.
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: b.lorebook.id,
			fromNodeId: b.kael.id,
			toNodeId: b.lone.id,
			relationshipType: "enemy",
			description: "",
			visibility: "acknowledged",
			status: "active"
		})
		const activityId = atReview(b, "replace")
		// The modal was opened as Extend (SessionWorkflowTab's `mode="extend"`);
		// what it sends has no mode in it at all.
		const params = await modalParams(b, activityId)
		expect("mode" in params).toBe(false)
		const { error } = await send(b.user.id, params)
		expect(error).toBeUndefined()
		expect(await tie(b.lorebook.id, b.kael.id, b.lone.id)).toHaveLength(0)
	}, 60_000)
})

describe("a build is applied once", () => {
	test("the apply consumes the build; a retry is refused in a sentence and writes nothing", async () => {
		const b = await makeBook()
		const { activityStore } = await import(
			"$lib/server/utils/activityStore"
		)
		const activityId = atReview(b, "extend")
		const params = await modalParams(b, activityId)
		const first = await send(b.user.id, params)
		expect(first.error).toBeUndefined()
		expect(activityStore.getById(activityId)).toBeUndefined()

		const again = await send(b.user.id, params)
		expect(again.error).toBeDefined()
		expect(again.refusal?.error).toMatch(/already been applied/)
		expect(again.refusal?.error).toMatch(/Nothing was changed/)
		expect(again.refusal?.lorebookId).toBe(b.lorebook.id)
		expect(await membersNamed(b.lorebook.id, "Mira")).toHaveLength(1)
		expect(await tie(b.lorebook.id, b.aria.id, b.kael.id)).toHaveLength(1)
	}, 60_000)

	test("two tabs applying at once: exactly one lands", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const params = await modalParams(b, activityId)
		const [one, two] = await Promise.all([
			send(b.user.id, params),
			send(b.user.id, params)
		])
		expect([one.error, two.error].filter((e) => e === undefined)).toHaveLength(1)
		expect(await membersNamed(b.lorebook.id, "Mira")).toHaveLength(1)
		expect(await tie(b.lorebook.id, b.aria.id, b.kael.id)).toHaveLength(1)
	}, 60_000)

	test("a refused apply leaves the build parked, so the person can fix it and apply again", async () => {
		const b = await makeBook()
		const { activityStore } = await import(
			"$lib/server/utils/activityStore"
		)
		const activityId = atReview(b, "extend")
		const blank = await send(
			b.user.id,
			await modalParams(b, activityId, {
				edit: (r) => {
					r.nodes[0].name = "   "
				}
			})
		)
		expect(blank.error).toBeDefined()
		expect(activityStore.getById(activityId)).toBeDefined()
		const ok = await send(b.user.id, await modalParams(b, activityId))
		expect(ok.error).toBeUndefined()
	}, 60_000)
})

describe("removing a proposed character in review", () => {
	test("its relationships go with it and the rest applies", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const params = await modalParams(b, activityId, {
			edit: (r) => {
				r.nodes[0]._deleted = true
			}
		})
		const { error } = await send(b.user.id, params)
		expect(error).toBeUndefined()
		expect(await membersNamed(b.lorebook.id, "Mira")).toHaveLength(0)
		expect(await tie(b.lorebook.id, b.aria.id, b.kael.id)).toHaveLength(1)
		// Mira is gone from the scene's saved cast, and the others stay.
		expect(await participantsOf(b.together.id)).toEqual(
			[b.aria.id, b.kael.id].sort((x, y) => x - y)
		)
	}, 60_000)

	test("the server drops a relationship still naming her, with a plain note", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const params = await modalParams(b, activityId)
		// A client that did not take her relationships with her.
		params.proposal.nodes = []
		const { error, reply } = await send(b.user.id, params)
		expect(error).toBeUndefined()
		expect(reply.applyNotes).toEqual([
			"2 relationships were left out because a character they name was removed from the proposal."
		])
		expect(await membersNamed(b.lorebook.id, "Mira")).toHaveLength(0)
		expect(await tie(b.lorebook.id, b.aria.id, b.kael.id)).toHaveLength(1)
	}, 60_000)
})

describe("what the apply checks before it writes", () => {
	test("a relationship type is capped and an unknown status falls back to active", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const { error } = await send(
			b.user.id,
			await modalParams(b, activityId, {
				edit: (r) => {
					r.relationships[0].relationshipType = "x".repeat(5000)
					r.relationships[0].status = "exploded"
				}
			})
		)
		expect(error).toBeUndefined()
		const [row] = await tie(b.lorebook.id, b.aria.id, b.kael.id)
		expect(row.relationshipType.length).toBeLessThanOrEqual(100)
		expect(row.status).toBe("active")
	}, 60_000)

	test("a new character with no name is refused in a sentence", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const params = await modalParams(b, activityId, {
			edit: (r) => {
				r.nodes[0].name = "  "
			}
		})
		const { refusal } = await send(b.user.id, params)
		expect(refusal?.error).toBe(
			"Every new character needs a name. Nothing was changed."
		)
		expect(refusal?.requestId).toBe(params.requestId)
		expect(
			await testDb.query.lorebookBindings.findMany({
				where: eq(schema.lorebookBindings.lorebookId, b.lorebook.id)
			})
		).toHaveLength(3)
	}, 60_000)

	test("a field of the wrong kind is refused in a sentence, not a TypeError", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const params = await modalParams(b, activityId)
		;(params.proposal.nodes[0] as any).name = 42
		const { refusal } = await send(b.user.id, params)
		expect(refusal?.error).toBe(
			"This graph proposal could not be read. Nothing was changed."
		)
	}, 60_000)

	test("a character sent twice, or one the build never proposed, is refused", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const twice = await modalParams(b, activityId)
		twice.proposal.nodes.push({ ...twice.proposal.nodes[0] })
		expect((await send(b.user.id, twice)).refusal?.error).toBe(
			"This proposal does not match the build it came from. Nothing was changed; build the graph again."
		)
		const invented = await modalParams(b, activityId)
		invented.proposal.nodes.push({
			tempId: "new_99",
			name: "Stranger",
			nodeState: "active",
			summary: ""
		})
		expect((await send(b.user.id, invented)).refusal?.error).toBe(
			"This proposal does not match the build it came from. Nothing was changed; build the graph again."
		)
		expect(await membersNamed(b.lorebook.id, "Mira")).toHaveLength(0)
	}, 60_000)

	test("a new character who joined the cast during review is the one member, with a note", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const [mira] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: b.lorebook.id, binding: "{{char:4}}", name: "Mira" })
			.returning()
		const { error, reply } = await send(
			b.user.id,
			await modalParams(b, activityId)
		)
		expect(error).toBeUndefined()
		expect(await membersNamed(b.lorebook.id, "Mira")).toHaveLength(1)
		expect(await tie(b.lorebook.id, b.aria.id, mira.id)).toHaveLength(1)
		expect(reply.applyNotes).toContain(
			"Mira is already in the cast, so the proposal's Mira was added to that member instead of a new one."
		)
	}, 60_000)

	test("a new character renamed to a member she then links to leaves that self-link out, with a note", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const { error, reply } = await send(
			b.user.id,
			await modalParams(b, activityId, {
				edit: (r) => {
					r.nodes[0].name = "Kael"
				}
			})
		)
		expect(error).toBeUndefined()
		expect(await tie(b.lorebook.id, b.kael.id, b.kael.id)).toHaveLength(0)
		expect(await tie(b.lorebook.id, b.aria.id, b.kael.id)).toHaveLength(2)
		expect(reply.applyNotes).toContain(
			"1 relationship was left out because both its ends are now Kael."
		)
	}, 60_000)

	test("a new character named after a place is refused in a sentence", async () => {
		const b = await makeBook()
		await testDb.insert(schema.lorebookEntries).values(
			entryInsert({
				lorebookId: b.lorebook.id,
				typeId: LOCATION_TYPE_ID,
				position: 1,
				name: "The Harbor",
				content: "A harbor.",
				keys: ""
			} as any)
		)
		const activityId = atReview(b, "extend")
		const { refusal } = await send(
			b.user.id,
			await modalParams(b, activityId, {
				edit: (r) => {
					r.nodes[0].name = "Harbor"
				}
			})
		)
		expect(refusal?.error).toBe(
			"“Harbor” is the name of a place or thing in this book, so it can't be added as a character. Rename it or remove it, then apply again. Nothing was changed."
		)
		expect(await membersNamed(b.lorebook.id, "Harbor")).toHaveLength(0)
	}, 60_000)
})

describe("refusals reach the person as sentences", () => {
	test("a scene only the cast names, deleted during review, is skipped — nothing is left to save", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		await testDb.delete(schema.scenes).where(eq(schema.scenes.id, b.alone.id))
		const { error } = await send(b.user.id, await modalParams(b, activityId))
		expect(error).toBeUndefined()
		expect(await membersNamed(b.lorebook.id, "Mira")).toHaveLength(1)
	}, 60_000)

	test("a scene deleted during review", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		await testDb
			.delete(schema.scenes)
			.where(eq(schema.scenes.id, b.together.id))
		const params = await modalParams(b, activityId)
		const { refusal } = await send(b.user.id, params)
		expect(refusal?.error).toBe(
			"A scene this proposal came from has been deleted. Nothing was changed; build the graph again."
		)
		expect(refusal?.lorebookId).toBe(b.lorebook.id)
		expect(refusal?.requestId).toBe(params.requestId)
	}, 60_000)

	test("a history entry deleted during review", async () => {
		const b = await makeBook()
		// A relationship dated by a second history entry, with no scenes of
		// its own — the one deleted while the review is open.
		const [later] = await testDb
			.insert(schema.lorebookEntries)
			.values(historyValues([{ lorebookId: b.lorebook.id }]))
			.returning()
		const proposal = structuredClone(b.proposal)
		proposal.relationships[0].historyEntryId = later.id
		const activityId = atReview(b, "extend", proposal)
		const params = await modalParams(b, activityId)
		await testDb
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, later.id))
		const { refusal } = await send(b.user.id, params)
		expect(refusal?.error).toBe(
			"A history entry this proposal came from has been deleted. Nothing was changed; build the graph again."
		)
	}, 60_000)

	test("a book that is not yours", async () => {
		const b = await makeBook()
		const other = await makeBook()
		const activityId = atReview(b, "extend")
		const params = await modalParams(b, activityId)
		const { refusal } = await send(other.user.id, params)
		expect(refusal?.error).toBe(
			"That lorebook was not found. Nothing was changed."
		)
	}, 60_000)

	test("the reply names the book and the request it answers", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const params = await modalParams(b, activityId)
		const { reply } = await send(b.user.id, params)
		expect(reply.lorebookId).toBe(b.lorebook.id)
		expect(reply.requestId).toBe(params.requestId)
		expect(reply.applyNotes).toEqual([])
	}, 60_000)
})

describe("the apply runs the relationship write guard", () => {
	test("every relationship it writes is judged — inserts and updates", async () => {
		const guards = await import("$lib/server/utils/relationshipGuards")
		const spy = guards.assertRelationshipWrite as unknown as ReturnType<
			typeof vi.fn
		>
		const b = await makeBook()
		const [standing] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: b.lorebook.id,
				fromNodeId: b.aria.id,
				toNodeId: b.kael.id,
				relationshipType: "ally",
				description: "",
				visibility: "acknowledged",
				status: "active",
				sceneId: b.together.id,
				historyEntryId: b.history.id
			})
			.returning()
		spy.mockClear()
		const activityId = atReview(b, "extend")
		const { error } = await send(b.user.id, await modalParams(b, activityId))
		expect(error).toBeUndefined()
		const ops = spy.mock.calls.map((c: any[]) => c[1].op)
		expect(ops.filter((o: string) => o === "create")).toHaveLength(2)
		expect(ops.filter((o: string) => o === "update")).toHaveLength(1)
		const update = spy.mock.calls.find((c: any[]) => c[1].op === "update")!
		expect(update[1].row.id).toBe(standing.id)
		expect(update[1].line).toBeNull()
		// Nothing drawn on a line: an apply writes main.
		const rows = await testDb.query.narrativeRelationships.findMany({
			where: and(
				eq(schema.narrativeRelationships.lorebookId, b.lorebook.id),
				isNull(schema.narrativeRelationships.branchId)
			)
		})
		expect(rows).toHaveLength(3)
	}, 60_000)
})

/** A scene's cast, saved as an earlier apply saves it. */
async function savedCast(sceneId: number, participants: number[]) {
	await writeSceneCast(sceneId, { participantCharacters: participants }, testDb as any)
	await testDb
		.update(schema.scenes)
		.set({ castResolvedAt: new Date() })
		.where(eq(schema.scenes.id, sceneId))
}

/**
 * A tie filed at `together`, and a build that re-states it from a later scene
 * of the same date in which only Aria appears.
 */
async function reStatedFromALaterScene(b: Book) {
	await testDb.insert(schema.narrativeRelationships).values({
		lorebookId: b.lorebook.id,
		fromNodeId: b.aria.id,
		toNodeId: b.kael.id,
		relationshipType: "ally",
		description: "Old friends.",
		visibility: "acknowledged",
		status: "active",
		sceneId: b.together.id,
		historyEntryId: b.history.id
	})
	const [later] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: b.lorebook.id,
			historyEntryId: b.history.id,
			summary: "Aria speaks of Kael."
		})
		.returning()
	const proposal: Sockets.NarrativeGraph.GraphProposal = {
		nodes: [],
		relationships: [
			{
				fromTempId: `existing_${b.aria.id}`,
				toTempId: `existing_${b.kael.id}`,
				relationshipType: "ally",
				description: "Still loyal to Kael.",
				visibility: "acknowledged",
				status: "active",
				sceneIndex: 0,
				sceneId: later.id,
				historyEntryId: b.history.id
			}
		],
		updatedNodes: [],
		resolvedSceneCast: [
			{
				sceneId: later.id,
				historyEntryId: null,
				participantTempIds: [`existing_${b.aria.id}`],
				mentionedTempIds: []
			}
		]
	}
	return buildAtReview({
		userId: b.user.id,
		lorebookId: b.lorebook.id,
		mode: "extend",
		proposal,
		processedSceneIds: [later.id],
		seedNodeNames: seedNodeNamesOf(b)
	})
}

describe("a tie re-stated from a later scene of the same date (plan A21 review)", () => {
	test("is not made secret when the scene it is filed at is not known to have lacked its object", async () => {
		const b = await makeBook()
		const activityId = await reStatedFromALaterScene(b)
		const { error, reply } = await send(b.user.id, await modalParams(b, activityId))
		expect(error).toBeUndefined()
		const rows = await tie(b.lorebook.id, b.aria.id, b.kael.id)
		expect(rows).toHaveLength(1)
		expect(rows[0].description).toBe("Still loyal to Kael.")
		expect(rows[0].visibility).toBe("acknowledged")
		expect(reply.applyNotes).toEqual([])
	}, 60_000)

	test("nor is a secret tie made known by it", async () => {
		const b = await makeBook()
		const activityId = await reStatedFromALaterScene(b)
		await testDb
			.update(schema.narrativeRelationships)
			.set({ visibility: "secret" })
			.where(eq(schema.narrativeRelationships.lorebookId, b.lorebook.id))
		await send(b.user.id, await modalParams(b, activityId))
		const [row] = await tie(b.lorebook.id, b.aria.id, b.kael.id)
		expect(row.visibility).toBe("secret")
		expect(row.description).toBe("Still loyal to Kael.")
	}, 60_000)

	test("nor when its own scene had its object", async () => {
		const b = await makeBook()
		await savedCast(b.together.id, [b.aria.id, b.kael.id])
		const activityId = await reStatedFromALaterScene(b)
		await send(b.user.id, await modalParams(b, activityId))
		const [row] = await tie(b.lorebook.id, b.aria.id, b.kael.id)
		expect(row.visibility).toBe("acknowledged")
	}, 60_000)

	test("but is when neither scene had its object — and the apply says so", async () => {
		const b = await makeBook()
		await savedCast(b.together.id, [b.aria.id])
		const activityId = await reStatedFromALaterScene(b)
		const { reply } = await send(b.user.id, await modalParams(b, activityId))
		const [row] = await tie(b.lorebook.id, b.aria.id, b.kael.id)
		expect(row.visibility).toBe("secret")
		expect(reply.applyNotes).toEqual([
			"1 relationship was saved as secret, because the character it is about was not in the scene it came from."
		])
	}, 60_000)
})

describe("what the person chose in review is what is written (plan A21 review)", () => {
	test("a visibility picked in review is written as picked — public too", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const { error, reply } = await send(
			b.user.id,
			await modalParams(b, activityId, {
				edit: (r) => {
					r.relationships[0].visibility = "public"
				}
			})
		)
		expect(error).toBeUndefined()
		const [ally] = await tie(b.lorebook.id, b.aria.id, b.kael.id)
		expect(ally.visibility).toBe("public")
		expect(reply.applyNotes).toEqual([])
	}, 60_000)

	test("a picked visibility is written over a standing tie's — even an authored public", async () => {
		const b = await makeBook()
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: b.lorebook.id,
			fromNodeId: b.aria.id,
			toNodeId: b.kael.id,
			relationshipType: "ally",
			description: "",
			visibility: "public",
			status: "active",
			sceneId: b.together.id,
			historyEntryId: b.history.id
		})
		const proposal = structuredClone(b.proposal)
		proposal.relationships[0].visibility = "secret"
		const activityId = atReview(b, "extend", proposal)
		await send(
			b.user.id,
			await modalParams(b, activityId, {
				edit: (r) => {
					r.relationships[0].visibility = "acknowledged"
				}
			})
		)
		const rows = await tie(b.lorebook.id, b.aria.id, b.kael.id)
		expect(rows).toHaveLength(1)
		expect(rows[0].visibility).toBe("acknowledged")
	}, 60_000)

	test("a claim the review left alone never pulls an authored public down", async () => {
		const b = await makeBook()
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: b.lorebook.id,
			fromNodeId: b.aria.id,
			toNodeId: b.kael.id,
			relationshipType: "ally",
			description: "",
			visibility: "public",
			status: "active",
			sceneId: b.together.id,
			historyEntryId: b.history.id
		})
		const activityId = atReview(b, "extend")
		await send(b.user.id, await modalParams(b, activityId))
		const [row] = await tie(b.lorebook.id, b.aria.id, b.kael.id)
		expect(row.visibility).toBe("public")
	}, 60_000)

	test("a claim the review left alone is still bounded, and the apply says so", async () => {
		const b = await makeBook()
		const proposal = structuredClone(b.proposal)
		// Kael was not in the scene the tie came from.
		proposal.resolvedSceneCast![0].participantTempIds = [
			`existing_${b.aria.id}`,
			"new_1"
		]
		const activityId = atReview(b, "extend", proposal)
		const { reply } = await send(b.user.id, await modalParams(b, activityId))
		const [ally] = await tie(b.lorebook.id, b.aria.id, b.kael.id)
		expect(ally.visibility).toBe("secret")
		expect(reply.applyNotes).toEqual([
			"2 relationships were saved as secret, because the character each is about was not in the scene it came from."
		])
	}, 60_000)
})

describe("a member deleted or merged while the review is open (plan A21 review)", () => {
	test("deleted, and named only by a scene's cast: the scene is saved without them, with a note", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const params = await modalParams(b, activityId)
		// Lone is in no relationship and no change — only in the lone scene's cast.
		await testDb
			.delete(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, b.lone.id))
		const { error, reply } = await send(b.user.id, params)
		expect(error).toBeUndefined()
		expect(await membersNamed(b.lorebook.id, "Mira")).toHaveLength(1)
		const [alone] = await testDb.query.scenes.findMany({
			where: eq(schema.scenes.id, b.alone.id)
		})
		expect(alone.castResolvedAt).not.toBeNull()
		expect(await participantsOf(b.alone.id)).toEqual([])
		expect(reply.applyNotes).toEqual([
			"Lone was deleted while this was being reviewed, so the scenes Lone was in were saved without them."
		])
	}, 60_000)

	test("merged into another member: the scene lists the member they joined", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const params = await modalParams(b, activityId)
		const { narrativeGraphMergeNodeHandler } = await import("./narrativeGraph")
		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(b.user.id),
			{ nodeId: b.lone.id, parentNodeId: b.aria.id } as any,
			() => {}
		)
		const { error, reply } = await send(b.user.id, params)
		expect(error).toBeUndefined()
		expect(await participantsOf(b.alone.id)).toEqual([b.aria.id])
		expect(reply.applyNotes).toEqual([
			"Lone was merged into Aria while this was being reviewed, so Aria is listed in the scenes Lone was in."
		])
	}, 60_000)

	test("deleted, and named by a relationship: refused, and nothing is written", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const params = await modalParams(b, activityId)
		await testDb
			.delete(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, b.kael.id))
		const { refusal } = await send(b.user.id, params)
		expect(refusal?.error).toBe(
			"A character in this proposal was deleted while it was being reviewed. Nothing was changed; build the graph again."
		)
		expect(await membersNamed(b.lorebook.id, "Mira")).toHaveLength(0)
	}, 60_000)
})

describe("the apply's own account of itself (plan A21 review)", () => {
	test("two new characters given one name in review become one, and the note says so", async () => {
		const b = await makeBook()
		const proposal = structuredClone(b.proposal)
		proposal.nodes.push({
			tempId: "new_2",
			name: "Oren",
			nodeState: "active",
			summary: "",
			sceneIndex: 0,
			sceneId: b.together.id
		})
		proposal.relationships.push({
			fromTempId: "new_2",
			toTempId: `existing_${b.aria.id}`,
			relationshipType: "friend",
			description: "",
			visibility: "acknowledged",
			status: "active",
			sceneIndex: 0,
			sceneId: b.together.id,
			historyEntryId: b.history.id
		})
		const activityId = atReview(b, "extend", proposal)
		const { error, reply } = await send(
			b.user.id,
			await modalParams(b, activityId, {
				edit: (r) => {
					r.nodes[1].name = "Mira"
				}
			})
		)
		expect(error).toBeUndefined()
		expect(await membersNamed(b.lorebook.id, "Mira")).toHaveLength(1)
		expect(reply.applyNotes).toEqual([
			"Two new characters were both named Mira, so they were added as one."
		])
	}, 60_000)

	test("a failure after the graph is written never says nothing was changed", async () => {
		const b = await makeBook()
		const activityId = atReview(b, "extend")
		const params = await modalParams(b, activityId)
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const emits: { event: string; data: any }[] = []
		// The graph list's refresh fails — after the commit.
		const emit = (event: string, data: any) => {
			if (event === "narrativeGraph:list") throw new Error("list read failed")
			if (typeof data !== "function") emits.push({ event, data })
		}
		let error: unknown
		try {
			await narrativeGraphApplyProposalHandler.handler(
				fakeSocket(b.user.id),
				params as any,
				emit
			)
		} catch (e) {
			error = e
		}
		expect(error).toBeUndefined()
		expect(
			emits.find((e) => e.event === "narrativeGraph:applyProposal:error")
		).toBeUndefined()
		expect(
			emits.find((e) => e.event === "narrativeGraph:applyProposal")?.data
				.requestId
		).toBe(params.requestId)
		expect(await membersNamed(b.lorebook.id, "Mira")).toHaveLength(1)
	}, 60_000)
})
