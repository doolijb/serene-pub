/**
 * 🚧 `rekeySessionRefs` with `memberMoveTranslator` (`sessions/seatKeys.ts`,
 * the fold's one traversal).
 *
 * Claims: member-form items naming moved members M and N become M2 in all
 * fifteen stores of one session, inside the caller's transaction; an unrelated
 * member K, a player seat and a card-form item stay byte-identical; two rows
 * landing on one unique key keep the newest; a second call changes nothing; a
 * second session's rows are untouched. The translator moves exactly
 * `seated-member:<id>` (no prefix match) and nothing else.
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
import { eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	memberMoveTranslator,
	rekeySessionRefs,
	SEAT_KEY_STORES
} from "./seatKeys"

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
		path.join(os.tmpdir(), "serene-pub-vitest-seatKeysMemberMove-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`
const made: number[] = []

afterEach(async () => {
	if (made.length)
		await testDb
			.delete(schema.sessions)
			.where(inArray(schema.sessions.id, made))
	made.length = 0
})

describe("memberMoveTranslator (pure)", () => {
	const tr = memberMoveTranslator(new Map([[12, 99]]))

	test("moves exactly seated-member:<id> of a moved member", () => {
		expect(tr.ref("seated-member:12", "one")).toEqual(["seated-member:99"])
		expect(tr.ref("seated-member:12", "every")).toEqual([
			"seated-member:99"
		])
		expect(tr.ref("seated-member:123", "one")).toBeNull()
		expect(tr.ref("seated-member:1", "one")).toBeNull()
		expect(tr.ref("xseated-member:12", "one")).toBeNull()
	})

	test("leaves every other ref and owner alone", () => {
		for (const ref of [
			"player-seat:12",
			"character:12",
			"seated_member:12",
			"user:12",
			"narrator",
			"12"
		])
			expect(tr.ref(ref, "one")).toBeNull()
		expect(tr.owner({ kind: "seated_member", id: 12 }, "one")).toEqual([
			{ kind: "seated_member", id: 99 }
		])
		expect(tr.owner({ kind: "seated_member", id: 13 }, "one")).toBeNull()
		expect(tr.owner({ kind: "player_seat", id: 12 }, "one")).toBeNull()
		expect(tr.owner({ kind: "session_cast", id: 12 }, "one")).toBeNull()
	})
})

const sm = (id: number) => `seated-member:${id}`
const own = (id: number) => ({ kind: "seated_member", id })
const PLAYER = { kind: "player_seat", id: 7 }
const CARD = { kind: "session_cast", id: 5 }

async function user() {
	const [row] = await testDb
		.insert(schema.users)
		.values({ username: uniq("member-move-user") })
		.returning()
	return row!
}
async function member(lorebookId: number) {
	const [row] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId, binding: uniq("{{char:x}}"), name: "" })
		.returning()
	return row!.id
}

/** One session holding member-form refs of M, N, K, a player seat and a card in every store. */
async function seed(u: number, b: number, M: number, N: number, K: number) {
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId: u, isGroup: false, name: uniq("Run"), lorebookId: b })
		.returning()
	made.push(s!.id)
	const sessionId = s!.id
	const owners = [own(M), own(N), own(K), PLAYER, CARD]

	for (const [i, o] of owners.entries()) {
		await testDb.insert(schema.attributeValues).values({
			sessionId,
			ownerKind: o.kind,
			ownerId: o.id,
			slotId: "core:slot/hp@1",
			value: { v: i },
			updatedBy: "user:1"
		})
		await testDb.insert(schema.attributeConfigs).values({
			sessionId,
			ownerKind: o.kind,
			ownerId: o.id,
			slotId: "core:slot/hp@1",
			config: { max: 40 + i }
		})
		await testDb.insert(schema.zoneContents).values({
			sessionId,
			ownerKind: o.kind,
			ownerId: o.id,
			rulesetId: "r:ruleset/x@1",
			zoneType: "hand",
			entries: [{ entryId: i, name: "Ace" }]
		})
	}
	// A tie's other end, held by K.
	await testDb.insert(schema.zoneContents).values({
		sessionId,
		ownerKind: "seated_member",
		ownerId: K,
		rulesetId: "r:ruleset/x@1",
		zoneType: "ties",
		entries: [
			{ entryId: 1, name: "Bond", fields: { towards: sm(M) } },
			{ entryId: 2, name: "Keep", fields: { towards: sm(K) } },
			{ entryId: 3, name: "Card", fields: { towards: "character:5" } }
		]
	})
	await testDb
		.insert(schema.attributeSheets)
		.values({ id: "test:sheet/wounds@1" })
		.onConflictDoNothing()
	const sheetAt = (o: { kind: string; id: number }, at: number) =>
		testDb.insert(schema.ownerSheets).values({
			sessionId,
			ownerKind: o.kind,
			ownerId: o.id,
			sheetId: "test:sheet/wounds@1",
			position: 2,
			createdAt: new Date(at)
		})
	await sheetAt(own(M), 1_000)
	await sheetAt(own(N), 2_000)
	await sheetAt(own(K), 3_000)
	await sheetAt(PLAYER, 4_000)
	await sheetAt(CARD, 5_000)
	const carryAt = (o: { kind: string; id: number }, at: number, v: boolean) =>
		testDb.insert(schema.attributeCarries).values({
			sessionId,
			ownerKind: o.kind,
			ownerId: o.id,
			slotId: "core:slot/hp@1",
			carries: v,
			createdAt: new Date(at)
		})
	await carryAt(own(M), 1_000, true)
	await carryAt(own(N), 2_000, false)
	await carryAt(own(K), 3_000, true)
	await carryAt(PLAYER, 4_000, true)
	await carryAt(CARD, 5_000, true)

	for (const o of owners)
		await testDb.insert(schema.stateProposals).values({
			sessionId,
			kind: "value",
			payload: { kind: "value", owner: o, slotId: "core:slot/hp@1" }
		})
	await testDb.insert(schema.stateProposals).values({
		sessionId,
		kind: "clock",
		payload: { kind: "clock", at: 1 }
	})

	await testDb
		.update(schema.sessions)
		.set({
			turnOrder: {
				v: 1,
				order: [
					{ ref: sm(M), via: "strategy" },
					{ ref: sm(K), via: "pick" },
					{ ref: "player-seat:7", via: "pick" },
					{ ref: "character:5", via: "pick" }
				],
				candidates: [
					{ ref: sm(N), kind: "character", name: "N" },
					{ ref: sm(K), kind: "character", name: "K" }
				]
			},
			turnTally: {
				v: 1,
				lanes: {
					main: {
						lastSpeaker: sm(N),
						turnsBy: { [sm(M)]: 2, [sm(N)]: 3, [sm(K)]: 1 },
						spoke: [sm(M), "narrator", sm(K)],
						persons: [sm(N)]
					}
				}
			},
			annex: {
				core: {
					"dungeon-crawler-progress": {
						fates: {
							[sm(M)]: "alive",
							[sm(K)]: "dead",
							"character:5": "x"
						}
					}
				}
			},
			annexAudiences: {
				core: { goals: [sm(M), sm(N), sm(K), "player-seat:7"] }
			},
			genreFields: {
				title: "T",
				[`speechAutoVoice:${sm(M)}`]: "amy",
				[`speechAutoVoice:${sm(K)}`]: "bo"
			}
		} as never)
		.where(eq(schema.sessions.id, sessionId))

	await testDb.insert(schema.widgetSettings).values({
		sessionId,
		userId: u,
		widgetInstanceId: uniq("widget"),
		values: {
			chosenImages: [`${sm(M)}=img-a`, `${sm(K)}=img-k`],
			pickMembers: [sm(M), "Some Name", sm(K)]
		}
	})

	const line = (extra: Partial<typeof schema.sessionMessages.$inferInsert>) =>
		testDb
			.insert(schema.sessionMessages)
			.values({ sessionId, role: "character", content: "hi", ...extra })
	await line({ metadata: { speaker: sm(M) } as never })
	await line({ metadata: { speaker: sm(K) } as never })
	await line({
		rewindTaken: {
			state: {
				values: [
					{ id: 1, ownerKind: "seated_member", ownerId: M },
					{ id: 2, ownerKind: "seated_member", ownerId: K },
					{ id: 3, ownerKind: "player_seat", ownerId: 7 }
				],
				proposals: [{ payload: { owner: own(N) } }]
			},
			turn: { tally: { lanes: { main: { lastSpeaker: sm(M) } } } }
		} as never
	})

	const [mirror] = await testDb
		.insert(schema.messages)
		.values({ sessionId, role: "character" })
		.returning()
	await testDb.insert(schema.messageParts).values({
		messageId: mirror!.id,
		type: "core:blocks",
		data: {
			blocks: [
				{
					kind: "choices",
					addressee: sm(N),
					answered: { by: sm(M) },
					actions: []
				},
				{ kind: "choices", addressee: sm(K), actions: [] }
			]
		}
	})
	await testDb.insert(schema.sessionImprints).values({
		sessionId,
		messageId: mirror!.id,
		subjectKind: "annex",
		subjectKey: "core/dungeon-crawler-progress",
		before: { v: { fates: { [sm(M)]: "dead" } } },
		after: null,
		audienceBefore: [sm(M), sm(K)],
		audienceAfter: null
	})
	return sessionId
}

