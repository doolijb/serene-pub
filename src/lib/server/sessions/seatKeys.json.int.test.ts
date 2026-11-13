/**
 * 🚧 The `seat-keys` boot pass, JSON stores (`sessions/seatKeys.ts`, plan §34.1, S4).
 *
 * Claims: each JSON store moves a card-form ref to member form (a character
 * seat → `seated-member:`, a player seat → `player-seat:`) and leaves every
 * other key and item byte-identical; a value per seat (audiences, fates,
 * auto-voice keys, `pickMembers`) goes to every seat holding the card and a
 * designation (speaker, addressee, tie end, `lastSpeaker`) to one, hinted where
 * the item says the seat kind; `turnsBy` of a merged pair sums; a chosen image
 * on a player seat is left and counted; non-card strings (names, `envoy:`,
 * `user:`, `owner`, a digits-only line) are never touched; a plugin owner's
 * annex document and delta document are left and never make a session a
 * candidate; what no seat can take is left and counted; a second run changes
 * nothing.
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
import { seatKeys } from "./seatKeys"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const loaded = vi.hoisted(() => ({ sessionIds: [] as number[] }))

vi.mock("$lib/server/state/seatRefs", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/state/seatRefs")>()
	return {
		...actual,
		// Which sessions the pass opened: the fast path's observable.
		loadSeatMap: (db: Db, sessionId: number) => {
			loaded.sessionIds.push(sessionId)
			return actual.loadSeatMap(db, sessionId)
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
		path.join(os.tmpdir(), "serene-pub-vitest-seatKeysJson-")
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

afterEach(async () => {
	loaded.sessionIds.length = 0
	if (made.length)
		await testDb
			.delete(schema.sessions)
			.where(inArray(schema.sessions.id, made))
	made.length = 0
})

async function user() {
	const [row] = await testDb
		.insert(schema.users)
		.values({ username: uniq("seat-keys-json-user") })
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
type Fx = Awaited<ReturnType<typeof fixture>>

/** A card held by a character seat AND a player seat (one member): ★K-2. */
async function bothFixture() {
	const u = await user()
	const b = await book(u.id)
	const both = await card(u.id, "Both")
	const m = await member(b.id, both.id)
	const s = await session(u.id, b.id)
	const cs = await charSeat(s.id, both.id, m.id)
	const ps = await playerSeat(s.id, both.id, m.id)
	return { u, b, s, both, m, cs, ps, ref: `character:${both.id}` }
}

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

// ─── seeding ─────────────────────────────────────────────────────────────────

const rows = async (q: ReturnType<typeof sql>) =>
	(await testDb.execute(q)).rows as Record<string, any>[]

async function setSession(
	id: number,
	set: {
		annex?: unknown
		annexAudiences?: unknown
		genreFields?: unknown
		turnOrder?: unknown
		turnTally?: unknown
		laneReads?: unknown
	}
) {
	await testDb
		.update(schema.sessions)
		.set(set as never)
		.where(eq(schema.sessions.id, id))
}
const readSession = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!

async function zoneRow(
	sessionId: number,
	owner: { kind: string; id: number },
	entries: unknown[]
) {
	const [row] = await testDb
		.insert(schema.zoneContents)
		.values({
			sessionId,
			ownerKind: owner.kind,
			ownerId: owner.id,
			rulesetId: "r:ruleset/x@1",
			zoneType: "ties",
			entries: entries as never
		})
		.returning()
	return row!
}
async function widgetRow(
	sessionId: number,
	userId: number,
	values: Record<string, unknown>
) {
	const [row] = await testDb
		.insert(schema.widgetSettings)
		.values({
			sessionId,
			userId,
			widgetInstanceId: uniq("widget"),
			values
		})
		.returning()
	return row!
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
	const [row] = await testDb
		.insert(schema.messageParts)
		.values({ messageId, type: "core:blocks", data })
		.returning()
	return row!
}
/** One `annex` session imprint: a key's values (wrapped) and audiences; absent = SQL NULL. */
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
	const [row] = await testDb
		.insert(schema.sessionImprints)
		.values({
			sessionId,
			messageId,
			subjectKind: "annex",
			subjectKey: key,
			before: side.before === undefined ? null : { v: side.before },
			after: side.after === undefined ? null : { v: side.after },
			audienceBefore: side.audienceBefore ?? null,
			audienceAfter: side.audienceAfter ?? null
		})
		.returning()
	return row!
}

