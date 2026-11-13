/**
 * A scene's notes reach the compile ("Noted in this scene:" beside the
 * scene's summary) and the scene summarize request (`request.scene.notes`).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
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

/** The summaries the synthesis was handed, per call, by scene id. */
const compiled: Record<number, string>[] = []
vi.mock("$lib/server/utils/summarizer", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return {
		...actual,
		compileScenesForEntry: vi.fn(
			async (args: { scenes: { id: number; summary: string }[] }) => {
				compiled.push(
					Object.fromEntries(args.scenes.map((s) => [s.id, s.summary]))
				)
				return { content: "The compiled history.", raw: "x" }
			}
		)
	}
})

/** The `input.request` each scene summarize run was handed. */
const requests: any[] = []
vi.mock("$lib/server/pipelines/runtime/runTurn", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return {
		...actual,
		runSpec: vi.fn(async (args: any) => {
			requests.push(args.input.request)
			return {
				nodes: [{ nodeKey: "synth", output: { content: "A summary." } }]
			}
		})
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-scenes-notes-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await seedTextDefault()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

async function seedTextDefault() {
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name: "notes-conn", type: "ollama" })
		.returning()
	const [sampling] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name: "notes-sampling" })
		.returning()
	const existing = await testDb.query.systemSettings.findFirst()
	if (!existing) await testDb.insert(schema.systemSettings).values({} as any)
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = await ensureConnectionModel(
		testDb as any,
		connection.id,
		"notes-7b"
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

const note = (text: string) => ({
	text,
	runId: null,
	messageId: null,
	at: "2026-11-10T00:00:00.000Z"
})

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

describe("scene notes", () => {
	test("compile: a scene's notes ride beside its summary; a scene with none is unchanged", async () => {
		const w = await seedWorld("notes-compile")
		const { sceneCompileHandler } = await import("./scenes")
		const noted = await w.scene("Noted", {
			notes: [note("  The bridge was out. "), note("Ada limped.")]
		})
		const plain = await w.scene("Plain")
		compiled.length = 0

		await sceneCompileHandler.handler(
			fakeSocket(w.owner.id),
			{ historyEntryId: w.entry.id, branchId: null, moment: null },
			() => {}
		)

		expect(compiled).toHaveLength(1)
		expect(compiled[0]![noted.id]).toBe(
			"Noted.\n\nNoted in this scene:\n- The bridge was out.\n- Ada limped."
		)
		expect(compiled[0]![plain.id]).toBe("Plain.")
	}, 60_000)

	test("summarize request: notes in the scene go into request.scene; none, no key", async () => {
		const w = await seedWorld("notes-summarize")
		const { insertLegacy } = await import("$lib/server/messages/store")
		const line = async () =>
			(
				await insertLegacy(testDb as any, {
					sessionId: w.session.id,
					role: "assistant",
					content: "A line."
				} as any)
			).id
		const withNotes = await w.scene("With", {
			selectedMessageIds: [await line()],
			notes: [note(" First. "), note("   "), note("Second.")]
		})
		const without = await w.scene("Without", {
			selectedMessageIds: [await line()]
		})
		const { processScene } = await import("./scenes")
		requests.length = 0

		await processScene(w.owner.id, { sceneId: withNotes.id } as any, () => {})
		await processScene(w.owner.id, { sceneId: without.id } as any, () => {})

		expect(requests).toHaveLength(2)
		expect(requests[0].scene.notes).toEqual(["First.", "Second."])
		expect("notes" in requests[1].scene).toBe(false)
	}, 60_000)
})
