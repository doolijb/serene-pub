/**
 * 🚧 The host reads a seat as the cast member it seats (plan §27 S2, lane
 * s27-S2-promptText, host half): the `session_cast` read, a transcript's
 * names, and the refs the host accepts as `seated-member:<memberId>`.
 *
 * The retold overlay this replaced is gone; these tests are what changed: a member is
 * read wherever it lives (a session whose lorebook is its own book too), a
 * seat reads its member over the member's active card, and every row carries
 * the seat's member.
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
import { insertDatedCardVersion } from "$lib/server/pipelines/testing/fixtures"

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
		path.join(os.tmpdir(), "serene-pub-vitest-hostseatmembers-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

// ⏳ (S4) These tests pin the card form — the member-form switch OFF; the same
// paths in member form are `host.seatForm.int.test.ts`'s.
import { memberFormSwitch } from "$lib/server/state/memberForm"
let switchWas = false
beforeEach(() => {
	switchWas = memberFormSwitch.on
	memberFormSwitch.on = false
})
afterEach(() => {
	memberFormSwitch.on = switchWas
})

const db = () => testDb as unknown as Db
const castNode = {
	key: "read",
	definitionId: "core:query/session-cast@1"
} as any
let n = 0

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `hostseat-${++n}`)
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({
			userId,
			name,
			description: `${name}: the card's description.`,
			firstMessage: `${name}: the card says hello.`,
			strokes: [
				{
					kind: "description",
					text: "A stroke.",
					trigger: "always"
				} as any
			]
		})
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

/** A session's own book, made the way a session is born with one. */
async function ownBookOfSession(sessionId: number, userId: number) {
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	return insertOwnBook(db(), {
		sessionId,
		userId,
		name: null,
		overlayOf: null,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
}

async function member(
	lorebookId: number,
	characterId: number | null,
	over: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	const row = (
		await insertCastMember(testDb, {
			lorebookId,
			characterId,
			binding: `{{char:${++n}}}`,
			name: "member",
			...over
		} as any)
	).member
	return row!
}

async function session(
	userId: number,
	lorebookId: number | null,
	over: Partial<typeof schema.sessions.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
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
	over: Partial<typeof schema.sessionCharacters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, castMemberId, ...over } as any)
		.returning()
	return row!
}

async function readCast(sessionId: number) {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return (await createHost(db(), { sessionId }).read!(
		"session_cast",
		{ sessionId },
		castNode
	)) as any
}

