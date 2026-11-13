/**
 * The narrative graph and cast versions (plan §32 §8, ★CV-10: "graph state
 * and visibility move into cast versions").
 *
 * - **Writes.** An applied proposal's new member is inserted through the
 *   versions module (so it has a base); an applied state update is a cast
 *   version write at the key of the version the build's line reads, and the
 *   frozen `node_state` column is never written.
 * - **Reads.** The graph list and the build's seeds read the node state and
 *   visibility of the cast version in force, not the column.
 * - **Merge.** Absorb snapshots the member's cast versions and undo puts them
 *   back (the base brought onto the fresh one, every other row inserted again
 *   with its write order); a dated version makes a member "linked".
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { castVersionsInForce } from "$lib/server/cast/memberAsRead"
import {
	insertCard,
	insertCastMember,
	insertCharacterVersions,
	writeCastVersion
} from "$lib/server/characters/versions"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { applyAtReview } from "./fixtures/graphReview"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

/** The seed members handed to the builder, in call order. */
const capturedSeeds: Array<
	Array<{ id: number; name: string; nodeState?: string }>
> = []

vi.mock("$lib/server/utils/graphBuilder", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/utils/graphBuilder")>()
	return {
		...actual,
		buildGraphFromScenes: async (opts: {
			seedNodes?: Array<{ id: number; name: string; nodeState?: string }>
			scenes?: Array<{ summary: string | null }>
		}) => {
			capturedSeeds.push(opts.seedNodes ?? [])
			capturedSceneSummaries.push(
				(opts.scenes ?? []).map((s) => s.summary ?? "")
			)
			return {
				proposal: { nodes: [], relationships: [] },
				resolvedSceneCast: [],
				sceneLabels: [],
				seedTempIdMap: {},
				seedNodeNames: {}
			}
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-graph-castversions-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb

	// The build's connection comes from a registered default.
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name: "Graph default", type: "ollama" })
		.returning()
	const [sampling] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name: "Graph sampling", isImmutable: false })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = await ensureConnectionModel(
		testDb as any,
		connection.id,
		"graph-7b"
	)
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(testDb as any, "text->text", {
		connectionId: connection.id,
		connectionModelId: model!.id,
		samplingConfigId: sampling.id
	})
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

/** The scene summaries handed to the builder, in call order. */
const capturedSceneSummaries: string[][] = []

beforeEach(() => {
	capturedSeeds.length = 0
	capturedSceneSummaries.length = 0
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

let seq = 0

/** A book with a summarized scene (so a build has something to read) and a way to add members. */
async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `graph-castversions-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Cast Versions Book ${seq}`, userId: user.id })
		.returning()
	const [historyEntry] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([{ lorebookId: lorebook.id, year: 1, content: "" }])
		)
		.returning()
	await testDb.insert(schema.scenes).values({
		lorebookId: lorebook.id,
		name: "The meeting",
		summary: "Aria and Bram met.",
		historyEntryId: historyEntry.id
	})
	let token = 0
	const member = async (
		name: string,
		extra: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
	) =>
		(
			await insertCastMember(testDb, {
				lorebookId: lorebook.id,
				binding: `{{char:${++token}}}`,
				name,
				...extra
			})
		).member
	return { user, lorebook, member }
}

const versionsOf = (memberId: number) =>
	testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, memberId))
		.orderBy(asc(schema.characterVersions.id))

const columnsOf = async (memberId: number) =>
	(await testDb.query.lorebookBindings.findFirst({
		where: eq(schema.lorebookBindings.id, memberId)
	}))!

const stateInForce = async (memberId: number) =>
	(await castVersionsInForce(testDb, [memberId])).get(memberId)!.version

async function applyUpdate(
	userId: number,
	lorebookId: number,
	memberId: number,
	nodeState: string,
	summary?: string
) {
	const { narrativeGraphApplyProposalHandler } = await import(
		"./narrativeGraph"
	)
	await narrativeGraphApplyProposalHandler.handler(
		fakeSocket(userId),
		applyAtReview(userId, {
			lorebookId,
			proposal: {
				nodes: [],
				relationships: [],
				updatedNodes: [
					{
						tempId: `existing_${memberId}`,
						name: "x",
						nodeState,
						previousNodeState: "active",
						...(summary !== undefined
							? { summary, previousSummary: null }
							: {})
					}
				]
			},
			mode: "replace"
		} as any),
		noopEmit
	)
}

