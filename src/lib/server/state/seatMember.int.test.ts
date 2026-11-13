/**
 * 🚧 The state module reads a seated character through the seat's cast member
 * (plan §27 S2): the names of `sessionLinks`, the sealed-reply refusal and the
 * hand-edit sentences come from the member as read over the card the seat
 * holds; a `seated_member` owner at the socket door is the seat's stored owner,
 * and no row is ever written under it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	defineAttributeSlot,
	defineRuleset,
	rulesetAttributeSlotId
} from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import { memberFormSwitch } from "$lib/server/state/memberForm"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertDatedCardVersion } from "$lib/server/pipelines/testing/fixtures"

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

const switchWas = memberFormSwitch.on
afterEach(() => {
	memberFormSwitch.on = switchWas
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-seatMember-")
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

const GRIT = "test:slot/seat-member-grit@1"
const grit = defineAttributeSlot(GRIT, {
	type: "integer",
	label: { en: "Grit" },
	descriptor: "How much is left in the tank.",
	appliesTo: ["cast"],
	config: { min: 0, max: 20 },
	default: 10
})

const R = "test:ruleset/seat-member@1"
defineRuleset(R, {
	name: { en: "Seat member" },
	attributes: [
		{ id: "free", name: { en: "Free" }, kind: "number", prose: "Anyone's." }
	]
})
const FREE = rulesetAttributeSlotId(R, "free")

let n = 0
const db = () => testDb as unknown as Db

async function user(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb, `seat-member-${label}-${++n}`))!
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
	const row = (
		await insertCastMember(testDb, {
			lorebookId,
			binding: `{{char:${++n}}}`,
			characterId,
			name: "",
			...extra
		})
	).member
	return row!
}

/** A group session over an attached book, tracking `GRIT`. */
async function session(userId: number, lorebookId: number) {
	const genreId = `test:genre/seat-member-${++n}`
	genreKeeping(genreId, {
		name: { en: "Seat member" },
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
	characterId: number,
	castMemberId: number | null,
	position = 0
) =>
	(
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId, characterId, castMemberId, position })
			.returning()
	)[0]!

describe("sessionLinks names a seat from its cast member", () => {
	test("a member with its own name: the name, the seat's member, the attached book's member and the state key", async () => {
		const u = await user("a")
		const attached = await book(u.id)
		const own = await book(u.id)
		const verity = await card(u.id, "Verity")
		const inAttached = await member(attached.id, verity.id, {
			name: "Verity"
		})
		const inOwn = await member(own.id, verity.id, {
			name: "Verity",
			ownName: "Vee"
		})
		const s = await session(u.id, attached.id)
		await seatCharacter(s.id, verity.id, inOwn.id)

		const { sessionLinks, stateFor } = await import("./resolve")
		const links = await sessionLinks(db(), s.id)
		expect(links.cast).toHaveLength(1)
		expect(links.cast[0]).toMatchObject({
			characterId: verity.id,
			name: "Vee",
			seatMemberId: inOwn.id,
			// ⚠ still the attached book's member, which routes durable values
			castMemberId: inAttached.id
		})
		const state = await stateFor(db(), s.id)
		// Found by the host-filled card id, whichever form the key is in.
		const entry = (Object.values(state.cast.byId) as any[]).find(
			(e) => e.id === verity.id
		)
		expect(entry?.name).toBe("Vee")
	})

	test("a seat with no member reads the card's name, as before", async () => {
		const u = await user("b")
		const attached = await book(u.id)
		const wren = await card(u.id, "Wren")
		const s = await session(u.id, attached.id)
		await seatCharacter(s.id, wren.id, null)

		const { sessionLinks } = await import("./resolve")
		const links = await sessionLinks(db(), s.id)
		expect(links.cast[0]).toMatchObject({
			characterId: wren.id,
			name: "Wren",
			seatMemberId: null
		})
	})

	test("a carded player seat: the seat name still wins, else the member, else the card", async () => {
		const u = await user("b2")
		const attached = await book(u.id)
		const one = await card(u.id, "Ione")
		const two = await card(u.id, "Twyla")
		const m1 = await member(attached.id, one.id, {
			name: "Ione",
			ownName: "Io"
		})
		const m2 = await member(attached.id, two.id, {
			name: "Twyla",
			ownName: "Ty"
		})
		const s = await session(u.id, attached.id)
		await testDb.insert(schema.sessionPersonas).values([
			{
				sessionId: s.id,
				personaId: one.id,
				userId: u.id,
				castMemberId: m1.id,
				position: 0
			},
			{
				sessionId: s.id,
				personaId: two.id,
				userId: u.id,
				castMemberId: m2.id,
				seatName: "Seat Ty",
				position: 1
			}
		] as any)

		const { sessionLinks } = await import("./resolve")
		const links = await sessionLinks(db(), s.id)
		const byCard = new Map(links.cast.map((c) => [c.characterId, c]))
		expect(byCard.get(one.id)).toMatchObject({
			name: "Io",
			seatMemberId: m1.id,
			isPersona: true
		})
		expect(byCard.get(two.id)).toMatchObject({
			name: "Seat Ty",
			seatMemberId: m2.id
		})
	})

	// Owner ruling 2026-11-05: "Everything in session is cast -> active card."
	// Two seats on one member read the same thing: the member over its active card.
	test("two live seats on one member with different cards: two entries, each named as the member is read (switch off)", async () => {
		memberFormSwitch.on = false
		const u = await user("c")
		const attached = await book(u.id)
		const a = await card(u.id, "Alder")
		const b = await card(u.id, "Birch")
		const shared = await member(attached.id, a.id, { name: "Alder" })
		const s = await session(u.id, attached.id)
		await seatCharacter(s.id, a.id, shared.id, 0)
		await seatCharacter(s.id, b.id, shared.id, 1)

		const { sessionLinks } = await import("./resolve")
		const links = await sessionLinks(db(), s.id)
		expect(
			links.cast.map((c) => [c.characterId, c.name, c.seatMemberId])
		).toEqual([
			[a.id, "Alder", shared.id],
			[b.id, "Alder", shared.id]
		])
	})
})

