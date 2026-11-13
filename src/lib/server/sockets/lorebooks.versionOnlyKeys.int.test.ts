/**
 * Post-history instructions, creator notes and likeness are retold fields that
 * live on the member's versions only: `lorebooks:updateBinding` writes them to
 * the base version (never the row), `membersAsRead` reads them, turning
 * *Use from card* back on keeps the text, and a bad value is refused.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { MAIN_HEAD } from "$lib/server/state/entriesOnReading"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-version-only-keys-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const V = schema.characterVersions
let n = 0

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `version-only-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${n}`, userId: user.id })
		.returning()
	const { card } = await insertCard(db(), {
		userId: user.id,
		name: `Verity ${n}`,
		description: "The card's description.",
		postHistoryInstructions: "The card's instructions."
	})
	const { member, base } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${n}}}`,
		characterId: card.id,
		name: `Maren ${n}`,
		description: null,
		firstMessage: null
	})
	const update = async (fields: Record<string, unknown>) => {
		const { updateLorebookBindingHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		return (await updateLorebookBindingHandler.handler(
			{ user: { id: user.id } } as any,
			{ lorebookBinding: { id: member.id, ...fields } } as any,
			(async () => {}) as any
		)) as Sockets.Lorebooks.UpdateBinding.Response
	}
	const read = async () => {
		const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
		return (
			await membersAsRead(db(), [member.id], { reading: MAIN_HEAD })
		).get(member.id)!
	}
	const baseRow = async () =>
		(await testDb.select().from(V).where(eq(V.id, base!.id)))[0]
	return { member, base: base!, update, read, baseRow }
}

describe("version-only member keys through lorebooks:updateBinding", () => {
	test("Use from card off: an own value on the base, read as the member's; back on: the card again, the text kept", async () => {
		const w = await world()
		const first = await w.read()
		expect(first.postHistoryInstructions).toBe("The card's instructions.")

		const res = await w.update({
			retold: { postHistoryInstructions: true },
			postHistoryInstructions: "Her own instructions."
		})
		expect(res.lorebookBinding.postHistoryInstructions).toBe(
			"Her own instructions."
		)
		const own = await w.baseRow()
		expect(own.postHistoryInstructions).toBe("Her own instructions.")
		expect(own.follows).not.toContain("postHistoryInstructions")
		expect((await w.read()).postHistoryInstructions).toBe(
			"Her own instructions."
		)
		// The row never got a column of its own.
		const [row] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, w.member.id))
		expect(row).not.toHaveProperty("postHistoryInstructions")

		await w.update({ retold: {} })
		const followed = await w.baseRow()
		expect(followed.follows).toContain("postHistoryInstructions")
		expect(followed.postHistoryInstructions).toBe("Her own instructions.")
		expect((await w.read()).postHistoryInstructions).toBe(
			"The card's instructions."
		)
	})

	test("creator notes and likeness ride the same way", async () => {
		const w = await world()
		const notes = { text: "Note.", lang: "en", variants: { fr: "Note." } }
		const res = await w.update({
			retold: { creatorNotes: true, likeness: true },
			creatorNotes: notes,
			likeness: { prompt: "  red coat ", junk: 1 }
		})
		expect(res.lorebookBinding.creatorNotes).toEqual(notes)
		expect(res.lorebookBinding.likeness).toEqual({ prompt: "red coat" })
		const row = await w.baseRow()
		expect(row.creatorNotes).toEqual(notes)
		expect(row.likeness).toEqual({ prompt: "red coat" })
		expect(row.follows).toEqual(
			expect.not.arrayContaining(["creatorNotes", "likeness"])
		)
	})

	test("a bad value is refused in a sentence that says what to send", async () => {
		const w = await world()
		await expect(w.update({ likeness: "tall" })).rejects.toThrow(
			/likeness is null, or \{ imageMediaId/
		)
		await expect(w.update({ likeness: { prompt: 4 } })).rejects.toThrow(
			/likeness is null/
		)
		await expect(w.update({ creatorNotes: { text: "x" } })).rejects.toThrow(
			/creator notes are null, or \{ text: string/
		)
		await expect(w.update({ postHistoryInstructions: 5 })).rejects.toThrow(
			/post-history instructions are text, or null/
		)
		await expect(
			w.update({ likeness: { imageMediaId: 999999 } })
		).rejects.toThrow(/not one of yours/)
	})
})
