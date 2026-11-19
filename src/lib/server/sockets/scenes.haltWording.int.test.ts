/**
 * A scene summary that stopped without a summary: only an administrator reads
 * the run's reason. `processScene` has no socket (the routine calls it with
 * the owner's id alone), so the reader's flag is read from the user row.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const REASON =
	"KoboldCPP API error at http://10.0.0.5:5001/api/v1/generate: model 'mistral-7b.Q4_K_M.gguf' not loaded"
const NODE = "drafting.item.draft"
const PLAIN =
	"The summary could not be written. An administrator can see the details."

vi.mock("$lib/server/pipelines/runtime/runTurn", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return {
		...actual,
		runSpec: vi.fn(async () => ({
			outcome: "err",
			haltNodeKey: "drafting.item.draft",
			haltReason:
				"KoboldCPP API error at http://10.0.0.5:5001/api/v1/generate: model 'mistral-7b.Q4_K_M.gguf' not loaded",
			nodes: []
		}))
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-scenes-halt-wording-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await seedTextDefault()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function seedTextDefault() {
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name: "halt-conn", type: "ollama" })
		.returning()
	const [sampling] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name: "halt-sampling" })
		.returning()
	const existing = await testDb.query.systemSettings.findFirst()
	if (!existing) await testDb.insert(schema.systemSettings).values({} as any)
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = await ensureConnectionModel(
		testDb as any,
		connection.id,
		"halt-7b"
	)
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(testDb as any, "text->text", {
		connectionId: connection.id,
		connectionModelId: model!.id,
		samplingConfigId: sampling.id
	})
}

async function seedWorld(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, username)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Notes", userId: owner.id })
		.returning()
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{ lorebookId: book!.id, year: 5, month: 2, day: 7 } as any
			])
		)
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			name: "Tale",
			lorebookId: book!.id,
			lorebookBranchId: null,
			isGroup: false
		} as any)
		.returning()
	const scene = async (
		name: string,
		over: Partial<typeof schema.scenes.$inferInsert> = {}
	) =>
		(
			await testDb
				.insert(schema.scenes)
				.values({
					lorebookId: book!.id,
					historyEntryId: null,
					sessionId: session!.id,
					branchId: null,
					name,
					summary: `${name}.`,
					openedStoryClockYear: 5,
					openedStoryClockMonth: 2,
					openedStoryClockDay: 7,
					...over
				} as any)
				.returning()
		)[0]!
	return { owner, book: book!, entry: entry!, session: session!, scene }
}


async function failAs(username: string, isAdmin: boolean) {
	const w = await seedWorld(username)
	await testDb
		.update(schema.users)
		.set({ isAdmin })
		.where(eq(schema.users.id, w.owner.id))
	const { insertLegacy } = await import("$lib/server/messages/store")
	const line = (
		await insertLegacy(testDb as any, {
			sessionId: w.session.id,
			role: "assistant",
			content: "A line."
		} as any)
	).id
	const scene = await w.scene("Halting", { selectedMessageIds: [line] })
	const { processScene } = await import("./scenes")
	const { activityStore } = await import("$lib/server/utils/activityStore")
	let thrown: Error | undefined
	try {
		await processScene(w.owner.id, { sceneId: scene.id } as any, () => {})
	} catch (e) {
		thrown = e as Error
	}
	const card = activityStore
		.getFor(w.owner.id, true)
		.find((a) => a.kind === "scene_summarize" && (a as any).sceneId === scene.id) as any
	return { message: thrown?.message, card: card?.errorMessage as string | undefined }
}

describe("scene summary halt wording", () => {
	test("a non-administrator owner reads plain words on the error and the card", async () => {
		const { message, card } = await failAs("halt-plain", false)
		expect(message).toBe(PLAIN)
		expect(card).toBe(PLAIN)
		for (const leak of ["http://", ".gguf", NODE]) {
			expect(message).not.toContain(leak)
			expect(card).not.toContain(leak)
		}
	}, 60_000)

	test("an administrator owner reads the whole reason and the node", async () => {
		const { message, card } = await failAs("halt-admin", true)
		expect(message).toBe(`${REASON} (at '${NODE}')`)
		expect(card).toBe(`${REASON} (at '${NODE}')`)
	}, 60_000)
})