/** Every touched JSON column of every session, as the stored text. */
async function jsonDump() {
	return {
		zones: await rows(
			sql`select id, entries::text as e from zone_contents order by id`
		),
		sessions: await rows(
			sql`select id, annex::text as a, turn_order::text as to_, turn_tally::text as tt, annex_audiences::text as au, genre_fields::text as g, annex_versions::text as v, updated_at::text as u from sessions order by id`
		),
		widgets: await rows(
			sql`select id, "values"::text as v, updated_at::text as u from widget_settings order by id`
		),
		lines: await rows(
			sql`select id, metadata::text as m, rewind_taken::text as r, updated_at::text as u from session_messages order by id`
		),
		parts: await rows(
			sql`select id, data::text as d from message_parts order by id`
		),
		imprints: await rows(
			sql`select id, before::text as b, after::text as a, audience_before::text as ab, audience_after::text as aa from session_imprints order by id`
		)
	}
}

const cr = (id: number) => `character:${id}`
const sm = (id: number) => `seated-member:${id}`
const pseat = (id: number) => `player-seat:${id}`

/** The `turn_order` column of that session, in card form. */
function turnOrderOf(f: Fx) {
	return {
		v: 1,
		order: [
			{ ref: cr(f.hero.id), via: "strategy", channel: "main" },
			{ ref: null, via: "voice" },
			{ ref: "envoy:x", via: "script" },
			{ ref: pseat(f.ps.id), via: "pick" }
		],
		candidates: [
			{
				ref: cr(f.persona.id),
				kind: "persona",
				name: "P",
				position: 1
			},
			{
				ref: cr(f.hero.id),
				kind: "character",
				name: "H",
				position: 0
			},
			{ ref: "envoy:x", kind: "envoy", name: "X", position: 2 }
		],
		basedOnAt: 1,
		computedAt: 2,
		runId: null,
		event: null,
		strategy: "s"
	}
}

/** The `turn_tally` column of that session, in card form. */
function turnTallyOf(f: Fx) {
	return {
		v: 1,
		lanes: {
			main: {
				turn: 3,
				lastMessageId: 9,
				lastSpeaker: cr(f.hero.id),
				turnsBy: {
					[cr(f.hero.id)]: 2,
					narrator: 1,
					"user:1": 4
				},
				spoke: [cr(f.hero.id), "narrator", cr(f.persona.id)],
				persons: [cr(f.persona.id)],
				round: 1
			},
			"phone:3": {
				turn: 1,
				lastMessageId: 4,
				lastSpeaker: "envoy:x",
				turnsBy: { "envoy:x": 1 },
				spoke: ["envoy:x"],
				persons: []
			}
		}
	}
}

/** The `lane_reads` column: left alone. */
const LANE_READS = { "1": { main: 3 } }

/** What `turnOrderOf` and `turnTallyOf` become. */
function afterOf(f: Fx) {
	const c = { turnOrder: JSON.parse(JSON.stringify(turnOrderOf(f))), turnTally: JSON.parse(JSON.stringify(turnTallyOf(f))) }
	c.turnOrder.order[0].ref = sm(f.heroMember.id)
	c.turnOrder.candidates[0].ref = pseat(f.ps.id)
	c.turnOrder.candidates[1].ref = sm(f.heroMember.id)
	const lane = c.turnTally.lanes.main
	lane.lastSpeaker = sm(f.heroMember.id)
	lane.turnsBy = { [sm(f.heroMember.id)]: 2, narrator: 1, "user:1": 4 }
	lane.spoke = [sm(f.heroMember.id), "narrator", pseat(f.ps.id)]
	lane.persons = [pseat(f.ps.id)]
	return c
}

const turnOrderAfter = (f: Fx) => afterOf(f).turnOrder
const turnTallyAfter = (f: Fx) => afterOf(f).turnTally

/** The annex of a session whose hero and persona are in card form, with keys and an owner the pass leaves alone. (The turn order, the turn tally and the read marks are columns: below.) */
function annexOf(f: Fx) {
	return {
		core: {
			"dungeon-crawler-progress": {
				fates: {
					[cr(f.hero.id)]: "alive",
					[cr(f.persona.id)]: "dead"
				},
				heroes: { "user:1": { made: true, name: "H" } },
				world: { rooms: [1, 2] }
			},
			"retake-quietly": true
		},
		mundi: { doc: cr(f.hero.id), nested: { who: [cr(f.persona.id)] } }
	}
}

/** What `annexOf` becomes. */
function annexAfter(f: Fx) {
	const a = JSON.parse(JSON.stringify(annexOf(f)))
	const c = a.core
	c["dungeon-crawler-progress"].fates = {
		[sm(f.heroMember.id)]: "alive",
		[pseat(f.ps.id)]: "dead"
	}
	return a
}