describe("session_cast reads the member each seat seats", () => {
	test("a seated member's own name and retold description reach the cast and the prompt, over the card", async () => {
		const u = await user()
		const c = await card(u.id, "Verity")
		const b = await book(u.id)
		const m = await member(b.id, c.id, {
			ownName: "Maren",
			description: "The member's description.",
			retold: { description: true }
		})
		const s = await session(u.id, b.id)
		// The real seat writer finds the member and stores it on the seat.
		await testDb.transaction(async (tx) => {
			const { seatCast } = await import("$lib/server/sessions/seats")
			await seatCast(tx as unknown as Db, {
				sessionId: s.id,
				cardId: c.id
			})
		})
		const [stored] = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, s.id))
		expect(stored.castMemberId).toBe(m.id)

		const read = await readCast(s.id)
		const character = read.sessionCharacters[0].character
		expect(character.name).toBe("Maren")
		expect(character.description).toBe("The member's description.")
		// What is not retold is the card's; the member follows its card's
		// strokes, so the seat reads them as the member's ("Everything in
		// session is cast -> active card", owner 2026-11-05) — now every
		// profile field is laid over the seat's card row, strokes included.
		expect(character.firstMessage).toBe("Verity: the card says hello.")
		expect(character.strokes).toEqual([
			{ kind: "description", text: "A stroke.", trigger: "always" }
		])

		const { resolveContextInput } = await import(
			"$lib/server/pipelines/prompt/promptFields"
		)
		const resolved: any = resolveContextInput({
			sessionCharacters: read.sessionCharacters,
			sessionPersonas: [],
			promptConfig: {} as any,
			currentCharacterId: c.id
		} as any)
		const text = JSON.stringify(resolved)
		expect(text).toContain("The member's description.")
		expect(text).toContain("Maren")
		expect(text).not.toContain("Verity: the card's description.")
		expect(text).not.toContain("Verity")
	})

	test("a session whose lorebook is its own book reads the member of its own book (the intended change)", async () => {
		const u = await user()
		const c = await card(u.id, "Wren")
		const s = await session(u.id, null)
		const own = await ownBookOfSession(s.id, u.id)
		const m = await member(own.id, c.id, {
			ownName: "Wren of the Notes",
			description: "Told in the session's notes.",
			retold: { description: true }
		})
		await seat(s.id, c.id, m.id)
		const read = await readCast(s.id)
		expect(read.sessionCharacters[0].character.name).toBe(
			"Wren of the Notes"
		)
		expect(read.sessionCharacters[0].character.description).toBe(
			"Told in the session's notes."
		)
		// A seat the boot pass has not filled finds the same member by its card.
		const c2 = await card(u.id, "Sparrow")
		await member(own.id, c2.id, { ownName: "Sparrow of the Notes" })
		await seat(s.id, c2.id, null, { position: 1 })
		const again = await readCast(s.id)
		expect(
			again.sessionCharacters.map((r: any) => r.character.name)
		).toEqual(["Wren of the Notes", "Sparrow of the Notes"])
	})

	// Owner ruling 2026-11-05: "Everything in session is cast -> active card."
	test("a seat holding a card the clock has moved on from reads its member over the dated (active) card", async () => {
		const u = await user()
		const a = await card(u.id, "Maren")
		const bCard = await card(u.id, "Maren, younger")
		const b = await book(u.id)
		const m = await member(b.id, a.id, {
			ownName: "Captain Maren",
			description: "The member's description.",
			retold: { description: true }
		})
		await insertDatedCardVersion(testDb, m.id, bCard.id, 1)
		const s = await session(u.id, b.id, { storyClockYear: 5 } as any)
		await seat(s.id, a.id, m.id)
		const character = (await readCast(s.id)).sessionCharacters[0].character
		expect(character.id).toBe(a.id)
		expect(character.name).toBe("Captain Maren")
		expect(character.description).toBe("The member's description.")
		expect(character.firstMessage).toBe(
			"Maren, younger: the card says hello."
		)
	})

	test("a seated card with no member anywhere reads the card untouched", async () => {
		const u = await user()
		const c = await card(u.id, "Alone")
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		await seat(s.id, c.id, null)
		const [row] = await testDb
			.select()
			.from(schema.characters)
			.where(eq(schema.characters.id, c.id))
		expect((await readCast(s.id)).sessionCharacters[0].character).toEqual(
			row
		)
	})

	// Owner ruling 2026-11-05: two seats on one member read the same thing.
	test("two live seats on one member read the member over its one active card", async () => {
		const u = await user()
		const a = await card(u.id, "Ada")
		const a2 = await card(u.id, "Ada, later")
		const b = await book(u.id)
		const m = await member(b.id, a.id, {
			ownName: "Ada Prime",
			scenario: "Member scenario.",
			retold: { scenario: true }
		})
		await insertDatedCardVersion(testDb, m.id, a2.id, 1)
		const s = await session(u.id, b.id, { storyClockYear: 5 } as any)
		await seat(s.id, a.id, m.id, { position: 0 })
		await seat(s.id, a2.id, m.id, { position: 1 })
		const rows = (await readCast(s.id)).sessionCharacters
		expect(rows.map((r: any) => r.character.id)).toEqual([a.id, a2.id])
		expect(rows.map((r: any) => r.character.name)).toEqual([
			"Ada Prime",
			"Ada Prime"
		])
		expect(rows[0].character.description).toBe(
			"Ada, later: the card's description."
		)
		expect(rows[1].character.description).toBe(
			"Ada, later: the card's description."
		)
	})

	test("the rows carry the seat and its member; a player seat carries its member and reads it", async () => {
		const u = await user()
		const c = await card(u.id, "Verity")
		const persona = await card(u.id, "Pia")
		const b = await book(u.id)
		const m = await member(b.id, c.id, { ownName: "Maren" })
		const pm = await member(b.id, persona.id, {
			ownName: "Pia of the Book"
		})
		const s = await session(u.id, b.id)
		const cs = await seat(s.id, c.id, m.id)
		const [ps] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: s.id,
				personaId: persona.id,
				userId: u.id,
				castMemberId: pm.id
			} as any)
			.returning()
		const read = await readCast(s.id)
		expect(read.sessionCharacters[0]).toMatchObject({
			castMemberId: m.id,
			seatId: cs.id
		})
		expect(read.sessionPersonas[0]).toMatchObject({
			castMemberId: pm.id,
			seatId: ps.id
		})
		// ★pT-1 (owner, 2026-11-05): "Everything in session is cast -> active
		// card" -- a player seat reads its member like every seat (was: kept
		// its card, "Pia").
		expect(read.sessionPersonas[0].persona.name).toBe("Pia of the Book")
	})

	test("a player seat reads its member's own name and retold description; a seat name still wins over the member's name", async () => {
		const u = await user()
		const persona = await card(u.id, "Pia")
		const b = await book(u.id)
		const pm = await member(b.id, persona.id, {
			ownName: "Pia of the Book",
			description: "The member's description of Pia.",
			retold: { description: true }
		})
		const s = await session(u.id, b.id)
		const [ps] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: s.id,
				personaId: persona.id,
				userId: u.id,
				castMemberId: pm.id
			} as any)
			.returning()
		const read = await readCast(s.id)
		// ★pT-1 (owner, 2026-11-05): "Everything in session is cast -> active card".
		expect(read.sessionPersonas[0].persona).toMatchObject({
			id: persona.id,
			name: "Pia of the Book",
			description: "The member's description of Pia."
		})
		// What is not retold is the card's.
		expect(read.sessionPersonas[0].persona.firstMessage).toBe(
			"Pia: the card says hello."
		)

		// A seat name wins over the member's own name; the member still lends the rest.
		await testDb
			.update(schema.sessionPersonas)
			.set({ seatName: "Mistress Pia" })
			.where(eq(schema.sessionPersonas.id, ps.id))
		const named = await readCast(s.id)
		expect(named.sessionPersonas[0].persona).toMatchObject({
			name: "Mistress Pia",
			description: "The member's description of Pia."
		})
	})

	test("a card-less player seat rides with its seat name and no card", async () => {
		const u = await user()
		const s = await session(u.id, null)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s.id,
			personaId: null,
			userId: u.id,
			seatName: "Wren"
		} as any)
		const read = await readCast(s.id)
		expect(read.sessionPersonas).toHaveLength(1)
		expect(read.sessionPersonas[0].persona).toBeNull()
		expect(read.sessionPersonas[0].seatName).toBe("Wren")
	})
})

