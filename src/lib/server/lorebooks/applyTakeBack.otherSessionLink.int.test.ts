/**
 * 🚧 Take-back of an Apply still refuses when another session's own-book link
 * names the entry, in a sentence that is true for it; a link elsewhere in the
 * lorebook keeps its own sentence.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0
const asDb = () => db as unknown as Db
const lore = () => import("$lib/server/lorebooks/ownBook")

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(
			os.tmpdir(),
			"serene-pub-vitest-take-back-other-session-link-"
		)
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function applied() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertOwnBook, applyOverlayItems, ownBookFor } = await lore()
	const user = await createTestUser(db, `take-back-other-${++n}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${n}` })
		.returning()
	const [vault] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: "The Vault",
			content: "Locked."
		})
		.returning()
	const sessionOn = async () => {
		const [s] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				name: `Run ${++n}`,
				lorebookId: book!.id
			})
			.returning()
		await insertOwnBook(asDb(), {
			sessionId: s!.id,
			userId: user.id,
			name: null,
			overlayOf: book!.id,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		return s!
	}
	const a = await sessionOn()
	const b = await sessionOn()
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: a.id, role: "assistant", content: "…" })
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: legacy!.id, sessionId: a.id, role: "assistant" })
	const notesA = (await ownBookFor(asDb(), a.id)).id
	const notesB = (await ownBookFor(asDb(), b.id)).id
	const [keep] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: notesA,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: "Ashfall Keep",
			content: "About Ashfall Keep.",
			sourceMessageId: legacy!.id
		})
		.returning()
	const done = await applyOverlayItems(asDb(), {
		sessionId: a.id,
		userId: user.id
	})
	return { user, book: book!, vault: vault!, keep: keep!, notesB, done }
}

const linkFrom = (lorebookId: number, from: number, to: number) =>
	db
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId,
			fromEntryId: from,
			toEntryId: to,
			relationshipType: "neutral"
		})

describe("take-back of an Apply and a link from another session's notes", () => {
	it("refuses in the sentence for another session's notes", async () => {
		const w = await applied()
		await linkFrom(w.notesB, w.vault.id, w.keep.id)
		const { takeBackApply } = await lore()
		await expect(
			takeBackApply(asDb(), { batch: w.done.batch!, userId: w.user.id })
		).rejects.toThrow(
			"Ashfall Keep is linked from another session's notes, so this can't be taken back."
		)
	})

	it("a link in the lorebook as well keeps today's sentence", async () => {
		const w = await applied()
		await linkFrom(w.notesB, w.vault.id, w.keep.id)
		await linkFrom(w.book.id, w.vault.id, w.keep.id)
		const { takeBackApply } = await lore()
		await expect(
			takeBackApply(asDb(), { batch: w.done.batch!, userId: w.user.id })
		).rejects.toThrow(
			"Something else in the lorebook now links to Ashfall Keep, so this can't be taken back."
		)
	})
})
