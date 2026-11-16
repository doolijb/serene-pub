/**
 * `sessionAsleep` — whether every live player seat is asleep — reads the
 * session's links once for all its seats, and still sees a write on the next
 * call: nothing is kept between calls.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const ASLEEP = "core:slot/asleep@1"
const d = () => db as unknown as Db
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-session-asleep-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world(seatCount: number) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `session-asleep-${suffix}`)
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Asleep ${suffix}`,
			lorebookId: lorebook!.id
		})
		.returning()
	const seats: number[] = []
	for (let i = 0; i < seatCount; i++) {
		const [seat] = await db
			.insert(schema.sessionPersonas)
			.values({
				sessionId: session!.id,
				userId: user.id,
				seatName: `Seat ${i}`,
				position: i
			})
			.returning()
		seats.push(seat!.id)
	}
	const sleep = async (seatId: number, value: boolean) => {
		const { setValue } = await import("$lib/server/state/write")
		await setValue(
			d(),
			{
				sessionId: session!.id,
				updatedBy: "user" as const,
				userId: user.id
			},
			{
				owner: { kind: "player_seat", id: seatId },
				slotId: ASLEEP,
				value
			} as never
		)
	}
	return { sessionId: session!.id, seats, sleep }
}

describe("sessionAsleep", () => {
	test("no seats is not asleep", async () => {
		const w = await world(0)
		const { sessionAsleep } = await import("./resolve")
		expect(await sessionAsleep(d(), w.sessionId)).toBe(false)
	})

	test("two live seats, none asleep, is not asleep", async () => {
		const w = await world(2)
		const { sessionAsleep } = await import("./resolve")
		expect(await sessionAsleep(d(), w.sessionId)).toBe(false)
	})

	test("both asleep is asleep; one written back awake is not, on the next call", async () => {
		const w = await world(2)
		const { sessionAsleep } = await import("./resolve")
		await w.sleep(w.seats[0]!, true)
		expect(await sessionAsleep(d(), w.sessionId)).toBe(false)
		await w.sleep(w.seats[1]!, true)
		expect(await sessionAsleep(d(), w.sessionId)).toBe(true)
		await w.sleep(w.seats[1]!, false)
		expect(await sessionAsleep(d(), w.sessionId)).toBe(false)
	})
})