const rows = async (q: ReturnType<typeof sql>) =>
	(await testDb.execute(q)).rows as Record<string, unknown>[]

/** Every touched table of one session as stored text, owner-column rows by owner. */
async function dump(sessionId: number) {
	const byOwner = async (table: string) =>
		rows(
			sql`select * from ${sql.raw(table)} where session_id = ${sessionId} order by owner_kind, owner_id, id`
		)
	return {
		attribute_values: await byOwner("attribute_values"),
		attribute_configs: await byOwner("attribute_configs"),
		zone_contents: await byOwner("zone_contents"),
		owner_sheets: await byOwner("owner_sheets"),
		attribute_carries: await byOwner("attribute_carries"),
		proposals: await rows(
			sql`select id, payload::text as p from state_proposals where session_id = ${sessionId} order by id`
		),
		session: await rows(
			sql`select annex::text as a, turn_order::text as turn_order, turn_tally::text as turn_tally, annex_audiences::text as au, genre_fields::text as g, updated_at::text as u from sessions where id = ${sessionId}`
		),
		widgets: await rows(
			sql`select id, "values"::text as v, updated_at::text as u from widget_settings where session_id = ${sessionId} order by id`
		),
		lines: await rows(
			sql`select id, metadata::text as m, rewind_taken::text as r, updated_at::text as u from session_messages where session_id = ${sessionId} order by id`
		),
		parts: await rows(
			sql`select p.id, p.data::text as d from message_parts p join messages m on m.id = p.message_id where m.session_id = ${sessionId} order by p.id`
		),
		deltas: await rows(
			sql`select id, before::text as b, after::text as a, audience_before::text as ab, audience_after::text as aa from session_imprints where session_id = ${sessionId} order by id`
		)
	}
}