async function listedNode(userId: number, lorebookId: number, id: number) {
	const { narrativeGraphListHandler } = await import("./narrativeGraph")
	const res = await narrativeGraphListHandler.handler(
		fakeSocket(userId),
		{ lorebookId },
		noopEmit as any
	)
	return res.nodes.find((n) => n.id === id)!
}

async function runBuild(userId: number, lorebookId: number) {
	const { narrativeGraphBuildHandler } = await import("./narrativeGraph")
	await narrativeGraphBuildHandler.handler(
		fakeSocket(userId),
		{ lorebookId, mode: "replace" } as any,
		noopEmit as any
	)
	return capturedSeeds.at(-1)!
}

describe("an applied proposal writes cast versions, not the frozen columns", () => {
	test("a new member comes with a base carrying the proposal's node state", async () => {
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)
		const b = await makeBook()
		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(b.user.id),
			applyAtReview(b.user.id, {
				lorebookId: b.lorebook.id,
				proposal: {
					nodes: [
						{
							tempId: "new_1",
							name: "Dara",
							nodeState: "missing",
							summary: "a courier"
						}
					],
					relationships: []
				} as any,
				mode: "replace"
			}),
			noopEmit
		)

		const member = (
			await testDb.query.lorebookBindings.findMany({
				where: eq(schema.lorebookBindings.lorebookId, b.lorebook.id)
			})
		).find((m) => m.name === "Dara")!
		const versions = await versionsOf(member.id)
		expect(versions).toHaveLength(1)
		const [base] = versions
		expect([base.branchId, base.year, base.personalPosition]).toEqual([
			null,
			null,
			null
		])
		expect(base.nodeState).toBe("missing")
		expect(base.nodeVisibility).toBe("normal")
		expect(base.summary).toBe("a courier")
		expect(base.writtenBy).toBe(`user:${b.user.id}`)
	}, 60_000)

	test("a state update is a version write: the column stays, the list and the next build read the version", async () => {
		const b = await makeBook()
		const aria = await b.member("Aria")
		await b.member("Bram")

		await applyUpdate(b.user.id, b.lorebook.id, aria.id, "deceased")

		// The frozen column is untouched; the base took the state.
		expect((await columnsOf(aria.id)).nodeState).toBe("active")
		const versions = await versionsOf(aria.id)
		expect(versions).toHaveLength(1)
		expect(versions[0].nodeState).toBe("deceased")

		expect(
			(await listedNode(b.user.id, b.lorebook.id, aria.id)).nodeState
		).toBe("deceased")
		const seeds = await runBuild(b.user.id, b.lorebook.id)
		expect(seeds.find((s) => s.id === aria.id)!.nodeState).toBe("deceased")
		expect(seeds.find((s) => s.name === "Bram")!.nodeState).toBe("active")
	}, 60_000)

	test("an unchanged state writes nothing", async () => {
		const b = await makeBook()
		const aria = await b.member("Aria", { nodeState: "deceased" })
		const before = await versionsOf(aria.id)

		await applyUpdate(b.user.id, b.lorebook.id, aria.id, "deceased")

		expect(await versionsOf(aria.id)).toEqual(before)
	}, 60_000)

	test("a filled summary keeps the base in step", async () => {
		const b = await makeBook()
		const aria = await b.member("Aria", { summary: "" })

		await applyUpdate(
			b.user.id,
			b.lorebook.id,
			aria.id,
			"active",
			"a fallen scout"
		)

		expect((await columnsOf(aria.id)).summary).toBe("a fallen scout")
		const versions = await versionsOf(aria.id)
		expect(versions).toHaveLength(1)
		expect(versions[0].summary).toBe("a fallen scout")
	}, 60_000)

	test("a member whose state was changed at a dated version reads that state at the build's line head, and a new state edits that version", async () => {
		const b = await makeBook()
		const aria = await b.member("Aria")
		await writeCastVersion(testDb, {
			member: aria.id,
			changes: { nodeState: "deceased" },
			writtenBy: `user:${b.user.id}`,
			at: { branchId: null, date: { year: 10 }, personalPosition: null }
		})
		// The base still says active; the head reads the dated version.
		expect((await versionsOf(aria.id))[0].nodeState).toBe("active")
		expect(
			(await listedNode(b.user.id, b.lorebook.id, aria.id)).nodeState
		).toBe("deceased")
		expect(
			(await runBuild(b.user.id, b.lorebook.id)).find(
				(s) => s.id === aria.id
			)!.nodeState
		).toBe("deceased")

		// The build now says "missing": the version in force at the head is
		// the dated one, so that one is edited — no third row, base untouched.
		await applyUpdate(b.user.id, b.lorebook.id, aria.id, "missing")

		const versions = await versionsOf(aria.id)
		expect(versions).toHaveLength(2)
		expect(versions[0].nodeState).toBe("active")
		expect([versions[1].year, versions[1].nodeState]).toEqual([
			10,
			"missing"
		])
		expect(
			(await runBuild(b.user.id, b.lorebook.id)).find(
				(s) => s.id === aria.id
			)!.nodeState
		).toBe("missing")
		expect((await columnsOf(aria.id)).nodeState).toBe("active")
	}, 60_000)

	test("a state a session wrote is answered by a new authored version at its date", async () => {
		const b = await makeBook()
		const aria = await b.member("Aria")
		const [base] = await versionsOf(aria.id)
		const {
			id: _id,
			writeOrder: _writeOrder,
			createdAt: _createdAt,
			updatedAt: _updatedAt,
			...copy
		} = base
		await insertCharacterVersions(testDb, [
			{
				...copy,
				year: 5,
				sourceSessionId: 77,
				nodeState: "deceased"
			}
		])
		expect((await stateInForce(aria.id)).nodeState).toBe("deceased")

		await applyUpdate(b.user.id, b.lorebook.id, aria.id, "active")

		const versions = await versionsOf(aria.id)
		expect(versions).toHaveLength(3)
		const authored = versions[2]
		expect([authored.year, authored.sourceSessionId]).toEqual([5, null])
		expect(authored.writtenBy).toBe(`user:${b.user.id}`)
		expect((await stateInForce(aria.id)).id).toBe(authored.id)
		expect((await stateInForce(aria.id)).nodeState).toBe("active")
	}, 60_000)
})