describe("a transcript names a seated character by the member's own name", () => {
	test("summarize_source senderName", async () => {
		const u = await user()
		const c = await card(u.id, "Verity")
		const b = await book(u.id)
		const m = await member(b.id, c.id, { ownName: "Maren" })
		const s = await session(u.id, b.id)
		await seat(s.id, c.id, m.id)
		const [msg] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: s.id,
				role: "assistant",
				content: "Hello.",
				characterId: c.id
			} as any)
			.returning()
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const out = (await createHost(db(), { sessionId: s.id }).read!(
			"summarize_source",
			{ sessionId: s.id, messageIds: [msg.id] },
			{
				key: "read",
				definitionId: "core:query/summarize-source@1"
			} as any
		)) as any[]
		expect(out.map((r) => r.senderName)).toEqual(["Maren"])
	})
})

describe("refs in accept seated-member:<memberId>", () => {
	test("the turn-order write stores the card form of a seated-member candidate and order entry", async () => {
		const u = await user()
		const c = await card(u.id, "Verity")
		const other = await card(u.id, "Other")
		const b = await book(u.id)
		const m = await member(b.id, c.id, { ownName: "Maren" })
		const s = await session(u.id, b.id)
		await seat(s.id, c.id, m.id)
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db(), {
			sessionId: s.id,
			specId: "test:spec/turn-order",
			runId: "run-turn-order"
		} as any)
		const node = {
			key: "set",
			definitionId: "core:outlet/set-turn-order",
			definitionVersion: 1
		} as any
		const cand = (ref: string, position: number) => ({
			ref,
			kind: "character",
			name: ref,
			position
		})
		const out: any = await host.commit!(
			{
				candidates: [
					cand(`seated-member:${m.id}`, 0),
					cand(`seated-member:${m.id + 9999}`, 1),
					cand(`character:${other.id}`, 2)
				],
				order: [
					{ ref: `seated-member:${m.id}`, via: "strategy" },
					{ ref: `seated-member:${m.id + 9999}`, via: "strategy" }
				],
				basedOnAt: Date.now()
			},
			node
		)
		expect(out.written).toBe(true)
		const { readStoredTurnOrder } = await import(
			"$lib/server/sessions/turnOrder"
		)
		const stored = await readStoredTurnOrder(db(), s.id)
		expect(stored.order.map((e: any) => e.ref)).toEqual([
			`character:${c.id}`
		])
		expect(stored.candidates.map((e: any) => e.ref)[0]).toBe(
			`character:${c.id}`
		)
		expect(out.notes).toEqual([
			expect.stringContaining(`seated-member:${m.id + 9999}`)
		])
	})

	test("set-stat-config takes a seated-member owner as it takes the seat's character ref; an unseated member halts with the owner sentence", async () => {
		const u = await user()
		const c = await card(u.id, "Verity")
		const b = await book(u.id)
		const m = await member(b.id, c.id, { ownName: "Maren" })
		// A genre that tracks one cast stat, so the configuration is a real write.
		const slot = "test:slot/seat-stat-config@1"
		const stat = defineAttributeSlot(slot, {
			type: "integer",
			descriptor: "How much a seat can take.",
			appliesTo: ["cast"],
			config: { min: 0, max: 20 },
			default: 20
		})
		genreKeeping("test:genre/seat-stat-config", {
			name: { en: "Seat stat config" },
			family: "test",
			slots: [stat],
			events: {}
		})
		const s = await session(u.id, b.id, {
			genreId: "test:genre/seat-stat-config"
		})
		await seat(s.id, c.id, m.id)
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db(), {
			sessionId: s.id,
			specId: "test:spec/stat-config",
			runId: "run-stat-config"
		} as any)
		const node = {
			key: "configure",
			definitionId: "core:outlet/set-stat-config",
			definitionVersion: 1
		} as any
		const { configFor } = await import("$lib/server/state/resolve")
		const maxOf = async () =>
			(
				await configFor(db(), {
					sessionId: s.id,
					owner: { kind: "session_cast", id: c.id },
					slotId: slot
				} as any)
			).max

		const viaCard: any = await host.commit!(
			{ owner: `character:${c.id}`, slot, config: { max: 11 } },
			node
		)
		expect(viaCard.halt, viaCard.halt).toBeUndefined()
		expect(await maxOf()).toBe(11)

		const viaMember: any = await host.commit!(
			{ owner: `seated-member:${m.id}`, slot, config: { max: 23 } },
			node
		)
		expect(viaMember.halt, viaMember.halt).toBeUndefined()
		expect(viaMember.owner).toBe(`seated-member:${m.id}`)
		expect(await maxOf()).toBe(23)

		const unseated = `seated-member:${m.id + 9999}`
		const out: any = await host.commit!(
			{ owner: unseated, slot, config: { max: 5 } },
			node
		)
		expect(out).toEqual({
			halt: `${JSON.stringify(unseated)} is not an owner here — name a seat (player-seat:<id>, seated-member:<id>, character:<id>) or world`
		})
		expect(await maxOf()).toBe(23)
	})
})

