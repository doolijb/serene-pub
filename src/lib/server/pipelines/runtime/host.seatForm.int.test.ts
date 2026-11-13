/**
 * 🚧 ⏳ S4 f-emit (w3): the host and the turn runtime emit a seat in member
 * form — behind `memberFormSwitch`, which these tests set explicitly and
 * always restore. Off, every answer here is the card form it was.
 *
 * Covers: the `session_cast` read's host-filled `ref`, `liveCastRefs` (through
 * the turn-order write), `turnRefs` / `resolvePortrayals` against the refs
 * `hearingOf` asks by (★K-2: a member holding both a character seat and a
 * player seat with one card), `enabledSeats` and the status line's speaker
 * name.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
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
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { defineAttributeSlot } from "@serene-pub/sdk"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

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
		path.join(os.tmpdir(), "serene-pub-vitest-hostseatform-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let was = false
beforeEach(() => {
	was = memberFormSwitch.on
	memberFormSwitch.on = true
})
afterEach(() => {
	memberFormSwitch.on = was
})

const db = () => testDb as unknown as Db
const castNode = {
	key: "read",
	definitionId: "core:query/session-cast@1"
} as any
let n = 0

async function user(label = "u") {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb, `seatform-${label}-${++n}`))!
}

async function card(userId: number, name: string, isPersona = false) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: `${name}.`, isPersona } as any)
		.returning()
	return row!
}

async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` } as any)
		.returning()
	return row!
}

async function member(
	lorebookId: number,
	characterId: number | null,
	over: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	return (
		await insertCastMember(testDb, {
			lorebookId,
			characterId,
			binding: `{{char:${++n}}}`,
			name: "member",
			...over
		} as any)
	).member!
}

async function session(
	userId: number,
	lorebookId: number | null,
	over: object = {}
) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: true,
			name: `Run ${++n}`,
			lorebookId,
			...over
		} as any)
		.returning()
	return row!
}

async function seat(
	sessionId: number,
	characterId: number,
	castMemberId: number | null,
	over: object = {}
) {
	const [row] = await testDb
		.insert(schema.sessionCharacters)
		.values({
			sessionId,
			characterId,
			castMemberId,
			isActive: true,
			...over
		} as any)
		.returning()
	return row!
}

async function playerSeat(sessionId: number, userId: number, over: object) {
	const [row] = await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId, userId, ...over } as any)
		.returning()
	return row!
}

/** One table: every seat form a session holds. */
async function table() {
	const owner = await user("owner")
	const guest = await user("guest")
	const b = await book(owner.id)
	const ai = await card(owner.id, "Verity")
	const aiMember = await member(b.id, ai.id, { ownName: "Maren" })
	const persona = await card(owner.id, "Pia", true)
	const personaMember = await member(b.id, persona.id, { ownName: "Pippa" })
	// ★K-2: one member, one card, a character seat AND a player seat.
	const both = await card(owner.id, "Kit")
	const bothMember = await member(b.id, both.id)
	const memberless = await card(owner.id, "Loner")
	const departed = await card(owner.id, "Gone")
	const departedMember = await member(b.id, departed.id)
	const s = await session(owner.id, b.id)
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: s.id, userId: guest.id })
	const aiSeat = await seat(s.id, ai.id, aiMember.id)
	const loner = await seat(s.id, memberless.id, null, { position: 1 })
	const kitChar = await seat(s.id, both.id, bothMember.id, { position: 2 })
	const goneSeat = await seat(s.id, departed.id, departedMember.id, {
		position: 3,
		removedAt: new Date()
	})
	const carded = await playerSeat(s.id, owner.id, {
		personaId: persona.id,
		castMemberId: personaMember.id
	})
	const cardless = await playerSeat(s.id, guest.id, {
		personaId: null,
		seatName: "Wren",
		position: 1
	})
	const kitPlayer = await playerSeat(s.id, owner.id, {
		personaId: both.id,
		castMemberId: bothMember.id,
		position: 2
	})
	return {
		owner,
		guest,
		s,
		ai,
		aiMember,
		aiSeat,
		loner,
		memberless,
		kitChar,
		kitPlayer,
		bothMember,
		both,
		goneSeat,
		departedMember,
		carded,
		persona,
		personaMember,
		cardless
	}
}

