/**
 * 🚧 The `seat-keys` gate tests (plan §34.5, S4): the paths a user's data
 * really takes to the flip, each proving the pass safe.
 *
 * Claims, one test each:
 *  1. A turn taken **Back** before the pass, the pass, **Forward**, **Back**
 *     again: what Forward puts back is in member form with its ids kept, and
 *     the record the second Back writes is member form too.
 *  2. One session's failure — thrown after its column stores ran, from a JSON
 *     step — rolls that session back alone, JSON stores included.
 *  3. The second boot over everything at once: card form in every store the
 *     pass names, a card in a character seat and a player seat (★K-2), a
 *     merged pair, card ids that equal other people's member ids — the first
 *     run rekeys every store, the second changes nothing in any touched table
 *     or JSON column, and no row or ref names the decoy member.
 *  4. A database loaded from a pre-flip backup (PGlite's own data-dir dump,
 *     into a fresh PGlite) is rekeyed exactly as the original is.
 *
 * The attic upgrade → boot passes claim lives in `seatKeys.attic.int.test.ts`
 * (the fixture harness owns the database module there).
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
import { drizzle } from "drizzle-orm/pglite"
import { PGlite } from "@electric-sql/pglite"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { guardTransactions } from "$lib/server/db/transactionGuard"
import { memberFormSwitch } from "$lib/server/state/memberForm"
import { annexImprintKey, fileSessionImprint } from "$lib/server/sessions/sessionImprints"
import { seatKeys, SEAT_KEY_STORES } from "./seatKeys"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "seat-keys-gate-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

/** Test 2's switch: the translator throws for one session, and counts what the column stores asked first. */
const failing = vi.hoisted(() => ({
	sessionId: -1,
	targetsCalls: 0,
	ofCalls: 0
}))
vi.mock("$lib/server/state/seatRefs", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/state/seatRefs")>()
	return {
		...actual,
		memberFormTargetsOf: (map: { sessionId: number }, input: unknown) => {
			if (map.sessionId === failing.sessionId) failing.targetsCalls++
			return (
				actual.memberFormTargetsOf as (
					m: unknown,
					i: unknown
				) => unknown
			)(map, input)
		},
		memberFormOf: (map: { sessionId: number }, input: unknown) => {
			if (map.sessionId === failing.sessionId) {
				failing.ofCalls++
				throw new Error("boom")
			}
			return (actual.memberFormOf as (m: unknown, i: unknown) => unknown)(
				map,
				input
			)
		}
	}
})

let testDb: TestDb
let dataDir: string
let ownerId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-seatKeysGate-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as unknown as Db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(testDb, "seat-keys-gate-owner")).id
}, 120_000)

