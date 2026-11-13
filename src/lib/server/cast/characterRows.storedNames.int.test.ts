/**
 * The Characters view pages and sorts by `lorebook_bindings.name` and finds a
 * card's members by `lorebook_bindings.character_id`, and shows the name
 * `membersAsRead` gives. These tests drive the app's writers and assert the
 * stored pair tracks that reading (Main at its head) after each write.
 *
 * `writeMemberEdit` is private to `sockets/lorebooks.ts`, so the member edit
 * and the unlink / link are its steps in the order the socket takes them: the
 * binding row's own columns, the version write (`writeCastVersion`,
 * `reparentFromBookPresent`, `makeMemberCardless`), then the attach-time sync.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	insertCard,
	insertCastMember,
	newCardVersion,
	reparentFromBookPresent,
	deleteCastVersion,
	updateCardVersion,
	updateCastVersion,
	writeCastVersion
} from "$lib/server/characters/versions"
import { profileOf } from "$lib/shared/characters/profile"
import { syncLorebookBindingsForCharacter } from "$lib/server/utils/characterBindingSync"
import { makeMemberCardless } from "./cardless"
import { membersAsRead } from "./memberAsRead"

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
		path.join(os.tmpdir(), "serene-pub-vitest-chrrows-names-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0
const author = (id: number) => `user:${id}`
const base = { branchId: null, date: null, personalPosition: null }

async function world(linked: boolean) {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: `chrrows-names-${++n}` })
		.returning()
	const { card, version } = await insertCard(testDb, {
		userId: user!.id,
		name: `Card ${n}`,
		description: "A person."
	})
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: `Book ${n}` })
		.returning()
	const { member } = await insertCastMember(db(), {
		lorebookId: book!.id,
		characterId: linked ? card.id : null,
		binding: `{{char:${n}}}`,
		name: linked ? card.name : `Bare ${n}`
	})
	return { user: user!, card, version, book: book!, member }
}

/** The stored pair, and what the book's present reads. */
async function pair(memberId: number) {
	const [row] = await testDb
		.select({
			name: schema.lorebookBindings.name,
			characterId: schema.lorebookBindings.characterId
		})
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, memberId))
	const read = (await membersAsRead(db(), [memberId])).get(memberId)!
	return { stored: row!, read }
}

async function expectTracked(memberId: number) {
	const { stored, read } = await pair(memberId)
	expect(stored.name).toBe(read.shownName)
	expect(stored.characterId).toBe(read.activeCardId)
}

