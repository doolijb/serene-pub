/**
 * 🚧 ★6 (owner 2026-11-08): `writeSeatName` opens a named seat through
 * `seatPlayer`, which mints one card-less member in the session's book.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { writeSeatName } from "./seatName"

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
		path.join(os.tmpdir(), "serene-pub-vitest-seatname-mint-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const db = () => testDb as unknown as Db

async function setup() {
	const [u] = await testDb
		.insert(schema.users)
		.values({ username: `mint-user-${++n}` })
		.returning()
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId: u!.id, isGroup: false, name: `Run ${++n}` })
		.returning()
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db(), s!.id)
	return { u: u!, s: s!, own }
}

const members = (lorebookId: number) =>
	testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))

const seatRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, id))
	)[0]!

describe("writeSeatName mints a card-less member", () => {
	test("a named Take a seat makes one member and a player seat holding it", async () => {
		const { u, s, own } = await setup()
		const before = (await members(own.id)).length
		const id = await writeSeatName(db(), {
			sessionId: s.id,
			userId: u.id,
			isOwner: true,
			name: "Ann"
		})
		const after = await members(own.id)
		expect(after.length - before).toBe(1)
		const seat = await seatRow(id!)
		expect(seat).toMatchObject({
			personaId: null,
			seatName: "Ann",
			userId: u.id,
			castMemberId: after[after.length - 1]!.id
		})
	})

	test("a retire re-seat benches the old seat and mints a second member", async () => {
		const { u, s, own } = await setup()
		const first = await writeSeatName(db(), {
			sessionId: s.id,
			userId: u.id,
			isOwner: true,
			name: "Ann"
		})
		const second = await writeSeatName(db(), {
			sessionId: s.id,
			userId: u.id,
			isOwner: true,
			name: "Bea",
			retireSeatId: first
		})
		expect(await seatRow(first!)).toMatchObject({
			isActive: false,
			removedAt: null
		})
		const seat = await seatRow(second!)
		expect(seat).toMatchObject({
			seatName: "Bea",
			personaId: null,
			removedAt: null
		})
		expect(seat.castMemberId).not.toBeNull()
		expect(seat.castMemberId).not.toBe((await seatRow(first!)).castMemberId)
		expect(await members(own.id)).toHaveLength(2)
	})

	test("renaming an existing seat mints nothing", async () => {
		const { u, s, own } = await setup()
		const first = await writeSeatName(db(), {
			sessionId: s.id,
			userId: u.id,
			isOwner: true,
			name: "Ann"
		})
		const before = (await members(own.id)).length
		const again = await writeSeatName(db(), {
			sessionId: s.id,
			userId: u.id,
			isOwner: true,
			name: "Anna"
		})
		expect(again).toBe(first)
		expect((await members(own.id)).length).toBe(before)
		expect((await seatRow(first!)).seatName).toBe("Anna")
	})
})

describe("🚧 a benched seat is never the speaking seat (owner 2026-11-10)", () => {
	test("cardlessPlayerSeatOf never returns a benched seat", async () => {
		const { cardlessPlayerSeatOf } = await import("./seatName")
		const { u, s } = await setup()
		const first = await writeSeatName(db(), {
			sessionId: s.id,
			userId: u.id,
			isOwner: true,
			name: "Ann"
		})
		expect(await cardlessPlayerSeatOf(db(), s.id, u.id)).toBe(first)
		await testDb
			.update(schema.sessionPersonas)
			.set({ isActive: false })
			.where(eq(schema.sessionPersonas.id, first!))
		expect(await cardlessPlayerSeatOf(db(), s.id, u.id)).toBeNull()
	})

	test("writeSeatName with no playerSeatId never names a benched seat", async () => {
		const { u, s } = await setup()
		const first = await writeSeatName(db(), {
			sessionId: s.id,
			userId: u.id,
			isOwner: true,
			name: "Ann"
		})
		await testDb
			.update(schema.sessionPersonas)
			.set({ isActive: false })
			.where(eq(schema.sessionPersonas.id, first!))
		const second = await writeSeatName(db(), {
			sessionId: s.id,
			userId: u.id,
			isOwner: true,
			name: "Bea"
		})
		expect(second).not.toBe(first)
		expect((await seatRow(first!)).seatName).toBe("Ann")
		expect((await seatRow(second!)).seatName).toBe("Bea")
	})

	test("naming a benched seat by its id is a names read and still works", async () => {
		const { u, s } = await setup()
		const first = await writeSeatName(db(), {
			sessionId: s.id,
			userId: u.id,
			isOwner: true,
			name: "Ann"
		})
		await testDb
			.update(schema.sessionPersonas)
			.set({ isActive: false })
			.where(eq(schema.sessionPersonas.id, first!))
		const again = await writeSeatName(db(), {
			sessionId: s.id,
			userId: u.id,
			isOwner: true,
			name: "Anna",
			playerSeatId: first!
		})
		expect(again).toBe(first)
		expect((await seatRow(first!)).seatName).toBe("Anna")
	})
})
