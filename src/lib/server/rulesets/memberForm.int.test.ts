/**
 * 🚧 ⏳ S4 wave 2 (plan §34.1): the rulesets, sessions and state files that
 * can take **member form** behind `memberFormSwitch` (off in core until wave
 * 3 flips it). Claims, switch on: `ownerRefOf` reads `seated-member:<id>`; a
 * carded player seat keeps its `player_seat` rows when it takes its card; a
 * branch copies `seated_member` rows under the same owner id; Forward's
 * tally comes back in member form. Switch off: each of those is as before.
 *
 * Every test that turns the switch on turns it back off in `finally`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertLegacyMany } from "$lib/server/messages/store"
import { memberFormSwitch } from "$lib/server/state/memberForm"
import { seatMapOf } from "$lib/server/state/seatRefs"
import { seatCast, seatPlayer } from "$lib/server/sessions/seats"
import { ownerRefOf } from "./read"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async () => {}),
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-rulesMemberForm-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
}, 180_000)

afterAll(async () => {
	memberFormSwitch.on = false
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`
const asDb = (tx: unknown) => tx as Db
const inTx = <T>(fn: (tx: Db) => Promise<T>) =>
	testDb.transaction(async (tx) => fn(asDb(tx)))

/** Runs `fn` with the switch on, and always puts it back off. */
async function withSwitchOn<T>(fn: () => Promise<T>): Promise<T> {
	memberFormSwitch.on = true
	try {
		return await fn()
	} finally {
		memberFormSwitch.on = false
	}
}

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb, uniq("rules-member-form")))!
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	return row!
}

async function sessionOnBook(userId: number) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: uniq("Book") })
		.returning()
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: uniq("Run"),
			lorebookId: book!.id
		})
		.returning()
	return row!
}

const SLOT = "test:slot/member-form-grit@1"

const putValue = (
	sessionId: number,
	ownerKind: string,
	ownerId: number,
	v: unknown,
	messageId: number | null = null
) =>
	testDb.insert(schema.attributeValues).values({
		ownerKind,
		ownerId,
		slotId: SLOT,
		value: { v },
		sessionId,
		validFromMessageId: messageId,
		updatedBy: "user"
	})

const valuesOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.attributeValues)
		.where(eq(schema.attributeValues.sessionId, sessionId))
		.orderBy(asc(schema.attributeValues.id))

describe("ownerRefOf reads a seat's member form only while the switch is on", () => {
	it("off: refuses seated-member refs and seated_member owners, reads the rest", () => {
		// Pinned off, whatever the file's config says: this asserts card form.
		memberFormSwitch.on = false
		expect(ownerRefOf("seated-member:7", 1)).toBeNull()
		expect(ownerRefOf({ kind: "seated_member", id: 7 }, 1)).toBeNull()
		expect(ownerRefOf("character:3", 1)).toMatchObject({
			key: "character:3",
			owner: { kind: "session_cast", id: 3 }
		})
		expect(ownerRefOf("player-seat:2", 1)).toMatchObject({
			key: "player-seat:2",
			owner: { kind: "player_seat", id: 2 }
		})
	})

	it("on: reads both shapes of a seat's member as a cast owner; the rest unchanged", async () => {
		await withSwitchOn(async () => {
			const want = {
				key: "seated-member:7",
				owner: { kind: "seated_member", id: 7 },
				facet: "cast"
			}
			expect(ownerRefOf("seated-member:7", 1)).toEqual(want)
			expect(ownerRefOf({ kind: "seated_member", id: 7 }, 1)).toEqual(
				want
			)
			expect(ownerRefOf("character:3", 1)).toMatchObject({
				key: "character:3",
				owner: { kind: "session_cast", id: 3 }
			})
			expect(ownerRefOf("seated-member:0", 1)).toBeNull()
		})
		expect(memberFormSwitch.on).toBe(false)
	})
})

