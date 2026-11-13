/**
 * A scene the boundary watcher places (Automatic mode, an accepted-by-rule
 * cue) re-sends the history list of the scene's book, as a manual open does:
 * its `unfiledSceneCount` is Compile's gate.
 */
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { releaseDataDir } from "$lib/server/utils/testDb"

let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-scenes-after-boundary-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const db = await createTestDb()
	return { db }
})

vi.mock("$lib/server/sockets/entries", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return { ...actual, relistEntries: vi.fn(async () => {}) }
})

vi.mock(
	"$lib/server/sockets/utils/broadcastHelpers",
	async (importOriginal) => {
		const actual = await importOriginal<any>()
		return {
			...actual,
			broadcastToSessionUsers: vi.fn(async () => {}),
			emitToUserRedacted: vi.fn(async () => {})
		}
	}
)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

beforeEach(async () => {
	const { relistEntries } = await import("$lib/server/sockets/entries")
	vi.mocked(relistEntries).mockClear()
})

describe("afterBoundaryPlaced relists the history list", () => {
	test("a placed scene in a book re-sends that book's history list to its owner", async () => {
		const { afterBoundaryPlaced } = await import("./scenes")
		const { relistEntries } = await import("$lib/server/sockets/entries")

		await afterBoundaryPlaced(
			{},
			{
				sessionId: 1,
				userId: 7,
				lorebookId: 42,
				closedSceneIds: []
			}
		)

		expect(relistEntries).toHaveBeenCalledTimes(1)
		expect(relistEntries).toHaveBeenCalledWith(
			expect.objectContaining({ user: { id: 7 } }),
			42,
			HISTORY_TYPE_ID,
			expect.any(Function)
		)
	}, 60_000)

	test("a session that reads no book re-sends nothing", async () => {
		const { afterBoundaryPlaced } = await import("./scenes")
		const { relistEntries } = await import("$lib/server/sockets/entries")

		await afterBoundaryPlaced(
			{},
			{
				sessionId: 1,
				userId: 7,
				lorebookId: null,
				closedSceneIds: []
			}
		)

		expect(relistEntries).not.toHaveBeenCalled()
	}, 60_000)
})
