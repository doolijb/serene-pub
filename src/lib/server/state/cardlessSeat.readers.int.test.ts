/**
 * 🚧 ⏳ S4 (lane s4-fixes, w1): a card-less character seat appears wherever a carded
 * character seat does in the hearing, the `state:*` sockets and the hand-edit judge.
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
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, defineRuleset } from "@serene-pub/sdk"
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
		path.join(os.tmpdir(), "serene-pub-vitest-cardlessReaders-")
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

const SECRET = "test:slot/cardless-readers-secret@1"
defineAttributeSlot(SECRET, {
	type: "integer",
	label: { en: "Secret" },
	descriptor: "Heard by its holder alone.",
	appliesTo: ["cast"],
	earshot: "holder",
	config: { min: 0, max: 20 },
	default: 10
})

const HEARD = "test:slot/cardless-readers-heard@1"
defineAttributeSlot(HEARD, {
	type: "integer",
	label: { en: "Heard" },
	descriptor: "Heard by everyone.",
	appliesTo: ["cast"],
	config: { min: 0, max: 20 },
	default: 10
})

let n = 0
const db = () => testDb as unknown as Db

async function user(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb, `cardless-readers-${label}-${++n}`))!
}

const fakeSocket = (userId: number) =>
	({
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } }
	}) as any

async function call(handler: any, userId: number, params: unknown) {
	const emitted: Array<{ event: string; data: any }> = []
	const res = await handler
		.handler(fakeSocket(userId), params, (event: string, data: any) =>
			emitted.push({ event, data })
		)
		.then(
			(r: any) => r,
			(e: Error) => ({ thrown: e.message })
		)
	return {
		res,
		errors: emitted
			.filter((e) => e.event.endsWith(":error"))
			.map((e) => e.data.error as string)
	}
}

/** One carded seat (Verity), one card-less seat (Ash) seated by a guest, and another guest. */
async function world() {
	const owner = await user("owner")
	const seater = await user("seater")
	const other = await user("other")
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${++n}` })
		.returning()
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Verity", description: "…" } as any)
		.returning()
	const mVerity = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:v${++n}}}`,
			characterId: verity!.id,
			name: "Verity"
		})
	).member!
	const ash = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:a${++n}}}`,
			characterId: null,
			name: "Ash",
			ownName: "Ash"
		} as any)
	).member!
	const genreId = `test:genre/cardless-readers-${++n}`
	genreKeeping(genreId, {
		name: { en: "Readers" },
		family: "test",
		slots: [
			(await import("@serene-pub/sdk")).getAttributeSlot(SECRET)!,
			(await import("@serene-pub/sdk")).getAttributeSlot(HEARD)!
		],
		events: {}
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Run ${n}`,
			genreId,
			genreFields: { playerSheetLatitude: "all-own" },
			lorebookId: book!.id
		} as any)
		.returning()
	const sessionId = session!.id
	await testDb.insert(schema.sessionGuests).values([
		{ sessionId, userId: seater.id, isPlayer: true },
		{ sessionId, userId: other.id, isPlayer: true }
	] as any)
	await testDb.insert(schema.sessionCharacters).values([
		{
			sessionId,
			characterId: verity!.id,
			castMemberId: mVerity.id,
			position: 0,
			seatedByUserId: owner.id
		},
		{
			sessionId,
			characterId: null,
			castMemberId: ash.id,
			position: 1,
			seatedByUserId: seater.id
		}
	] as any)
	return { owner, seater, other, ash, sessionId }
}