describe("two seats on one member, switch on", () => {
	test("share one key and collapse to one link: the lowest position", async () => {
		memberFormSwitch.on = true
		const u = await user("c-on")
		const attached = await book(u.id)
		const a = await card(u.id, "Alder")
		const b = await card(u.id, "Birch")
		const shared = await member(attached.id, a.id, { name: "Alder" })
		const s = await session(u.id, attached.id)
		await seatCharacter(s.id, a.id, shared.id, 0)
		await seatCharacter(s.id, b.id, shared.id, 1)

		const { sessionLinks } = await import("./resolve")
		const links = await sessionLinks(db(), s.id)
		expect(
			links.cast.map((c) => [c.characterId, c.name, c.seatMemberId])
		).toEqual([[a.id, "Alder", shared.id]])
	})
})

describe("the sealed-reply refusal names the seat's member", () => {
	test("by its own name", async () => {
		const u = await user("d")
		const attached = await book(u.id)
		const verity = await card(u.id, "Verity")
		const m = await member(attached.id, verity.id, {
			name: "Verity",
			ownName: "Vee"
		})
		const s = await session(u.id, attached.id)
		await seatCharacter(s.id, verity.id, m.id)
		const say = async () => {
			const [legacy] = await testDb
				.insert(schema.sessionMessages)
				.values({
					sessionId: s.id,
					role: "assistant",
					characterId: verity.id,
					content: "…",
					isNarratorResponse: false
				} as any)
				.returning()
			await testDb.insert(schema.messages).values({
				id: legacy!.id,
				sessionId: s.id,
				characterId: verity.id,
				role: "assistant"
			} as any)
			return legacy!
		}
		const older = await say()
		await say()

		const { setValue, StateRefusal } = await import("./write")
		const write = setValue(
			db(),
			{ sessionId: s.id, updatedBy: "user", messageId: older.id },
			{
				owner: { kind: "session_cast", id: verity.id },
				slotId: GRIT,
				value: 1
			}
		)
		await expect(write).rejects.toBeInstanceOf(StateRefusal)
		await expect(write).rejects.toThrow("sealed: Vee has spoken since")
	})
})