/** Seed card form into every JSON store of a fixture (no item left, no player-seat chosen image). */
async function seedAll(f: Fx) {
	await setSession(f.s.id, {
		annex: annexOf(f),
		turnOrder: turnOrderOf(f),
		turnTally: turnTallyOf(f),
		laneReads: LANE_READS,
		annexAudiences: {
			core: { goals: [cr(f.hero.id), "user:2", cr(f.persona.id)] },
			mundi: { map: [cr(f.hero.id)] }
		},
		genreFields: {
			title: "T",
			[`speechAutoVoice:${cr(f.hero.id)}`]: "amy",
			[`speechAutoVoice:${cr(f.persona.id)}`]: "bo",
			"speechAutoVoice:envoy:x": "cy"
		}
	})
	const zone = await zoneRow(
		f.s.id,
		{ kind: "seated_member", id: f.heroMember.id },
		[
			{
				entryId: 1,
				name: "Bond",
				fields: { towards: cr(f.persona.id), note: "x" }
			},
			{ entryId: 2, name: "Rival", fields: { towards: "Some Name" } },
			{ entryId: 3, name: "Rope" }
		]
	)
	const widget = await widgetRow(f.s.id, f.u.id, {
		chosenImages: [`${cr(f.hero.id)}=img-a`, "seated-member:999=img-z"],
		pickMembers: [cr(f.hero.id), "Some Name", "12"],
		other: { keep: [cr(f.hero.id)] }
	})
	const l1 = await line(f.s.id, {
		personaId: f.persona.id,
		metadata: { speaker: cr(f.persona.id), isEdited: false } as never
	})
	const l2 = await line(f.s.id, {
		characterId: f.hero.id,
		metadata: { speaker: cr(f.hero.id) } as never
	})
	const l3 = await line(f.s.id, {
		metadata: { speaker: "envoy:mascot" } as never
	})
	const m1 = await mirror(f.s.id)
	const part = await blocksPart(m1.id, {
		blocks: [
			{ kind: "md", text: "hello" },
			{
				kind: "choices",
				addressee: cr(f.hero.id),
				answered: { by: cr(f.hero.id), at: "2026-01-01T00:00:00Z" },
				actions: []
			},
			{
				kind: "group",
				blocks: [
					{ kind: "form", addressee: "owner", fields: {} },
					{
						kind: "choices",
						addressee: cr(f.persona.id),
						actions: []
					}
				]
			}
		],
		other: 1
	})
	const d = await imprint(f.s.id, m1.id, "core/dungeon-crawler-progress", {
		before: { fates: { [cr(f.hero.id)]: "alive", "user:1": 1 }, keep: 1 },
		after: { fates: { [cr(f.hero.id)]: "dead" } },
		audienceBefore: [cr(f.hero.id)]
	})
	const mundiDelta = await imprint(f.s.id, m1.id, "mundi/doc", {
		before: cr(f.hero.id),
		after: cr(f.persona.id),
		audienceBefore: [cr(f.hero.id)]
	})
	return { zone, widget, l1, l2, l3, part, d, mundiDelta, m1 }
}