describe("the session_cast read's host-filled ref", () => {
	async function readCast(sessionId: number) {
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		return (await createHost(db(), { sessionId }).read!(
			"session_cast",
			{ sessionId },
			castNode
		)) as any
	}

	test("on: a character seat is seated-member:M, a player seat player-seat:S, a member-less character seat ⏳ its card", async () => {
		const t = await table()
		const read = await readCast(t.s.id)
		const chars = new Map<number, any>(
			read.sessionCharacters.map((r: any) => [r.seatId, r])
		)
		expect(chars.get(t.aiSeat.id).ref).toBe(
			`seated-member:${t.aiMember.id}`
		)
		expect(chars.get(t.kitChar.id).ref).toBe(
			`seated-member:${t.bothMember.id}`
		)
		expect(chars.get(t.loner.id).ref).toBe(`character:${t.memberless.id}`)
		const players = new Map<number, any>(
			read.sessionPersonas.map((r: any) => [r.seatId, r])
		)
		expect(players.get(t.carded.id).ref).toBe(`player-seat:${t.carded.id}`)
		expect(players.get(t.cardless.id).ref).toBe(
			`player-seat:${t.cardless.id}`
		)
		expect(players.get(t.kitPlayer.id).ref).toBe(
			`player-seat:${t.kitPlayer.id}`
		)
	})

	test("off: the card form, a card-less player seat's own ref", async () => {
		memberFormSwitch.on = false
		const t = await table()
		const read = await readCast(t.s.id)
		const chars = new Map<number, any>(
			read.sessionCharacters.map((r: any) => [r.seatId, r])
		)
		expect(chars.get(t.aiSeat.id).ref).toBe(`character:${t.ai.id}`)
		expect(chars.get(t.loner.id).ref).toBe(`character:${t.memberless.id}`)
		const players = new Map<number, any>(
			read.sessionPersonas.map((r: any) => [r.seatId, r])
		)
		expect(players.get(t.carded.id).ref).toBe(`character:${t.persona.id}`)
		expect(players.get(t.cardless.id).ref).toBe(
			`player-seat:${t.cardless.id}`
		)
	})

	test("the roster carries each binding's id and whether its card is soft-deleted", async () => {
		const owner = await user("roster")
		const b = await book(owner.id)
		const live = await card(owner.id, "Live")
		const dead = await card(owner.id, "Dead")
		await testDb
			.update(schema.characters)
			.set({ isDeleted: true })
			.where(eq(schema.characters.id, dead.id))
		const liveMember = await member(b.id, live.id)
		const deadMember = await member(b.id, dead.id)
		const bare = await member(b.id, null)
		const s = await session(owner.id, b.id)
		const rows = new Map<number, any>(
			(await readCast(s.id)).lorebookBindings.map((r: any) => [r.id, r])
		)
		expect(rows.get(liveMember.id)).toMatchObject({
			characterId: live.id,
			cardDeleted: false
		})
		expect(rows.get(deadMember.id)).toMatchObject({
			characterId: dead.id,
			cardDeleted: true
		})
		expect(rows.get(bare.id)).toMatchObject({
			characterId: null,
			cardDeleted: null
		})
	})
})

