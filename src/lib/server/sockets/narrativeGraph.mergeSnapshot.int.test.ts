/**
 * What an absorb writes down about a value it no longer stores.
 *
 * `mentioned` is derived now (plan §1), and plan §1's first caveat is the
 * constraint that follows: **a merge log is a point-in-time record by
 * definition.** Merge and undo need the cast *as it was*, not as it would now
 * derive — the vocabulary moves, and re-deriving at undo time would answer about
 * an alphabet the merge never saw. So the snapshot freezes the derived value at
 * the moment the merge happens. That is not a reason to make the stored row
 * primary again, which is the trap this file exists to keep shut.
 *
 * The other half is the work this deleted. Undo used to remap the snapshot's
 * mentioned ids onto the recreated row, because the value was stored and only a
 * remap could put it back. It does not any more: the same transaction recreates
 * the absorbed binding and strips the aliases it lent the survivor, so the
 * gazetteer the next derivation resolves through is the pre-merge one again and
 * the answer reverts by itself.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-merge-snapshot-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

/**
 * A ghost NPC standing in a scene that talks about two other people — one the
 * world already knows (Bramwell), one it does not yet (Kes).
 *
 * Kes is the moving part: nothing resolves that name at first, so the derived
 * mentions start as Bramwell alone. Teaching the world the nickname afterwards
 * is what makes "did the snapshot freeze, or did it re-derive" a question with
 * two different answers.
 */
async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, "merge-snapshot-user")
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Merge Snapshot Book", userId: user.id })
		.returning()
	const character = async (name: string) =>
		(
			await testDb
				.insert(schema.characters)
				.values({ userId: user.id, name, description: "" })
				.returning()
		)[0]
	const aria = await character("Aria")
	const bramwell = await character("Bramwell")
	const kestrel = await character("Kestrel")
	const bind = async (name: string, token: string, characterId?: number) =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: lorebook.id,
					binding: token,
					name,
					characterId: characterId ?? null
				})
				.returning()
		)[0]
	const survivor = await bind("Aria", "{{char:1}}", aria.id)
	const bram = await bind("Bramwell", "{{char:2}}", bramwell.id)
	const kes = await bind("Kestrel", "{{char:3}}", kestrel.id)
	const ghost = await bind("Ghost NPC", "{{char:4}}")

	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: lorebook.id })
		.returning()
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			role: "assistant",
			content:
				"The ghost muttered about Bramwell, and about Kes, and would say no more."
		})
		.returning()
	await testDb
		.insert(schema.messages)
		.values({ id: legacy.id, sessionId: session.id, role: "assistant" })

	const [historyEntry] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id }]))
		.returning()
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: lorebook.id,
			sessionId: session.id,
			historyEntryId: historyEntry.id,
			selectedMessageIds: [legacy.id]
		})
		.returning()
	// The absorbed row is the one standing in the scene — that is what puts
	// this scene in the snapshot at all.
	await testDb.insert(schema.sceneCharacters).values({
		sceneId: scene.id,
		bindingId: ghost.id,
		role: "participant",
		ordinal: 0
	})

	return { user, lorebook, session, scene, survivor, bram, kes, ghost }
}

async function annotate(lorebookId: number, sessionId: number) {
	const { annotateSessionMessages, loadVocabulary } = await import(
		"$lib/server/annotations"
	)
	await annotateSessionMessages(
		testDb as any,
		sessionId,
		await loadVocabulary(testDb as any, lorebookId)
	)
}

describe("the absorb snapshot freezes the derived cast", () => {
	test("records the mentions as they were, and never re-derives them", async () => {
		const { user, lorebook, session, scene, survivor, bram, kes, ghost } =
			await makeBook()
		await annotate(lorebook.id, session.id)

		const {
			narrativeGraphMergeNodeHandler,
			narrativeGraphUndoMergeHandler
		} = await import("./narrativeGraph")
		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: ghost.id, parentNodeId: survivor.id },
			noopEmit
		)

		const log = await testDb.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.lorebookId, lorebook.id)
		})
		expect(log).toBeTruthy()
		expect(log!.sceneSnapshots).toEqual([
			{
				sceneId: scene.id,
				// The stored half, off the rows the repoint is about to move.
				participantCharacters: [ghost.id],
				// The derived half, frozen. Kes is not here: nothing resolved
				// that name when this merge happened.
				mentionedCharacters: [bram.id]
			}
		])

		// Now teach the world the nickname. The transcript, the scene and its
		// cast rows are all untouched — only the vocabulary moves.
		await testDb
			.update(schema.lorebookBindings)
			.set({ aliases: ["Kes"] })
			.where(eq(schema.lorebookBindings.id, kes.id))
		await annotate(lorebook.id, session.id)

		const { deriveSceneMentionsFor } = await import(
			"$lib/server/utils/sceneMentions"
		)
		const now = await deriveSceneMentionsFor(testDb as any, lorebook.id, {
			id: scene.id,
			selectedMessageIds: scene.selectedMessageIds
		})
		expect(now.status).toBe("derived")
		if (now.status !== "derived") throw new Error("unreachable")
		// The live answer moved…
		expect(now.bindingIds).toEqual([bram.id, kes.id].sort((a, b) => a - b))

		// …and the record did not. That is the whole property: a point-in-time
		// record of a derived value has to stop being derived the moment it is
		// taken, or it is not a record of anything.
		const logAgain = await testDb.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.id, log!.id)
		})
		expect(logAgain!.sceneSnapshots[0]!.mentionedCharacters).toEqual([
			bram.id
		])

		// ── Undo: participants come back, mentions are not re-materialised ──
		await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(user.id),
			{ mergeLogId: log!.id },
			noopEmit
		)

		const castRows = await testDb
			.select()
			.from(schema.sceneCharacters)
			.where(eq(schema.sceneCharacters.sceneId, scene.id))
		// The recreated row gets a new id, so the participant is restored
		// through the log's remap rather than by its old id.
		const recreated = await testDb.query.lorebookBindings.findFirst({
			where: and(
				eq(schema.lorebookBindings.lorebookId, lorebook.id),
				eq(schema.lorebookBindings.name, "Ghost NPC")
			)
		})
		expect(recreated).toBeTruthy()
		expect(
			castRows
				.filter((r) => r.role === "participant")
				.map((r) => r.bindingId)
		).toEqual([recreated!.id])
		// ⚠ The deleted work. The log holds a mentioned list; undo does not turn
		// it back into rows, because nothing reads those rows any more and the
		// derivation reverts with the vocabulary on its own.
		expect(castRows.filter((r) => r.role === "mentioned")).toEqual([])
	}, 60_000)
})