describe("an outcome row's words name the seat's member", () => {
	test("the create-message outlet words a carded seat's outcome by the member's own name, not the card's", async () => {
		const u = await user()
		const c = await card(u.id, "Verity")
		const b = await book(u.id)
		const m = await member(b.id, c.id, { ownName: "Maren" })
		const s = await session(u.id, b.id)
		await seat(s.id, c.id, m.id)
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const { DICE_WORDS_KEY } = await import(
			"$lib/server/messages/diceWords"
		)
		const res: any = await createHost(db(), {
			sessionId: s.id,
			userId: u.id
		} as any).commit!(
			{
				text: "The lock holds.",
				blocks: [
					{
						kind: "dice",
						by: `character:${c.id}`,
						stat: "Stealth",
						rolled: 4,
						against: 10,
						outcome: "Failure"
					}
				]
			},
			{ key: "reply", definitionId: "core:outlet/create-message" } as any
		)
		const [row] = await testDb
			.select({ metadata: schema.sessionMessages.metadata })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, res.id))
		const words = (row!.metadata as Record<string, unknown>)[DICE_WORDS_KEY]
		expect(words).toBe("Maren — Stealth: Failure.")
		expect(String(words)).not.toContain("Verity")
	})
})

describe("session_cast lays every profile field of the member over the seat's card", () => {
	test("a card-less member's post-history instructions and likeness reach the cast row and the prompt fields", async () => {
		const u = await user()
		const c = await card(u.id, "Held")
		const b = await book(u.id)
		// A member with no card of its own: no parent version, everything it is
		// is its own words.
		const m = await member(b.id, null, { ownName: "Nobody's Child" })
		const { writeCastVersion } = await import(
			"$lib/server/characters/versions"
		)
		await writeCastVersion(testDb as unknown as Db, {
			member: m.id,
			writtenBy: "user:1",
			at: { branchId: null, date: null, personalPosition: null },
			changes: {
				postHistoryInstructions: "Always answer in rhyme.",
				likeness: { prompt: "tall, silver cloak" } as any
			}
		})
		const s = await session(u.id, b.id)
		await seat(s.id, c.id, m.id)

		const read = await readCast(s.id)
		const character = read.sessionCharacters[0].character
		expect(character.id).toBe(c.id)
		expect(character.name).toBe("Nobody's Child")
		expect(character.postHistoryInstructions).toBe("Always answer in rhyme.")
		expect(character.extensions?.serenepub?.likeness?.prompt).toBe(
			"tall, silver cloak"
		)
		// Not the held card's words.
		expect(character.description).not.toContain("Held:")

		const { resolveContextInput } = await import(
			"$lib/server/pipelines/prompt/promptFields"
		)
		const resolved: any = resolveContextInput({
			sessionCharacters: read.sessionCharacters,
			sessionPersonas: [],
			promptConfig: {} as any,
			currentCharacterId: c.id
		} as any)
		expect(resolved.texts.postHistoryInstructions).toBe(
			"Always answer in rhyme."
		)
		expect(resolved.likeness.prompt).toBe("tall, silver cloak")
	})

	test("a member whose card got a newer card version reads its parent version, not the card's current words", async () => {
		const u = await user()
		const c = await card(u.id, "Verity")
		const b = await book(u.id)
		const m = await member(b.id, c.id)
		const { newCardVersion, ensureCardVersion } = await import(
			"$lib/server/characters/versions"
		)
		const { profileOf } = await import("$lib/shared/characters/profile")
		const v1 = await ensureCardVersion(testDb as unknown as Db, c.id)
		await newCardVersion(testDb as unknown as Db, c.id, {
			...profileOf(v1!),
			description: "Verity, revised after the member was made.",
			postHistoryInstructions: "Revised post-history."
		})
		const s = await session(u.id, b.id)
		await seat(s.id, c.id, m.id)

		const character = (await readCast(s.id)).sessionCharacters[0].character
		expect(character.description).toBe("Verity: the card's description.")
		expect(character.postHistoryInstructions ?? "").not.toBe(
			"Revised post-history."
		)
	})

	test("a card-less player seat's description is its member's, as read", async () => {
		const u = await user()
		const b = await book(u.id)
		const m = await member(b.id, null, {
			ownName: "Guest",
			description: "The guest's own description.",
			retold: { description: true }
		})
		const s = await session(u.id, b.id)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s.id,
			personaId: null,
			castMemberId: m.id,
			seatName: "Guest",
			userId: u.id
		} as any)
		const read = await readCast(s.id)
		const row = read.sessionPersonas[0]
		expect(row.persona).toBeNull()
		expect(row.memberDescription).toBe("The guest's own description.")

		const { resolveContextInput } = await import(
			"$lib/server/pipelines/prompt/promptFields"
		)
		const resolved: any = resolveContextInput({
			sessionCharacters: [],
			sessionPersonas: read.sessionPersonas,
			promptConfig: {} as any
		} as any)
		expect(JSON.stringify(resolved)).toContain(
			"The guest's own description."
		)
	})
})
