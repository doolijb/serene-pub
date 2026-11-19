/**
 * 🚧 `rekeySessionRefs` with `seatMoveTranslator` (`sessions/seatKeys.ts`):
 * a player seat moved to the AI.
 *
 * Claims: items of player seat P become the seated member M in thirteen of the
 * fifteen stores of one session, inside the caller's transaction; a line's
 * stamp (`message_speakers`) and its blocks (`message_blocks`) stay
 * byte-identical; another player seat (`P0` is not `P`), another owner and
 * another session stay as they were; a row meeting a departed seat's row on a
 * unique key wins; a second call changes nothing. The translator moves exactly
 * `player-seat:<id>` and `{ player_seat, id }`.
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
	rekeySessionRefs,
	SEAT_KEY_STORES,
	seatMoveTranslator
} from "./seatKeys"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-seatKeysSeatMove-")
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

describe("seatMoveTranslator (pure)", () => {
	const tr = seatMoveTranslator({ playerSeatId: 12, castMemberId: 99 })

	test("moves exactly player-seat:<id> and the owner player_seat:<id>", () => {
		expect(tr.ref("player-seat:12", "one")).toEqual(["seated-member:99"])
		expect(tr.ref("player-seat:12", "every")).toEqual(["seated-member:99"])
		expect(tr.ref("player-seat:123", "one")).toBeNull()
		expect(tr.ref("player-seat:1", "one")).toBeNull()
		expect(tr.ref("xplayer-seat:12", "one")).toBeNull()
		expect(tr.owner({ kind: "player_seat", id: 12 }, "one")).toEqual([
			{ kind: "seated_member", id: 99 }
		])
		expect(tr.owner({ kind: "player_seat", id: 123 }, "one")).toBeNull()
	})

	test("leaves every other ref and owner alone", () => {
		for (const ref of [
			"seated-member:12",
			"character:12",
			"player_seat:12",
			"user:12",
			"narrator",
			"12"
		])
			expect(tr.ref(ref, "one")).toBeNull()
		expect(tr.owner({ kind: "seated_member", id: 12 }, "one")).toBeNull()
		expect(tr.owner({ kind: "session_cast", id: 12 }, "one")).toBeNull()
	})

	test("the moved row wins on a unique key, and a line's stamp and blocks are left", () => {
		expect(tr.survivor!({ kind: "seated_member", id: 99 })).toBe(12)
		expect(tr.survivor!({ kind: "seated_member", id: 98 })).toBeNull()
		expect(tr.survivor!({ kind: "player_seat", id: 99 })).toBeNull()
		expect(tr.leaves).toEqual(["message_speakers", "message_blocks"])
		expect(tr.ownerKinds).toEqual(["player_seat"])
	})
})

const sm = (id: number) => `seated-member:${id}`
const ps = (id: number) => `player-seat:${id}`
const pown = (id: number) => ({ kind: "player_seat", id })
const mown = (id: number) => ({ kind: "seated_member", id })

async function user() {
	const [row] = await testDb
		.insert(schema.users)
		.values({ username: uniq("seat-move-user") })
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

/** One session holding refs of the moved seat X and of another seat Y (X's id followed by a digit) in every store. */
async function seed(
	u: number,
	b: number,
	X: number,
	Y: number,
	xIsMember = false
) {
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId: u, isGroup: false, name: uniq("Run"), lorebookId: b })
		.returning()
	made.push(s!.id)
	const sessionId = s!.id
	const ownX = xIsMember ? mown(X) : pown(X)
	const refX = xIsMember ? sm(X) : ps(X)
	const owners = [ownX, pown(Y)]

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
		await testDb.insert(schema.attributeCarries).values({
			sessionId,
			ownerKind: o.kind,
			ownerId: o.id,
			slotId: "core:slot/hp@1",
			carries: true
		})
		await testDb.insert(schema.stateProposals).values({
			sessionId,
			kind: "value",
			payload: { kind: "value", owner: o, slotId: "core:slot/hp@1" }
		})
	}
	await testDb.insert(schema.zoneContents).values({
		sessionId,
		ownerKind: "player_seat",
		ownerId: Y,
		rulesetId: "r:ruleset/x@1",
		zoneType: "ties",
		entries: [
			{ entryId: 1, name: "Bond", fields: { towards: refX } },
			{ entryId: 2, name: "Other", fields: { towards: ps(Y) } }
		]
	})
	await testDb
		.insert(schema.attributeSheets)
		.values({ id: "test:sheet/wounds@1" })
		.onConflictDoNothing()
	for (const o of owners)
		await testDb.insert(schema.ownerSheets).values({
			sessionId,
			ownerKind: o.kind,
			ownerId: o.id,
			sheetId: "test:sheet/wounds@1",
			position: 2
		})

	await testDb
		.update(schema.sessions)
		.set({
			turnOrder: {
				v: 1,
				order: [
					{ ref: ps(Y), via: "strategy" },
					{ ref: refX, via: "pick" }
				],
				candidates: [{ ref: refX, kind: "persona", name: "X" }]
			},
			turnTally: {
				v: 1,
				lanes: {
					main: {
						lastSpeaker: refX,
						turnsBy: { [refX]: 2, [ps(Y)]: 1 },
						spoke: [refX, "narrator", ps(Y)],
						persons: [refX, ps(Y)]
					}
				}
			},
			annex: {
				core: {
					"dungeon-crawler-progress": {
						fates: { [refX]: "alive", [ps(Y)]: "dead" }
					}
				}
			},
			annexAudiences: { core: { goals: [refX, ps(Y)] } },
			genreFields: {
				title: "T",
				[`speechAutoVoice:${refX}`]: "amy",
				[`speechAutoVoice:${ps(Y)}`]: "bo"
			}
		} as never)
		.where(eq(schema.sessions.id, sessionId))

	await testDb.insert(schema.widgetSettings).values({
		sessionId,
		userId: u,
		widgetInstanceId: uniq("widget"),
		values: {
			chosenImages: [`${refX}=img-a`, `${ps(Y)}=img-k`],
			pickMembers: [refX, "Some Name", ps(Y)]
		}
	})

	const line = (extra: Partial<typeof schema.sessionMessages.$inferInsert>) =>
		testDb
			.insert(schema.sessionMessages)
			.values({ sessionId, role: "character", content: "hi", ...extra })
	await line({ metadata: { speaker: refX } as never })
	await line({ metadata: { speaker: ps(Y) } as never })
	await line({
		rewindTaken: {
			state: {
				values: [
					{ id: 1, ownerKind: ownX.kind, ownerId: ownX.id },
					{ id: 2, ownerKind: "player_seat", ownerId: Y }
				],
				proposals: [{ payload: { owner: ownX } }]
			},
			turn: { tally: { lanes: { main: { lastSpeaker: refX } } } }
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
					addressee: refX,
					answered: { by: refX },
					actions: []
				},
				{ kind: "choices", addressee: ps(Y), actions: [] }
			]
		}
	})
	await testDb.insert(schema.sessionImprints).values({
		sessionId,
		messageId: mirror!.id,
		subjectKind: "annex",
		subjectKey: "core/dungeon-crawler-progress",
		before: { v: { fates: { [refX]: "dead" } } },
		after: null,
		audienceBefore: [refX, ps(Y)],
		audienceAfter: null
	})
	return sessionId
}