const run = (sessionId: number, moves: Map<number, number>) =>
	testDb.transaction(async (tx) =>
		rekeySessionRefs(
			tx as unknown as Db,
			sessionId,
			memberMoveTranslator(moves)
		)
	)

describe("rekeySessionRefs with a member move", () => {
	test("moves M and N to M2 in all fifteen stores, nothing else", async () => {
		const u = await user()
		const [b] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: uniq("Book") })
			.returning()
		const [M, N, K, M2] = [
			await member(b!.id),
			await member(b!.id),
			await member(b!.id),
			await member(b!.id)
		] as [number, number, number, number]
		const s = await seed(u.id, b!.id, M, N, K)
		const other = await seed(u.id, b!.id, M, N, K)
		const otherBefore = await dump(other)

		const moves = new Map([
			[M, M2],
			[N, M2]
		])
		const tally = await run(s, moves)

		for (const store of SEAT_KEY_STORES)
			expect(tally.rekeyed[store], store).toBeGreaterThan(0)
		expect(tally.left).toBe(0)
		expect(tally.copied).toBe(0)
		// owner_sheets and attribute_carries: M and N collide on one key.
		expect(tally.dropped).toBe(2)

		const after = await dump(s)
		const ownerOf = (r: Record<string, unknown>) =>
			`${r.owner_kind}:${r.owner_id}`
		for (const t of [
			"attribute_values",
			"attribute_configs",
			"zone_contents"
		] as const) {
			const held = after[t].map(ownerOf)
			expect(held).not.toContain(`seated_member:${M}`)
			expect(held).not.toContain(`seated_member:${N}`)
			expect(
				held.filter((o) => o === `seated_member:${M2}`)
			).toHaveLength(2)
			for (const keep of [
				`seated_member:${K}`,
				"player_seat:7",
				"session_cast:5"
			])
				expect(held).toContain(keep)
		}

		// Unique keys: the newest (N's) row survives under M2.
		for (const t of [schema.ownerSheets, schema.attributeCarries]) {
			const all = await testDb.select().from(t).where(eq(t.sessionId, s))
			const held = all.filter(
				(r) => r.ownerKind === "seated_member" && r.ownerId === M2
			)
			expect(held).toHaveLength(1)
			expect(held[0]!.createdAt.getTime()).toBe(2_000)
			expect(all).toHaveLength(4)
		}
		const carried = await testDb
			.select()
			.from(schema.attributeCarries)
			.where(eq(schema.attributeCarries.ownerId, M2))
		expect(
			carried.find(
				(r) => r.sessionId === s && r.ownerKind === "seated_member"
			)!.carries
		).toBe(false)

		const proposals = after.proposals
			.filter((r) => !String(r.p).includes('"clock"'))
			.map((r) => JSON.parse(String(r.p)).owner)
		expect(proposals).toEqual([own(M2), own(M2), own(K), PLAYER, CARD])

		const sess = after.session[0]!
		const annex = JSON.parse(String(sess.a)).core
		const turnOrder = JSON.parse(String(sess.turn_order))
		const turnTally = JSON.parse(String(sess.turn_tally))
		expect(
			turnOrder.order.map((e: { ref: string }) => e.ref)
		).toEqual([sm(M2), sm(K), "player-seat:7", "character:5"])
		expect(
			turnOrder.candidates.map((e: { ref: string }) => e.ref)
		).toEqual([sm(M2), sm(K)])
		const lane = turnTally.lanes.main
		expect(lane.lastSpeaker).toBe(sm(M2))
		expect(lane.turnsBy).toEqual({ [sm(M2)]: 5, [sm(K)]: 1 })
		expect(lane.spoke).toEqual([sm(M2), "narrator", sm(K)])
		expect(lane.persons).toEqual([sm(M2)])
		expect(annex["dungeon-crawler-progress"].fates).toEqual({
			[sm(M2)]: "alive",
			[sm(K)]: "dead",
			"character:5": "x"
		})
		expect(JSON.parse(String(sess.au)).core.goals).toEqual([
			sm(M2),
			sm(K),
			"player-seat:7"
		])
		expect(JSON.parse(String(sess.g))).toEqual({
			title: "T",
			[`speechAutoVoice:${sm(M2)}`]: "amy",
			[`speechAutoVoice:${sm(K)}`]: "bo"
		})
		// Raw JSON writes do not move updated_at.
		expect(sess.u).toBe((await dump(s)).session[0]!.u)

		const zones = after.zone_contents.filter((r) =>
			String(r.zone_type).startsWith("ties")
		)
		expect(zones[0]!.entries).toEqual([
			{ entryId: 1, name: "Bond", fields: { towards: sm(M2) } },
			{ entryId: 2, name: "Keep", fields: { towards: sm(K) } },
			{ entryId: 3, name: "Card", fields: { towards: "character:5" } }
		])

		expect(JSON.parse(String(after.widgets[0]!.v))).toEqual({
			chosenImages: [`${sm(M2)}=img-a`, `${sm(K)}=img-k`],
			pickMembers: [sm(M2), "Some Name", sm(K)]
		})
		const [l1, l2, l3] = after.lines
		expect(JSON.parse(String(l1!.m)).speaker).toBe(sm(M2))
		expect(JSON.parse(String(l2!.m)).speaker).toBe(sm(K))
		const taken = JSON.parse(String(l3!.r))
		expect(taken.state.values).toEqual([
			{ id: 1, ownerKind: "seated_member", ownerId: M2 },
			{ id: 2, ownerKind: "seated_member", ownerId: K },
			{ id: 3, ownerKind: "player_seat", ownerId: 7 }
		])
		expect(taken.state.proposals[0].payload.owner).toEqual(own(M2))
		expect(taken.turn.tally.lanes.main.lastSpeaker).toBe(sm(M2))
		const blocks = JSON.parse(String(after.parts[0]!.d)).blocks
		expect(blocks[0].addressee).toBe(sm(M2))
		expect(blocks[0].answered.by).toBe(sm(M2))
		expect(blocks[1].addressee).toBe(sm(K))
		const d = after.deltas[0]!
		expect(JSON.parse(String(d.b))).toEqual({
			v: { fates: { [sm(M2)]: "dead" } }
		})
		expect(JSON.parse(String(d.ab))).toEqual([sm(M2), sm(K)])
		expect(d.a).toBeNull()
		expect(d.aa).toBeNull()

		// A second call changes nothing; the other session never moved.
		const again = await run(s, moves)
		expect(again.copied + again.dropped + again.left).toBe(0)
		for (const store of SEAT_KEY_STORES)
			expect(again.rekeyed[store], store).toBe(0)
		expect(await dump(s)).toEqual(after)
		expect(await dump(other)).toEqual(otherBefore)
	})
})
