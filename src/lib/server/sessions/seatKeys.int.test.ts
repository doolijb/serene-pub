/**
 * 🚧 The `seat-keys` boot pass (`sessions/seatKeys.ts`, plan §34.1, S4).
 *
 * Claims: with nothing in card form it writes nothing; each owner-column store
 * and the proposals move a character seat's `session_cast:<card>` rows to
 * `seated_member:<member>` and a player seat's to `player_seat:<seatId>`; a
 * card held by a character seat and a player seat is copied to both (★K-2); a
 * merged pair keeps the survivor's row (else the newest) on a unique key; a
 * card number equal to another person's member number still lands on the
 * right member; what no seat can take is counted and left; a second run
 * changes nothing; one session's failure rolls back that session alone.
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
import { inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { seatKeys } from "./seatKeys"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const failing = vi.hoisted(() => ({ sessionId: -1 }))

vi.mock("$lib/server/state/seatRefs", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/state/seatRefs")>()
	return {
		...actual,
		// Proposals run after the column stores: a chosen session throws late.
		memberFormOf: (map: { sessionId: number }, input: unknown) => {
			if (map.sessionId === failing.sessionId) throw new Error("boom")
			return (actual.memberFormOf as (m: unknown, i: unknown) => unknown)(
				map,
				input
			)
		}
	}
})

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
		path.join(os.tmpdir(), "serene-pub-vitest-seatKeys-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`
const asDb = () => testDb as unknown as Db
const made: number[] = []

// Sessions of a test go with it (state rows cascade), so reports stay per test.
afterEach(async () => {
	failing.sessionId = -1
	if (made.length)
		await testDb
			.delete(schema.sessions)
			.where(inArray(schema.sessions.id, made))
	made.length = 0
})

async function user() {
	const [row] = await testDb
		.insert(schema.users)
		.values({ username: uniq("seat-keys-user") })
		.returning()
	return row!
}
async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	return row!
}
async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: uniq("Book") })
		.returning()
	return row!
}
async function member(lorebookId: number, characterId: number | null) {
	const [row] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId,
			binding: uniq("{{char:x}}"),
			characterId,
			name: ""
		})
		.returning()
	return row!
}
async function session(userId: number, lorebookId: number) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: uniq("Run"), lorebookId })
		.returning()
	made.push(row!.id)
	return row!
}
async function charSeat(
	sessionId: number,
	characterId: number | null,
	castMemberId: number | null,
	extra: Partial<typeof schema.sessionCharacters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, castMemberId, ...extra })
		.returning()
	return row!
}
async function playerSeat(
	sessionId: number,
	personaId: number | null,
	castMemberId: number | null
) {
	const [row] = await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId, castMemberId })
		.returning()
	return row!
}
const departed = (mergedInto?: number) => ({
	removedAt: new Date(),
	removedName: "gone",
	isActive: false,
	...(mergedInto ? { mergedInto } : {})
})

type Owner = { kind: string; id: number }
const cardForm = (id: number): Owner => ({ kind: "session_cast", id })

async function value(sessionId: number, o: Owner, slotId = "core:slot/hp@1") {
	await testDb.insert(schema.attributeValues).values({
		sessionId,
		ownerKind: o.kind,
		ownerId: o.id,
		slotId,
		value: { v: 12 },
		note: "n",
		updatedBy: "user:1",
		stateVersion: 3
	})
}
async function config(sessionId: number, o: Owner) {
	await testDb.insert(schema.attributeConfigs).values({
		sessionId,
		ownerKind: o.kind,
		ownerId: o.id,
		slotId: "core:slot/hp@1",
		config: { max: 40 }
	})
}
async function zone(sessionId: number, o: Owner) {
	await testDb.insert(schema.zoneContents).values({
		sessionId,
		ownerKind: o.kind,
		ownerId: o.id,
		rulesetId: "r:ruleset/x@1",
		zoneType: "hand",
		entries: [{ entryId: 1, name: "Ace" }]
	})
}
async function sheet(
	sessionId: number,
	o: Owner,
	createdAt?: Date,
	sheetId = "test:sheet/wounds@1"
) {
	await testDb
		.insert(schema.attributeSheets)
		.values({ id: sheetId })
		.onConflictDoNothing()
	const [row] = await testDb
		.insert(schema.ownerSheets)
		.values({
			sessionId,
			ownerKind: o.kind,
			ownerId: o.id,
			sheetId,
			position: 2,
			...(createdAt ? { createdAt } : {})
		})
		.returning()
	return row!
}
async function carry(
	sessionId: number,
	o: Owner,
	carries = true,
	createdAt?: Date
) {
	const [row] = await testDb
		.insert(schema.attributeCarries)
		.values({
			sessionId,
			ownerKind: o.kind,
			ownerId: o.id,
			slotId: "core:slot/hp@1",
			carries,
			...(createdAt ? { createdAt } : {})
		})
		.returning()
	return row!
}
async function proposal(sessionId: number, payload: Record<string, unknown>) {
	const [row] = await testDb
		.insert(schema.stateProposals)
		.values({
			sessionId,
			kind: payload.kind === "clock" ? "clock" : "value",
			payload
		})
		.returning()
	return row!
}

const dump = async () => ({
	values: await testDb
		.select()
		.from(schema.attributeValues)
		.orderBy(schema.attributeValues.id),
	configs: await testDb
		.select()
		.from(schema.attributeConfigs)
		.orderBy(schema.attributeConfigs.id),
	zones: await testDb
		.select()
		.from(schema.zoneContents)
		.orderBy(schema.zoneContents.id),
	sheets: await testDb
		.select()
		.from(schema.ownerSheets)
		.orderBy(schema.ownerSheets.id),
	carries: await testDb
		.select()
		.from(schema.attributeCarries)
		.orderBy(schema.attributeCarries.id),
	proposals: await testDb
		.select()
		.from(schema.stateProposals)
		.orderBy(schema.stateProposals.id)
})
const ownerOf = (r: { ownerKind: string; ownerId: number }) =>
	`${r.ownerKind}:${r.ownerId}`

const REKEYED_ZERO = {
	attribute_values: 0,
	attribute_configs: 0,
	zone_contents: 0,
	owner_sheets: 0,
	attribute_carries: 0,
	state_proposals: 0,
	zone_towards: 0,
	annex_core: 0,
	annex_audiences: 0,
	genre_fields: 0,
	widget_settings: 0,
	message_speakers: 0,
	message_blocks: 0,
	rewind_taken: 0,
	annex_imprints: 0
}
const ZEROS = {
	sessions: 0,
	rekeyed: REKEYED_ZERO,
	copied: 0,
	dropped: 0,
	left: 0,
	failed: 0
}

/** A session with one character seat (carded, with a member) and one player seat. */
async function fixture() {
	const u = await user()
	const b = await book(u.id)
	const hero = await card(u.id, "Hero")
	const heroMember = await member(b.id, hero.id)
	const persona = await card(u.id, "Persona")
	const personaMember = await member(b.id, persona.id)
	const s = await session(u.id, b.id)
	const cs = await charSeat(s.id, hero.id, heroMember.id)
	const ps = await playerSeat(s.id, persona.id, personaMember.id)
	return { u, b, s, hero, heroMember, persona, personaMember, cs, ps }
}