describe("givePlayerSeatACard", () => {
	async function cardlessSeatWithStat() {
		const u = await user()
		const s = await sessionOnBook(u.id)
		const seat = await inTx((tx) =>
			seatPlayer(tx, {
				sessionId: s.id,
				personaId: null,
				position: 0,
				userId: u.id,
				seatName: "Nobody"
			})
		)
		await putValue(s.id, "player_seat", seat.seatId, 4)
		const wren = await card(u.id, "Wren")
		return { s, seat, wren }
	}

	it("off: the seat's stat rows move to the card's session_cast", async () => {
		// Pinned off, whatever the file's config says: this asserts card form.
		memberFormSwitch.on = false
		const { s, seat, wren } = await cardlessSeatWithStat()
		const { givePlayerSeatACard } = await import(
			"$lib/server/sessions/seatName"
		)
		expect(await givePlayerSeatACard(asDb(testDb), s.id, wren.id)).toBe(
			true
		)
		const rows = await valuesOf(s.id)
		expect(rows.map((r) => [r.ownerKind, r.ownerId])).toEqual([
			["session_cast", wren.id]
		])
		const [persona] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, seat.seatId))
		expect(persona!.personaId).toBe(wren.id)
	})

	it("on: the card is filled, the rows stay under player_seat", async () => {
		const { s, seat, wren } = await cardlessSeatWithStat()
		const { givePlayerSeatACard } = await import(
			"$lib/server/sessions/seatName"
		)
		await withSwitchOn(async () => {
			expect(await givePlayerSeatACard(asDb(testDb), s.id, wren.id)).toBe(
				true
			)
		})
		const rows = await valuesOf(s.id)
		expect(rows.map((r) => [r.ownerKind, r.ownerId])).toEqual([
			["player_seat", seat.seatId]
		])
		const [persona] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, seat.seatId))
		expect(persona!.personaId).toBe(wren.id)
	})
})

describe("branching with the switch on", () => {
	it("copies a seated_member row under the same owner id, and remaps a player_seat's", async () => {
		const u = await user()
		const maren = await card(u.id, "Maren")
		const wren = await card(u.id, "Wren")
		const s = await sessionOnBook(u.id)
		await inTx(async (tx) => {
			await seatCast(tx, {
				sessionId: s.id,
				cardId: maren.id,
				position: 0
			})
			await seatPlayer(tx, {
				sessionId: s.id,
				personaId: wren.id,
				position: 0,
				userId: u.id
			})
		})
		const [charSeat] = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, s.id))
		const [playerSeat] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, s.id))
		const memberId = charSeat!.castMemberId!
		expect(memberId).toBeGreaterThan(0)
		const [fork] = (
			await insertLegacyMany(testDb, [
				{
					sessionId: s.id,
					userId: u.id,
					characterId: maren.id,
					personaId: null,
					role: "assistant",
					content: "Maren speaks."
				}
			])
		).slice(-1)
		await putValue(s.id, "seated_member", memberId, 7, fork!.id)
		await putValue(s.id, "player_seat", playerSeat!.id, 3, fork!.id)

		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await withSwitchOn(() =>
			branchSession(asDb(testDb), {
				sessionId: s.id,
				fromMessageId: fork!.id
			})
		)
		const [branchPlayer] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, branch.id))
		const copied = await valuesOf(branch.id)
		const seated = copied.find((r) => r.ownerKind === "seated_member")
		expect(seated?.ownerId).toBe(memberId)
		expect(seated?.value).toEqual({ v: 7 })
		const player = copied.find((r) => r.ownerKind === "player_seat")
		expect(player?.ownerId).toBe(branchPlayer!.id)
		expect(player?.ownerId).not.toBe(playerSeat!.id)
		expect(
			await testDb
				.select()
				.from(schema.attributeValues)
				.where(
					and(
						eq(schema.attributeValues.sessionId, s.id),
						eq(schema.attributeValues.ownerKind, "seated_member")
					)
				)
		).toHaveLength(1)
	})
})

describe("Forward's tally in member form", () => {
	const tally = {
		v: 1 as const,
		lanes: {
			story: {
				turn: 4,
				lastMessageId: 9,
				lastSpeaker: "character:11",
				turnsBy: { "character:11": 2, "character:12": 1, narrator: 1 },
				spoke: ["character:11", "narrator", "character:99"],
				persons: ["character:11", "character:12", "player-seat:3"]
			}
		}
	}
	// Card 11: a character seat (member 51). Card 12: a carded player seat 4.
	const map = seatMapOf(1, [
		{
			kind: "character",
			seatId: 1,
			castMemberId: 51,
			cardId: 11,
			departed: false,
			position: 0
		},
		{
			kind: "player",
			seatId: 4,
			castMemberId: 52,
			cardId: 12,
			departed: false,
			position: 0
		}
	])

	it("maps card refs to the seat's member form; narrator, other refs and unknown cards stay", async () => {
		const { tallyInMemberForm } = await import(
			"$lib/server/sessions/rewind"
		)
		const out = tallyInMemberForm(tally as never, map)
		expect(out.lanes.story).toMatchObject({
			turn: 4,
			lastMessageId: 9,
			lastSpeaker: "seated-member:51",
			turnsBy: { "seated-member:51": 2, "player-seat:4": 1, narrator: 1 },
			spoke: ["seated-member:51", "narrator", "character:99"],
			persons: ["seated-member:51", "player-seat:4", "player-seat:3"]
		})
		// pure: the input is not changed
		expect(tally.lanes.story.lastSpeaker).toBe("character:11")
	})
})