describe("the build names members by their cast versions", () => {
	test("a member whose own name lives only on its base version is shown by that name in the build's summaries", async () => {
		const b = await makeBook()
		const { card } = await insertCard(testDb, {
			userId: b.user.id,
			name: "Aria Vale",
			description: ""
		})
		const aria = await b.member("Aria Vale", { characterId: card.id })
		// The name is the base's own; the frozen column was never set.
		await writeCastVersion(testDb, {
			member: aria.id,
			changes: { name: "Lady Aria" },
			writtenBy: `user:${b.user.id}`,
			at: { branchId: null, date: null, personalPosition: null }
		})
		expect((await versionsOf(aria.id))[0].follows).not.toContain("name")
		expect((await columnsOf(aria.id)).ownName).toBeNull()
		await testDb
			.update(schema.scenes)
			.set({ summary: `${aria.binding} met Bram.` })
			.where(eq(schema.scenes.lorebookId, b.lorebook.id))

		await runBuild(b.user.id, b.lorebook.id)

		expect(capturedSceneSummaries.at(-1)).toEqual(["Lady Aria met Bram."])
	}, 60_000)
})

describe("merge and undo-merge keep the member's cast versions", () => {
	async function absorb(
		userId: number,
		nodeId: number,
		parentNodeId: number
	) {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(userId),
			{ nodeId, parentNodeId },
			noopEmit
		)
		const logs = await testDb
			.select()
			.from(schema.bindingMergeLogs)
			.orderBy(asc(schema.bindingMergeLogs.id))
		return logs.at(-1)!
	}

	async function undo(userId: number, mergeLogId: number) {
		const { narrativeGraphUndoMergeHandler } = await import(
			"./narrativeGraph"
		)
		return narrativeGraphUndoMergeHandler.handler(
			fakeSocket(userId),
			{ mergeLogId },
			noopEmit
		)
	}

	test("the absorbed member's base words, dated version and state come back with the undo", async () => {
		const b = await makeBook()
		const survivor = await b.member("Kestrel")
		const absorbed = await b.member("Kes")
		const by = `user:${b.user.id}`
		await writeCastVersion(testDb, {
			member: absorbed.id,
			changes: { description: "Kes the scout", nodeState: "departed" },
			writtenBy: by,
			at: { branchId: null, date: null, personalPosition: null }
		})
		await writeCastVersion(testDb, {
			member: absorbed.id,
			changes: { nodeState: "missing" },
			writtenBy: by,
			at: { branchId: null, date: { year: 20 }, personalPosition: 2 }
		})
		const before = await versionsOf(absorbed.id)
		expect(before).toHaveLength(2)
		const [, datedBefore] = before

		const log = await absorb(b.user.id, absorbed.id, survivor.id)

		// The versions went with the row, and are in the log.
		expect(await versionsOf(absorbed.id)).toHaveLength(0)
		const story = (log.absorbedSnapshot as any).$memberStory
		expect(story.castVersions).toHaveLength(2)

		const undone = await undo(b.user.id, log.id)
		const back = undone.restoredNode.id
		expect(undone.unrestoredStoryCount).toBe(0)
		// The restored node reads the state of its versions: at the head, the
		// dated one.
		expect(undone.restoredNode.nodeState).toBe("missing")

		const after = await versionsOf(back)
		expect(after).toHaveLength(2)
		const [base, dated] = after
		expect([base.branchId, base.year, base.personalPosition]).toEqual([
			null,
			null,
			null
		])
		expect(base.description).toBe("Kes the scout")
		expect(base.nodeState).toBe("departed")
		expect(base.follows).toEqual([])
		expect([dated.year, dated.personalPosition, dated.nodeState]).toEqual([
			20,
			2,
			"missing"
		])
		expect(dated.description).toBe("Kes the scout")
		expect(dated.writeOrder).toBe(datedBefore.writeOrder)
		expect(dated.writtenBy).toBe(by)
		expect(dated.castMemberId).toBe(back)
		expect(dated.lorebookId).toBe(b.lorebook.id)
	}, 60_000)

	test("a logged base that followed a card brings the new base to the same follows and words", async () => {
		const b = await makeBook()
		const [card] = await testDb
			.insert(schema.characters)
			.values({
				userId: b.user.id,
				name: "Verity",
				description: "The card's description",
				personality: "The card's personality"
			} as any)
			.returning()
		const survivor = await b.member("Kestrel")
		const absorbed = await b.member("Kes")
		await writeCastVersion(testDb, {
			member: absorbed.id,
			changes: { description: "Told over by this book" },
			writtenBy: `user:${b.user.id}`,
			at: { branchId: null, date: null, personalPosition: null }
		})
		const log = await absorb(b.user.id, absorbed.id, survivor.id)
		// A carded member is never absorbed (the bound row survives), so this
		// log is made up: the saved row names the card, and the logged base
		// followed only the card's personality, with its description told over.
		const snapshot = log.absorbedSnapshot as any
		snapshot.characterId = card.id
		snapshot.$memberStory.castVersions[0].follows = ["personality"]
		await testDb
			.update(schema.bindingMergeLogs)
			.set({ absorbedSnapshot: snapshot })
			.where(eq(schema.bindingMergeLogs.id, log.id))

		const undone = await undo(b.user.id, log.id)

		const [restored] = await versionsOf(undone.restoredNode.id)
		// The saved row's columns said nothing was retold, so the fresh base
		// followed every card field; the logged base wins.
		expect(restored.parentVersionId).not.toBeNull()
		expect(restored.description).toBe("Told over by this book")
		expect(restored.follows).toContain("personality")
		expect(restored.follows).not.toContain("description")
	}, 60_000)

	test("a log from before cast versions were kept restores the base from the row's columns", async () => {
		const b = await makeBook()
		const survivor = await b.member("Kestrel")
		const absorbed = await b.member("Kes", { summary: "a scout" })
		const log = await absorb(b.user.id, absorbed.id, survivor.id)
		const snapshot = log.absorbedSnapshot as any
		delete snapshot.$memberStory.castVersions
		await testDb
			.update(schema.bindingMergeLogs)
			.set({ absorbedSnapshot: snapshot })
			.where(eq(schema.bindingMergeLogs.id, log.id))

		const undone = await undo(b.user.id, log.id)

		const versions = await versionsOf(undone.restoredNode.id)
		expect(versions).toHaveLength(1)
		expect(versions[0].summary).toBe("a scout")
	}, 60_000)

	test("a version on a line that is gone is left behind and counted", async () => {
		const b = await makeBook()
		const survivor = await b.member("Kestrel")
		const absorbed = await b.member("Kes")
		const [branch] = await testDb
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: b.lorebook.id,
				name: "Elsewhere"
			})
			.returning()
		await writeCastVersion(testDb, {
			member: absorbed.id,
			changes: { nodeState: "missing" },
			writtenBy: `user:${b.user.id}`,
			at: {
				branchId: branch.id,
				date: { year: 3 },
				personalPosition: null
			}
		})
		const log = await absorb(b.user.id, absorbed.id, survivor.id)
		await testDb
			.delete(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, branch.id))

		const undone = await undo(b.user.id, log.id)

		expect(undone.unrestoredStoryCount).toBe(1)
		expect(await versionsOf(undone.restoredNode.id)).toHaveLength(1)
	}, 60_000)

	test("a blank member on the old tag with a dated version is somebody: it steps aside, not deleted", async () => {
		const b = await makeBook()
		const survivor = await b.member("Kestrel")
		const absorbed = await b.member("Kes")
		const log = await absorb(b.user.id, absorbed.id, survivor.id)
		// A blank member on the absorbed tag, as the pre-A16 save minted.
		const { member: blank } = await insertCastMember(testDb, {
			lorebookId: b.lorebook.id,
			binding: absorbed.binding
		})
		await writeCastVersion(testDb, {
			member: blank.id,
			changes: { description: "Seen at the gate" },
			writtenBy: `user:${b.user.id}`,
			at: { branchId: null, date: { year: 3 }, personalPosition: null }
		})

		const undone = await undo(b.user.id, log.id)

		expect(undone.restoredNode.binding).toBe(absorbed.binding)
		const after = await columnsOf(blank.id)
		expect(after.binding).not.toBe(absorbed.binding)
	}, 60_000)

	test("a blank member whose state is a version's is somebody too", async () => {
		const b = await makeBook()
		const survivor = await b.member("Kestrel")
		const absorbed = await b.member("Kes")
		const log = await absorb(b.user.id, absorbed.id, survivor.id)
		const { member: blank } = await insertCastMember(testDb, {
			lorebookId: b.lorebook.id,
			binding: absorbed.binding
		})
		await writeCastVersion(testDb, {
			member: blank.id,
			changes: { nodeState: "deceased" },
			writtenBy: `user:${b.user.id}`,
			at: { branchId: null, date: null, personalPosition: null }
		})
		// The column still reads blank.
		expect((await columnsOf(blank.id)).nodeState).toBe("active")

		const undone = await undo(b.user.id, log.id)

		// Not blank, so it keeps the tag it holds and the member comes back
		// under a fresh one.
		expect(undone.restoredNode.binding).not.toBe(absorbed.binding)
		expect((await columnsOf(blank.id)).binding).toBe(absorbed.binding)
	}, 60_000)

	test("a blank member with only a base is removed, as before", async () => {
		const b = await makeBook()
		const survivor = await b.member("Kestrel")
		const absorbed = await b.member("Kes")
		const log = await absorb(b.user.id, absorbed.id, survivor.id)
		const { member: blank } = await insertCastMember(testDb, {
			lorebookId: b.lorebook.id,
			binding: absorbed.binding
		})

		const undone = await undo(b.user.id, log.id)

		expect(undone.restoredNode.binding).toBe(absorbed.binding)
		expect(
			await testDb.query.lorebookBindings.findFirst({
				where: eq(schema.lorebookBindings.id, blank.id)
			})
		).toBeUndefined()
	}, 60_000)
})