describe("a seated_member owner at the state:set door", () => {
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

	test("writes the same row as the session_cast owner, and none under seated_member (switch off)", async () => {
		memberFormSwitch.on = false
		const u = await user("e")
		const attached = await book(u.id)
		const verity = await card(u.id, "Verity")
		const m = await member(attached.id, verity.id, { name: "Verity" })
		const elsewhere = await member(attached.id, null, {
			name: "Nobody seated"
		})
		const s = await session(u.id, attached.id)
		await seatCharacter(s.id, verity.id, m.id)

		const viaMember = await set(
			u.id,
			s.id,
			{ kind: "seated_member", id: m.id },
			7
		)
		expect(viaMember).toEqual({ outcome: "written", errors: [] })
		const rowsOf = async () =>
			await testDb
				.select()
				.from(schema.attributeValues)
				.where(
					and(
						eq(schema.attributeValues.sessionId, s.id),
						eq(schema.attributeValues.slotId, GRIT)
					)
				)
		const first = await rowsOf()
		expect(first.map((r) => [r.ownerKind, r.ownerId])).toEqual([
			["session_cast", verity.id]
		])
		expect(first[0]!.value).toMatchObject({ v: 7 })

		const viaCard = await set(
			u.id,
			s.id,
			{ kind: "session_cast", id: verity.id },
			8
		)
		expect(viaCard).toEqual({ outcome: "written", errors: [] })
		const second = await rowsOf()
		// Values keep their history: the second write is a row beside the first, under the same owner.
		expect(second.map((r) => [r.ownerKind, r.ownerId])).toEqual([
			["session_cast", verity.id],
			["session_cast", verity.id]
		])
		expect(
			second.some((r) => (r.ownerKind as string) === "seated_member")
		).toBe(false)

		// A member nobody seats here is refused in words; nothing is written.
		const stray = await set(
			u.id,
			s.id,
			{ kind: "seated_member", id: elsewhere.id },
			3
		)
		expect(stray.outcome).toBe(
			"that character is not in this session's cast."
		)
		expect(await rowsOf()).toHaveLength(2)
	})
})

describe("a seated_member owner at the state:set door, switch on", () => {
	test("writes under seated_member whether given the member or the seat's card", async () => {
		memberFormSwitch.on = true
		const u = await user("e-on")
		const attached = await book(u.id)
		const verity = await card(u.id, "Verity")
		const m = await member(attached.id, verity.id, { name: "Verity" })
		const elsewhere = await member(attached.id, null, {
			name: "Nobody seated"
		})
		const s = await session(u.id, attached.id)
		await seatCharacter(s.id, verity.id, m.id)
		const { stateSet } = await import("$lib/server/sockets/state")
		const errors: string[] = []
		const emit = (event: string, data: any) => {
			if (event.endsWith(":error")) errors.push(data.error)
		}
		const sock = {
			user: { id: u.id },
			io: { to: () => ({ emit: () => {} }) }
		} as any
		const write = (owner: unknown, value: number) =>
			stateSet.handler(
				sock,
				{ sessionId: s.id, owner, slotId: GRIT, value } as any,
				emit
			)
		const rowsOf = async () =>
			await testDb
				.select()
				.from(schema.attributeValues)
				.where(
					and(
						eq(schema.attributeValues.sessionId, s.id),
						eq(schema.attributeValues.slotId, GRIT)
					)
				)

		await write({ kind: "seated_member", id: m.id }, 7)
		const first = await rowsOf()
		expect(first.map((r) => [r.ownerKind, r.ownerId])).toEqual([
			["seated_member", m.id]
		])
		expect(first[0]!.value).toMatchObject({ v: 7 })

		// The card form is translated at the door to the same stored owner.
		await write({ kind: "session_cast", id: verity.id }, 8)
		expect(
			(await rowsOf()).map((r) => [r.ownerKind, r.ownerId])
		).toEqual([
			["seated_member", m.id],
			["seated_member", m.id]
		])
		expect(errors).toEqual([])

		// A member nobody seats here is refused; nothing is written.
		await expect(
			write({ kind: "seated_member", id: elsewhere.id }, 3)
		).rejects.toThrow("that character is not in this session's cast.")
		expect(await rowsOf()).toHaveLength(2)
	})
})

