/**
 * A stat write whose owner is deleted while it is being made (plan A6,
 * review fix-up).
 *
 * An owner id has no foreign key (`owners.ts`), so a stat row can only be
 * kept from outliving its owner by the write itself: the delete removes the
 * owner's stats in its transaction, and a write that checked the owner BEFORE
 * that and inserted AFTER it left a row naming nobody. Each write here is
 * made with the member deleted between its checks and its insert — the hook
 * on the lore-write-mode read, which every book-layer write asks after the
 * owner check — and must refuse rather than store the row.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, genre, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const between = vi.hoisted(() => ({ run: null as null | (() => Promise<void>) }))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

vi.mock("$lib/server/state/loreWriteMode", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/state/loreWriteMode")>()
	return {
		...real,
		sessionLoreWriteMode: async (...args: Parameters<typeof real.sessionLoreWriteMode>) => {
			const run = between.run
			between.run = null
			if (run) await run()
			return real.sessionLoreWriteMode(...args)
		}
	}
})

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-write-owner-gone-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"
const GENRE = "test:genre/write-owner-gone"

let n = 0
async function world() {
	_clearAttributeSlots()
	const hp = defineAttributeSlot(HP, {
		type: "integer",
		descriptor: "How much punishment they can still take.",
		appliesTo: ["cast"],
		config: { min: 0, max: 20 },
		default: 20
	})
	genre(GENRE, { name: { en: "Write owner gone" }, family: "test", slots: [hp], events: {} })
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `owner-gone-${++n}`)
	const [book] = await testDb.insert(schema.lorebooks).values({ userId: user.id, name: `World ${n}` }).returning()
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId: book!.id, binding: "{{char:1}}", name: "Verity" })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${n}`, genreId: GENRE, lorebookId: book!.id })
		.returning()
	await testDb
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "full" })
		.onConflictDoUpdate({ target: schema.userSettings.userId, set: { loreWriteMode: "full" } })
	/** Delete the member as the delete does: its stats, then the row, in one transaction. */
	const deleteMember = async () => {
		const { deleteOwnerStats } = await import("$lib/server/state/lorebookState")
		await testDb.transaction(async (tx) => {
			await deleteOwnerStats(tx as any, ["cast_member"], [member!.id])
			await tx.delete(schema.lorebookBindings).where(eq(schema.lorebookBindings.id, member!.id))
		})
	}
	const ctx = { sessionId: session!.id, updatedBy: "user" as const, userId: user.id }
	const owner = { kind: "cast_member" as const, id: member!.id }
	return { user, book: book!, member: member!, session: session!, deleteMember, ctx, owner }
}

const rowsNaming = async (memberId: number) => {
	const named = <T extends { ownerKind: any; ownerId: any }>(t: T) =>
		and(eq(t.ownerKind, "cast_member"), eq(t.ownerId, memberId))
	return {
		values: (await testDb.select().from(schema.attributeValues).where(named(schema.attributeValues))).length,
		configs: (await testDb.select().from(schema.attributeConfigs).where(named(schema.attributeConfigs))).length,
		changes: (await testDb.select().from(schema.stateProposals)).filter(
			(p) => (p.payload as any)?.owner?.kind === "cast_member" && (p.payload as any)?.owner?.id === memberId
		).length
	}
}
const NOTHING = { values: 0, configs: 0, changes: 0 }

describe("a member deleted while a stat of theirs is being written", () => {
	test("setValue refuses, and stores nothing for them", async () => {
		const { setValue } = await import("./write")
		const w = await world()
		between.run = w.deleteMember
		await expect(setValue(testDb as any, w.ctx, { owner: w.owner, slotId: HP, value: 5 })).rejects.toThrow(
			"that cast member is no longer in this session's lorebook."
		)
		expect(await rowsNaming(w.member.id)).toEqual(NOTHING)
	})

	test("configure refuses, and stores nothing for them", async () => {
		const { configure } = await import("./write")
		const w = await world()
		between.run = w.deleteMember
		await expect(
			configure(testDb as any, w.ctx, { owner: w.owner, slotId: HP, config: { max: 30 } })
		).rejects.toThrow("that cast member is no longer in this session's lorebook.")
		expect(await rowsNaming(w.member.id)).toEqual(NOTHING)
	})

	test("proposeChange refuses, and files nothing for them", async () => {
		const { proposeChange } = await import("./write")
		const w = await world()
		between.run = w.deleteMember
		await expect(
			proposeChange(testDb as any, w.ctx, { owner: w.owner, slotId: HP, value: 5 })
		).rejects.toThrow("that cast member is no longer in this session's lorebook.")
		expect(await rowsNaming(w.member.id)).toEqual(NOTHING)
	})

	test("with the member still there, each write lands", async () => {
		const { setValue, configure } = await import("./write")
		const w = await world()
		await setValue(testDb as any, w.ctx, { owner: w.owner, slotId: HP, value: 5 })
		await configure(testDb as any, w.ctx, { owner: w.owner, slotId: HP, config: { max: 30 } })
		expect(await rowsNaming(w.member.id)).toEqual({ values: 1, configs: 1, changes: 0 })
	})
})