afterAll(async () => {
	memberFormSwitch.on = false
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`
const asDb = () => testDb as unknown as Db
const made: number[] = []

// Sessions of a test go with it (state rows cascade), so reports stay per test.
afterEach(async () => {
	failing.sessionId = -1
	failing.targetsCalls = 0
	failing.ofCalls = 0
	memberFormSwitch.on = false
	if (made.length)
		await testDb
			.delete(schema.sessions)
			.where(inArray(schema.sessions.id, made))
	made.length = 0
})

// ─── seeding ─────────────────────────────────────────────────────────────────

async function card(name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId: ownerId, name: uniq(name), description: "" })
		.returning()
	return row!
}
async function book() {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: uniq("Book") })
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
async function session(
	lorebookId: number,
	extra: Partial<typeof schema.sessions.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: true,
			name: uniq("Run"),
			lorebookId,
			...extra
		})
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

const cr = (id: number) => `character:${id}`
const sm = (id: number) => `seated-member:${id}`
const pseat = (id: number) => `player-seat:${id}`
type Owner = { kind: string; id: number }
const cardForm = (id: number): Owner => ({ kind: "session_cast", id })

async function value(
	sessionId: number,
	o: Owner,
	extra: Partial<typeof schema.attributeValues.$inferInsert> = {},
	slotId = "core:slot/hp@1"
) {
	const [row] = await testDb
		.insert(schema.attributeValues)
		.values({
			sessionId,
			ownerKind: o.kind,
			ownerId: o.id,
			slotId,
			value: { v: 12 },
			note: "n",
			updatedBy: "user:1",
			stateVersion: 3,
			...extra
		})
		.returning()
	return row!
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
async function zone(
	sessionId: number,
	o: Owner,
	zoneType: string,
	entries: unknown[],
	extra: Partial<typeof schema.zoneContents.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.zoneContents)
		.values({
			sessionId,
			ownerKind: o.kind,
			ownerId: o.id,
			rulesetId: "r:ruleset/x@1",
			zoneType,
			entries: entries as never,
			...extra
		})
		.returning()
	return row!
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
	await testDb.insert(schema.ownerSheets).values({
		sessionId,
		ownerKind: o.kind,
		ownerId: o.id,
		sheetId,
		position: 2,
		...(createdAt ? { createdAt } : {})
	})
}
async function carry(
	sessionId: number,
	o: Owner,
	carries = true,
	createdAt?: Date
) {
	await testDb.insert(schema.attributeCarries).values({
		sessionId,
		ownerKind: o.kind,
		ownerId: o.id,
		slotId: "core:slot/hp@1",
		carries,
		...(createdAt ? { createdAt } : {})
	})
}
async function proposal(
	sessionId: number,
	payload: Record<string, unknown>,
	extra: Partial<typeof schema.stateProposals.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.stateProposals)
		.values({
			sessionId,
			kind: payload.kind === "clock" ? "clock" : "value",
			payload,
			...extra
		})
		.returning()
	return row!
}
async function widgetRow(sessionId: number, values: Record<string, unknown>) {
	await testDb.insert(schema.widgetSettings).values({
		sessionId,
		userId: ownerId,
		widgetInstanceId: uniq("widget"),
		values
	})
}
async function line(
	sessionId: number,
	extra: Partial<typeof schema.sessionMessages.$inferInsert>
) {
	const [row] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "character", content: "hi", ...extra })
		.returning()
	return row!
}
async function mirror(sessionId: number) {
	const [row] = await testDb
		.insert(schema.messages)
		.values({ sessionId, role: "character" })
		.returning()
	return row!
}
async function blocksPart(messageId: number, data: Record<string, unknown>) {
	await testDb
		.insert(schema.messageParts)
		.values({ messageId, type: "core:blocks", data })
}
/** One `annex` session imprint (values wrapped; absent = SQL NULL). */
async function imprint(
	sessionId: number,
	messageId: number,
	key: string,
	side: {
		before?: unknown
		after?: unknown
		audienceBefore?: string[] | null
		audienceAfter?: string[] | null
	}
) {
	await testDb.insert(schema.sessionImprints).values({
		sessionId,
		messageId,
		subjectKind: "annex",
		subjectKey: key,
		before: side.before === undefined ? null : { v: side.before },
		after: side.after === undefined ? null : { v: side.after },
		audienceBefore: side.audienceBefore ?? null,
		audienceAfter: side.audienceAfter ?? null
	})
}
async function setSession(id: number, set: Record<string, unknown>) {
	await testDb
		.update(schema.sessions)
		.set(set as never)
		.where(inArray(schema.sessions.id, [id]))
}

const REKEYED_ZERO = Object.fromEntries(
	SEAT_KEY_STORES.map((s) => [s, 0])
) as Record<(typeof SEAT_KEY_STORES)[number], number>
const ZEROS = {
	sessions: 0,
	rekeyed: REKEYED_ZERO,
	copied: 0,
	dropped: 0,
	left: 0,
	failed: 0
}

/** Every table the pass can touch, whole rows (so every JSON column and `updated_at`), by id. */
const TOUCHED = [
	"attribute_values",
	"attribute_configs",
	"zone_contents",
	"owner_sheets",
	"attribute_carries",
	"state_proposals",
	"sessions",
	"widget_settings",
	"session_messages",
	"message_parts",
	"session_imprints"
] as const
async function snapshot(
	h: { execute: TestDb["execute"] },
	where = ""
): Promise<Record<string, string[]>> {
	const out: Record<string, string[]> = {}
	for (const t of TOUCHED) {
		const rs = await h.execute(
			sql.raw(
				`select to_jsonb(t)::text as j from ${t} t ${where.replaceAll("{t}", t)} order by id`
			)
		)
		out[t] = (rs.rows as { j: string }[]).map((r) => r.j)
	}
	return out
}

// ─── 1. Back before the pass → pass → Forward → Back ────────────────────────

describe("Back before the pass, the pass, Forward, Back again", () => {
	test("what Forward puts back and what the second Back writes are member form; ids kept; second run all zeros", async () => {
		const hero = await card("Hero")
		const persona = await card("Persona")
		const b = await book()
		const heroMember = await member(b.id, hero.id)
		const personaMember = await member(b.id, persona.id)
		const turnTally = {
			v: 1,
			lanes: {
				main: {
					turn: 2,
					lastMessageId: 0,
					lastSpeaker: cr(hero.id),
					turnsBy: { [cr(hero.id)]: 1 },
					spoke: [cr(hero.id)],
					persons: [cr(persona.id)]
				}
			}
		}
		const s = await session(b.id, { turnTally: turnTally as never })
		const cs = await charSeat(s.id, hero.id, heroMember.id)
		const ps = await playerSeat(s.id, persona.id, personaMember.id)

		// The turn: the owner's line and the hero's reply (rows written straight, as rewind.int.test.ts's group tests do).
		const { insertLegacy } = await import("$lib/server/messages/store")
		const mine = await insertLegacy(asDb(), {
			sessionId: s.id,
			role: "user",
			userId: ownerId,
			characterId: null,
			content: "Hello."
		} as never)
		const reply = await insertLegacy(asDb(), {
			sessionId: s.id,
			role: "assistant",
			userId: ownerId,
			characterId: hero.id,
			content: "Hero nods."
		} as never)

		// State anchored to the newest turn (the reply), all in card form (the flip is off).
		const anchored = await value(s.id, cardForm(hero.id), {
			validFromMessageId: reply.id
		})
		const zoneRow = await zone(
			s.id,
			cardForm(hero.id),
			"ties",
			[
				{
					entryId: 1,
					name: "Bond",
					fields: { towards: cr(persona.id), note: "x" }
				},
				{ entryId: 2, name: "Tie", fields: { towards: cr(hero.id) } }
			],
			{ validFromMessageId: reply.id }
		)
		const prop = await proposal(
			s.id,
			{
				owner: cardForm(hero.id),
				slotId: "core:slot/hp@1",
				value: 9
			},
			{ messageId: reply.id }
		)
		// An annex write, as the host leaves it: the key moved, one imprint anchored to the reply.
		const PROGRESS = "dungeon-crawler-progress"
		const progress = (fate: string) => ({
			fates: { [cr(hero.id)]: fate, "user:1": { made: true } }
		})
		const see = [cr(hero.id), "user:2"]
		await testDb.transaction(async (tx) => {
			await tx
				.update(schema.sessions)
				.set({
					annex: { core: { [PROGRESS]: progress("dead") } } as never,
					annexAudiences: { core: { [PROGRESS]: see } } as never
				})
				.where(inArray(schema.sessions.id, [s.id]))
			await fileSessionImprint(
				tx as unknown as Db,
				{ sessionId: s.id, messageId: reply.id, runId: null },
				{ kind: "annex", key: annexImprintKey("core", PROGRESS) },
				progress("alive"),
				progress("dead"),
				{ ownerVersion: null, audienceBefore: see, audienceAfter: see }
			)
		})
		const deltaId = (await testDb.select().from(schema.sessionImprints)).find(
			(d) => d.sessionId === s.id
		)!.id

		// Back, before the pass: the record holds card form.
		const { rewindTurn, forwardTurn } = await import(
			"$lib/server/sessions/rewind"
		)
		const back1 = await rewindTurn(asDb(), {
			sessionId: s.id,
			userId: ownerId
		})
		expect(back1).toMatchObject({ ok: true })
		const takenOf = async (id: number) =>
			(
				await testDb
					.select({ t: schema.sessionMessages.rewindTaken })
					.from(schema.sessionMessages)
					.where(inArray(schema.sessionMessages.id, [id]))
			)[0]!.t as any
		const rec1 = await takenOf(reply.id)
		expect(rec1.state.values).toHaveLength(1)
		expect(rec1.state.values[0]).toMatchObject({
			id: anchored.id,
			ownerKind: "session_cast",
			ownerId: hero.id
		})
		expect(rec1.state.zones[0].ownerKind).toBe("session_cast")
		expect(rec1.state.zones[0].entries[0].fields.towards).toBe(
			cr(persona.id)
		)
		expect(rec1.state.proposals[0].payload.owner.kind).toBe("session_cast")
		expect(rec1.state.sessionImprints).toHaveLength(1)
		expect(
			JSON.stringify(rec1.state.sessionImprints[0].imprint.before)
		).toContain(cr(hero.id))
		expect(rec1.state.sessionImprints[0].imprint.id).toBe(deltaId)
		// Live rows are gone (taken); the live annex now holds the imprint's `before`, card form.
		expect(
			(await testDb.select().from(schema.attributeValues)).filter(
				(r) => r.sessionId === s.id
			)
		).toHaveLength(0)

		// The pass.
		const first = await seatKeys(asDb())
		expect(first.failed).toBe(0)
		// The person's line holds the turn's tally, the reply's the state: two records.
		expect(first.rekeyed.rewind_taken).toBe(2)
		expect(first.rekeyed.annex_core).toBeGreaterThan(0)
		expect(first.rekeyed.annex_audiences).toBeGreaterThan(0)
		expect(first.left).toBe(0)
		const rec2 = await takenOf(reply.id)
		expect(rec2.state.values[0]).toMatchObject({
			id: anchored.id,
			ownerKind: "seated_member",
			ownerId: heroMember.id
		})
		expect(rec2.state.zones[0].id).toBe(zoneRow.id)
		expect(rec2.state.zones[0].ownerKind).toBe("seated_member")
		expect(rec2.state.zones[0].ownerId).toBe(heroMember.id)
		expect(rec2.state.zones[0].entries[0].fields.towards).toBe(pseat(ps.id))
		expect(rec2.state.zones[0].entries[1].fields.towards).toBe(
			sm(heroMember.id)
		)
		expect(rec2.state.proposals[0].id).toBe(prop.id)
		expect(rec2.state.proposals[0].payload.owner).toEqual({
			kind: "seated_member",
			id: heroMember.id
		})
		const dRow = rec2.state.sessionImprints[0].imprint
		expect(dRow.id).toBe(deltaId)
		expect(dRow.audienceBefore).toEqual([sm(heroMember.id), "user:2"])
		expect(dRow.before.v.fates).toEqual({
			[sm(heroMember.id)]: "alive",
			"user:1": { made: true }
		})
		expect(dRow.after.v.fates).toEqual({
			[sm(heroMember.id)]: "dead",
			"user:1": { made: true }
		})
		expect(JSON.stringify(rec2)).not.toContain("session_cast")
		expect(JSON.stringify(rec2)).not.toContain(cr(hero.id))
		expect(JSON.stringify(rec2)).not.toContain(cr(persona.id))
		// The live annex (the imprint's `before` Back landed) is member form too.
		const liveAnnex = (
			await testDb
				.select({
					a: schema.sessions.annex,
					au: schema.sessions.annexAudiences
				})
				.from(schema.sessions)
				.where(inArray(schema.sessions.id, [s.id]))
		)[0]!
		expect(JSON.stringify(liveAnnex)).not.toContain(cr(hero.id))

		// Forward, the flip on: the restored rows are member form, ids kept.
		memberFormSwitch.on = true
		const fwd = await forwardTurn(asDb(), {
			sessionId: s.id,
			userId: ownerId
		})
		expect(fwd).toMatchObject({ ok: true })
		const values = (
			await testDb.select().from(schema.attributeValues)
		).filter((r) => r.sessionId === s.id)
		expect(values.map((r) => [r.id, r.ownerKind, r.ownerId])).toEqual([
			[anchored.id, "seated_member", heroMember.id]
		])
		const zones = (await testDb.select().from(schema.zoneContents)).filter(
			(r) => r.sessionId === s.id
		)
		expect(zones.map((r) => [r.id, r.ownerKind, r.ownerId])).toEqual([
			[zoneRow.id, "seated_member", heroMember.id]
		])
		expect((zones[0]!.entries as any)[0].fields.towards).toBe(pseat(ps.id))
		const props = (
			await testDb.select().from(schema.stateProposals)
		).filter((r) => r.sessionId === s.id)
		expect(props.map((r) => r.id)).toEqual([prop.id])
		expect((props[0]!.payload as any).owner).toEqual({
			kind: "seated_member",
			id: heroMember.id
		})
		const deltas = (await testDb.select().from(schema.sessionImprints)).filter(
			(d) => d.sessionId === s.id
		)
		expect(deltas.map((d) => d.id)).toEqual([deltaId])
		expect(JSON.stringify(deltas[0])).not.toContain(cr(hero.id))
		const afterForward = (
			await testDb
				.select({
					a: schema.sessions.annex,
					au: schema.sessions.annexAudiences
				})
				.from(schema.sessions)
				.where(inArray(schema.sessions.id, [s.id]))
		)[0]!
		expect(
			(afterForward.a as any).core["dungeon-crawler-progress"].fates
		).toEqual({ [sm(heroMember.id)]: "dead", "user:1": { made: true } })
		expect((afterForward.au as any).core).toEqual({
			"dungeon-crawler-progress": [sm(heroMember.id), "user:2"]
		})
		expect(JSON.stringify(afterForward)).not.toContain(cr(hero.id))
		// Both lines are back in the history, the record cleared.
		expect(await takenOf(reply.id)).toBeNull()
		expect(await takenOf(mine.id)).toBeNull()
		expect(await seatKeys(asDb())).toEqual(ZEROS)

		// Back again: the record written is member form.
		const back2 = await rewindTurn(asDb(), {
			sessionId: s.id,
			userId: ownerId
		})
		expect(back2).toMatchObject({ ok: true })
		const rec3 = await takenOf(reply.id)
		expect(rec3.state.values[0]).toMatchObject({
			id: anchored.id,
			ownerKind: "seated_member",
			ownerId: heroMember.id
		})
		expect(rec3.state.sessionImprints).toHaveLength(1)
		expect(JSON.stringify(rec3)).not.toContain("session_cast")
		expect(JSON.stringify(rec3)).not.toContain(cr(hero.id))
		expect(JSON.stringify(rec3)).not.toContain(cr(persona.id))
		// Nothing for the pass to do, and nothing it does.
		const before = await snapshot(testDb)
		expect(await seatKeys(asDb())).toEqual(ZEROS)
		expect(await snapshot(testDb)).toEqual(before)
		// `cs` seated nothing else: the character seat is still the hero's.
		expect(cs.castMemberId).toBe(heroMember.id)
	}, 120_000)
})

// ─── 2. One session's failure, JSON stores included ─────────────────────────

describe("one session's failure rolls back that session alone", () => {
	/** Card form in an owner column, the annex, its audiences, voice keys and a message speaker. */
	async function seeded() {
		const hero = await card("Hero")
		const b = await book()
		const heroMember = await member(b.id, hero.id)
		const s = await session(b.id)
		await charSeat(s.id, hero.id, heroMember.id)
		await value(s.id, cardForm(hero.id))
		await setSession(s.id, {
			turnOrder: {
				v: 1,
				order: [{ ref: cr(hero.id), via: "strategy" }],
				candidates: [
					{
						ref: cr(hero.id),
						kind: "character",
						name: "H",
						position: 0
					}
				]
			},
			turnTally: {
				v: 1,
				lanes: {
					main: {
						turn: 1,
						lastMessageId: 1,
						lastSpeaker: cr(hero.id),
						turnsBy: { [cr(hero.id)]: 1 },
						spoke: [cr(hero.id)],
						persons: []
					}
				}
			},
			annexAudiences: { core: { goals: [cr(hero.id)] } },
			genreFields: { [`speechAutoVoice:${cr(hero.id)}`]: "amy" }
		})
		await line(s.id, {
			characterId: hero.id,
			metadata: { speaker: cr(hero.id), isEdited: false } as never
		})
		return { s, hero, heroMember }
	}

	test("the failing session's columns, annex and metadata are unchanged text; the other is fully rekeyed", async () => {
		const good = await seeded()
		const bad = await seeded()
		// Everything of the failing session, as stored text (column tables, sessions row, message rows).
		const textOf = async (sessionId: number) => ({
			values: (
				await testDb.execute(
					sql`select to_jsonb(t)::text as j from attribute_values t where session_id = ${sessionId} order by id`
				)
			).rows,
			session: (
				await testDb.execute(
					sql`select to_jsonb(t)::text as j from sessions t where id = ${sessionId}`
				)
			).rows,
			lines: (
				await testDb.execute(
					sql`select to_jsonb(t)::text as j from session_messages t where session_id = ${sessionId} order by id`
				)
			).rows
		})
		const badBefore = await textOf(bad.s.id)

		failing.sessionId = bad.s.id
		const spy = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			await expect(seatKeys(asDb())).rejects.toThrow(/1 session/)
			expect(spy).toHaveBeenCalledTimes(1)
		} finally {
			spy.mockRestore()
		}
		// The translator was asked by the column stores first, then threw from a JSON step.
		expect(failing.targetsCalls).toBeGreaterThan(0)
		expect(failing.ofCalls).toBeGreaterThan(0)

		expect(await textOf(bad.s.id)).toEqual(badBefore)
		const goodAfter = JSON.stringify(await textOf(good.s.id))
		expect(goodAfter).not.toContain(cr(good.hero.id))
		expect(goodAfter).not.toContain("session_cast")
		expect(goodAfter).toContain("seated_member")
		const goodSession = (
			await testDb
				.select({
					a: schema.sessions.annex,
					to: schema.sessions.turnOrder,
					au: schema.sessions.annexAudiences,
					g: schema.sessions.genreFields
				})
				.from(schema.sessions)
				.where(inArray(schema.sessions.id, [good.s.id]))
		)[0]!
		expect((goodSession.to as any).order[0].ref).toBe(
			sm(good.heroMember.id)
		)
		expect(goodSession.au).toEqual({
			core: { goals: [sm(good.heroMember.id)] }
		})
		expect(goodSession.g).toEqual({
			[`speechAutoVoice:${sm(good.heroMember.id)}`]: "amy"
		})
		const goodLine = (
			await testDb
				.select({ m: schema.sessionMessages.metadata })
				.from(schema.sessionMessages)
				.where(inArray(schema.sessionMessages.sessionId, [good.s.id]))
		)[0]!
		expect((goodLine.m as any).speaker).toBe(sm(good.heroMember.id))
		// Once the failure is gone the failed session is taken too.
		failing.sessionId = -1
		const rerun = await seatKeys(asDb())
		expect(rerun.sessions).toBe(1)
		expect(rerun.failed).toBe(0)
		expect(await seatKeys(asDb())).toEqual(ZEROS)
	})
})

// ─── the rich fixture: card form in every store ──────────────────────────────

/**
 * One session holding card form in every store the pass names, plus the
 * awkward shapes: a card in a character seat and a player seat (★K-2), a
 * merged pair, and a decoy — a member whose id equals the seated card's id.
 */
async function rich() {
	const b = await book()
	const decoyCard = await card("Decoy")
	// One number for the next card and the next member: a seat that took "its card's id" for "its member's id" lands on the decoy.
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
	const twin = await card("Twin")
	expect(twin.id).toBe(decoy.id)
	const twinMember = await member(b.id, twin.id)
	expect(twinMember.id).not.toBe(twin.id)
	const pc = await card("Persona")
	const pcMember = await member(b.id, pc.id)
	const live = await card("Live")
	const gone = await card("Gone")
	const liveMember = await member(b.id, live.id)

	const s = await session(b.id)
	const twinChar = await charSeat(s.id, twin.id, twinMember.id)
	const twinPlayer = await playerSeat(s.id, twin.id, twinMember.id)
	const pcPlayer = await playerSeat(s.id, pc.id, pcMember.id)
	const liveSeat = await charSeat(s.id, live.id, liveMember.id)
	await charSeat(s.id, gone.id, liveMember.id, departed(liveSeat.id))

	// Owner columns and proposals.
	const owners = [twin, pc, live, gone].map((c) => cardForm(c.id))
	for (const o of owners) {
		await value(s.id, o)
		await config(s.id, o)
		await zone(s.id, o, "hand", [{ entryId: 1, name: "Ace" }])
		await sheet(
			s.id,
			o,
			new Date(o === owners[3] ? "2025-01-01" : "2020-01-01")
		)
		await carry(
			s.id,
			o,
			o !== owners[3],
			new Date(o === owners[3] ? "2025-01-01" : "2020-01-01")
		)
		await proposal(s.id, {
			owner: o,
			slotId: "core:slot/hp@1",
			value: 1,
			nested: { keep: [1, 2] }
		})
	}
	await proposal(s.id, { kind: "clock", by: 2, unit: "hour" })

	// zone_towards
	await zone(s.id, { kind: "seated_member", id: liveMember.id }, "ties", [
		{
			entryId: 1,
			name: "Bond",
			fields: { towards: cr(twin.id), note: "x" }
		},
		{ entryId: 2, name: "Rival", fields: { towards: "Some Name" } },
		{ entryId: 3, name: "Pal", fields: { towards: cr(pc.id) } }
	])

	const core = {
		turnOrder: {
			v: 1,
			order: [
				{ ref: cr(twin.id), via: "strategy", channel: "main" },
				{ ref: null, via: "voice" },
				{ ref: "envoy:x", via: "script" }
			],
			candidates: [
				{ ref: cr(pc.id), kind: "persona", name: "P", position: 0 },
				{ ref: cr(twin.id), kind: "character", name: "T", position: 1 },
				{ ref: cr(live.id), kind: "character", name: "L", position: 2 }
			],
			basedOnAt: 1,
			computedAt: 2,
			runId: null,
			event: null,
			strategy: "s"
		},
		turnTally: {
			v: 1,
			lanes: {
				main: {
					turn: 3,
					lastMessageId: 9,
					lastSpeaker: cr(gone.id),
					turnsBy: {
						[cr(live.id)]: 2,
						[cr(gone.id)]: 3,
						[cr(twin.id)]: 1,
						narrator: 1
					},
					spoke: [cr(gone.id), cr(live.id), cr(pc.id), "narrator"],
					persons: [cr(pc.id)]
				}
			}
		},
		"dungeon-crawler-progress": {
			fates: { [cr(twin.id)]: "alive", [cr(pc.id)]: "dead" },
			heroes: { "user:1": { made: true } }
		}
	}
	const { turnOrder: coreOrder, turnTally: coreTally, ...coreDoc } = core
	await setSession(s.id, {
		turnOrder: coreOrder,
		turnTally: coreTally,
		annex: { core: coreDoc, mundi: { doc: cr(twin.id) } },
		annexAudiences: {
			core: { goals: [cr(twin.id), "user:2"] },
			mundi: { map: [cr(live.id)] }
		},
		genreFields: {
			title: "T",
			[`speechAutoVoice:${cr(twin.id)}`]: "amy",
			[`speechAutoVoice:${cr(pc.id)}`]: "bo",
			"speechAutoVoice:envoy:x": "cy"
		}
	})
	await widgetRow(s.id, {
		chosenImages: [`${cr(live.id)}=img-a`, "envoy:x=img-b"],
		pickMembers: [cr(twin.id), cr(pc.id), "Some Name", "12"],
		other: { keep: [cr(twin.id)] }
	})
	await line(s.id, {
		characterId: live.id,
		metadata: { speaker: cr(live.id), isEdited: false } as never
	})
	await line(s.id, {
		personaId: pc.id,
		metadata: { speaker: cr(pc.id) } as never
	})
	await line(s.id, { metadata: { speaker: "envoy:mascot" } as never })
	const m1 = await mirror(s.id)
	await blocksPart(m1.id, {
		blocks: [
			{ kind: "md", text: "hello" },
			{
				kind: "choices",
				addressee: cr(live.id),
				answered: { by: cr(live.id), at: "2026-01-01T00:00:00Z" },
				actions: []
			},
			{
				kind: "group",
				blocks: [
					{ kind: "form", addressee: "owner", fields: {} },
					{ kind: "choices", addressee: cr(pc.id), actions: [] }
				]
			}
		]
	})
	await imprint(s.id, m1.id, "core/goals", {
		after: 1,
		audienceBefore: [cr(live.id)]
	})
	// A record Back took, card form.
	const date = "2026-01-01T00:00:00.000Z"
	const record = {
		v: 1,
		wasHidden: false,
		state: {
			messageId: 77,
			values: [
				{
					id: 9001,
					sessionId: s.id,
					ownerKind: "session_cast",
					ownerId: twin.id,
					slotId: "core:slot/hp@1",
					value: { v: 3 },
					note: null,
					updatedBy: "user:1",
					stateVersion: 2,
					createdAt: date,
					updatedAt: date
				}
			],
			configs: [],
			proposals: [],
			zones: [],
			imprints: [],
			ownBookEntries: [],
			clockSessions: [],
			annexDeltas: [],
			scenes: []
		},
		turn: {
			tally: core.turnTally,
			elsewhere: { values: [], configs: [], proposals: [], imprints: [] }
		}
	}
	await line(s.id, { rewindOrdinal: 1, rewindTaken: record as never })
	return {
		s,
		twin,
		twinMember,
		twinChar,
		twinPlayer,
		pc,
		pcPlayer,
		live,
		liveMember,
		gone,
		decoy
	}
}
type Rich = Awaited<ReturnType<typeof rich>>

/**
 * A snapshot with the ids of the owner-column rows left out and the rows sorted:
 * a ★K-2 copy takes its id from the table's sequence, which a restored data
 * directory does not carry on from the original, so only the copies' ids differ.
 */
const OWNER_TABLES = [
	"attribute_values",
	"attribute_configs",
	"zone_contents",
	"owner_sheets",
	"attribute_carries"
]
function sameRows(snap: Record<string, string[]>): Record<string, string[]> {
	return Object.fromEntries(
		Object.entries(snap).map(([t, rows]) => [
			t,
			OWNER_TABLES.includes(t)
				? rows
						.map((j) => {
							const { id: _id, ...rest } = JSON.parse(j)
							return JSON.stringify(rest)
						})
						.sort()
				: rows
		])
	)
}

/** Whether any owner row or ref in the snapshot names the decoy member. */
function namesDecoy(snap: Record<string, string[]>, r: Rich): string[] {
	const found: string[] = []
	const x = r.decoy.id
	for (const [table, rows] of Object.entries(snap)) {
		for (const text of rows) {
			const hits =
				new RegExp(`seated-member:${x}(\\D|$)`).test(text) ||
				new RegExp(`"id": ${x}, "kind": "seated_member"`).test(text) ||
				new RegExp(`"kind": "seated_member", "id": ${x}\\b`).test(
					text
				) ||
				new RegExp(
					`"ownerKind": "seated_member", "ownerId": ${x}\\b`
				).test(text) ||
				new RegExp(
					`"owner_id": ${x}, .*"owner_kind": "seated_member"`
				).test(text) ||
				new RegExp(
					`"owner_kind": "seated_member", .*"owner_id": ${x}\\b`
				).test(text)
			if (hits) found.push(`${table}: ${text.slice(0, 80)}`)
		}
	}
	return found
}

/** Every owner row of one session that still reads card form. */
const cardFormOwnerRows = async (h: { execute: TestDb["execute"] }) => {
	let total = 0
	for (const t of [
		"attribute_values",
		"attribute_configs",
		"zone_contents",
		"owner_sheets",
		"attribute_carries"
	])
		total += Number(
			(
				await h.execute(
					sql.raw(
						`select count(*)::int as n from ${t} where owner_kind = 'session_cast'`
					)
				)
			).rows[0]!.n as number
		)
	return total
}

describe("the second boot, over everything at once", () => {
	test("first run: every store rekeyed; second run: every touched table identical, all zeros; the decoy is never named", async () => {
		const r = await rich()
		const first = await seatKeys(asDb())
		expect(first.failed).toBe(0)
		expect(first.left).toBe(0)
		expect(first.sessions).toBe(1)
		for (const store of SEAT_KEY_STORES)
			expect(
				first.rekeyed[store],
				`${store} was rekeyed`
			).toBeGreaterThan(0)
		expect(first.copied).toBeGreaterThan(0)
		expect(first.dropped).toBeGreaterThan(0)
		expect(await cardFormOwnerRows(testDb)).toBe(0)

		const after = await snapshot(testDb)
		expect(namesDecoy(after, r)).toEqual([])
		// The twin's rows: the character seat's member, and (K-2) a copy for its player seat.
		const twinOwners = (await testDb.select().from(schema.attributeValues))
			.filter((v) => v.sessionId === r.s.id)
			.map((v) => `${v.ownerKind}:${v.ownerId}`)
			.sort()
		expect(twinOwners).toEqual(
			[
				`seated_member:${r.twinMember.id}`,
				`player_seat:${r.twinPlayer.id}`,
				`player_seat:${r.pcPlayer.id}`,
				// The merged pair: the live seat's card and the departed seat's card, one member.
				`seated_member:${r.liveMember.id}`,
				`seated_member:${r.liveMember.id}`
			].sort()
		)
		// A plugin's annex document is a documented leave (★K-3): still as written.
		const mundi = (
			(
				await testDb
					.select({ a: schema.sessions.annex })
					.from(schema.sessions)
					.where(inArray(schema.sessions.id, [r.s.id]))
			)[0]!.a as any
		).mundi
		expect(mundi).toEqual({ doc: cr(r.twin.id) })
		// Not a single other card-form ref is left in any touched JSON.
		const withoutMundi = { ...after }
		withoutMundi.sessions = after.sessions.map((j) => {
			const row = JSON.parse(j)
			delete row.annex.mundi
			return JSON.stringify(row)
		})
		// (A widget's other keys are not seat keys: `other.keep` stays as written.)
		withoutMundi.widget_settings = after.widget_settings.map((j) => {
			const row = JSON.parse(j)
			delete row.values.other
			return JSON.stringify(row)
		})
		for (const c of [r.twin, r.pc, r.live, r.gone]) {
			const text = JSON.stringify(withoutMundi)
			expect(text, `character:${c.id} left`).not.toMatch(
				new RegExp(`character:${c.id}(\\D|$)`)
			)
		}

		expect(await seatKeys(asDb())).toEqual(ZEROS)
		expect(await snapshot(testDb)).toEqual(after)
	})
})

// ─── 3. A pre-flip backup, then the pass ─────────────────────────────────────

describe("a pre-flip backup, then the pass", () => {
	test("the restored database is rekeyed as the original is; a second run changes nothing", async () => {
		const r = await rich()
		// The backup: exactly what PGlite's dumpDataDir produces (recovery.ts), taken before any pass ran.
		const blob = await (
			testDb as unknown as { $client: PGlite }
		).$client.dumpDataDir("gzip")
		const preSnapshot = await snapshot(testDb)
		expect(await cardFormOwnerRows(testDb)).toBeGreaterThan(0)

		const client = await PGlite.create({ loadDataDir: blob })
		guardTransactions(client, "throw")
		const restored = drizzle(client, { schema })
		try {
			// What was saved is what was dumped.
			expect(await snapshot(restored)).toEqual(preSnapshot)
			const onRestored = await seatKeys(restored as unknown as Db)
			expect(onRestored.failed).toBe(0)
			expect(onRestored.left).toBe(0)
			for (const store of SEAT_KEY_STORES)
				expect(onRestored.rekeyed[store], store).toBeGreaterThan(0)
			expect(await cardFormOwnerRows(restored)).toBe(0)
			const restoredAfter = await snapshot(restored)
			expect(namesDecoy(restoredAfter, r)).toEqual([])

			// The same pass on the original: the same report, the same rows.
			const onOriginal = await seatKeys(asDb())
			expect(onOriginal).toEqual(onRestored)
			expect(sameRows(await snapshot(testDb))).toEqual(
				sameRows(restoredAfter)
			)

			// And a second run on the restored database changes nothing.
			expect(await seatKeys(restored as unknown as Db)).toEqual(ZEROS)
			expect(await snapshot(restored)).toEqual(restoredAfter)
		} finally {
			await client.close()
		}
	}, 120_000)
})
