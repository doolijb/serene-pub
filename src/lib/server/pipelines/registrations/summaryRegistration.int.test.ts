/**
 * 🚧 Summary registrations found by registration (programme 3.8): for every shipped genre and kind the registration
 * reader gives what the older mechanisms gave (world/character by identity, scene by declaration, close-out by
 * key); a switched-off summarize registration is still found, a switched-off close-out is not. `runSpec` is mocked.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
const asDb = () => testDb as unknown as Db

const runSpecMock = vi.fn()
vi.mock("$lib/server/pipelines/runtime/runTurn", () => ({
	runSpec: (...args: any[]) => runSpecMock(...args),
	runTurn: vi.fn(),
	PipelineUnavailableError: class extends Error {}
}))

vi.mock("$lib/server/utils/resolveTaskConfig", () => ({
	resolveTaskConfig: vi.fn().mockResolvedValue({
		connection: { id: 1, baseUrl: "http://fake", type: "koboldcpp" },
		sampling: { id: 1 },
		connectionName: "test-connection",
		samplingName: "test-sampling"
	})
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb)
}, 120_000)

const GENRES = [
	"core:genre/story",
	"core:genre/chat",
	"core:genre/guide",
	"core:genre/lair",
	"core:genre/dungeon-crawler"
]
const WORLD = "core:spec/summarize-world"
const CHARACTER = "core:spec/summarize-character"

let seq = 0
async function makeSession(genreId: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `summarizer-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Test Book", userId: user.id })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, name: "S", lorebookId: lorebook!.id, isGroup: false, genreId } as any)
		.returning()
	const [message] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId: session!.id, role: "user", content: "one" })
		.returning()
	return { user, session: session!, message: message! }
}

/** The scene spec a genre declares, else core's. */
async function declaredScene(genreId: string) {
	const { getGenre } = await import("@serene-pub/sdk")
	const { DEFAULT_SUMMARIZE_SCENE_SPEC_ID } = await import("$lib/server/scenes/liveScenes")
	return (getGenre(genreId) as any)?.summarize?.scene ?? DEFAULT_SUMMARIZE_SCENE_SPEC_ID
}

describe("summaryRegistrationOf — per shipped genre and kind", () => {
	for (const genreId of GENRES) {
		test(`${genreId}: world, character, scene and close-out`, async () => {
			const { summaryRegistrationOf } = await import("./summaryRegistration")
			const { resolveSubjectVerdict } = await import("$lib/server/pipelines/entities/sessionGenres")
			const { resolveSummarizeSceneSpec, resolveSummarizeSceneSpecOfGenre } = await import(
				"$lib/server/scenes/liveScenes"
			)
			const { summarizeWorldSpec, summarizeCharacterSpec } = await import("@serene-pub/core-catalog")
			const { session } = await makeSession(genreId)
			const scene = await declaredScene(genreId)

			const world = await summaryRegistrationOf(asDb(), session.id, "world")
			const oldWorld = await resolveSubjectVerdict(
				asDb(),
				genreId,
				summarizeWorldSpec().actions["summarize-world"].identity,
				{ sessionId: session.id }
			)
			expect(world?.spec).toBe(WORLD)
			expect(world?.spec).toBe(oldWorld.spec)
			expect(world?.key).toBe(oldWorld.registrationKey)
			expect(world?.minAge).toBe(oldWorld.registrationMinAge)

			const character = await summaryRegistrationOf(asDb(), session.id, "character")
			const oldCharacter = await resolveSubjectVerdict(
				asDb(),
				genreId,
				summarizeCharacterSpec().actions["summarize-character"].identity,
				{ sessionId: session.id }
			)
			expect(character?.spec).toBe(CHARACTER)
			expect(character?.spec).toBe(oldCharacter.spec)
			expect(character?.key).toBe(oldCharacter.registrationKey)
			expect(character?.minAge).toBe(oldCharacter.registrationMinAge)

			expect((await summaryRegistrationOf(asDb(), session.id, "scene"))?.spec).toBe(scene)
			expect((await resolveSummarizeSceneSpec(asDb(), session.id)).specId).toBe(scene)
			expect((await resolveSummarizeSceneSpecOfGenre(asDb(), genreId)).specId).toBe(scene)
			const closeOut = await summaryRegistrationOf(asDb(), session.id, "close-out")
			expect(closeOut?.spec).toBe(scene)
			expect(closeOut?.minAge).toBe(0)
		}, 60_000)
	}

	test("Story, Guide, the Lair and the Dungeon Crawler declare their own scene spec; Chat has core's", async () => {
		const core = await declaredScene("core:genre/chat")
		expect(core).toBe("core:spec/summarize-scene")
		for (const id of GENRES.filter((g) => g !== "core:genre/chat"))
			expect(await declaredScene(id)).not.toBe(core)
	})

	test("cues for a session and for a genre are the declared spec's, as before", async () => {
		const { boundaryTriggersOfSpec, sessionBoundaryTriggers, genreBoundaryTriggers } = await import(
			"$lib/server/scenes/liveScenes"
		)
		for (const genreId of GENRES) {
			const { session } = await makeSession(genreId)
			const expected = await boundaryTriggersOfSpec(asDb(), await declaredScene(genreId))
			expect(await sessionBoundaryTriggers(asDb(), session.id)).toEqual(expected)
			expect(await genreBoundaryTriggers(asDb(), genreId)).toEqual(expected)
		}
	}, 60_000)
})

describe("summaryRegistrationOf — modes", () => {
	async function switchOff(sessionId: number, key: string) {
		const { rowOfChange } = await import("./rows")
		const { upsertRow } = await import("./write")
		await upsertRow(asDb(), rowOfChange({ key, mode: "off" }, { kind: "session", sessionId }, "owner"))
	}

	test("a switched-off summarize registration is still found; a switched-off close-out is not", async () => {
		const { summaryRegistrationOf } = await import("./summaryRegistration")
		const { closeOutRegistrationOf } = await import("$lib/server/sessions/closeOut")
		const { session } = await makeSession("core:genre/story")
		const world = (await summaryRegistrationOf(asDb(), session.id, "world"))!
		const closeOut = (await summaryRegistrationOf(asDb(), session.id, "close-out"))!
		expect(closeOut).not.toBeNull()
		expect((await closeOutRegistrationOf(asDb(), session.id))?.key).toBe(closeOut.key)

		await switchOff(session.id, world.key)
		const off = await summaryRegistrationOf(asDb(), session.id, "world")
		expect(off?.registration.mode).toBe("off")
		expect(off?.spec).toBe(WORLD)

		await switchOff(session.id, closeOut.key)
		expect(await summaryRegistrationOf(asDb(), session.id, "close-out")).toBeNull()
		expect(await closeOutRegistrationOf(asDb(), session.id)).toBeNull()
	}, 60_000)
})
