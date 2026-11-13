/**
 * 🚧 `state:showTieSide` reads a `{ kind: "seated_member", id: <memberId> }`
 * owner as its seat's stored owner (plan §27 S3, `seatedOwnerAtDoor`): the
 * seat's `session_cast` (by card) or `player_seat` (by seat id). A member no
 * seat of the session seats is refused in `NOT_IN_CAST`; a stored owner works
 * as it did. The tie write itself is stood in for: only the owner it is given
 * is under test.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { memberFormSwitch } from "$lib/server/state/memberForm"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

const tieWrites = vi.hoisted(() => [] as any[])

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

vi.mock("$lib/server/rulesets/ties", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/rulesets/ties")>()
	return {
		...actual,
		setTieSideShown: async (_db: unknown, input: any) => {
			tieWrites.push(input)
			return { shown: input.shown }
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-showtieside-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

const switchWas = memberFormSwitch.on
afterEach(() => {
	memberFormSwitch.on = switchWas
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const u = await createTestUser(testDb, `showtie-${++n}`)
	const [c] = await testDb
		.insert(schema.characters)
		.values({ userId: u.id, name: "Verity", description: "The card." })
		.returning()
	const [b] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: u.id, name: `Book ${n}` } as any)
		.returning()
	const [s] = await testDb
		.insert(schema.sessions)
		.values({
			userId: u.id,
			isGroup: false,
			name: `Run ${n}`,
			lorebookId: b!.id
		} as any)
		.returning()
	const bind = async (characterId: number | null) =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: b!.id,
					characterId,
					binding: `{{char:${++n}}}`,
					name: "member"
				} as any)
				.returning()
		)[0]!
	const castMember = await bind(c!.id)
	await testDb
		.insert(schema.sessionCharacters)
		.values({
			sessionId: s!.id,
			characterId: c!.id,
			castMemberId: castMember.id
		} as any)
	const seatMember = await bind(null)
	const [seat] = await testDb
		.insert(schema.sessionPersonas)
		.values({
			sessionId: s!.id,
			userId: u.id,
			personaId: null,
			seatName: "Wren",
			castMemberId: seatMember.id
		} as any)
		.returning()
	const stranger = await bind(null)
	return { u, c: c!, s: s!, castMember, seatMember, seat: seat!, stranger }
}

async function show(userId: number, sessionId: number, owner: unknown) {
	const { stateShowTieSide } = await import("./state")
	const errors: any[] = []
	tieWrites.length = 0
	const res: any = await stateShowTieSide.handler(
		fakeSocket(userId),
		{
			sessionId,
			owner,
			entryType: "bond",
			towards: "character:1",
			shown: true
		} as any,
		(event: string, data: any) => {
			if (event === "state:showTieSide:error") errors.push(data)
		}
	)
	return { res, errors, writes: [...tieWrites] }
}

describe("state:showTieSide — the door", () => {
	test("a seated member shows the tie side of its seat (character seat -> session_cast, switch off)", async () => {
		memberFormSwitch.on = false
		const w = await world()
		const { res, writes } = await show(w.u.id, w.s.id, {
			kind: "seated_member",
			id: w.castMember.id
		})
		expect(res.error).toBeUndefined()
		expect(res.shown).toBe(true)
		expect(writes).toHaveLength(1)
		expect(writes[0].owner).toEqual({ kind: "session_cast", id: w.c.id })
	})

	test("a seated member shows the tie side of its seat (character seat -> seated_member, switch on)", async () => {
		memberFormSwitch.on = true
		const w = await world()
		const { res, writes } = await show(w.u.id, w.s.id, {
			kind: "seated_member",
			id: w.castMember.id
		})
		expect(res.error).toBeUndefined()
		expect(res.shown).toBe(true)
		expect(writes).toHaveLength(1)
		expect(writes[0].owner).toEqual({
			kind: "seated_member",
			id: w.castMember.id
		})
	})

	test("a seated member of a card-less player seat -> player_seat", async () => {
		const w = await world()
		const { res, writes } = await show(w.u.id, w.s.id, {
			kind: "seated_member",
			id: w.seatMember.id
		})
		expect(res.error).toBeUndefined()
		expect(writes).toHaveLength(1)
		expect(writes[0].owner).toEqual({ kind: "player_seat", id: w.seat.id })
	})

	test("a member nobody is seated as is refused as not in the cast", async () => {
		const w = await world()
		const { res, errors, writes } = await show(w.u.id, w.s.id, {
			kind: "seated_member",
			id: w.stranger.id
		})
		expect(res.error).toMatch(/not in this session's cast/)
		expect(errors).toHaveLength(1)
		expect(writes).toHaveLength(0)
	})

	test("a session_cast owner works as before (switch off)", async () => {
		memberFormSwitch.on = false
		const w = await world()
		const { res, writes } = await show(w.u.id, w.s.id, {
			kind: "session_cast",
			id: w.c.id
		})
		expect(res.error).toBeUndefined()
		expect(writes[0].owner).toEqual({ kind: "session_cast", id: w.c.id })
	})

	test("a session_cast owner is translated to its seat's member form (switch on)", async () => {
		memberFormSwitch.on = true
		const w = await world()
		const { res, writes } = await show(w.u.id, w.s.id, {
			kind: "session_cast",
			id: w.c.id
		})
		expect(res.error).toBeUndefined()
		expect(writes[0].owner).toEqual({
			kind: "seated_member",
			id: w.castMember.id
		})
	})
})
