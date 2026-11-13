/**
 * A provided book keeps its cast's faces (§0-D), the two holes beside the
 * member form: a picture added to its list (`lorebooks:uploadMemberFace`) and
 * a dated face change (`amendments:create` / `amendments:update`). Its clone,
 * and a book whose plugin was uninstalled, are the person's.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { count, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { PROVIDED_BOOK_CAST_REFUSAL } from "$lib/server/plugins/providedMarks"
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
		path.join(os.tmpdir(), "serene-pub-vitest-l2-provided-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noop = (() => {}) as any
let n = 0
let shade = 10

async function png() {
	const { PNG } = await import("pngjs")
	const p = new PNG({ width: 2, height: 2 })
	p.data.fill(++shade)
	return PNG.sync.write(p)
}

const filesCount = async () =>
	(await testDb.select({ c: count() }).from(schema.files))[0].c

/** A book with one member, marked as `plugin`'s (installed or not). */
async function providedBook(plugin: string, installed: boolean) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `l2-provided-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Provided", userId: user.id })
		.returning()
	const { member } = await insertCastMember(testDb as unknown as Db, {
		lorebookId: book.id,
		name: "Verity",
		binding: `{{char:${n}}}`
	})
	if (installed)
		await testDb
			.insert(schema.plugins)
			.values({
				pluginId: plugin,
				name: plugin,
				bundleSource: "",
				bundleHash: `hash-${plugin}`
			} as any)
			.onConflictDoNothing()
	await testDb
		.update(schema.lorebooks)
		.set({
			extraJson: {
				provided: {
					plugin,
					slug: "pack",
					version: "1.0.0",
					uuid: book.uuid
				}
			}
		})
		.where(eq(schema.lorebooks.id, book.id))
	return { user, book, member }
}

describe("uploadMemberFace on a provided book", () => {
	test("is refused and writes no file; the clone and an uninstalled plugin's book accept", async () => {
		const { uploadMemberFaceHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const { user, book, member } = await providedBook("acme-l2", true)
		const before = await filesCount()
		await expect(
			uploadMemberFaceHandler.handler(
				fakeSocket(user.id),
				{
					castId: member.id,
					imageFile: await png(),
					mimeType: "image/png"
				},
				noop
			)
		).rejects.toThrow(PROVIDED_BOOK_CAST_REFUSAL)
		expect(await filesCount()).toBe(before)

		const { duplicateLorebookRows } = await import(
			"$lib/server/utils/lorebookDuplicate"
		)
		const dup = await testDb.transaction((tx) =>
			duplicateLorebookRows(tx as any, book.id, user.id, "Clone")
		)
		const [cloneMember] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, dup.id))
		const ok = await uploadMemberFaceHandler.handler(
			fakeSocket(user.id),
			{
				castId: cloneMember.id,
				imageFile: await png(),
				mimeType: "image/png"
			},
			noop
		)
		expect(ok.lorebookId).toBe(dup.id)
		expect(await filesCount()).toBe(before + 1)

		const gone = await providedBook("gone-l2", false)
		const res = await uploadMemberFaceHandler.handler(
			fakeSocket(gone.user.id),
			{
				castId: gone.member.id,
				imageFile: await png(),
				mimeType: "image/png"
			},
			noop
		)
		expect(res.castId).toBe(gone.member.id)
	})
})

describe("a dated face change on a provided book", () => {
	test("is refused; a dated summary is not; a re-save changing neither is not", async () => {
		const { amendmentsCreateHandler, amendmentsUpdateHandler } =
			await import("$lib/server/sockets/amendments")
		const { user, book, member: bare } = await providedBook("acme-l2", true)
		// A carded member: only a member with a card can wear a face of its
		// own over the card's (`retold.face` is "not following the card's").
		const { insertCard } = await import("$lib/server/characters/versions")
		const { card } = await testDb.transaction((tx) =>
			insertCard(tx as any, { userId: user.id, name: "Verity", description: "" })
		)
		await testDb
			.delete(schema.characterVersions)
			.where(eq(schema.characterVersions.castMemberId, bare.id))
		await testDb
			.delete(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, bare.id))
		const { member } = await insertCastMember(testDb as unknown as Db, {
			lorebookId: book.id,
			name: "Verity",
			binding: "{{char:carded}}",
			characterId: card.id
		})
		const create = (fields: Record<string, unknown>) =>
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: book.id,
					castId: member.id,
					year: 5,
					fields
				} as any,
				noop
			)
		for (const fields of [
			{ faceMediaId: 999999 },
			{ retold: { face: true } },
			{ faceMediaId: 999999, retold: { face: true } }
		])
			await expect(create(fields)).rejects.toThrow(
				PROVIDED_BOOK_CAST_REFUSAL
			)
		const listed = await create({ summary: "Keeper of the marrow." })
		expect(listed.cast).toHaveLength(1)
		expect(listed.cast[0].fields).toEqual({
			summary: "Keeper of the marrow."
		})
		// Nothing is written to the frozen dated-change table any more.
		expect(await testDb.select().from(schema.castAmendments)).toEqual([])

		// An existing dated version that already wears its own face: re-saving
		// it with the flag unchanged is not refused, changing it is. (Made
		// through the versions writer, past the provided-book check, as a
		// lifted 0.5 change would be.)
		const { writeCastVersion } = await import(
			"$lib/server/characters/versions"
		)
		const { version: own } = await testDb.transaction((tx) =>
			writeCastVersion(tx as any, {
				member: member.id,
				changes: { faceMediaId: null },
				writtenBy: `user:${user.id}`,
				at: {
					branchId: null,
					date: { year: 7, month: null, day: null },
					personalPosition: null
				}
			})
		)
		const update = (fields: Record<string, unknown>) =>
			amendmentsUpdateHandler.handler(
				fakeSocket(user.id),
				{ id: own.id, lorebookId: book.id, subject: "cast", fields } as any,
				noop
			)
		await update({ retold: { face: true }, summary: "Same flag." })
		await expect(update({ retold: { face: false } })).rejects.toThrow(
			PROVIDED_BOOK_CAST_REFUSAL
		)
	})

	test("an uninstalled plugin's book is not refused on the cast sentence", async () => {
		const { amendmentsCreateHandler } = await import(
			"$lib/server/sockets/amendments"
		)
		const { user, book, member } = await providedBook("gone-l2b", false)
		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: book.id,
					castId: member.id,
					year: 5,
					fields: { retold: { face: true } }
				} as any,
				noop
			)
		).resolves.toBeDefined()
	})
})
