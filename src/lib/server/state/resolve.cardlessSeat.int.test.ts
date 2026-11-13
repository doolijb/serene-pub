/**
 * 🚧 ⏳ S4 (lane s4-seat-live, w4): a card-less character seat (a member, no card)
 * has links, a cast entry, configs and a `who.active` place in `sessionLinks`
 * / `stateFor` (`SeatedMemberLink`), with the flip on.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cardlessSeat-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

afterEach(() => {
	memberFormSwitch.on = false
})

const GRIT = "test:slot/cardless-seat-grit@1"
const GRIT_KEY = "cardless-seat-grit"
const grit = defineAttributeSlot(GRIT, {
	type: "integer",
	label: { en: "Grit" },
	descriptor: "How much is left in the tank.",
	appliesTo: ["cast"],
	config: { min: 0, max: 20 },
	default: 10
})

let n = 0
const db = () => testDb as unknown as Db

async function user(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb, `cardless-seat-${label}-${++n}`))!
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "…" } as any)
		.returning()
	return row!
}

async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` })
		.returning()
	return row!
}

async function member(
	lorebookId: number,
	characterId: number | null,
	extra: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	return (
		await insertCastMember(testDb, {
			lorebookId,
			binding: `{{char:${++n}}}`,
			characterId,
			name: "",
			...extra
		})
	).member!
}

async function session(userId: number, lorebookId: number) {
	const genreId = `test:genre/cardless-seat-${++n}`
	genreKeeping(genreId, {
		name: { en: "Member form" },
		family: "test",
		slots: [grit],
		events: {}
	})
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: true,
			name: `Run ${n}`,
			genreId,
			lorebookId
		})
		.returning()
	return row!
}

const seatCharacter = async (
	sessionId: number,
	characterId: number | null,
	castMemberId: number | null,
	position = 0
) =>
	(
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId, characterId, castMemberId, position })
			.returning()
	)[0]!

const rowsOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.sessionId, sessionId),
				eq(schema.attributeValues.slotId, GRIT)
			)
		)

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
async function set(
	userId: number,
	sessionId: number,
	owner: unknown,
	value: number
) {
	const { stateSet } = await import("$lib/server/sockets/state")
	const errors: string[] = []
	const emit = (event: string, data: any) => {
		if (event.endsWith(":error")) errors.push(data.error)
	}
	const outcome = await stateSet
		.handler(
			fakeSocket(userId),
			{ sessionId, owner, slotId: GRIT, value } as any,
			emit
		)
		.then(
			() => "written" as const,
			(e: Error) => e.message
		)
	return { outcome, errors }
}

/** A session with one carded seat (Verity) and one card-less seat (member Ash, own name, no card). */
async function world(label: string) {
	const u = await user(label)
	const attached = await book(u.id)
	const verity = await card(u.id, "Verity")
	const mVerity = await member(attached.id, verity.id, { name: "Verity" })
	const ash = await member(attached.id, null, {
		name: "Ash",
		ownName: "Ash"
	} as any)
	const s = await session(u.id, attached.id)
	const charSeat = await seatCharacter(s.id, verity.id, mVerity.id, 0)
	const ashSeat = await seatCharacter(s.id, null, ash.id, 1)
	return { u, attached, verity, mVerity, ash, s, charSeat, ashSeat }
}

