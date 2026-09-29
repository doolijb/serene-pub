/**
 * Two server halves of the graph workspace's fixes (lane W2-graphs-client).
 *
 * "Extend from this session" reads that session alone (#51).
 *
 * An extend started with a `sessionId` hands the builder only that session's
 * ungraphed, summarized scenes — never another session's, never a direct
 * history entry (which belongs to no session). Without one, it reads the
 * whole book as before. Replace ignores the scope.
 *
 * The delete reply names the link and its book (#55, #123), so the canvas
 * drops one edge in place and another book's canvas ignores it.
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
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import type { GraphBuilderScene } from "$lib/server/utils/graphBuilder"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

// The build reaches the scene mapping only after resolving configs. What those
// configs contain is orthogonal to the mapping, so they are canned rather than
// seeded.
//
// ⚠ The connection and sampling used to be canned HERE too. They are not any
// more: this function no longer returns them, and the build's connection comes
// from the resolution chain — which under the no-implicit-pickup ruling means a
// registered `connection_defaults` row and nothing else. A capable connection
// merely existing in the table would not do, so `beforeAll` registers one.
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		contextConfig: { id: 1 },
		promptConfig: { id: 1 },
		narratorPromptConfig: null
	})
}))

/**
 * Every GraphBuilderScene[] handed to the builder, in call order. This array is
 * the subject under test — no LLM is involved, because the defect was entirely
 * in how the array gets populated.
 */
const capturedScenes: GraphBuilderScene[][] = []

vi.mock("$lib/server/utils/graphBuilder", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/utils/graphBuilder")>()
	return {
		...actual,
		buildGraphFromScenes: async (opts: { scenes: GraphBuilderScene[] }) => {
			capturedScenes.push(opts.scenes)
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
		path.join(os.tmpdir(), "serene-pub-extendscope-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb

	// The instance's chat default. Both halves: the connection is what the build
	// runs on, and `buildGraphFromScenes` reads `sampling.name` off the row to
	// label each queued call, so the graph handler refuses a null one by name
	// rather than letting it reach a property access.
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name: "Graph default", type: "ollama" })
		.returning()
	const [sampling] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name: "Graph sampling", isImmutable: false })
		.returning()
	// The MODEL half: a registration names a pair, and an endpoint on its own is
	// incomplete — the build would refuse before it read a single scene.
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

beforeEach(() => {
	capturedScenes.length = 0
})

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

async function seedBook(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `user-${label}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: label, userId: user.id })
		.returning()
	await testDb.insert(schema.lorebookBindings).values({
		lorebookId: lorebook.id,
		binding: "{{char:1}}",
		name: "Aria"
	})
	const [a, b] = await testDb
		.insert(schema.sessions)
		.values([
			{ userId: user.id, isGroup: false, name: "A" },
			{ userId: user.id, isGroup: false, name: "B" }
		])
		.returning()
	const [historyEntry] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([{ lorebookId: lorebook.id, year: 1, content: "" }])
		)
		.returning()
	const scene = async (sessionId: number, name: string, graphed = false) =>
		(
			await testDb
				.insert(schema.scenes)
				.values({
					lorebookId: lorebook.id,
					sessionId,
					name,
					summary: `${name} happened.`,
					historyEntryId: historyEntry.id,
					graphed
				})
				.returning()
		)[0]
	const inA = await scene(a.id, "In A")
	const doneInA = await scene(a.id, "Done in A", true)
	const inB = await scene(b.id, "In B")
	const [direct] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{ lorebookId: lorebook.id, year: 2, content: "Aria left." }
			])
		)
		.returning()
	return { user, lorebook, a, b, inA, doneInA, inB, direct }
}

async function build(
	userId: number,
	lorebookId: number,
	params: Record<string, unknown>
) {
	const { narrativeGraphBuildHandler } = await import("./narrativeGraph")
	return narrativeGraphBuildHandler.handler(
		fakeSocket(userId),
		{ lorebookId, ...params } as any,
		noopEmit as any
	)
}

const sceneIds = (scenes: GraphBuilderScene[]) =>
	scenes.filter((s) => s.sourceHistoryEntryId == null).map((s) => s.id)
const directIds = (scenes: GraphBuilderScene[]) =>
	scenes
		.filter((s) => s.sourceHistoryEntryId != null)
		.map((s) => s.sourceHistoryEntryId)

describe("extend scoped to a session", () => {
	test("reads only that session's ungraphed scenes, and no direct entries", async () => {
		const { user, lorebook, a, inA } = await seedBook("scoped")

		await build(user.id, lorebook.id, { mode: "extend", sessionId: a.id })

		expect(capturedScenes).toHaveLength(1)
		expect(sceneIds(capturedScenes[0])).toEqual([inA.id])
		expect(directIds(capturedScenes[0])).toEqual([])
	}, 60_000)

	test("without a session it still reads the whole book", async () => {
		const { user, lorebook, inA, inB, direct } = await seedBook("unscoped")

		await build(user.id, lorebook.id, { mode: "extend" })

		expect(sceneIds(capturedScenes[0]).sort()).toEqual(
			[inA.id, inB.id].sort()
		)
		expect(directIds(capturedScenes[0])).toEqual([direct.id])
	}, 60_000)

	test("replace ignores the session", async () => {
		const { user, lorebook, a, inA, doneInA, inB } =
			await seedBook("replace")

		await build(user.id, lorebook.id, { mode: "replace", sessionId: a.id })

		expect(sceneIds(capturedScenes[0]).sort()).toEqual(
			[inA.id, doneInA.id, inB.id].sort()
		)
	}, 60_000)

	test("a session with nothing new builds nothing", async () => {
		const { user, lorebook, b, inB } = await seedBook("nothing-new")
		await testDb
			.update(schema.scenes)
			.set({ graphed: true })
			.where(eq(schema.scenes.id, inB.id))

		await build(user.id, lorebook.id, { mode: "extend", sessionId: b.id })

		// Refused before the builder: the other session's scene and the
		// direct entry are not this session's to read.
		expect(capturedScenes).toHaveLength(0)
	}, 60_000)
})

describe("the delete reply names the link and its book", () => {
	test("carries id and lorebookId", async () => {
		const { user, lorebook } = await seedBook("delete-reply")
		const [a, b] = await testDb
			.insert(schema.lorebookBindings)
			.values([
				{ lorebookId: lorebook.id, binding: "{{char:2}}", name: "Bram" },
				{ lorebookId: lorebook.id, binding: "{{char:3}}", name: "Cole" }
			])
			.returning()
		const [rel] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: lorebook.id,
				fromNodeId: a.id,
				toNodeId: b.id,
				relationshipType: "ally",
				description: "",
				status: "active"
			} as any)
			.returning()
		const emitted: unknown[] = []
		const { narrativeGraphDeleteRelationshipHandler } = await import(
			"./narrativeGraph"
		)
		const res = await narrativeGraphDeleteRelationshipHandler.handler(
			fakeSocket(user.id),
			{ id: rel.id },
			((_: string, payload: unknown) => emitted.push(payload)) as any
		)
		expect(res).toMatchObject({ id: rel.id, lorebookId: lorebook.id })
		expect(emitted[0]).toMatchObject({ id: rel.id, lorebookId: lorebook.id })
	}, 60_000)
})