describe("the JSON stores", () => {
	test("zone_towards, annex_core, annex_audiences, genre_fields: card form to member form, everything else byte-identical", async () => {
		const f = await fixture()
		const seeded = await seedAll(f)
		const versionsBefore = (await readSession(f.s.id)).annexVersions

		const report = await seatKeys(asDb())
		expect(report.failed).toBe(0)
		expect(report.rekeyed).toMatchObject({
			zone_towards: 1,
			annex_core: 1,
			annex_audiences: 1,
			genre_fields: 1
		})

		const [zone] = await testDb
			.select()
			.from(schema.zoneContents)
			.where(eq(schema.zoneContents.id, seeded.zone.id))
		expect(zone!.entries).toEqual([
			{
				entryId: 1,
				name: "Bond",
				fields: { towards: pseat(f.ps.id), note: "x" }
			},
			{ entryId: 2, name: "Rival", fields: { towards: "Some Name" } },
			{ entryId: 3, name: "Rope" }
		])

		const after = await readSession(f.s.id)
		expect(after.annex).toEqual(annexAfter(f))
		// The turn order and the tally are columns: rekeyed in place; the read marks left alone.
		expect(after.turnOrder).toEqual(turnOrderAfter(f))
		expect(after.turnTally).toEqual(turnTallyAfter(f))
		expect(after.laneReads).toEqual(LANE_READS)
		// No key added or lost (jsonb keeps its own key order).
		expect(Object.keys((after.annex as any).core).sort()).toEqual(
			Object.keys(annexOf(f).core).sort()
		)
		// The annex's document versions do not move: a key migration is no story change.
		expect(after.annexVersions).toEqual(versionsBefore)
		expect(after.annexAudiences).toEqual({
			core: {
				goals: [sm(f.heroMember.id), "user:2", pseat(f.ps.id)]
			},
			mundi: { map: [sm(f.heroMember.id)] }
		})
		expect(after.genreFields).toEqual({
			title: "T",
			[`speechAutoVoice:${sm(f.heroMember.id)}`]: "amy",
			[`speechAutoVoice:${pseat(f.ps.id)}`]: "bo",
			"speechAutoVoice:envoy:x": "cy"
		})
	})

	test("widget_settings: chosenImages and pickMembers; names, a digits-only line and other keys untouched", async () => {
		const f = await fixture()
		const seeded = await seedAll(f)
		const report = await seatKeys(asDb())
		expect(report.rekeyed.widget_settings).toBe(1)
		const [w] = await testDb
			.select()
			.from(schema.widgetSettings)
			.where(eq(schema.widgetSettings.id, seeded.widget.id))
		expect(w!.values).toEqual({
			chosenImages: [
				`${sm(f.heroMember.id)}=img-a`,
				"seated-member:999=img-z"
			],
			pickMembers: [sm(f.heroMember.id), "Some Name", "12"],
			other: { keep: [cr(f.hero.id)] }
		})
	})

	test("chosenImages: a character seat's entry is rekeyed; a player seat's is left and counted, every run", async () => {
		const f = await fixture()
		const w = await widgetRow(f.s.id, f.u.id, {
			chosenImages: [
				`${cr(f.hero.id)}=a`,
				`${cr(f.persona.id)}=b`,
				"envoy:x=c"
			]
		})
		const read = async () =>
			(
				await testDb
					.select()
					.from(schema.widgetSettings)
					.where(eq(schema.widgetSettings.id, w.id))
			)[0]!.values
		const expected = {
			chosenImages: [
				`${sm(f.heroMember.id)}=a`,
				`${cr(f.persona.id)}=b`,
				"envoy:x=c"
			]
		}
		expect(await seatKeys(asDb())).toEqual({
			...ZEROS,
			sessions: 1,
			rekeyed: { ...REKEYED_ZERO, widget_settings: 1 },
			left: 1
		})
		expect(await read()).toEqual(expected)
		// The left entry keeps the session a candidate: it recurs, and nothing changes.
		const before = await jsonDump()
		expect(await seatKeys(asDb())).toEqual({ ...ZEROS, left: 1 })
		expect(await jsonDump()).toEqual(before)
	})

	test("an existing member-form chosen image wins over the card-form entry for the same seat", async () => {
		const f = await fixture()
		const w = await widgetRow(f.s.id, f.u.id, {
			chosenImages: [`${cr(f.hero.id)}=old`, `${sm(f.heroMember.id)}=new`]
		})
		await seatKeys(asDb())
		const [row] = await testDb
			.select()
			.from(schema.widgetSettings)
			.where(eq(schema.widgetSettings.id, w.id))
		expect(row!.values).toEqual({
			chosenImages: [`${sm(f.heroMember.id)}=new`]
		})
	})

	test("message_speakers: the speaker of a persona line and a character line, every other key and an envoy speaker untouched; updated_at does not move", async () => {
		const f = await fixture()
		const seeded = await seedAll(f)
		const stampBefore = await rows(
			sql`select id, updated_at::text as u from session_messages order by id`
		)
		const report = await seatKeys(asDb())
		expect(report.rekeyed.message_speakers).toBe(2)
		const get = async (id: number) =>
			(
				await testDb
					.select()
					.from(schema.sessionMessages)
					.where(eq(schema.sessionMessages.id, id))
			)[0]!
		expect((await get(seeded.l1.id)).metadata).toEqual({
			speaker: pseat(f.ps.id),
			isEdited: false
		})
		expect((await get(seeded.l2.id)).metadata).toEqual({
			speaker: sm(f.heroMember.id)
		})
		expect((await get(seeded.l3.id)).metadata).toEqual({
			speaker: "envoy:mascot"
		})
		expect(
			await rows(
				sql`select id, updated_at::text as u from session_messages order by id`
			)
		).toEqual(stampBefore)
	})

	test("message_blocks: addressee and answered.by, nested in a group; 'owner' and every other key untouched", async () => {
		const f = await fixture()
		const seeded = await seedAll(f)
		const report = await seatKeys(asDb())
		expect(report.rekeyed.message_blocks).toBe(1)
		const [p] = await testDb
			.select()
			.from(schema.messageParts)
			.where(eq(schema.messageParts.id, seeded.part.id))
		expect(p!.data).toEqual({
			blocks: [
				{ kind: "md", text: "hello" },
				{
					kind: "choices",
					addressee: sm(f.heroMember.id),
					answered: {
						by: sm(f.heroMember.id),
						at: "2026-01-01T00:00:00Z"
					},
					actions: []
				},
				{
					kind: "group",
					blocks: [
						{ kind: "form", addressee: "owner", fields: {} },
						{
							kind: "choices",
							addressee: pseat(f.ps.id),
							actions: []
						}
					]
				}
			],
			other: 1
		})
	})

	test("annex_imprints: audiences every target, the progress key's fates rekeyed; a plugin owner's values untouched", async () => {
		// (The old case rekeyed a `turnOrder` inside a delta document: runtime keys are columns now, in no annex document, so it is gone.)
		const f = await fixture()
		const seeded = await seedAll(f)
		const report = await seatKeys(asDb())
		// The core progress imprint and the plugin imprint's audiences; the plugin's values are left.
		expect(report.rekeyed.annex_imprints).toBe(2)
		const one = async (id: number) =>
			(
				await testDb
					.select()
					.from(schema.sessionImprints)
					.where(eq(schema.sessionImprints.id, id))
			)[0]!
		const d = await one(seeded.d.id)
		expect(d.before).toEqual({
			v: { fates: { [sm(f.heroMember.id)]: "alive", "user:1": 1 }, keep: 1 }
		})
		expect(d.after).toEqual({ v: { fates: { [sm(f.heroMember.id)]: "dead" } } })
		expect(d.audienceBefore).toEqual([sm(f.heroMember.id)])
		expect(d.audienceAfter).toBeNull()
		const mundi = await one(seeded.mundiDelta.id)
		expect(mundi.before).toEqual({ v: cr(f.hero.id) })
		expect(mundi.after).toEqual({ v: cr(f.persona.id) })
		expect(mundi.audienceBefore).toEqual([sm(f.heroMember.id)])
		expect(mundi.audienceAfter).toBeNull()
	})

	test("a Mundi-like owner's annex document and delta alone: untouched, and the session is not a candidate", async () => {
		const f = await fixture()
		await setSession(f.s.id, {
			annex: { mundi: { doc: cr(f.hero.id), more: [cr(f.persona.id)] } }
		})
		const m = await mirror(f.s.id)
		await imprint(f.s.id, m.id, "mundi/doc", {
			before: cr(f.hero.id),
			after: cr(f.persona.id)
		})
		const before = await jsonDump()
		expect(await seatKeys(asDb())).toEqual(ZEROS)
		expect(loaded.sessionIds).toEqual([])
		expect(await jsonDump()).toEqual(before)
	})

	test("a card number as a state key never moves: a digits-only pickMembers line stays", async () => {
		const f = await fixture()
		const w = await widgetRow(f.s.id, f.u.id, {
			pickMembers: [
				String(f.hero.id),
				cr(f.hero.id),
				String(f.persona.id)
			]
		})
		await seatKeys(asDb())
		const [row] = await testDb
			.select()
			.from(schema.widgetSettings)
			.where(eq(schema.widgetSettings.id, w.id))
		expect(row!.values).toEqual({
			pickMembers: [
				String(f.hero.id),
				sm(f.heroMember.id),
				String(f.persona.id)
			]
		})
	})
})