describe("the pass", () => {
	test("nothing in card form: zeros, and nothing written", async () => {
		const before = await dump()
		expect(await seatKeys(asDb())).toEqual(ZEROS)
		expect(await dump()).toEqual(before)
	})

	test("each owner-column store: a character seat to its member, a player seat to its seat", async () => {
		const f = await fixture()
		const hero = cardForm(f.hero.id)
		const persona = cardForm(f.persona.id)
		for (const o of [hero, persona]) {
			await value(f.s.id, o)
			await config(f.s.id, o)
			await zone(f.s.id, o)
			await sheet(f.s.id, o)
			await carry(f.s.id, o)
		}
		const report = await seatKeys(asDb())
		expect(report).toEqual({
			...ZEROS,
			sessions: 1,
			rekeyed: {
				...REKEYED_ZERO,
				attribute_values: 2,
				attribute_configs: 2,
				zone_contents: 2,
				owner_sheets: 2,
				attribute_carries: 2
			}
		})
		const after = await dump()
		const heroKey = `seated_member:${f.heroMember.id}`
		const personaKey = `player_seat:${f.ps.id}`
		for (const rows of [
			after.values,
			after.configs,
			after.zones,
			after.sheets,
			after.carries
		])
			expect(rows.map(ownerOf).sort()).toEqual(
				[heroKey, personaKey].sort()
			)
	})

	test("a card held by a character seat AND a player seat: copied to both (★K-2)", async () => {
		const u = await user()
		const b = await book(u.id)
		const both = await card(u.id, "Both")
		const m = await member(b.id, both.id)
		const s = await session(u.id, b.id)
		await charSeat(s.id, both.id, m.id)
		const ps = await playerSeat(s.id, both.id, m.id)
		const o = cardForm(both.id)
		await value(s.id, o)
		await config(s.id, o)
		await zone(s.id, o)
		await sheet(s.id, o)
		await carry(s.id, o)
		const before = await dump()

		const report = await seatKeys(asDb())
		expect(report.rekeyed).toMatchObject({
			attribute_values: 1,
			attribute_configs: 1,
			zone_contents: 1,
			owner_sheets: 1,
			attribute_carries: 1
		})
		expect(report).toMatchObject({
			copied: 5,
			dropped: 0,
			left: 0,
			sessions: 1
		})
		const after = await dump()
		const strip = (r: Record<string, unknown>) => {
			const { id: _id, ownerKind: _k, ownerId: _i, ...rest } = r
			return rest
		}
		const tables = [
			"values",
			"configs",
			"zones",
			"sheets",
			"carries"
		] as const
		for (const t of tables) {
			expect(after[t]).toHaveLength(2)
			const [first, copy] = after[t] as Array<
				Record<string, unknown> & { ownerKind: string; ownerId: number }
			>
			expect(ownerOf(first!)).toBe(`seated_member:${m.id}`)
			expect(ownerOf(copy!)).toBe(`player_seat:${ps.id}`)
			expect(strip(copy!)).toEqual(strip(first!))
			expect(strip(first!)).toEqual(strip(before[t][0] as never))
		}
	})

	test("a merged pair on owner_sheets and attribute_carries: the survivor's row stays, the other is dropped", async () => {
		const u = await user()
		const b = await book(u.id)
		const survivorCard = await card(u.id, "Survivor")
		const otherCard = await card(u.id, "Other")
		const m = await member(b.id, survivorCard.id)
		const s = await session(u.id, b.id)
		const live = await charSeat(s.id, survivorCard.id, m.id)
		await charSeat(s.id, otherCard.id, m.id, departed(live.id))
		const old = new Date("2020-01-01")
		const recent = new Date("2025-01-01")
		// The survivor's row is the OLDER one: it wins by being the survivor's.
		const sSheet = await sheet(s.id, cardForm(survivorCard.id), old)
		await sheet(s.id, cardForm(otherCard.id), recent)
		const sCarry = await carry(s.id, cardForm(survivorCard.id), true, old)
		await carry(s.id, cardForm(otherCard.id), false, recent)

		const report = await seatKeys(asDb())
		expect(report).toMatchObject({
			dropped: 2,
			left: 0,
			failed: 0,
			sessions: 1
		})
		expect(report.rekeyed).toMatchObject({
			owner_sheets: 1,
			attribute_carries: 1
		})
		const after = await dump()
		expect(after.sheets.map((r) => [r.id, ownerOf(r)])).toEqual([
			[sSheet.id, `seated_member:${m.id}`]
		])
		expect(after.carries.map((r) => [r.id, r.carries, ownerOf(r)])).toEqual(
			[[sCarry.id, true, `seated_member:${m.id}`]]
		)
	})

	test("only the departed card has a row, and a member-form row exists: the newest is kept", async () => {
		const u = await user()
		const b = await book(u.id)
		const survivorCard = await card(u.id, "Survivor")
		const otherCard = await card(u.id, "Other")
		const m = await member(b.id, survivorCard.id)
		const s = await session(u.id, b.id)
		const live = await charSeat(s.id, survivorCard.id, m.id)
		await charSeat(s.id, otherCard.id, m.id, departed(live.id))
		const memberForm = { kind: "seated_member", id: m.id }
		const old = new Date("2020-01-01")
		const recent = new Date("2025-01-01")
		// Existing member-form row is older than the departed card's: the departed's wins.
		await sheet(s.id, memberForm, old)
		const newer = await sheet(s.id, cardForm(otherCard.id), recent)
		// Existing member-form carry is newer: it wins.
		const keep = await carry(s.id, memberForm, true, recent)
		await carry(s.id, cardForm(otherCard.id), false, old)

		const report = await seatKeys(asDb())
		expect(report).toMatchObject({ dropped: 2, failed: 0 })
		const after = await dump()
		expect(after.sheets.map((r) => [r.id, ownerOf(r)])).toEqual([
			[newer.id, `seated_member:${m.id}`]
		])
		expect(after.carries.map((r) => r.id)).toEqual([keep.id])
	})

	test("a card number equal to another person's member number lands on the right member", async () => {
		const u = await user()
		const b = await book(u.id)
		const decoyCard = await card(u.id, "Decoy")
		const [{ top }] = (
			await testDb.execute(
				sql`select greatest((select max(id) from characters), (select max(id) from lorebook_bindings))::int as top`
			)
		).rows as { top: number }[]
		const shared = top + 5
		await testDb.execute(
			sql`select setval(pg_get_serial_sequence('lorebook_bindings', 'id'), ${shared - 1})`
		)
		await testDb.execute(
			sql`select setval(pg_get_serial_sequence('characters', 'id'), ${shared - 1})`
		)
		const decoy = await member(b.id, decoyCard.id)
		const twin = await card(u.id, "Twin")
		expect(twin.id).toBe(decoy.id)
		const realMember = await member(b.id, twin.id)
		expect(realMember.id).not.toBe(twin.id)
		const s = await session(u.id, b.id)
		await charSeat(s.id, decoyCard.id, decoy.id)
		await charSeat(s.id, twin.id, realMember.id)
		await value(s.id, cardForm(twin.id), "core:slot/twin@1")
		await value(s.id, cardForm(decoyCard.id), "core:slot/decoy@1")

		await seatKeys(asDb())
		const after = await dump()
		const bySlot = Object.fromEntries(
			after.values.map((r) => [r.slotId, ownerOf(r)])
		)
		expect(bySlot["core:slot/twin@1"]).toBe(
			`seated_member:${realMember.id}`
		)
		expect(bySlot["core:slot/decoy@1"]).toBe(`seated_member:${decoy.id}`)
	})

	test("a hard-deleted card, and a member-less departed seat: counted in `left`, rows unchanged", async () => {
		const u = await user()
		const b = await book(u.id)
		const heldNowhere = await card(u.id, "Nowhere")
		const memberless = await card(u.id, "Memberless")
		const s = await session(u.id, b.id)
		await charSeat(s.id, memberless.id, null, departed())
		await value(s.id, cardForm(heldNowhere.id))
		await value(s.id, cardForm(memberless.id), "core:slot/mp@1")
		await sheet(s.id, cardForm(heldNowhere.id))
		await proposal(s.id, {
			owner: cardForm(heldNowhere.id),
			slotId: "core:slot/hp@1",
			value: 3
		})
		const before = await dump()
		const report = await seatKeys(asDb())
		expect(report).toEqual({ ...ZEROS, left: 4 })
		expect(await dump()).toEqual(before)
		// The left rows stay card form until S5, so a second run counts them again and changes nothing.
		expect(await seatKeys(asDb())).toEqual({ ...ZEROS, left: 4 })
		expect(await dump()).toEqual(before)
	})

	test("a proposal's owner is rekeyed, every other key kept; a clock proposal is untouched", async () => {
		const f = await fixture()
		const valueP = await proposal(f.s.id, {
			owner: cardForm(f.hero.id),
			slotId: "core:slot/hp@1",
			value: 7,
			note: "x",
			nested: { a: [1, 2] }
		})
		const listP = await proposal(f.s.id, {
			owner: cardForm(f.persona.id),
			slotId: "core:slot/inv@1",
			op: "add",
			items: ["rope"]
		})
		const clockP = await proposal(f.s.id, {
			kind: "clock",
			by: 2,
			unit: "hour"
		})
		const report = await seatKeys(asDb())
		expect(report.rekeyed.state_proposals).toBe(2)
		const after = await dump()
		const get = (id: number) => after.proposals.find((p) => p.id === id)!
		expect(get(valueP.id).payload).toEqual({
			owner: { kind: "seated_member", id: f.heroMember.id },
			slotId: "core:slot/hp@1",
			value: 7,
			note: "x",
			nested: { a: [1, 2] }
		})
		expect(get(listP.id).payload).toEqual({
			owner: { kind: "player_seat", id: f.ps.id },
			slotId: "core:slot/inv@1",
			op: "add",
			items: ["rope"]
		})
		expect(get(clockP.id).payload).toEqual(clockP.payload)
	})

	test("a second run changes nothing and reports zeros", async () => {
		const f = await fixture()
		for (const o of [cardForm(f.hero.id), cardForm(f.persona.id)]) {
			await value(f.s.id, o)
			await config(f.s.id, o)
			await zone(f.s.id, o)
			await sheet(f.s.id, o)
			await carry(f.s.id, o)
			await proposal(f.s.id, {
				owner: o,
				slotId: "core:slot/hp@1",
				value: 1
			})
		}
		expect((await seatKeys(asDb())).sessions).toBe(1)
		const first = await dump()
		expect(await seatKeys(asDb())).toEqual(ZEROS)
		expect(await dump()).toEqual(first)
	})

	test("one session's failure rolls back that session alone", async () => {
		const good = await fixture()
		const bad = await fixture()
		for (const f of [good, bad]) {
			await value(f.s.id, cardForm(f.hero.id))
			await proposal(f.s.id, {
				owner: cardForm(f.hero.id),
				slotId: "core:slot/hp@1",
				value: 1
			})
		}
		failing.sessionId = bad.s.id
		const spy = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			await expect(seatKeys(asDb())).rejects.toThrow(/1 session/)
			expect(spy).toHaveBeenCalledTimes(1)
		} finally {
			spy.mockRestore()
		}
		const after = await dump()
		const ownersIn = (id: number) =>
			after.values.filter((r) => r.sessionId === id).map(ownerOf)
		// The failing session's column rewrite (done before its proposals threw) was rolled back.
		expect(ownersIn(bad.s.id)).toEqual([`session_cast:${bad.hero.id}`])
		expect(ownersIn(good.s.id)).toEqual([
			`seated_member:${good.heroMember.id}`
		])
		expect(
			after.proposals.find((p) => p.sessionId === bad.s.id)!.payload
		).toMatchObject({ owner: { kind: "session_cast" } })
		expect(
			after.proposals.find((p) => p.sessionId === good.s.id)!.payload
		).toMatchObject({ owner: { kind: "seated_member" } })
	})
})