describe("liveCastRefs — the turn-order write admits the refs a turn entry carries", () => {
	async function writeOrder(sessionId: number, refs: string[]) {
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db(), {
			sessionId,
			specId: "test:spec/turn-order",
			runId: "run-seatform-order"
		} as any)
		const out: any = await host.commit!(
			{
				candidates: refs.map((ref, position) => ({
					ref,
					kind: "character",
					name: ref,
					position
				})),
				order: refs.map((ref) => ({ ref, via: "strategy" })),
				basedOnAt: Date.now()
			},
			{
				key: "set",
				definitionId: "core:outlet/set-turn-order",
				definitionVersion: 1
			} as any
		)
		const { readStoredTurnOrder } = await import(
			"$lib/server/sessions/turnOrder"
		)
		return { out, stored: await readStoredTurnOrder(db(), sessionId) }
	}

	test("on: seated-member, player-seat and a member-less seat's card are live; a departed seat is not", async () => {
		const t = await table()
		const refs = [
			`seated-member:${t.aiMember.id}`,
			`seated-member:${t.bothMember.id}`,
			`player-seat:${t.carded.id}`,
			`player-seat:${t.cardless.id}`,
			`player-seat:${t.kitPlayer.id}`,
			`character:${t.memberless.id}`,
			`seated-member:${t.departedMember.id}`
		]
		const { out, stored } = await writeOrder(t.s.id, refs)
		expect(out.written).toBe(true)
		expect(stored.order.map((e: any) => e.ref)).toEqual(refs.slice(0, 6))
		expect(out.notes).toEqual([
			expect.stringContaining(`seated-member:${t.departedMember.id}`)
		])
	})

	test("off: the card forms are live", async () => {
		memberFormSwitch.on = false
		const t = await table()
		const refs = [
			`character:${t.ai.id}`,
			`character:${t.persona.id}`,
			`player-seat:${t.cardless.id}`
		]
		const { stored } = await writeOrder(t.s.id, refs)
		expect(stored.order.map((e: any) => e.ref)).toEqual(refs)
	})
})

describe("set-stat-config reads the member form the door answers", () => {
	test("a character ref, a member ref and a player seat each configure their own seat", async () => {
		const owner = await user("stat")
		const c = await card(owner.id, "Verity")
		const b = await book(owner.id)
		const m = await member(b.id, c.id)
		const slot = "test:slot/seat-form-stat-config@1"
		const stat = defineAttributeSlot(slot, {
			type: "integer",
			descriptor: "How much a seat can take.",
			appliesTo: ["cast"],
			config: { min: 0, max: 20 },
			default: 20
		})
		genreKeeping("test:genre/seat-form-stat-config", {
			name: { en: "Seat form stat config" },
			family: "test",
			slots: [stat],
			events: {}
		})
		const s = await session(owner.id, b.id, {
			genreId: "test:genre/seat-form-stat-config"
		})
		await seat(s.id, c.id, m.id)
		const ps = await playerSeat(s.id, owner.id, {
			personaId: null,
			seatName: "Wren"
		})
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db(), {
			sessionId: s.id,
			specId: "test:spec/stat-config",
			runId: "run-seatform-stat-config"
		} as any)
		const node = {
			key: "configure",
			definitionId: "core:outlet/set-stat-config",
			definitionVersion: 1
		} as any
		const { configFor } = await import("$lib/server/state/resolve")
		const maxOf = async (o: { kind: string; id: number }) =>
			(
				await configFor(db(), {
					sessionId: s.id,
					owner: o,
					slotId: slot
				} as any)
			).max

		const viaCard: any = await host.commit!(
			{ owner: `character:${c.id}`, slot, config: { max: 11 } },
			node
		)
		expect(viaCard.halt, viaCard.halt).toBeUndefined()
		expect(await maxOf({ kind: "seated_member", id: m.id })).toBe(11)
		const viaMember: any = await host.commit!(
			{ owner: `seated-member:${m.id}`, slot, config: { max: 23 } },
			node
		)
		expect(viaMember.halt, viaMember.halt).toBeUndefined()
		expect(await maxOf({ kind: "seated_member", id: m.id })).toBe(23)
		const viaSeat: any = await host.commit!(
			{ owner: `player-seat:${ps.id}`, slot, config: { max: 7 } },
			node
		)
		expect(viaSeat.halt, viaSeat.halt).toBeUndefined()
		expect(await maxOf({ kind: "player_seat", id: ps.id })).toBe(7)
	})
})