describe("hints, and values versus designations", () => {
	test("a card held by BOTH seats: a persona candidate and a persona line go to the player seat; a character candidate and a character line to the character seat", async () => {
		const b = await bothFixture()
		await setSession(b.s.id, {
			turnOrder: {
				v: 1,
				order: [],
				candidates: [
					{
						ref: b.ref,
						kind: "persona",
						name: "A",
						position: 0
					},
					{
						ref: b.ref,
						kind: "character",
						name: "B",
						position: 1
					},
					{
						ref: b.ref,
						kind: "other",
						name: "C",
						position: 2
					}
				]
			}
		})
		const persona = await line(b.s.id, {
			personaId: b.both.id,
			metadata: { speaker: b.ref } as never
		})
		const character = await line(b.s.id, {
			characterId: b.both.id,
			metadata: { speaker: b.ref } as never
		})
		const neither = await line(b.s.id, {
			metadata: { speaker: b.ref } as never
		})
		await seatKeys(asDb())
		const refs = (
			(await readSession(b.s.id)).turnOrder as any
		).candidates.map((c: any) => c.ref)
		expect(refs).toEqual([pseat(b.ps.id), sm(b.m.id), sm(b.m.id)])
		const speaker = async (id: number) =>
			(
				await testDb
					.select()
					.from(schema.sessionMessages)
					.where(eq(schema.sessionMessages.id, id))
			)[0]!.metadata.speaker
		expect(await speaker(persona.id)).toBe(pseat(b.ps.id))
		expect(await speaker(character.id)).toBe(sm(b.m.id))
		expect(await speaker(neither.id)).toBe(sm(b.m.id))
	})

	test("a card held by BOTH seats: audiences, fates, auto-voice keys and pickMembers get both targets; speaker, addressee, tie end and lastSpeaker get one", async () => {
		const b = await bothFixture()
		const both = [sm(b.m.id), pseat(b.ps.id)]
		await setSession(b.s.id, {
			turnTally: {
				v: 1,
				lanes: {
					main: {
						turn: 1,
						lastMessageId: 1,
						lastSpeaker: b.ref,
						turnsBy: { [b.ref]: 3 },
						spoke: [b.ref],
						persons: [b.ref]
					}
				}
			},
			annex: {
				core: {
					"dungeon-crawler-progress": { fates: { [b.ref]: "dead" } }
				}
			},
			annexAudiences: { core: { goals: [b.ref] } },
			genreFields: { [`speechAutoVoice:${b.ref}`]: "amy" }
		})
		await widgetRow(b.s.id, b.u.id, { pickMembers: [b.ref] })
		await zoneRow(b.s.id, { kind: "seated_member", id: b.m.id }, [
			{ entryId: 1, fields: { towards: b.ref } }
		])
		const m = await mirror(b.s.id)
		await blocksPart(m.id, {
			blocks: [{ kind: "choices", addressee: b.ref, actions: [] }]
		})

		const report = await seatKeys(asDb())
		expect(report.copied).toBe(4)
		expect(report.left).toBe(0)
		const after = await readSession(b.s.id)
		expect(after.annexAudiences).toEqual({ core: { goals: both } })
		expect(after.genreFields).toEqual({
			[`speechAutoVoice:${both[0]}`]: "amy",
			[`speechAutoVoice:${both[1]}`]: "amy"
		})
		const core = (after.annex as any).core
		expect(core["dungeon-crawler-progress"].fates).toEqual({
			[both[0]!]: "dead",
			[both[1]!]: "dead"
		})
		const lane = (after.turnTally as any).lanes.main
		expect(lane.lastSpeaker).toBe(both[0])
		expect(lane.turnsBy).toEqual({ [both[0]!]: 3 })
		expect(lane.spoke).toEqual([both[0]])
		expect(lane.persons).toEqual([both[0]])
		const [w] = await testDb.select().from(schema.widgetSettings)
		expect(w!.values).toEqual({ pickMembers: both })
		const [z] = await testDb
			.select()
			.from(schema.zoneContents)
			.where(eq(schema.zoneContents.sessionId, b.s.id))
		expect((z!.entries as any)[0].fields.towards).toBe(both[0])
		const [p] = await testDb
			.select()
			.from(schema.messageParts)
			.where(eq(schema.messageParts.messageId, m.id))
		expect((p!.data as any).blocks[0].addressee).toBe(both[0])
	})

	test("turnsBy sums two keys landing on one member (a merged pair)", async () => {
		const u = await user()
		const bk = await book(u.id)
		const live = await card(u.id, "Live")
		const gone = await card(u.id, "Gone")
		const m = await member(bk.id, live.id)
		const s = await session(u.id, bk.id)
		const seat = await charSeat(s.id, live.id, m.id)
		await charSeat(s.id, gone.id, m.id, departed(seat.id))
		await setSession(s.id, {
			turnTally: {
				v: 1,
				lanes: {
					main: {
						turn: 5,
						lastMessageId: 1,
						lastSpeaker: cr(gone.id),
						turnsBy: {
							[cr(gone.id)]: 2,
							narrator: 1,
							[cr(live.id)]: 3
						},
						spoke: [cr(gone.id), cr(live.id)],
						persons: []
					}
				}
			}
		})
		await seatKeys(asDb())
		const lane = ((await readSession(s.id)).turnTally as any).lanes.main
		expect(lane.turnsBy).toEqual({ [sm(m.id)]: 5, narrator: 1 })
		expect(lane.spoke).toEqual([sm(m.id)])
		expect(lane.lastSpeaker).toBe(sm(m.id))
	})
})

