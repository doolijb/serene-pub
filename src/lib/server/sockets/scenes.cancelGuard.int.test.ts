/**
 * scenes.ts's catch-block guard around generateSummary()/compileScenesForEntry()
 * is deliberately narrower than checking `isQueueCancellation(err) ||
 * err.name === "AbortError"` — it checks abortController.signal.aborted
 * alone. activityStore.cancel() aborts that controller synchronously, so
 * every exception from OUR OWN cancel already has signal.aborted === true
 * by the time it's caught; the broader check only adds a way to misfire on
 * a cancellation from somewhere else entirely (e.g. a future queue-side
 * cancel) and silently strand the activity at "running" forever — for
 * compile specifically, permanently, since startCompile refuses to
 * supersede a "running" entry.
 *
 * This locks in the narrow guard by mocking compileScenesForEntry to reject
 * with a CancelledError while the activity's own abortController was never
 * touched — the case the broader guard would have gotten wrong.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

// A CancelledError from somewhere OTHER than this activity's own
// abortController — e.g. a hypothetical queue-side cancel unrelated to the
// user clicking Cancel on this specific job.
class FakeCancelledError extends Error {
	constructor() {
		super("Cancelled")
		this.name = "CancelledError"
	}
}

vi.mock("$lib/server/utils/summarizer", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return {
		...actual,
		compileScenesForEntry: vi.fn(async () => {
			throw new FakeCancelledError()
		})
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-scenes-cancel-guard-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

describe("sceneCompileHandler — narrowed cancel guard (PGlite integration)", () => {
	test("a CancelledError NOT originating from this activity's own abortController lands the activity in 'error', not stuck at 'running'", async () => {
		const owner = await makeUser("scene-cancel-guard-owner")

		const connection = (
			await testDb
				.insert(schema.connections)
				.values({ name: "test-conn", type: "ollama" })
				.returning()
		)[0]
		const sampling = (
			await testDb
				.insert(schema.samplingConfigs)
				.values({ name: "test-sampling" })
				.returning()
		)[0]
		const contextConfig = (
			await testDb
				.insert(schema.contextConfigs)
				.values({ name: "test-context", template: "{{instructions}}" })
				.returning()
		)[0]
		const promptConfig = (
			await testDb
				.insert(schema.promptConfigs)
				.values({ name: "test-prompt", systemPrompt: "" })
				.returning()
		)[0]

		// Context and prompt still live on `system_settings` — they point at the
		// 0.5 archive tables. Connection and sampling do not: since 0181 they
		// are a `connection_defaults` row keyed by capability, registered below.
		const existingSettings = await testDb.query.systemSettings.findFirst()
		if (existingSettings) {
			await testDb
				.update(schema.systemSettings)
				.set({
					defaultContextConfigId: contextConfig.id,
					defaultPromptConfigId: promptConfig.id
				})
				.where(eq(schema.systemSettings.id, existingSettings.id))
		} else {
			await testDb.insert(schema.systemSettings).values({
				defaultContextConfigId: contextConfig.id,
				defaultPromptConfigId: promptConfig.id
			} as any)
		}
		const { setCapabilityDefault } = await import(
			"$lib/server/connections/capabilityDefaults"
		)
		await setCapabilityDefault(testDb as any, "text->text", {
			connectionId: connection.id,
			samplingConfigId: sampling.id
		})

		const lorebook = (
			await testDb
				.insert(schema.lorebooks)
				.values({ name: "Cancel Guard Lorebook", userId: owner.id })
				.returning()
		)[0]
		const historyEntry = (
			await testDb
				.insert(schema.historyEntries)
				.values({ lorebookId: lorebook.id, year: 1 })
				.returning()
		)[0]
		await testDb.insert(schema.scenes).values({
			lorebookId: lorebook.id,
			historyEntryId: historyEntry.id,
			name: "Scene 1",
			summary: "A summary to compile."
		})

		const { sceneCompileHandler } = await import("./scenes")
		const { activityStore } = await import(
			"$lib/server/utils/activityStore"
		)

		await expect(
			sceneCompileHandler.handler(
				fakeSocket(owner.id),
				{ historyEntryId: historyEntry.id },
				noopEmit
			)
		).rejects.toThrow(/cancelled/i)

		const activities = activityStore.getFor(owner.id, false)
		const activity = activities.find(
			(a) =>
				a.kind === "compile_history_entry" &&
				(a as any).historyEntryId === historyEntry.id
		)
		expect(activity).toBeDefined()
		expect(activity?.status).toBe("error")

		// Not stuck: a fresh compile attempt for the same entry must now be
		// allowed (startCompile only refuses while status === "running").
		activityStore.remove(activity!.id)
	})
})