const rows = async (q: ReturnType<typeof sql>) =>
	(await testDb.execute(q)).rows as Record<string, unknown>[]

/** Every touched table of one session as stored text. */
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
		speakers: await rows(
			sql`select id, metadata::text as m from session_messages where session_id = ${sessionId} order by id`
		),
		rewinds: await rows(
			sql`select id, rewind_taken::text as r from session_messages where session_id = ${sessionId} order by id`
		),
		blocks: await rows(
			sql`select p.id, p.data::text as d from message_parts p join messages m on m.id = p.message_id where m.session_id = ${sessionId} order by p.id`
		),
		deltas: await rows(
			sql`select id, before::text as b, after::text as a, audience_before::text as ab, audience_after::text as aa from session_imprints where session_id = ${sessionId} order by id`
		)
	}
}

const run = (sessionId: number, X: number, M: number) =>
	testDb.transaction(async (tx) =>
		rekeySessionRefs(
			tx as unknown as Db,
			sessionId,
			seatMoveTranslator({ playerSeatId: X, castMemberId: M })
		)
	)

async function setup() {
	const u = await user()
	const [b] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: u.id, name: uniq("Book") })
		.returning()
	const M = await member(b!.id)
	return { u, b: b!, M }
}

describe("rekeySessionRefs with a seat move", () => {
	test("moves seat X to member M in thirteen stores, leaves stamp and blocks", async () => {
		const { u, b, M } = await setup()
		const [X, Y] = [7, 70]
		const s = await seed(u.id, b.id, X, Y)
		const other = await seed(u.id, b.id, X, Y)
		const otherBefore = await dump(other)
		const before = await dump(s)

		const tally = await run(s, X, M)

		const moved = SEAT_KEY_STORES.filter((st) => tally.rekeyed[st] > 0)
		expect(moved).toHaveLength(13)
		expect(
			SEAT_KEY_STORES.filter((st) => tally.rekeyed[st] === 0)
		).toEqual(["message_speakers", "message_blocks"])
		expect(tally.left + tally.copied + tally.dropped).toBe(0)

		const after = await dump(s)
		const ownerOf = (r: Record<string, unknown>) =>
			`${r.owner_kind}:${r.owner_id}`
		for (const t of [
			"attribute_values",
			"attribute_configs",
			"zone_contents",
			"owner_sheets",
			"attribute_carries"
		] as const) {
			const held = after[t].map(ownerOf)
			expect(held, t).not.toContain(`player_seat:${X}`)
			expect(held, t).toContain(`seated_member:${M}`)
			expect(held, t).toContain(`player_seat:${Y}`)
		}
		expect(
			after.proposals
				.map((r) => JSON.parse(String(r.p)).owner)
				.filter(Boolean)
		).toEqual([mown(M), pown(Y)])

		const sess = after.session[0]!
		const turnOrder = JSON.parse(String(sess.turn_order))
		const lane = JSON.parse(String(sess.turn_tally)).lanes.main
		expect(turnOrder.order.map((e: { ref: string }) => e.ref)).toEqual([
			ps(Y),
			sm(M)
		])
		expect(
			turnOrder.candidates.map((e: { ref: string }) => e.ref)
		).toEqual([sm(M)])
		expect(lane.lastSpeaker).toBe(sm(M))
		expect(lane.turnsBy).toEqual({ [sm(M)]: 2, [ps(Y)]: 1 })
		expect(lane.spoke).toEqual([sm(M), "narrator", ps(Y)])
		expect(lane.persons).toEqual([sm(M), ps(Y)])
		expect(
			JSON.parse(String(sess.a)).core["dungeon-crawler-progress"].fates
		).toEqual({ [sm(M)]: "alive", [ps(Y)]: "dead" })
		expect(JSON.parse(String(sess.au)).core.goals).toEqual([
			sm(M),
			ps(Y)
		])
		expect(JSON.parse(String(sess.g))).toEqual({
			title: "T",
			[`speechAutoVoice:${sm(M)}`]: "amy",
			[`speechAutoVoice:${ps(Y)}`]: "bo"
		})
		const tie = after.zone_contents.find((r) =>
			String(r.zone_type).startsWith("ties")
		)!
		expect(tie.entries).toEqual([
			{ entryId: 1, name: "Bond", fields: { towards: sm(M) } },
			{ entryId: 2, name: "Other", fields: { towards: ps(Y) } }
		])
		expect(JSON.parse(String(after.widgets[0]!.v))).toEqual({
			chosenImages: [`${sm(M)}=img-a`, `${ps(Y)}=img-k`],
			pickMembers: [sm(M), "Some Name", ps(Y)]
		})
		const taken = JSON.parse(String(after.rewinds[2]!.r))
		expect(taken.state.values).toEqual([
			{ id: 1, ownerKind: "seated_member", ownerId: M },
			{ id: 2, ownerKind: "player_seat", ownerId: Y }
		])
		expect(taken.state.proposals[0].payload.owner).toEqual(mown(M))
		expect(taken.turn.tally.lanes.main.lastSpeaker).toBe(sm(M))
		const d = after.deltas[0]!
		expect(JSON.parse(String(d.b))).toEqual({
			v: { fates: { [sm(M)]: "dead" } }
		})
		expect(JSON.parse(String(d.ab))).toEqual([sm(M), ps(Y)])

		// A line keeps its stamp and its blocks, byte for byte.
		expect(after.speakers).toEqual(before.speakers)
		expect(after.blocks).toEqual(before.blocks)

		const again = await run(s, X, M)
		expect(again.copied + again.dropped + again.left).toBe(0)
		for (const store of SEAT_KEY_STORES)
			expect(again.rekeyed[store], store).toBe(0)
		expect(await dump(s)).toEqual(after)
		expect(await dump(other)).toEqual(otherBefore)
	})

	test("a row of the moved seat wins over a departed seat's row on one unique key", async () => {
		const { u, b, M } = await setup()
		const s = await seed(u.id, b.id, 7, 70)
		// The member's own rows, newer than the seat's.
		await testDb.insert(schema.ownerSheets).values({
			sessionId: s,
			ownerKind: "seated_member",
			ownerId: M,
			sheetId: "test:sheet/wounds@1",
			position: 5,
			createdAt: new Date(9_000)
		})
		await testDb.insert(schema.attributeCarries).values({
			sessionId: s,
			ownerKind: "seated_member",
			ownerId: M,
			slotId: "core:slot/hp@1",
			carries: false,
			createdAt: new Date(9_000)
		})
		await testDb
			.update(schema.ownerSheets)
			.set({ createdAt: new Date(1_000), position: 2 })
			.where(eq(schema.ownerSheets.ownerKind, "player_seat"))

		const tally = await run(s, 7, M)
		expect(tally.dropped).toBe(2)
		const sheets = await testDb
			.select()
			.from(schema.ownerSheets)
			.where(eq(schema.ownerSheets.sessionId, s))
		const held = sheets.filter((r) => r.ownerId === M)
		expect(held).toHaveLength(1)
		expect(held[0]!.position).toBe(2)
		const carries = await testDb
			.select()
			.from(schema.attributeCarries)
			.where(eq(schema.attributeCarries.sessionId, s))
		const carried = carries.filter(
			(r) => r.ownerKind === "seated_member" && r.ownerId === M
		)
		expect(carried).toHaveLength(1)
		expect(carried[0]!.carries).toBe(true)
		expect(
			sheets.filter((r) => r.ownerKind === "player_seat")
		).toHaveLength(1)
	})
})