describe("stored names track the book's present", () => {
	test("a card edited in place (the version its members follow) and the sync", async () => {
		const w = await world(true)
		await updateCardVersion(db(), w.version.id, { name: "Edited Card" })
		await syncLorebookBindingsForCharacter(w.card.id, db())
		await expectTracked(w.member.id)
		expect((await pair(w.member.id)).stored.name).toBe("Edited Card")
	})

	// A new card version leaves the member on its parent (old) card version, so it keeps reading the old name and the sync stores that, not the card's current one.
	test("a card rename as a new card version and the sync", async () => {
		const w = await world(true)
		await expectTracked(w.member.id)
		await newCardVersion(testDb, w.card.id, {
			...profileOf(w.version),
			name: "Renamed Card"
		})
		await syncLorebookBindingsForCharacter(w.card.id, db())
		await expectTracked(w.member.id)
		expect((await pair(w.member.id)).stored.name).toBe(w.card.name)
	})

	test("a member's own name edit, then the sync", async () => {
		const w = await world(true)
		await writeCastVersion(db(), {
			member: w.member.id,
			changes: { name: "Own Name" },
			writtenBy: author(w.user.id),
			at: base
		})
		await syncLorebookBindingsForCharacter(w.card.id, db(), {
			lorebookId: w.book.id
		})
		await expectTracked(w.member.id)
		expect((await pair(w.member.id)).stored.name).toBe("Own Name")
	})

	test("a member's own nickname edit, then the sync", async () => {
		const w = await world(true)
		await writeCastVersion(db(), {
			member: w.member.id,
			changes: { nickname: "Nicky" },
			writtenBy: author(w.user.id),
			at: base
		})
		await syncLorebookBindingsForCharacter(w.card.id, db(), {
			lorebookId: w.book.id
		})
		await expectTracked(w.member.id)
		expect((await pair(w.member.id)).stored.name).toBe("Nicky")
	})

	test("a card-less member's rename (the binding row and its version)", async () => {
		const w = await world(false)
		await testDb
			.update(schema.lorebookBindings)
			.set({ name: "Bare Renamed" })
			.where(eq(schema.lorebookBindings.id, w.member.id))
		await writeCastVersion(db(), {
			member: w.member.id,
			changes: { name: "Bare Renamed" },
			writtenBy: author(w.user.id),
			at: base
		})
		await expectTracked(w.member.id)
	})

	test("an unlink", async () => {
		const w = await world(true)
		await testDb
			.update(schema.lorebookBindings)
			.set({ characterId: null })
			.where(eq(schema.lorebookBindings.id, w.member.id))
		await reparentFromBookPresent(db(), w.member.id, {
			cardId: null,
			writtenBy: author(w.user.id)
		})
		await makeMemberCardless(db(), w.member.id, {
			cause: "unlink",
			card: w.card.id
		})
		await expectTracked(w.member.id)
		expect((await pair(w.member.id)).stored.characterId).toBeNull()
	})

	test("a link", async () => {
		const w = await world(false)
		await testDb
			.update(schema.lorebookBindings)
			.set({ characterId: w.card.id })
			.where(eq(schema.lorebookBindings.id, w.member.id))
		await reparentFromBookPresent(db(), w.member.id, {
			cardId: w.card.id,
			writtenBy: author(w.user.id)
		})
		await syncLorebookBindingsForCharacter(w.card.id, db(), {
			lorebookId: w.book.id
		})
		await expectTracked(w.member.id)
		expect((await pair(w.member.id)).stored.characterId).toBe(w.card.id)
	})

	test("a dated cast version on Main that renames the member", async () => {
		const w = await world(false)
		await writeCastVersion(db(), {
			member: w.member.id,
			changes: { name: "Later Name" },
			writtenBy: author(w.user.id),
			at: {
				branchId: null,
				date: { year: 30, month: 1, day: 1 },
				personalPosition: null
			}
		})
		await expectTracked(w.member.id)
	})
	const dated = (year: number) => ({
		branchId: null,
		date: { year, month: 1, day: 1 },
		personalPosition: null
	})

	// `membersAsRead` reads Main at its head (it takes no book clock), so a later date is not held out of the reading; the edit changes the dated version's name instead.
	test("an edit of the dated version that renames the member", async () => {
		const w = await world(false)
		const v = await writeCastVersion(db(), {
			member: w.member.id,
			changes: { name: "Later Name" },
			writtenBy: author(w.user.id),
			at: dated(30)
		})
		await expectTracked(w.member.id)
		await updateCastVersion(db(), (v as any).id ?? (v as any).version.id, {
			changes: { name: "Another Name" }
		})
		await expectTracked(w.member.id)
		expect((await pair(w.member.id)).stored.name).toBe("Another Name")
	})

	test("an edit that re-dates the renaming version", async () => {
		const w = await world(false)
		const v = await writeCastVersion(db(), {
			member: w.member.id,
			changes: { name: "Later Name" },
			writtenBy: author(w.user.id),
			at: dated(30)
		})
		await updateCastVersion(db(), (v as any).id ?? (v as any).version.id, {
			place: dated(60)
		})
		await expectTracked(w.member.id)
	})

	test("deleting the dated rename brings the base name back", async () => {
		const w = await world(false)
		const v = await writeCastVersion(db(), {
			member: w.member.id,
			changes: { name: "Later Name" },
			writtenBy: author(w.user.id),
			at: dated(30)
		})
		await expectTracked(w.member.id)
		expect((await pair(w.member.id)).stored.name).toBe("Later Name")
		await deleteCastVersion(db(), (v as any).id ?? (v as any).version.id)
		await expectTracked(w.member.id)
		expect((await pair(w.member.id)).stored.name).toBe(`Bare ${n}`)
	})

	test("a carded member renamed by a dated Main version", async () => {
		const w = await world(true)
		await writeCastVersion(db(), {
			member: w.member.id,
			changes: { name: "Dated Name" },
			writtenBy: author(w.user.id),
			at: dated(30)
		})
		await expectTracked(w.member.id)
		expect((await pair(w.member.id)).stored.name).toBe("Dated Name")
	})
})
