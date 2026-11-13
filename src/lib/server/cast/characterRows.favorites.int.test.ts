/**
 * `characterRowsPage`: the asker's favourite cards come first, then the rest by
 * name; the keyset pages across that boundary; an old three-key cursor is
 * refused; and `nickname` is filled on a card row and a card-less member row.
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
	writeCastVersion
} from "$lib/server/characters/versions"
import { CHARACTER_ROWS_STALE_CURSOR } from "$lib/shared/characters/characterRows"
import { characterRowsPage } from "./characterRows"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-chrrows-fav-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0
const uniq = (label: string) => `${label}${++n}`

async function mkUser() {
	const [u] = await testDb
		.insert(schema.users)
		.values({ username: uniq("chrfav-user-") })
		.returning()
	return u!
}

async function mkCard(
	userId: number,
	name: string,
	extra: Partial<typeof schema.characters.$inferInsert> = {}
) {
	const { card } = await insertCard(testDb, {
		userId,
		name,
		description: "A person.",
		...extra
	})
	return card
}

const names = (r: { rows: { shownName: string }[] }) =>
	r.rows.map((x) => x.shownName)

describe("characterRowsPage: favourites first", () => {
	test("favourites first, then the rest by name; paging crosses the boundary once each", async () => {
		const p = uniq("fv")
		const me = await mkUser()
		await mkCard(me.id, `${p} a plain`)
		await mkCard(me.id, `${p} d fav`, { isFavorite: true })
		await mkCard(me.id, `${p} b plain`)
		await mkCard(me.id, `${p} z fav`, { isFavorite: true })
		await mkCard(me.id, `${p} c plain`)
		const all = [
			`${p} d fav`,
			`${p} z fav`,
			`${p} a plain`,
			`${p} b plain`,
			`${p} c plain`
		]

		const whole = await characterRowsPage(db(), me.id, {
			filters: { q: p }
		})
		expect(names(whole)).toEqual(all)

		const seen: string[] = []
		let cursor: string | null = null
		for (let guard = 0; guard < 10; guard++) {
			const r = await characterRowsPage(db(), me.id, {
				filters: { q: p },
				limit: 2,
				cursor
			})
			seen.push(...names(r))
			cursor = r.nextCursor
			if (!cursor) break
		}
		expect(seen).toEqual(all)
	})

	test("an old three-key cursor is refused as stale", async () => {
		const me = await mkUser()
		const old = Buffer.from(
			JSON.stringify({ n: "a", k: 0, i: 1 })
		).toString("base64url")
		await expect(
			characterRowsPage(db(), me.id, { cursor: old })
		).rejects.toThrow(CHARACTER_ROWS_STALE_CURSOR)
	})

	test("another person's favourite (a shared card) does not rank first", async () => {
		const p = uniq("fo")
		const me = await mkUser()
		const owner = await mkUser()
		await mkCard(me.id, `${p} a mine`)
		const theirs = await mkCard(owner.id, `${p} 0 theirs`, {
			isFavorite: true
		})
		await testDb
			.insert(schema.characterShares)
			.values({ characterId: theirs.id, userId: me.id })
		const r = await characterRowsPage(db(), me.id, { filters: { q: p } })
		expect(names(r)).toEqual([`${p} 0 theirs`, `${p} a mine`])
		expect(r.rows[0]!.isFavorite).toBe(false)

		// Sorted by name alone: were it ranked first it would sort first anyway,
		// so prove the rank with a name after the asker's own plain card.
		const late = await mkCard(owner.id, `${p} z theirs`, {
			isFavorite: true
		})
		await testDb
			.insert(schema.characterShares)
			.values({ characterId: late.id, userId: me.id })
		await mkCard(me.id, `${p} m favourite`, { isFavorite: true })
		const r2 = await characterRowsPage(db(), me.id, { filters: { q: p } })
		expect(names(r2)).toEqual([
			`${p} m favourite`,
			`${p} 0 theirs`,
			`${p} a mine`,
			`${p} z theirs`
		])
	})

	test("nickname is filled on a card row and a card-less member row", async () => {
		const p = uniq("nk")
		const me = await mkUser()
		const card = await mkCard(me.id, `${p} Card`, { nickname: "Cardy" })
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: me.id, name: uniq("Book ") })
			.returning()
		const { member } = await insertCastMember(db(), {
			lorebookId: book!.id,
			characterId: null,
			overlayOf: null,
			binding: `{{char:${++n}}}`,
			name: `${p} Loose`
		})
		await writeCastVersion(db(), {
			member: member.id,
			changes: { nickname: "Loosey" },
			writtenBy: `user:${me.id}`,
			at: { branchId: null, date: null, personalPosition: null }
		})
		await mkCard(me.id, `${p} Plain`)

		const r = await characterRowsPage(db(), me.id, { filters: { q: p } })
		const by = (s: string) => r.rows.find((x) => x.shownName.endsWith(s))!
		// The nickname edit renames the stored name too, so find it by its book.
		const inBook = await characterRowsPage(db(), me.id, {
			filters: { lorebookId: book!.id }
		})
		const looseRow = inBook.rows.find((x) => x.castMemberId === member.id)!
		expect(by("Card").nickname).toBe("Cardy")
		expect(by("Card").cardId).toBe(card.id)
		expect(by("Plain").nickname).toBeNull()
		expect(looseRow.nickname).toBe("Loosey")
	})
})