describe("a card-less character seat's stats and sheet exist (switch on)", () => {
	test("stateFor gives the member its own entry; the carded seat's is unchanged", async () => {
		const w = await world("a")
		memberFormSwitch.on = true
		const { stateFor } = await import("./resolve")
		const state = await stateFor(db(), w.s.id)
		const entry = state.cast.byId[`seated_member:${w.ash.id}`]!
		expect(entry).toBeDefined()
		expect(entry.ref).toBe(`seated-member:${w.ash.id}`)
		expect(entry.castMemberId).toBe(w.ash.id)
		expect(entry.cardId).toBeNull()
		expect(entry.name).toBe("Ash")
		expect(entry[GRIT_KEY]).toBe(10)
		const carded = state.cast.byId[`seated_member:${w.mVerity.id}`]!
		expect(carded.id).toBe(w.verity.id)
		expect(carded.cardId).toBe(w.verity.id)
		expect(carded.ref).toBe(`seated-member:${w.mVerity.id}`)
		expect(carded[GRIT_KEY]).toBe(10)
		expect(state.cast[entry.key]).toBe(entry)
	})

	test("a write on the seated_member owner lands and reads back on that entry only", async () => {
		const w = await world("b")
		memberFormSwitch.on = true
		expect(
			await set(
				w.u.id,
				w.s.id,
				{ kind: "seated_member", id: w.ash.id },
				3
			)
		).toEqual({ outcome: "written", errors: [] })
		expect(
			(await rowsOf(w.s.id)).map((r) => [r.ownerKind, r.ownerId])
		).toEqual([["seated_member", w.ash.id]])
		const { stateFor } = await import("./resolve")
		const state = await stateFor(db(), w.s.id)
		expect(state.cast.byId[`seated_member:${w.ash.id}`]![GRIT_KEY]).toBe(3)
		expect(
			state.cast.byId[`seated_member:${w.mVerity.id}`]![GRIT_KEY]
		).toBe(10)
	})

	test("the member's configs (its sheet) exist", async () => {
		const w = await world("c")
		memberFormSwitch.on = true
		const { stateFor } = await import("./resolve")
		const state = await stateFor(db(), w.s.id)
		const configs = state.configs![`seated_member:${w.ash.id}`]
		expect(configs).toBeDefined()
		expect(configs![GRIT]).toBeDefined()
		expect(
			Object.keys(state.configs![`seated_member:${w.mVerity.id}`] ?? {})
		).toEqual(Object.keys(configs!))
	})

	test("who.active lists the member by position while its seat is active; a departed seat has none", async () => {
		const w = await world("d")
		memberFormSwitch.on = true
		const { stateFor } = await import("./resolve")
		const before = await stateFor(db(), w.s.id)
		expect(before.who.active.map((e) => e.ref)).toEqual([
			`seated-member:${w.mVerity.id}`,
			`seated-member:${w.ash.id}`
		])
		await testDb
			.update(schema.sessionCharacters)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionCharacters.id, w.ashSeat.id))
		const after = await stateFor(db(), w.s.id)
		expect(after.cast.byId[`seated_member:${w.ash.id}`]).toBeUndefined()
		expect(after.who.active.map((e) => e.ref)).toEqual([
			`seated-member:${w.mVerity.id}`
		])
	})

	test("no entry or chain treats the member id as a card id", async () => {
		const w = await world("e")
		// A card whose id is the member's, when the id ranges let one exist.
		let twin: Awaited<ReturnType<typeof card>> | null = null
		for (let i = 0; i < 400 && !twin; i++) {
			const c = await card(w.u.id, `Twin ${i}`)
			if (c.id === w.ash.id) twin = c
			if (c.id > w.ash.id) break
		}
		memberFormSwitch.on = true
		expect(
			await set(
				w.u.id,
				w.s.id,
				{ kind: "seated_member", id: w.ash.id },
				4
			)
		).toEqual({ outcome: "written", errors: [] })
		const { stateFor, valueOf } = await import("./resolve")
		const state = await stateFor(db(), w.s.id)
		const entry = state.cast.byId[`seated_member:${w.ash.id}`]!
		expect(entry.id).toBe(0)
		expect(entry.cardId).toBeNull()
		expect(state.cast.byId[String(w.ash.id)]).toBeUndefined()
		if (twin) {
			const read = await valueOf(db(), {
				sessionId: w.s.id,
				owner: { kind: "session_cast", id: twin.id },
				slotId: GRIT
			})
			// the default, not M's 4: M's write is not that card's
			expect(read).toBe(10)
		}
		expect(
			Object.values(state.cast.byId).filter((e) => e.id === w.ash.id)
		).toEqual([])
	})
})
