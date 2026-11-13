/**
 * 🚧 `lorebooks:updateMemberToCardVersion` — **Update ‹member› to card
 * ‹label›**: a member whose versions read an older version of its card moves
 * to the card's current version, answered as the cast list now has it, with
 * `lorebookId` on the reply (the event is scoped on it). Refused in words for a
 * member already on the current version, a card-less member, and anyone but
 * the book's owner — over a real database.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	insertCard,
	insertCastMember,
	newCardVersion
} from "$lib/server/characters/versions"
import { profileOf } from "$lib/shared/characters/profile"

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
		path.join(os.tmpdir(), "serene-pub-vitest-update-member-card-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
let n = 0

async function world(opts: { carded: boolean }) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `upd-card-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${n}`, userId: user.id })
		.returning()
	const { card, version } = await insertCard(db(), {
		userId: user.id,
		name: `Verity ${n}`,
		description: "The card's first words."
	})
	const { member } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${n}}}`,
		characterId: opts.carded ? card.id : null,
		name: `Maren ${n}`,
		description: opts.carded ? null : "Her own description."
	})
	return { user, book: book!, card, v1: version, member }
}

async function ask(userId: number, castId: number) {
	const { updateMemberToCardVersionHandler } = await import(
		"$lib/server/sockets/lorebooks"
	)
	const emitted: { event: string; data: any }[] = []
	const emit = async (event: string, data: unknown) => {
		emitted.push({
			event,
			data: typeof data === "function" ? await data() : data
		})
	}
	try {
		const res = (await updateMemberToCardVersionHandler.handler(
			fakeSocket(userId),
			{ castId },
			emit as any
		)) as Sockets.Lorebooks.UpdateMemberToCardVersion.Response
		return { res, error: null as string | null, emitted }
	} catch {
		const err = emitted.find(
			(e) => e.event === "lorebooks:updateMemberToCardVersion:error"
		)
		return {
			res: null,
			error: (err?.data.error as string) ?? null,
			emitted
		}
	}
}

describe("lorebooks:updateMemberToCardVersion", () => {
	test("a carded member moves to the card's new version; a second call is refused", async () => {
		const w = await world({ carded: true })
		const v2 = await newCardVersion(
			db(),
			w.card.id,
			{ ...profileOf(w.v1), description: "The card's second words." },
			{ label: "2.0" }
		)
		const first = await ask(w.user.id, w.member.id)
		expect(first.error).toBeNull()
		const res = first.res!
		expect(res.moved).toBeGreaterThanOrEqual(1)
		expect(res.lorebookId).toBe(w.book.id)
		expect(res.castId).toBe(w.member.id)
		expect(res.cardVersion).toEqual({ id: v2.id, number: 2, label: "2.0" })
		expect(res.lorebookBinding.cardVersion?.id).toBe(v2.id)
		expect(res.lorebookBinding.behindCard).toBe(false)
		const sent = first.emitted.find(
			(e) => e.event === "lorebooks:updateMemberToCardVersion"
		)
		expect(sent?.data.lorebookId).toBe(w.book.id)
		expect(
			first.emitted.some((e) => e.event === "lorebooks:bindingList")
		).toBe(true)

		const again = await ask(w.user.id, w.member.id)
		expect(again.res).toBeNull()
		expect(again.error).toBe(
			`Verity ${n} already reads the card's current version, v2.0.`
		)
	})

	test("a card-less member is refused", async () => {
		const w = await world({ carded: false })
		const r = await ask(w.user.id, w.member.id)
		expect(r.res).toBeNull()
		expect(r.error).toBe(
			`Maren ${n} reads no card in this lorebook, so there is no card version to update to.`
		)
	})

	test("someone who does not own the book is refused", async () => {
		const w = await world({ carded: true })
		await newCardVersion(db(), w.card.id, profileOf(w.v1))
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const other = await createTestUser(testDb, `upd-card-other-${n}`)
		const r = await ask(other.id, w.member.id)
		expect(r.res).toBeNull()
		expect(r.error).toBe("Access denied.")
	})

	test("an unknown member is refused", async () => {
		const w = await world({ carded: true })
		const r = await ask(w.user.id, 999_999_999)
		expect(r.error).toBe("That cast member is not in this lorebook.")
	})
})