describe("a card-less character seat in the readers (switch on)", () => {
	test("hearingOf asks for it by its seat ref and hears it under seated_member:<id>", async () => {
		const w = await world()
		memberFormSwitch.on = true
		const { sessionLinks } = await import("./resolve")
		const { hearingOf } = await import("./earshot")
		const links = await sessionLinks(db(), w.sessionId)
		expect(links.seatedMembers?.map((s) => s.seatMemberId)).toEqual([
			w.ash.id
		])
		const hear = (userId: number) =>
			hearingOf(
				db(),
				w.sessionId,
				userId,
				links.cast,
				links.playerSeats,
				links.seatedMembers ?? []
			)
		// ⚠ The seater is NOT asserted: `resolvePortrayals` answers a live character seat's
		// `seated-member:` ref as the AI, never its seater (reported, not this lane's file).
		const other = await hear(w.other.id)
		expect([...(other as any).characterIds]).not.toContain(
			`seated_member:${w.ash.id}`
		)
		expect((await hear(w.owner.id)).all).toBe(true)
	})

	test("state:get lists an owner row for it, and a value written reads back", async () => {
		const w = await world()
		memberFormSwitch.on = true
		const { stateGet, stateSet } = await import("$lib/server/sockets/state")
		const owner = { kind: "seated_member", id: w.ash.id }
		const written = await call(stateSet, w.owner.id, {
			sessionId: w.sessionId,
			owner,
			slotId: SECRET,
			value: 4
		})
		expect(written.errors).toEqual([])
		const asOwner = (
			await call(stateGet, w.owner.id, { sessionId: w.sessionId })
		).res
		const row = asOwner.owners.find(
			(o: any) => o.kind === "seated_member" && o.id === w.ash.id
		)
		expect(row).toBeDefined()
		expect(row.label).toBe("Ash")
		expect(row.ref).toBe(`seated-member:${w.ash.id}`)
		expect(row.castMemberId).toBe(w.ash.id)
		expect(row.seat).toBeUndefined()
		expect(Object.keys(row.configs)).toContain(SECRET)
		const { stateFor } = await import("./resolve")
		expect(
			(await stateFor(db(), w.sessionId)).cast.byId[
				`seated_member:${w.ash.id}`
			]!["cardless-readers-secret"]
		).toBe(4)
		// `mine` follows `ownSeatsOf` (player seats' members) — a character seat's seater is not it (reported).
	})

	test("the hand-edit judge lets the owner set a holder-only value and refuses another guest by name", async () => {
		const w = await world()
		memberFormSwitch.on = true
		const { handEditRefusal } = await import("./handEdits")
		const owner = { kind: "seated_member", id: w.ash.id } as const
		const q = (userId: number) => ({
			sessionId: w.sessionId,
			userId,
			owner,
			slotId: SECRET,
			act: "set" as const
		})
		expect(await handEditRefusal(db(), q(w.owner.id))).toBeNull()
		const refused = await handEditRefusal(db(), q(w.other.id))
		expect(refused).not.toBeNull()
		expect(refused!.sentence).toContain("Ash")
	})

	test("the hand-edit judge lets the seater set an everyone-hears value on its own seat", async () => {
		const w = await world()
		memberFormSwitch.on = true
		const { handEditRefusal } = await import("./handEdits")
		const owner = { kind: "seated_member", id: w.ash.id } as const
		const q = (userId: number) => ({
			sessionId: w.sessionId,
			userId,
			owner,
			slotId: HEARD,
			act: "set" as const
		})
		expect(await handEditRefusal(db(), q(w.seater.id))).toBeNull()
		expect(await handEditRefusal(db(), q(w.other.id))).not.toBeNull()
	})

	test("state:attributes lists it as a holder", async () => {
		const w = await world()
		memberFormSwitch.on = true
		const RULES = `test:ruleset/cardless-readers-${n}@1`
		defineRuleset(RULES, {
			name: { en: "Carry" },
			attributes: [
				{
					id: "nerve",
					name: { en: "Nerve" },
					kind: "pool",
					bounds: { max: 5 },
					carriedBy: ["cast"],
					prose: "Nerve: courage held in reserve."
				}
			]
		})
		await testDb
			.update(schema.sessions)
			.set({ primaryRuleset: RULES })
			.where(eq(schema.sessions.id, w.sessionId))
		const { stateAttributes } = await import("$lib/server/sockets/state")
		const { res } = await call(stateAttributes, w.owner.id, {
			sessionId: w.sessionId
		})
		const holders = (res.carries ?? []).flatMap((r: any) => r.holders ?? [])
		expect(
			holders.some(
				(h: any) =>
					h.owner.kind === "seated_member" &&
					h.owner.id === w.ash.id &&
					h.name === "Ash"
			)
		).toBe(true)
	})
})