describe("seatMoveTranslator to a player seat (pure)", () => {
	const tr = seatMoveTranslator({
		playerSeatId: 12,
		castMemberId: 99,
		to: "player"
	})

	test("moves exactly seated-member:<id> and the owner seated_member:<id>", () => {
		expect(tr.ref("seated-member:99", "one")).toEqual(["player-seat:12"])
		expect(tr.ref("seated-member:99", "every")).toEqual(["player-seat:12"])
		expect(tr.ref("seated-member:991", "one")).toBeNull()
		expect(tr.ref("seated-member:9", "one")).toBeNull()
		expect(tr.ref("xseated-member:99", "one")).toBeNull()
		expect(tr.owner({ kind: "seated_member", id: 99 }, "one")).toEqual([
			{ kind: "player_seat", id: 12 }
		])
		expect(tr.owner({ kind: "seated_member", id: 991 }, "one")).toBeNull()
		for (const ref of ["player-seat:99", "character:99", "user:99", "narrator"])
			expect(tr.ref(ref, "one")).toBeNull()
		expect(tr.owner({ kind: "player_seat", id: 99 }, "one")).toBeNull()
	})

	test("the moved row wins on a unique key, a line's stamp and blocks are left, the filters match the quoted ref", () => {
		expect(tr.survivor!({ kind: "player_seat", id: 12 })).toBe(99)
		expect(tr.survivor!({ kind: "player_seat", id: 13 })).toBeNull()
		expect(tr.survivor!({ kind: "seated_member", id: 12 })).toBeNull()
		expect(tr.leaves).toEqual(["message_speakers", "message_blocks"])
		expect(tr.ownerKinds).toEqual(["seated_member"])
		expect(tr.refSql).toBe('"seated-member:99"')
	})

	test("the default is the move to the AI", () => {
		const dflt = seatMoveTranslator({ playerSeatId: 12, castMemberId: 99 })
		expect(dflt.ref("player-seat:12", "one")).toEqual(["seated-member:99"])
		expect(dflt.ownerKinds).toEqual(["player_seat"])
	})
})

