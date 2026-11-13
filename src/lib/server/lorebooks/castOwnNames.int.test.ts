/**
 * A cast member's own name and nickname in a book (§0-D): the name sync
 * applies them, *Use from card* (null) clears them, an own empty nickname means
 * none in this book, an own empty name is refused, a background member has
 * none, and a provided book refuses a change to them or to the face — its clone accepts.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { PROVIDED_BOOK_CAST_REFUSAL } from "$lib/server/plugins/providedMarks"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberColumnsOfVersion } from "$lib/server/lorebooks/retold"

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
		path.join(os.tmpdir(), "serene-pub-vitest-cast-own-names-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}
let tag = 1
let n = 0

/**
 * A member as the cast reads it: the binding row, with the columns the member
 * form owns (own names, face, flags) read from the member's base version.
 */
async function memberRow(id: number) {
	const V = schema.characterVersions
	const [stored] = await testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, id))
	const [base] = await testDb
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
	if (!base) return stored
	const c = memberColumnsOfVersion(base, {
		carded: stored.characterId != null
	})
	return {
		...stored,
		ownName: c.ownName,
		ownNickname: c.ownNickname,
		faceMediaId: c.faceMediaId,
		retold: c.retold
	}
}

async function setup(opts: { nickname?: string } = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { syncLorebookBindingsForCharacter } = await import(
		"$lib/server/utils/characterBindingSync"
	)
	const user = await createTestUser(testDb, `own-names-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Own names", userId: user.id })
		.returning()
	const [card] = await testDb
		.insert(schema.characters)
		.values({
			userId: user.id,
			name: "Verity Hale",
			nickname: opts.nickname ?? "",
			description: "Described."
		} as any)
		.returning()
	const { member } = await insertCastMember(testDb as any, {
		lorebookId: book.id,
		binding: `{{char:${tag++}}}`,
		characterId: card.id
	})
	await syncLorebookBindingsForCharacter(card.id, testDb as any, {
		lorebookId: book.id
	})
	const update = async (
		fields: Record<string, unknown>,
		memberId = member.id
	) => {
		const { updateLorebookBindingHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		return (
			await updateLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{ lorebookBinding: { id: memberId, ...fields } } as any,
				noopEmit
			)
		).lorebookBinding
	}
	const row = (id = member.id) => memberRow(id)
	return { user, book, card, member, update, row }
}

describe("own names on a carded member", () => {
	test("none: the card's nickname-or-name reads through", async () => {
		const a = await setup()
		expect((await a.row()).name).toBe("Verity Hale")
		const b = await setup({ nickname: "Vee" })
		expect((await b.row()).name).toBe("Vee")
		expect((await b.row()).ownName).toBeNull()
	})

	test("an own name is the name; the card's names stay aliases", async () => {
		const { update, row } = await setup({ nickname: "Vee" })
		const res = await update({ ownName: "  Maren ", ownNickname: "" })
		expect(res.ownName).toBe("Maren")
		expect(res.name).toBe("Maren")
		const stored = await row()
		expect(stored.aliases).toEqual(
			expect.arrayContaining(["Vee", "Verity Hale"])
		)
		expect(stored.aliases).not.toContain("Maren")
	})

	test("an own nickname wins over the own name", async () => {
		const { update } = await setup()
		const res = await update({ ownName: "Maren", ownNickname: "Mae" })
		expect(res.name).toBe("Mae")
		expect(res.aliases).toContain("Verity Hale")
	})

	test("an own name alone keeps the card's nickname (★L-3)", async () => {
		const { update } = await setup({ nickname: "Vee" })
		const res = await update({ ownName: "Maren" })
		expect(res.ownName).toBe("Maren")
		expect(res.name).toBe("Vee")
	})

	test("Use from card on stores NULL and the card's reads through", async () => {
		const { update, row } = await setup({ nickname: "Vee" })
		await update({ ownName: "Maren", ownNickname: "Mae" })
		const res = await update({ ownName: null, ownNickname: null })
		expect(res.ownName).toBeNull()
		expect(res.ownNickname).toBeNull()
		const stored = await row()
		expect(stored.ownName).toBeNull()
		expect(stored.ownNickname).toBeNull()
		expect(stored.name).toBe("Vee")
	})

	test("toggle off with a blank nickname stores '' and the member shows by name", async () => {
		const { update, row } = await setup({ nickname: "Vee" })
		const res = await update({ ownNickname: "  " })
		expect(res.ownNickname).toBe("")
		expect((await row()).ownNickname).toBe("")
		expect((await row()).name).toBe("Verity Hale")
		const named = await update({ ownName: "Maren", ownNickname: "" })
		expect(named.name).toBe("Maren")
	})

	test("toggle off with a blank name is refused and the row is unchanged", async () => {
		const { update, row } = await setup({ nickname: "Vee" })
		await update({ ownName: "Maren", ownNickname: "Mae" })
		const before = await row()
		for (const blank of ["  ", ""])
			await expect(update({ ownName: blank })).rejects.toThrow(
				"A cast member's name in this book must be text."
			)
		const after = await row()
		expect(after.ownName).toBe("Maren")
		expect(after.ownNickname).toBe("Mae")
		expect(after.name).toBe(before.name)
	})

	test("text only", async () => {
		const { update } = await setup()
		await expect(update({ ownName: 5 })).rejects.toThrow(
			"A cast member's name in this book must be text."
		)
	})

	test("a later card rename leaves the own name standing", async () => {
		const { update, row, card } = await setup()
		await update({ ownName: "Maren" })
		await testDb
			.update(schema.characters)
			.set({ name: "Verity Renamed" })
			.where(eq(schema.characters.id, card.id))
		const { syncLorebookBindingsForCharacter } = await import(
			"$lib/server/utils/characterBindingSync"
		)
		await syncLorebookBindingsForCharacter(card.id, testDb as any)
		const stored = await row()
		expect(stored.name).toBe("Maren")
		expect(stored.aliases).toContain("Verity Renamed")
	})

	test("a background member ignores the fields", async () => {
		const { book, update } = await setup()
		const [bg] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: book.id,
				binding: `{{char:${tag++}}}`,
				name: "Innkeeper"
			})
			.returning()
		const res = await update(
			{ ownName: "Maren", ownNickname: "Mae" },
			bg.id
		)
		expect(res.ownName).toBeNull()
		expect(res.ownNickname).toBeNull()
		expect(res.name).toBe("Innkeeper")
	})
})

describe("a provided book keeps its cast's names and faces", () => {
	async function provided(plugin = "acme", installed = true) {
		const s = await setup()
		await s.update({ ownName: "Maren" })
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
						uuid: s.book.uuid
					}
				}
			})
			.where(eq(schema.lorebooks.id, s.book.id))
		return s
	}

	test("a change to the own name, own nickname, face or face flag is refused", async () => {
		const { update, row } = await provided()
		for (const fields of [
			{ ownName: "Other" },
			{ ownName: null },
			{ ownNickname: "Mae" },
			{ faceMediaId: 999999 },
			{ retold: { face: true } }
		])
			await expect(update(fields)).rejects.toThrow(
				PROVIDED_BOOK_CAST_REFUSAL
			)
		expect((await row()).ownName).toBe("Maren")
	})

	test("a save that sends the stored values is not refused", async () => {
		const { update, row } = await provided()
		const stored = await row()
		const res = await update({
			ownName: stored.ownName,
			ownNickname: stored.ownNickname,
			faceMediaId: stored.faceMediaId,
			retold: stored.retold,
			summary: "Edited"
		})
		expect(res.ownName).toBe("Maren")
	})

	test("its clone carries the own names and accepts a new one", async () => {
		const { user, book, member, row } = await provided()
		const { duplicateLorebookRows } = await import(
			"$lib/server/utils/lorebookDuplicate"
		)
		const dup = await testDb.transaction((tx) =>
			duplicateLorebookRows(tx as any, book.id, user.id, "Clone")
		)
		const cloneRow = (
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, dup.id))
		)[0]
		const cloneMember = await memberRow(cloneRow.id)
		expect(cloneMember.ownName).toBe("Maren")
		const { updateLorebookBindingHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const res = await updateLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: { id: cloneMember.id, ownName: "Fresh" }
			} as any,
			noopEmit
		)
		expect(res.lorebookBinding.ownName).toBe("Fresh")
		expect(res.lorebookBinding.name).toBe("Fresh")
		expect((await row(member.id)).ownName).toBe("Maren")
	})

	test("a book whose plugin was uninstalled accepts a new own name", async () => {
		const { update, row } = await provided("gone", false)
		await update({ ownName: "Other" })
		expect((await row()).ownName).toBe("Other")
	})

	test("a core-marked book refuses", async () => {
		const { update, row } = await provided("core", false)
		await expect(update({ ownName: "Other" })).rejects.toThrow(
			PROVIDED_BOOK_CAST_REFUSAL
		)
		expect((await row()).ownName).toBe("Maren")
	})
})
