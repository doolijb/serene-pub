/**
 * The graph build ignored every saved scene cast.
 *
 * Migration 0091 dropped `scenes.participant_characters` / `mentioned_characters`
 * and moved cast into the `scene_characters` join table. The build handler kept
 * reading it off the scene row — behind an `(s: any)` that hid the now-missing
 * property from the compiler — so it was `undefined` for every scene. Three
 * consequences, all silent:
 *
 *   1. Every scene took graphBuilder's extract-cast-from-summary LLM branch on
 *      every build, so the modal's "this is saved afterwards, so later rebuilds
 *      skip it" was a promise the code could not keep.
 *   2. `derivedCast` was therefore always true, so apply re-wrote the cast the
 *      user had curated in the summarize review with the LLM's re-derivation.
 *   3. `droppedDanglingIds`, the only diagnostic in the subsystem, could never
 *      increment.
 *
 * Why these tests are at the SOCKET layer specifically: graphBuilder's own
 * behaviour given a populated cast was already covered — see
 * graphBuilder.discovery.test.ts, "a scene already holding valid binding ids
 * costs NO extraction call" and "scenes whose cast was derived are reported for
 * write-back; ones with ids are not". Both passed throughout the entire life of
 * this bug, because both hand-construct their input:
 *
 *     scenes: [scene(1, "Aria alone.", { participantCharacters: [10] })] as any
 *
 * — feeding the builder past the broken caller, with an `as any` that blinded
 * the fixture exactly as `(s: any)` blinded production. The untested gap was
 * never "does the builder use stored cast" but "does the socket layer supply
 * it", so that is what these assert, by capturing the GraphBuilderScene[] the
 * handler hands to the builder.
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
		path.join(os.tmpdir(), "serene-pub-storedcast-int-test-")
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
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(testDb as any, "text->text", {
		connectionId: connection.id,
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

/** A lorebook with three named bindings and one summarized scene. */
async function seedLorebook(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `user-${label}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: label, userId: user.id })
		.returning()

	const bindings = []
	for (const [i, name] of ["Aria", "Bram", "Cole"].entries()) {
		const [b] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: `{{char:${i + 1}}}`,
				name
			})
			.returning()
		bindings.push(b)
	}

	const [historyEntry] = await testDb
		.insert(schema.historyEntries)
		.values({ lorebookId: lorebook.id, year: 1, content: "" })
		.returning()

	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: lorebook.id,
			name: "The meeting",
			summary: "Aria and Bram met. Cole was discussed.",
			historyEntryId: historyEntry.id
		})
		.returning()

	return { user, lorebook, bindings, scene, historyEntry }
}

async function runBuild(
	userId: number,
	lorebookId: number,
	mode: "replace" | "extend" = "replace"
) {
	const { narrativeGraphBuildHandler } = await import("./narrativeGraph")
	return narrativeGraphBuildHandler.handler(
		fakeSocket(userId),
		{ lorebookId, mode } as any,
		noopEmit as any
	)
}

describe("the graph build reads cast from scene_characters", () => {
	test("a scene's stored cast reaches the builder as binding ids", async () => {
		const { user, lorebook, bindings, scene } =
			await seedLorebook("stored-cast")
		const { writeSceneCast } = await import("$lib/server/utils/sceneCast")
		await writeSceneCast(
			scene.id,
			{
				participantCharacters: [bindings[0].id, bindings[1].id],
				mentionedCharacters: [bindings[2].id]
			},
			testDb as any
		)

		await runBuild(user.id, lorebook.id)

		expect(capturedScenes).toHaveLength(1)
		const built = capturedScenes[0].find((s) => s.id === scene.id)
		expect(built).toBeDefined()
		// Before the fix both arrived as null — the scene row simply has no
		// such columns, and `(s: any)` meant nobody found out.
		expect(built!.participantCharacters).toEqual([
			bindings[0].id,
			bindings[1].id
		])
		expect(built!.mentionedCharacters).toEqual([bindings[2].id])
	})

	test("a scene with no cast rows arrives empty, so the builder still derives it", async () => {
		const { user, lorebook, scene } = await seedLorebook("no-cast")

		await runBuild(user.id, lorebook.id)

		const built = capturedScenes[0].find((s) => s.id === scene.id)
		// Empty rather than null; graphBuilder reads both as `?? []`, and this
		// is the state that must keep taking the extraction branch.
		expect(built!.participantCharacters).toEqual([])
		expect(built!.mentionedCharacters).toEqual([])
	})

	test("direct history entries still carry no cast of their own", async () => {
		const { user, lorebook } = await seedLorebook("direct-entry")
		const [entry] = await testDb
			.insert(schema.historyEntries)
			.values({
				lorebookId: lorebook.id,
				year: 2,
				content: "Aria was promoted."
			})
			.returning()

		await runBuild(user.id, lorebook.id)

		const built = capturedScenes[0].find(
			(s) => s.sourceHistoryEntryId === entry.id
		)
		expect(built).toBeDefined()
		// Guard against over-fixing: entries have no scene_characters rows by
		// definition, and must keep reaching the extract branch.
		expect(built!.participantCharacters).toBeNull()
		expect(built!.mentionedCharacters).toBeNull()
	})

	test("the loop closes: a cast written by apply is read by the next build", async () => {
		const { user, lorebook, bindings, scene } = await seedLorebook("loop")
		const { narrativeGraphApplyProposalHandler } = await import(
			"./narrativeGraph"
		)

		// Round 1: no stored cast, so the builder derives one and reports it for
		// write-back. `updatedNodes` carries the same tempIds because that is
		// how apply learns the tempId→id mapping — it derives it from the
		// `existing_<id>` form rather than trusting a client-sent map.
		const tempIds = [
			`existing_${bindings[0].id}`,
			`existing_${bindings[1].id}`
		]
		await narrativeGraphApplyProposalHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: lorebook.id,
				mode: "replace",
				proposal: {
					nodes: [],
					relationships: [],
					updatedNodes: tempIds.map((tempId) => ({ tempId })),
					resolvedSceneCast: [
						{
							sceneId: scene.id,
							historyEntryId: null,
							participantTempIds: tempIds,
							mentionedTempIds: []
						}
					]
				}
			} as any,
			noopEmit as any
		)

		// Apply persisted both halves of the state the read path looks for.
		const castRows = await testDb
			.select()
			.from(schema.sceneCharacters)
			.where(eq(schema.sceneCharacters.sceneId, scene.id))
		expect(castRows.map((r) => r.bindingId).sort()).toEqual(
			[bindings[0].id, bindings[1].id].sort()
		)
		const [afterApply] = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, scene.id))
		expect(afterApply.castResolvedAt).not.toBeNull()

		// Round 2: the build must now see that cast instead of re-deriving it.
		// This is the assertion the wrong-level fixture could never make.
		await runBuild(user.id, lorebook.id)
		const built = capturedScenes[0].find((s) => s.id === scene.id)
		expect(built!.participantCharacters).toEqual([
			bindings[0].id,
			bindings[1].id
		])
	})
})