describe("hand edits name a player seat from its member", () => {
	test("the not-theirs sentence uses the member's own name", async () => {
		const owner = await user("f-owner")
		const cara = await user("f-cara")
		const dan = await user("f-dan")
		const attached = await book(owner.id)
		const caraCard = await card(cara.id, "Cara")
		const danCard = await card(dan.id, "Daniel")
		const danMember = await member(attached.id, danCard.id, {
			name: "Daniel",
			ownName: "Dani"
		})
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner.id,
				isGroup: true,
				name: `Hands ${++n}`,
				genreId: "core:genre/dungeon-crawler",
				primaryRuleset: R,
				genreFields: { playerSheetLatitude: "as-ruled" },
				lorebookId: attached.id
			} as any)
			.returning()
		await testDb.insert(schema.sessionGuests).values([
			{ sessionId: s!.id, userId: cara.id, isPlayer: true },
			{ sessionId: s!.id, userId: dan.id, isPlayer: true }
		] as any)
		await testDb.insert(schema.sessionPersonas).values([
			{ sessionId: s!.id, personaId: caraCard.id, userId: cara.id },
			{
				sessionId: s!.id,
				personaId: danCard.id,
				userId: dan.id,
				castMemberId: danMember.id
			}
		] as any)

		const { handEditRefusal } = await import("./handEdits")
		const ask = (userId: number, ownerCard: number) =>
			handEditRefusal(db(), {
				sessionId: s!.id,
				userId,
				owner: { kind: "session_cast", id: ownerCard },
				slotId: FREE,
				act: "set"
			})
		expect(await ask(dan.id, danCard.id)).toBeNull()
		expect((await ask(cara.id, danCard.id))?.sentence).toBe(
			"only Dani's player or the session's owner can change their sheet."
		)
	})
})

// Owner ruling 2026-11-05: "Everything in session is cast -> active card."
// A seat's member is read over the card the story clock draws it with, not the
// card the seat holds; "own" is the owner of that active card.
describe("a seat reads its member's active card, the card the story clock draws", () => {
	/** A member linked to card A, drawn by card B from year 20; a session at year 30 seats A. */
	async function dated(label: string) {
		const owner = await user(`${label}-owner`)
		const aOwner = await user(`${label}-a`)
		const bOwner = await user(`${label}-b`)
		const attached = await book(owner.id)
		const cardA = await card(aOwner.id, `Aurelia ${++n}`)
		const cardB = await card(bOwner.id, `Beatrix ${++n}`)
		const m = await member(attached.id, cardA.id, { name: cardA.name })
		await insertDatedCardVersion(testDb, m.id, cardB.id, 20)
		return { owner, aOwner, bOwner, attached, cardA, cardB, member: m }
	}

	test("sessionLinks names the seat by active card B, with the member as its seat member", async () => {
		const w = await dated("links")
		const s = await session(w.owner.id, w.attached.id)
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 30 })
			.where(eq(schema.sessions.id, s.id))
		await seatCharacter(s.id, w.cardA.id, w.member.id)

		const { sessionLinks } = await import("./resolve")
		const links = await sessionLinks(db(), s.id)
		expect(links.cast).toHaveLength(1)
		expect(links.cast[0]).toMatchObject({
			characterId: w.cardA.id,
			name: w.cardB.name,
			seatMemberId: w.member.id
		})
		// The row keeps the seat's card id; the clock draws card B for this member.
		const { memberAsRead } = await import("$lib/server/cast/memberAsRead")
		expect(
			(await memberAsRead(db(), w.member.id, { sessionId: s.id }))
				?.activeCardId
		).toBe(w.cardB.id)
	})

	test("a hand edit's owner of the seat is active card B's owner, not card A's", async () => {
		const w = await dated("hands")
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.owner.id,
				isGroup: true,
				name: `Dated hands ${++n}`,
				genreId: "core:genre/dungeon-crawler",
				primaryRuleset: R,
				genreFields: { playerSheetLatitude: "as-ruled" },
				lorebookId: w.attached.id,
				storyClockYear: 30
			} as any)
			.returning()
		await testDb.insert(schema.sessionGuests).values([
			{ sessionId: s!.id, userId: w.aOwner.id, isPlayer: true },
			{ sessionId: s!.id, userId: w.bOwner.id, isPlayer: true }
		] as any)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s!.id,
			personaId: w.cardA.id,
			castMemberId: w.member.id
		} as any)

		const { handEditRefusal } = await import("./handEdits")
		const ask = (userId: number) =>
			handEditRefusal(db(), {
				sessionId: s!.id,
				userId,
				owner: { kind: "session_cast", id: w.cardA.id },
				slotId: FREE,
				act: "set"
			})
		expect(await ask(w.bOwner.id)).toBeNull()
		expect((await ask(w.aOwner.id))?.sentence).toBe(
			`only ${w.cardB.name}'s player or the session's owner can change their sheet.`
		)
	})
})
