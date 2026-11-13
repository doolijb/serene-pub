/**
 * 🚧 A cast member's voice is its `timbre`, and the member save path runs the
 * card's rule (`validateTimbre`): a member picks no voice unless an admin, a
 * bad value is refused with a reason, and `null` on a carded member is *Use
 * from card* — over a real database.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"

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
		path.join(os.tmpdir(), "serene-pub-vitest-member-timbre-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const noopEmit = () => {}
let n = 0
let tag = 1
const V = schema.characterVersions

async function voice(slug: string) {
	await testDb.insert(schema.voicebankVoices).values({
		slug,
		name: slug,
		voiceId: `id-${slug}`
	} as any)
	return slug
}

async function world(opts: { carded?: boolean; admin?: boolean } = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `member-timbre-${++n}`)
	const socket = { user: { id: user.id, isAdmin: !!opts.admin } } as any
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${n}`, userId: user.id })
		.returning()
	const [card] = await testDb
		.insert(schema.characters)
		.values({
			userId: user.id,
			name: "Verity Hale",
			description: "Card."
		} as any)
		.returning()
	const carded = !!opts.carded
	const { member } = await insertCastMember(db(), {
		lorebookId: book.id,
		binding: `{{char:${tag++}}}`,
		characterId: carded ? card.id : null,
		...(carded ? {} : { name: "The innkeeper" })
	})
	const update = async (fields: Record<string, unknown>) => {
		const { updateLorebookBindingHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		return (updateLorebookBindingHandler as any).handler(
			socket,
			{ lorebookBinding: { id: member.id, ...fields } },
			noopEmit
		)
	}
	const create = async (fields: Record<string, unknown>) => {
		const { createLorebookBindingHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		return (createLorebookBindingHandler as any).handler(
			socket,
			{
				lorebookBinding: {
					lorebookId: book.id,
					name: "A drifter",
					...fields
				}
			},
			noopEmit
		)
	}
	const stored = async (id = member.id) => {
		const [row] = await testDb
			.select()
			.from(V)
			.where(
				and(
					eq(V.castMemberId, id),
					isNull(V.cardId),
					isNull(V.branchId),
					isNull(V.year),
					isNull(V.personalPosition),
					isNull(V.sourceSessionId)
				)
			)
		return row
	}
	return { user, member, update, create, stored }
}

describe("the member save path checks the timbre", () => {
	test("a non-admin's voice is not stored; the other fields are", async () => {
		const slug = await voice("mt-real-1")
		const w = await world()
		await w.update({
			timbre: { voice: slug, language: "en", description: "Gruff." }
		})
		const t = (await w.stored()).timbre as any
		expect(t.voice).toBeUndefined()
		expect(t.language).toBe("en")
		expect(t.description).toBe("Gruff.")
	})

	test("a non-admin cannot change a voice an admin set", async () => {
		const a = await voice("mt-a")
		const b = await voice("mt-b")
		const w = await world()
		await testDb
			.update(V)
			.set({ timbre: { voice: a } })
			.where(eq(V.id, (await w.stored()).id))
		await w.update({ timbre: { voice: b, language: "ja" } })
		const t = (await w.stored()).timbre as any
		expect(t.voice).toBe(a)
		expect(t.language).toBe("ja")
	})

	test("an admin's voice is stored", async () => {
		const slug = await voice("mt-real-3")
		const w = await world({ admin: true })
		await w.update({ timbre: { voice: slug } })
		expect(((await w.stored()).timbre as any).voice).toBe(slug)
	})

	test("an unknown voice is refused and nothing is written", async () => {
		const w = await world({ admin: true })
		await expect(
			w.update({ timbre: { voice: "no-such-voice", language: "fr" } })
		).rejects.toThrow('No voice named "no-such-voice" in the voicebank.')
		expect((await w.stored()).timbre ?? null).toBeNull()
	})

	test("a bad language is refused for anyone", async () => {
		for (const admin of [false, true]) {
			const w = await world({ admin })
			await expect(
				w.update({ timbre: { language: "english" } })
			).rejects.toThrow(/two-letter language code/)
			expect((await w.stored()).timbre ?? null).toBeNull()
		}
	})

	test("a non-admin's create stores no voice", async () => {
		const slug = await voice("mt-real-6")
		const w = await world()
		const res = await w.create({ timbre: { voice: slug, language: "en" } })
		const t = (await w.stored(res.lorebookBinding.id)).timbre as any
		expect(t.voice).toBeUndefined()
		expect(t.language).toBe("en")
	})

	test("null on a carded member follows the card (no own timbre, no voice picked)", async () => {
		const w = await world({ carded: true })
		await w.update({ timbre: { language: "en" } })
		expect(((await w.stored()).timbre as any).language).toBe("en")
		expect((await w.stored()).follows).not.toContain("timbre")
		await w.update({ timbre: null })
		// Following the card is the version's `follows`, not an emptied column.
		expect((await w.stored()).follows).toContain("timbre")
	})
})