describe("turnRefs and resolvePortrayals", () => {
	test("on: turnRefs asks by each seat's member form", async () => {
		const t = await table()
		const { turnRefs } = await import(
			"$lib/server/pipelines/runtime/portrayals"
		)
		const refs = await turnRefs(db(), t.s.id, null)
		expect(refs).toEqual(
			expect.arrayContaining([
				"owner",
				"run-owner",
				`seated-member:${t.aiMember.id}`,
				`seated-member:${t.bothMember.id}`,
				`character:${t.memberless.id}`,
				`player-seat:${t.carded.id}`,
				`player-seat:${t.cardless.id}`,
				`player-seat:${t.kitPlayer.id}`
			])
		)
		expect(refs).not.toContain(`character:${t.ai.id}`)
		expect(refs).not.toContain(`character:${t.persona.id}`)
		expect(refs).not.toContain(`seated-member:${t.departedMember.id}`)
	})

	test("off: turnRefs asks by card", async () => {
		memberFormSwitch.on = false
		const t = await table()
		const { turnRefs } = await import(
			"$lib/server/pipelines/runtime/portrayals"
		)
		const refs = await turnRefs(db(), t.s.id, null)
		expect(refs).toEqual(
			expect.arrayContaining([
				`character:${t.ai.id}`,
				`character:${t.persona.id}`,
				`player-seat:${t.cardless.id}`
			])
		)
		expect(refs.some((r) => r.startsWith("seated-member:"))).toBe(false)
	})

	test("on: each ref answers its own seat — the AI's cast, a person's presence, a card-less seat, ★K-2's two seats of one card", async () => {
		const t = await table()
		const { resolvePortrayals } = await import(
			"$lib/server/pipelines/runtime/portrayals"
		)
		const asked = [
			`seated-member:${t.aiMember.id}`,
			`player-seat:${t.carded.id}`,
			`player-seat:${t.cardless.id}`,
			`seated-member:${t.bothMember.id}`,
			`player-seat:${t.kitPlayer.id}`,
			`seated-member:${t.departedMember.id}`,
			`character:${t.memberless.id}`
		]
		const v = (await resolvePortrayals(db(), {
			sessionId: t.s.id,
			runOwnerUserId: t.owner.id,
			refs: asked as any
		})) as Record<string, unknown>
		const person = (id: number) => ({ by: "person", userId: String(id) })
		expect(v[`seated-member:${t.aiMember.id}`]).toEqual({ by: "ai" })
		expect(v[`player-seat:${t.carded.id}`]).toEqual(person(t.owner.id))
		expect(v[`player-seat:${t.cardless.id}`]).toEqual(person(t.guest.id))
		// ★K-2: the member's character seat is the AI's, its player seat the person's.
		expect(v[`seated-member:${t.bothMember.id}`]).toEqual({ by: "ai" })
		expect(v[`player-seat:${t.kitPlayer.id}`]).toEqual(person(t.owner.id))
		expect(v[`seated-member:${t.departedMember.id}`]).toEqual({
			by: "none"
		})
		// A member-less character seat is still asked by its card.
		expect(v[`character:${t.memberless.id}`]).toEqual({ by: "ai" })
		expect(Object.keys(v).sort()).toEqual([...asked].sort())
	})

	test("on: the turn's speaker is the AI's, spelt either way", async () => {
		const t = await table()
		const { resolvePortrayals } = await import(
			"$lib/server/pipelines/runtime/portrayals"
		)
		const v = (await resolvePortrayals(db(), {
			sessionId: t.s.id,
			runOwnerUserId: t.owner.id,
			refs: [`seated-member:${t.departedMember.id}`] as any,
			speaker: `seated-member:${t.departedMember.id}` as any
		})) as Record<string, unknown>
		expect(v[`seated-member:${t.departedMember.id}`]).toEqual({ by: "ai" })
	})

	test("off: a seated-member ref is still answered as its card", async () => {
		memberFormSwitch.on = false
		const t = await table()
		const { resolvePortrayals } = await import(
			"$lib/server/pipelines/runtime/portrayals"
		)
		const v = (await resolvePortrayals(db(), {
			sessionId: t.s.id,
			runOwnerUserId: t.owner.id,
			refs: [
				`seated-member:${t.aiMember.id}`,
				`character:${t.persona.id}`,
				`player-seat:${t.cardless.id}`
			] as any
		})) as Record<string, unknown>
		expect(v[`seated-member:${t.aiMember.id}`]).toEqual({ by: "ai" })
		expect(v[`character:${t.persona.id}`]).toEqual({
			by: "person",
			userId: String(t.owner.id)
		})
		expect(v[`player-seat:${t.cardless.id}`]).toEqual({
			by: "person",
			userId: String(t.guest.id)
		})
	})
})