describe("rekeySessionRefs with a move to a player seat", () => {
	const runTo = (sessionId: number, P: number, M: number) =>
		testDb.transaction(async (tx) =>
			rekeySessionRefs(
				tx as unknown as Db,
				sessionId,
				seatMoveTranslator({ playerSeatId: P, castMemberId: M, to: "player" })
			)
		)

	test("moves member M to seat P in thirteen stores, leaves stamp and blocks (and a chosen image), a second call changes nothing", async () => {
		const { u, b } = await setup()
		const [M, P, Y] = [99, 7, 70]
		const s = await seed(u.id, b.id, M, Y, true)
		const other = await seed(u.id, b.id, M, Y, true)
		const otherBefore = await dump(other)
		const before = await dump(s)

		const tally = await runTo(s, P, M)

		expect(
			SEAT_KEY_STORES.filter((st) => tally.rekeyed[st] > 0)
		).toHaveLength(13)
		expect(
			SEAT_KEY_STORES.filter((st) => tally.rekeyed[st] === 0)
		).toEqual(["message_speakers", "message_blocks"])
		// `chosenImages` names a character seat's image: its entry for the member stays, counted left.
		expect({
			left: tally.left,
			copied: tally.copied,
			dropped: tally.dropped
		}).toEqual({ left: 1, copied: 0, dropped: 0 })

		const after = await dump(s)
		const ownerOf = (r: Record<string, unknown>) =>
			`${r.owner_kind}:${r.owner_id}`
		const ownerStores = [
			"attribute_values",
			"attribute_configs",
			"zone_contents",
			"owner_sheets",
			"attribute_carries"
		] as const
		for (const t of ownerStores) {
			const held = after[t].map(ownerOf)
			expect(held, t).not.toContain(`seated_member:${M}`)
			expect(held, t).toContain(`player_seat:${P}`)
			expect(held, t).toContain(`player_seat:${Y}`)
		}
		const textStores = ["proposals", "session", "rewinds", "deltas"] as const
		for (const t of textStores) {
			const text = JSON.stringify(after[t])
			expect(text, t).not.toContain(`seated-member:${M}`)
			expect(text, t).not.toContain('seated_member')
			expect(text, t).toMatch(/player[-_]seat/)
		}
		expect(JSON.parse(String(after.widgets[0]!.v))).toEqual({
			chosenImages: [`${sm(M)}=img-a`, `${ps(Y)}=img-k`],
			pickMembers: [ps(P), "Some Name", ps(Y)]
		})
		const turnOrder = JSON.parse(String(after.session[0]!.turn_order))
		expect(turnOrder.order.map((e: { ref: string }) => e.ref)).toEqual([
			ps(Y),
			ps(P)
		])
		const tie = after.zone_contents.find((r) =>
			String(r.zone_type).startsWith("ties")
		)!
		expect(tie.entries).toEqual([
			{ entryId: 1, name: "Bond", fields: { towards: ps(P) } },
			{ entryId: 2, name: "Other", fields: { towards: ps(Y) } }
		])

		expect(after.speakers).toEqual(before.speakers)
		expect(after.blocks).toEqual(before.blocks)

		const again = await runTo(s, P, M)
		expect(again.copied + again.dropped).toBe(0)
		for (const store of SEAT_KEY_STORES)
			expect(again.rekeyed[store], store).toBe(0)
		expect(await dump(s)).toEqual(after)
		expect(await dump(other)).toEqual(otherBefore)
	})

	test("a row of the moved member wins over a departed player seat's row on one unique key", async () => {
		const { u, b } = await setup()
		const [M, P] = [99, 7]
		const s = await seed(u.id, b.id, M, 70, true)
		await testDb.insert(schema.ownerSheets).values({
			sessionId: s,
			ownerKind: "player_seat",
			ownerId: P,
			sheetId: "test:sheet/wounds@1",
			position: 5,
			createdAt: new Date(9_000)
		})
		await testDb
			.update(schema.ownerSheets)
			.set({ createdAt: new Date(1_000), position: 2 })
			.where(eq(schema.ownerSheets.ownerKind, "seated_member"))

		const tally = await runTo(s, P, M)
		expect(tally.dropped).toBeGreaterThanOrEqual(1)
		const sheets = (
			await testDb
				.select()
				.from(schema.ownerSheets)
				.where(eq(schema.ownerSheets.sessionId, s))
		).filter((r) => r.ownerKind === "player_seat" && r.ownerId === P)
		expect(sheets).toHaveLength(1)
		expect(sheets[0]!.position).toBe(2)
	})
})