describe("rewind_taken", () => {
	test("values, configs, zones, proposals and annex deltas rekeyed; a K-2 copy has no id; every other field identical; turn.tally and elsewhere rekeyed", async () => {
		const b = await bothFixture()
		const hero = await card(b.u.id, "Hero2")
		const heroMember = await member(b.b.id, hero.id)
		await charSeat(b.s.id, hero.id, heroMember.id)
		const date = "2026-01-01T00:00:00.000Z"
		const valueRow = (id: number, ownerId: number) => ({
			id,
			sessionId: b.s.id,
			ownerKind: "session_cast",
			ownerId,
			slotId: "core:slot/hp@1",
			value: { v: 3 },
			note: null,
			updatedBy: "user:1",
			stateVersion: 2,
			createdAt: date,
			updatedAt: date
		})
		const tally = {
			v: 1,
			lanes: {
				main: {
					turn: 2,
					lastMessageId: 3,
					lastSpeaker: cr(hero.id),
					turnsBy: { [cr(hero.id)]: 1 },
					spoke: [cr(hero.id)],
					persons: []
				}
			}
		}
		const record = {
			v: 1,
			wasHidden: false,
			state: {
				messageId: 77,
				values: [valueRow(10, b.both.id), valueRow(11, hero.id)],
				configs: [
					{
						id: 4,
						sessionId: b.s.id,
						ownerKind: "session_cast",
						ownerId: hero.id,
						slotId: "core:slot/hp@1",
						config: { max: 9 },
						createdAt: date
					}
				],
				proposals: [
					{
						id: 5,
						sessionId: b.s.id,
						kind: "value",
						payload: {
							owner: { kind: "session_cast", id: hero.id },
							value: 1
						},
						createdAt: date
					}
				],
				zones: [
					{
						id: 6,
						sessionId: b.s.id,
						ownerKind: "session_cast",
						ownerId: hero.id,
						zoneType: "ties",
						entries: [
							{
								entryId: 1,
								fields: { towards: cr(hero.id), n: 1 }
							}
						],
						createdAt: date
					}
				],
				imprints: [{ act: "reverted", keep: cr(hero.id) }],
				ownBookEntries: [],
				clockSessions: [b.s.id],
				annexDeltas: [
					{
						reverted: true,
						row: {
							id: 8,
							owner: "core",
							ownerVersion: null,
							createdAt: date,
							before: {
								document: {
									"dungeon-crawler-progress": {
										fates: { [cr(hero.id)]: "dead" }
									}
								},
								audiences: { goals: [cr(hero.id)] }
							},
							after: { document: null, audiences: null }
						}
					},
					{
						reverted: false,
						row: {
							id: 9,
							owner: "mundi",
							before: {
								document: { who: cr(hero.id) },
								audiences: null
							},
							after: { document: null, audiences: null }
						}
					}
				],
				sessionImprints: [
					{
						act: "spliced",
						imprint: {
							id: 21,
							subjectKind: "annex",
							subjectKey: "core/dungeon-crawler-progress",
							before: { v: { fates: { [cr(hero.id)]: "alive" } } },
							after: { v: { fates: { [cr(hero.id)]: "dead" } } },
							audienceBefore: [cr(hero.id)],
							audienceAfter: null,
							createdAt: date
						},
						later: {
							id: 22,
							before: { v: { fates: { [cr(hero.id)]: "alive" } } },
							audienceBefore: [cr(hero.id)]
						}
					},
					{
						act: "reverted",
						imprint: {
							id: 23,
							subjectKind: "annex",
							subjectKey: "mundi/who",
							before: { v: cr(hero.id) },
							after: null,
							audienceBefore: null,
							audienceAfter: null
						}
					}
				],
				scenes: []
			},
			turn: {
				tally,
				elsewhere: {
					values: [valueRow(12, hero.id)],
					configs: [],
					proposals: [],
					imprints: []
				}
			}
		}
		const l = await line(b.s.id, {
			rewindOrdinal: 1,
			rewindTaken: record as never
		})
		const report = await seatKeys(asDb())
		expect(report.rekeyed.rewind_taken).toBe(1)
		expect(report.copied).toBe(1)
		const [got] = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, l.id))
		const taken = got!.rewindTaken as any
		const heroKey = { ownerKind: "seated_member", ownerId: heroMember.id }

		// both-seat value: the first keeps its id, the K-2 copy has none.
		expect(taken.state.values).toEqual([
			{ ...valueRow(10, b.m.id), ownerKind: "seated_member" },
			(({ id: _id, ...r }) => ({
				...r,
				ownerKind: "player_seat",
				ownerId: b.ps.id
			}))(valueRow(10, 0)),
			{ ...valueRow(11, hero.id), ...heroKey }
		])
		expect(taken.state.values[1]).not.toHaveProperty("id")
		expect(taken.state.configs[0]).toEqual({
			...record.state.configs[0],
			...heroKey
		})
		expect(taken.state.proposals[0].payload).toEqual({
			owner: { kind: "seated_member", id: heroMember.id },
			value: 1
		})
		expect(taken.state.zones[0]).toEqual({
			...record.state.zones[0],
			...heroKey,
			entries: [
				{ entryId: 1, fields: { towards: sm(heroMember.id), n: 1 } }
			]
		})
		const memberTally = {
			v: 1,
			lanes: {
				main: {
					turn: 2,
					lastMessageId: 3,
					lastSpeaker: sm(heroMember.id),
					turnsBy: { [sm(heroMember.id)]: 1 },
					spoke: [sm(heroMember.id)],
					persons: []
				}
			}
		}
		// (A `turnTally` inside an old record's delta document is no longer rekeyed: runtime keys are columns now, in no annex document.)
		expect(taken.state.annexDeltas[0].row.before).toEqual({
			document: {
				"dungeon-crawler-progress": {
					fates: { [sm(heroMember.id)]: "dead" }
				}
			},
			audiences: { goals: [sm(heroMember.id)] }
		})
		// A new record's annex imprints: audiences and the progress key's fates; a plugin key's values are left.
		const fatesOf = (fate: string) => ({ v: { fates: { [sm(heroMember.id)]: fate } } })
		expect(taken.state.sessionImprints[0]).toMatchObject({
			act: "spliced",
			imprint: {
				id: 21,
				before: fatesOf("alive"),
				after: fatesOf("dead"),
				audienceBefore: [sm(heroMember.id)],
				audienceAfter: null,
				createdAt: date
			},
			later: { id: 22, before: fatesOf("alive"), audienceBefore: [sm(heroMember.id)] }
		})
		expect(taken.state.sessionImprints[1]).toEqual(record.state.sessionImprints[1])
		// A plugin owner's delta is left; dates, imprints, flags and ids stay as written.
		expect(taken.state.annexDeltas[1]).toEqual(record.state.annexDeltas[1])
		expect(taken.state.annexDeltas[0].reverted).toBe(true)
		expect(taken.state.annexDeltas[0].row.createdAt).toBe(date)
		expect(taken.state.imprints).toEqual(record.state.imprints)
		expect(taken.state.messageId).toBe(77)
		expect(taken.wasHidden).toBe(false)
		expect(taken.turn.tally).toEqual(memberTally)
		expect(taken.turn.elsewhere.values).toEqual([
			{ ...valueRow(12, hero.id), ...heroKey }
		])
		expect(Object.keys(taken)).toEqual(Object.keys(record))
	})

	test("a record with no card form is not rewritten; a null tally stays null", async () => {
		const f = await fixture()
		const record = {
			v: 1,
			wasHidden: true,
			state: null,
			turn: {
				tally: null,
				elsewhere: {
					values: [],
					configs: [],
					proposals: [],
					imprints: []
				}
			}
		}
		await line(f.s.id, { rewindOrdinal: 1, rewindTaken: record as never })
		const before = await jsonDump()
		expect(await seatKeys(asDb())).toEqual(ZEROS)
		expect(await jsonDump()).toEqual(before)
	})
})