describe("fireAction and the status line", () => {
	test("on: enabledSeats are the seats' member forms; off the cards", async () => {
		const t = await table()
		const { enabledSeats } = await import(
			"$lib/server/pipelines/runtime/fireAction"
		)
		expect(await enabledSeats(db(), t.s.id)).toEqual(
			new Set([
				`seated-member:${t.aiMember.id}`,
				`seated-member:${t.bothMember.id}`,
				`character:${t.memberless.id}`
			])
		)
		memberFormSwitch.on = false
		expect(await enabledSeats(db(), t.s.id)).toEqual(
			new Set([
				`character:${t.ai.id}`,
				`character:${t.both.id}`,
				`character:${t.memberless.id}`
			])
		)
	})

	test("on: a member-form speaker is named by the card its seat holds", async () => {
		const t = await table()
		const { speakerDisplayName } = await import(
			"$lib/server/pipelines/runtime/runStatus"
		)
		expect(
			await speakerDisplayName(db(), {
				sessionId: t.s.id,
				speaker: `seated-member:${t.aiMember.id}` as any
			})
		).toBe("Maren")
		expect(
			await speakerDisplayName(db(), {
				sessionId: t.s.id,
				speaker: `player-seat:${t.carded.id}` as any
			})
		).toBe("Pippa")
	})
})

describe("create-message stores the speaker in member form", () => {
	const createMessage = {
		key: "reply",
		definitionId: "core:outlet/create-message"
	} as any
	const speakerOf = async (id: number) => {
		const [row] = await testDb
			.select({ metadata: schema.sessionMessages.metadata })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, id))
		return (row!.metadata as any).speaker
	}

	test("on: a card or a member asked, the seat's member form is stored; a carded player seat is player-seat:S", async () => {
		const t = await table()
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db(), {
			sessionId: t.s.id,
			userId: t.owner.id
		} as any)
		const viaMember: any = await host.commit!(
			{ text: "Hello.", speaker: `seated-member:${t.aiMember.id}` },
			createMessage
		)
		expect(await speakerOf(viaMember.id)).toBe(
			`seated-member:${t.aiMember.id}`
		)
		const viaCard: any = await host.commit!(
			{ text: "Hello.", speaker: `character:${t.ai.id}` },
			createMessage
		)
		expect(await speakerOf(viaCard.id)).toBe(
			`seated-member:${t.aiMember.id}`
		)
		const viaSeat: any = await host.commit!(
			{ text: "Hello.", speaker: `player-seat:${t.carded.id}` },
			createMessage
		)
		expect(await speakerOf(viaSeat.id)).toBe(`player-seat:${t.carded.id}`)
		// The row still names the card the seat holds.
		const [row] = await testDb
			.select({ characterId: schema.sessionMessages.characterId })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, viaMember.id))
		expect(row!.characterId).toBe(t.ai.id)
	})

	test("on: a person's line spoken as their carded player seat is written as that persona", async () => {
		const t = await table()
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db(), {
			sessionId: t.s.id,
			userId: t.owner.id
		} as any)
		const out: any = await host.commit!(
			{
				text: "I step in.",
				role: "user",
				speaker: `player-seat:${t.carded.id}`
			},
			createMessage
		)
		const [row] = await testDb
			.select({ personaId: schema.sessionMessages.personaId })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, out.id))
		expect(row!.personaId).toBe(t.persona.id)
	})
})
