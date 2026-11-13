/**
 * The narrator's names are non-cast labels (playtest item 11): the session's
 * current narrator name and every older one its narration rows were written
 * under are stopped on and stripped like the player label and the envoys.
 *
 * One test renames the seeded narrator prompt and reads it through the real
 * `narratorNameFor`; the rest stub the current name to test the other sources.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { insertSessionMessageRow, insertSessionRow } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
/** `REAL` hands the call to the real `narratorNameFor`, over the seeded config world. */
const REAL = Symbol("real")
let currentName: string | null | Error | typeof REAL = "Narrator"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

vi.mock("$lib/server/pipelines/runtime/host", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/pipelines/runtime/host")>()
	return {
		...actual,
		narratorNameFor: async (...args: Parameters<typeof actual.narratorNameFor>) => {
			if (currentName === REAL) return actual.narratorNameFor(...args)
			if (currentName instanceof Error) throw currentName
			return currentName
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-noncast-labels-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function makeSession() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `noncast-${++seq}`)
	return insertSessionRow(testDb, user.id, { isGroup: false })
}

describe("nonCastLabelsFor — the narrator's names", () => {
	test("no session: none", async () => {
		const { nonCastLabelsFor } = await import("$lib/server/pipelines/runtime/dispatch")
		expect(await nonCastLabelsFor(testDb as any, undefined)).toEqual([])
	}, 60_000)

	test("a renamed narrator, and the older names its narration was written under", async () => {
		const { nonCastLabelsFor } = await import("$lib/server/pipelines/runtime/dispatch")
		const { playerLabelFor } = await import("$lib/server/pipelines/entities/sessionGenres")
		const session = await makeSession()
		currentName = "The Chronicler"
		await insertSessionMessageRow(testDb, session.id, {
			role: "assistant",
			content: "The wind rises.",
			metadata: { narratorName: "Narrator" } as any
		})
		await insertSessionMessageRow(testDb, session.id, {
			role: "assistant",
			content: "Rain.",
			metadata: { narratorName: "Old Voice" } as any
		})
		await insertSessionMessageRow(testDb, session.id, {
			role: "assistant",
			content: "More rain.",
			metadata: { narratorName: "  Old Voice " } as any
		})
		await insertSessionMessageRow(testDb, session.id, {
			role: "assistant",
			content: "Blank.",
			metadata: { narratorName: "   " } as any
		})
		await insertSessionMessageRow(testDb, session.id, { role: "user", content: "I wait." })

		const labels = await nonCastLabelsFor(testDb as any, session.id)
		const player = (await playerLabelFor(testDb as any, session.id))?.trim()
		expect(labels).toEqual(
			expect.arrayContaining(["The Chronicler", "Narrator", "Old Voice", ...(player ? [player] : [])])
		)
		expect(new Set(labels).size).toBe(labels.length)
		expect(labels).not.toContain("")
	}, 60_000)

	test("a narrator name that cannot be resolved leaves the history names and the player label", async () => {
		const { nonCastLabelsFor } = await import("$lib/server/pipelines/runtime/dispatch")
		const session = await makeSession()
		currentName = new Error("no narrator pipeline")
		await insertSessionMessageRow(testDb, session.id, {
			role: "assistant",
			content: "Fog.",
			metadata: { narratorName: "Old Voice" } as any
		})
		const labels = await nonCastLabelsFor(testDb as any, session.id)
		expect(labels).toContain("Old Voice")
		currentName = "Narrator"
	}, 60_000)

	test("another session's narration names are not this one's", async () => {
		const { nonCastLabelsFor } = await import("$lib/server/pipelines/runtime/dispatch")
		const mine = await makeSession()
		const other = await makeSession()
		currentName = null
		await insertSessionMessageRow(testDb, other.id, {
			role: "assistant",
			content: "Elsewhere.",
			metadata: { narratorName: "Stranger" } as any
		})
		expect(await nonCastLabelsFor(testDb as any, mine.id)).not.toContain("Stranger")
		currentName = "Narrator"
	}, 60_000)

	test("a Story narrator renamed in its prompt is a non-cast label, through the real narratorNameFor", async () => {
		const { nonCastLabelsFor } = await import("$lib/server/pipelines/runtime/dispatch")
		const { eq, sql } = await import("drizzle-orm")
		// The pipeline catalog, with its seeded narrate prompts (last, so the
		// tests above ran with no narrator world).
		const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
		await bootstrapPipelines(testDb as any)
		const { STORY_GENRE_ID } = await import("@serene-pub/core-catalog")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, `noncast-${++seq}`)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, genreId: STORY_GENRE_ID })
			.returning()
		currentName = REAL
		try {
			// The seeded narrate prompts carry `narratorName`; rename them in this test's DB.
			const seeded = await testDb
				.select()
				.from(schema.pipelinePrompts)
				.where(eq(sql`${schema.pipelinePrompts.fields}->>'narratorName'`, "Narrator"))
			for (const row of seeded)
				await testDb
					.update(schema.pipelinePrompts)
					.set({ fields: { ...(row.fields as Record<string, string>), narratorName: "The Chronicler" } })
					.where(eq(schema.pipelinePrompts.id, row.id))
			expect(seeded.length).toBeGreaterThan(0)
			// Until the narrator has spoken here, its name is not a label (and
			// no world is built for it).
			expect(await nonCastLabelsFor(testDb as any, session.id)).not.toContain("The Chronicler")
			await insertSessionMessageRow(testDb, session.id, {
				role: "assistant",
				content: "Dusk settles.",
				isNarratorResponse: true
			} as any)
			const labels = await nonCastLabelsFor(testDb as any, session.id)
			expect(labels).toContain("The Chronicler")
			expect(labels).not.toContain("Narrator")
		} finally {
			currentName = "Narrator"
		}
	}, 60_000)
})