describe("left, and the second run", () => {
	test("a hard-deleted card in any JSON store: the item stays, counted in `left`, again on a second run", async () => {
		const u = await user()
		const bk = await book(u.id)
		const gone = await card(u.id, "Gone")
		const s = await session(u.id, bk.id)
		const ref = cr(gone.id)
		await setSession(s.id, {
			turnOrder: {
				v: 1,
				order: [{ ref, via: "x" }],
				candidates: [{ ref, kind: "character", name: "G", position: 0 }]
			},
			turnTally: {
				v: 1,
				lanes: {
					main: {
						turn: 1,
						lastMessageId: 1,
						lastSpeaker: ref,
						turnsBy: { [ref]: 1 },
						spoke: [ref],
						persons: [ref]
					}
				}
			},
			annex: {
				core: {
					"dungeon-crawler-progress": { fates: { [ref]: "dead" } }
				}
			},
			annexAudiences: { core: { goals: [ref] } },
			genreFields: { [`speechAutoVoice:${ref}`]: "amy" }
		})
		await zoneRow(s.id, { kind: "seated_member", id: 1 }, [
			{ entryId: 1, fields: { towards: ref } }
		])
		await widgetRow(s.id, u.id, {
			pickMembers: [ref],
			chosenImages: [`${ref}=i`]
		})
		await line(s.id, { metadata: { speaker: ref } as never })
		const m = await mirror(s.id)
		await blocksPart(m.id, {
			blocks: [
				{
					kind: "choices",
					addressee: ref,
					answered: { by: ref, at: "t" },
					actions: []
				}
			]
		})
		await imprint(s.id, m.id, "core/k", { audienceBefore: [ref], after: 1 })
		const before = await jsonDump()
		// order 1 + candidate 1 + lastSpeaker + turnsBy + spoke + persons + fates + audience + voice key + towards + pickMembers + chosen + speaker + addressee + by + imprint audience
		const report = await seatKeys(asDb())
		expect(report).toEqual({ ...ZEROS, left: 16 })
		expect(await jsonDump()).toEqual(before)
		expect(await seatKeys(asDb())).toEqual({ ...ZEROS, left: 16 })
		expect(await jsonDump()).toEqual(before)
	})

	test("a second run: every touched JSON column is the same text, and the report is all zeros", async () => {
		const f = await fixture()
		await seedAll(f)
		const first = await seatKeys(asDb())
		expect(first.sessions).toBe(1)
		expect(first.left).toBe(0)
		const after = await jsonDump()
		loaded.sessionIds.length = 0
		expect(await seatKeys(asDb())).toEqual(ZEROS)
		expect(await jsonDump()).toEqual(after)
		// Nothing is left in card form, so the fast path names no session at all.
		expect(loaded.sessionIds).toEqual([])
	})
})
