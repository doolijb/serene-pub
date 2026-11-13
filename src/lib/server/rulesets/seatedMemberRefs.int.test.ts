/**
 * 🚧 Refs in at the rules engine's doors (plan §27 S2): a seated cast member's
 * `seated-member:<memberId>` ref / `{ kind: "seated_member", id }` owner reads
 * as its seat's stored key (`character:<cardId>` / `session_cast`) — through
 * the ruleset handler's owners, deltas and zone asks, `ownersFrom`, the stat
 * trail socket and a far end's name — and no row is ever written under
 * `seated_member`. Names read from the member as read.
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
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { getRuleset } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { declareTrial, HP, TRIAL } from "./trialRuleset.testkit"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const GENRE = "test:genre/seated-member-refs"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-seatedMemberRefs-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { slots } = declareTrial()
	genreKeeping(GENRE, {
		name: { en: "Seated member refs" },
		family: "test",
		slots,
		events: {}
	})
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const switchWas = memberFormSwitch.on
afterEach(() => {
	memberFormSwitch.on = switchWas
})

let n = 0

/** A session with three cards: Ann (seated on a member with its own name), Bram (seated, no member yet), Cora (seated on Ann's member too, later). */
async function world(opts: { coraFirst?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `seated-refs-${suffix}`)
	const [ann, bram, cora] = await db
		.insert(schema.characters)
		.values([
			{
				userId: user.id,
				name: `Ann ${suffix}`,
				description: "A knight."
			},
			{
				userId: user.id,
				name: `Bram ${suffix}`,
				description: "A smith."
			},
			{ userId: user.id, name: `Cora ${suffix}`, description: "A thief." }
		])
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Run ${suffix}`,
			genreId: GENRE,
			primaryRuleset: TRIAL,
			rigour: "mechanics"
		})
		.returning()
	await db
		.insert(schema.messages)
		.values({ sessionId: session!.id, role: "character" })
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const notes = await ownBookFor(db as any, session!.id)
	const member = async (
		characterId: number | null,
		ownName: string | null = null
	) =>
		(
			await insertCastMember(db, {
				lorebookId: notes.id,
				characterId,
				binding: `{{char:${suffix}-${Math.random()}}}`,
				name: "",
				...(ownName ? { ownName } : {})
			})
		).member
	const annMember = await member(ann!.id, `Annabel ${suffix}`)
	const loose = await member(null, "Nobody seated")
	await db.insert(schema.sessionCharacters).values([
		{
			sessionId: session!.id,
			characterId: ann!.id,
			castMemberId: annMember.id,
			position: opts.coraFirst ? 1 : 0
		},
		{ sessionId: session!.id, characterId: bram!.id, position: 2 },
		{
			sessionId: session!.id,
			characterId: cora!.id,
			castMemberId: annMember.id,
			position: opts.coraFirst ? 0 : 1
		}
	])
	return {
		user,
		ann: ann!,
		bram: bram!,
		cora: cora!,
		session: session!,
		annMember,
		loose,
		suffix
	}
}

describe("the ruleset handler's doors", () => {
	test("a seated-member ref reads and writes the same row as character:<cardId>; none is stored under seated_member (switch off)", async () => {
		memberFormSwitch.on = false
		const w = await world()
		const { resolveRulesetTurn } = await import("./resolve")
		const read = async (owner: unknown) => {
			const res = await resolveRulesetTurn(db as any, {
				owners: [`session:${w.session.id}`, owner],
				mode: "resolve"
			})
			if ("halt" in res) throw new Error(res.halt)
			return res.ok
		}
		const byCard = await read(`character:${w.ann.id}`)
		const byMember = await read(`seated-member:${w.annMember.id}`)
		const byOwner = await read({
			kind: "seated_member",
			id: w.annMember.id
		})
		expect(byCard.blocks.sheet!.text).toBeTruthy()
		expect(byMember.blocks.sheet!.text).toBe(byCard.blocks.sheet!.text)
		expect(byOwner.blocks.sheet!.text).toBe(byCard.blocks.sheet!.text)
		expect(byMember.facts.unknownOwners).toBeUndefined()

		const applied = await resolveRulesetTurn(db as any, {
			owners: [
				`session:${w.session.id}`,
				`seated-member:${w.annMember.id}`
			],
			mode: "apply",
			deltas: [
				{
					owner: `seated-member:${w.annMember.id}`,
					slot: "hp",
					op: "add",
					value: -5,
					reason: "arrow"
				}
			]
		})
		if ("halt" in applied) throw new Error(applied.halt)
		const rows = await db
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.sessionId, w.session.id),
					eq(schema.attributeValues.slotId, HP)
				)
			)
		expect(rows.map((r) => [r.ownerKind, r.ownerId])).toEqual([
			["session_cast", w.ann.id]
		])
		const all = await db
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.sessionId, w.session.id))
		expect(
			all.some((r) => (r.ownerKind as string) === "seated_member")
		).toBe(false)
		const { stateFor } = await import("$lib/server/state/resolve")
		expect(
			(
				(await stateFor(db as any, w.session.id)).cast.byId[
					String(w.ann.id)
				] as any
			).hp
		).toBe(15)
	})

	test("switch on: a seated-member ref reads and writes the member's own rows, under seated_member", async () => {
		memberFormSwitch.on = true
		const w = await world()
		const { resolveRulesetTurn } = await import("./resolve")
		const read = async (owner: unknown) => {
			const res = await resolveRulesetTurn(db as any, {
				owners: [`session:${w.session.id}`, owner],
				mode: "resolve"
			})
			if ("halt" in res) throw new Error(res.halt)
			return res.ok
		}
		const byCard = await read(`character:${w.ann.id}`)
		const byMember = await read(`seated-member:${w.annMember.id}`)
		const byOwner = await read({
			kind: "seated_member",
			id: w.annMember.id
		})
		expect(byCard.blocks.sheet!.text).toBeTruthy()
		expect(byMember.blocks.sheet!.text).toBe(byCard.blocks.sheet!.text)
		expect(byOwner.blocks.sheet!.text).toBe(byCard.blocks.sheet!.text)
		expect(byMember.facts.unknownOwners).toBeUndefined()

		const applied = await resolveRulesetTurn(db as any, {
			owners: [
				`session:${w.session.id}`,
				`seated-member:${w.annMember.id}`
			],
			mode: "apply",
			deltas: [
				{
					owner: `seated-member:${w.annMember.id}`,
					slot: "hp",
					op: "add",
					value: -5,
					reason: "arrow"
				}
			]
		})
		if ("halt" in applied) throw new Error(applied.halt)
		const rows = await db
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.sessionId, w.session.id),
					eq(schema.attributeValues.slotId, HP)
				)
			)
		expect(rows.map((r) => [r.ownerKind, r.ownerId])).toEqual([
			["seated_member", w.annMember.id]
		])
		const { stateFor } = await import("$lib/server/state/resolve")
		expect(
			(
				(await stateFor(db as any, w.session.id)).cast.byId[
					`seated_member:${w.annMember.id}`
				] as any
			).hp
		).toBe(15)
	})

	test("a member with no seat is an unknown owner, as an unseated card is", async () => {
		const w = await world()
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(db as any, {
			owners: [`session:${w.session.id}`, `seated-member:${w.loose.id}`],
			mode: "resolve"
		})
		if ("halt" in res) throw new Error(res.halt)
		expect(res.ok.facts.unknownOwners).toEqual([
			`seated-member:${w.loose.id}`
		])
	})
})

describe("ownersFrom", () => {
	test("a seated-member ref is the seat's cast owner; an unseated member's is refused (switch off)", async () => {
		memberFormSwitch.on = false
		const w = await world()
		const { ownersFrom } = await import(
			"$lib/server/pipelines/runtime/bindings.state"
		)
		const refused: string[] = []
		const seatedOwners: unknown[] = []
		const owners = await ownersFrom(
			[
				`seated-member:${w.annMember.id}`,
				`seated-member:${w.loose.id}`,
				`character:${w.bram.id}`
			],
			w.session.id,
			async (o) => void seatedOwners.push(o),
			refused,
			db as unknown as Db
		)
		expect(owners).toEqual([
			{ kind: "session_cast", id: w.ann.id },
			{ kind: "session_cast", id: w.bram.id }
		])
		expect(refused).toEqual([
			`"seated-member:${w.loose.id}" is not a cast member of session ${w.session.id}, so nothing was set on it.`
		])
	})

	test("switch on: a seated-member ref is the member's own owner; an unseated member's is refused", async () => {
		memberFormSwitch.on = true
		const w = await world()
		const { ownersFrom } = await import(
			"$lib/server/pipelines/runtime/bindings.state"
		)
		const refused: string[] = []
		const owners = await ownersFrom(
			[
				`seated-member:${w.annMember.id}`,
				`seated-member:${w.loose.id}`,
				`character:${w.bram.id}`
			],
			w.session.id,
			async () => {},
			refused,
			db as unknown as Db
		)
		expect(owners).toEqual([
			{ kind: "seated_member", id: w.annMember.id },
			{ kind: "session_cast", id: w.bram.id }
		])
		expect(refused).toEqual([
			`"seated-member:${w.loose.id}" is not a cast member of session ${w.session.id}, so nothing was set on it.`
		])
	})

	test("two live seats on one member: the lowest position's card (switch off)", async () => {
		memberFormSwitch.on = false
		const first = await world()
		const second = await world({ coraFirst: true })
		const { ownersFrom } = await import(
			"$lib/server/pipelines/runtime/bindings.state"
		)
		const pick = async (w: Awaited<ReturnType<typeof world>>) =>
			ownersFrom(
				[`seated-member:${w.annMember.id}`],
				w.session.id,
				async () => {},
				[],
				db as unknown as Db
			)
		expect(await pick(first)).toEqual([
			{ kind: "session_cast", id: first.ann.id }
		])
		expect(await pick(second)).toEqual([
			{ kind: "session_cast", id: second.cora.id }
		])
	})
})

describe("ownersFrom, two seats on one member, switch on", () => {
	test("two live seats on one member: the member of the lowest position's seat", async () => {
		memberFormSwitch.on = true
		const first = await world()
		const second = await world({ coraFirst: true })
		const { ownersFrom } = await import(
			"$lib/server/pipelines/runtime/bindings.state"
		)
		const pick = async (w: Awaited<ReturnType<typeof world>>) =>
			ownersFrom(
				[`seated-member:${w.annMember.id}`],
				w.session.id,
				async () => {},
				[],
				db as unknown as Db
			)
		expect(await pick(first)).toEqual([
			{ kind: "seated_member", id: first.annMember.id }
		])
		expect(await pick(second)).toEqual([
			{ kind: "seated_member", id: second.annMember.id }
		])
	})
})

describe("the stat trail socket", () => {
	test("a seated_member owner returns the trail of the seat's session_cast owner", async () => {
		const w = await world()
		const { resolveRulesetTurn } = await import("./resolve")
		const applied = await resolveRulesetTurn(db as any, {
			owners: [`session:${w.session.id}`, `character:${w.ann.id}`],
			mode: "apply",
			deltas: [
				{
					owner: `character:${w.ann.id}`,
					slot: "hp",
					op: "add",
					value: -3,
					reason: "arrow"
				}
			]
		})
		if ("halt" in applied) throw new Error(applied.halt)
		const { readStatTrail, StatTrailRefusal } = await import(
			"$lib/server/sockets/statTrail"
		)
		const byCard = await readStatTrail(
			{
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.ann.id },
				slotId: HP
			} as any,
			w.user.id
		)
		const byMember = await readStatTrail(
			{
				sessionId: w.session.id,
				owner: { kind: "seated_member", id: w.annMember.id },
				slotId: HP
			} as any,
			w.user.id
		)
		expect(byCard.changes.length).toBeGreaterThan(0)
		expect(byMember).toEqual(byCard)
		await expect(
			readStatTrail(
				{
					sessionId: w.session.id,
					owner: { kind: "seated_member", id: w.loose.id },
					slotId: HP
				} as any,
				w.user.id
			)
		).rejects.toThrow(
			new StatTrailRefusal("Name the stat's owner in this session.")
		)
	})

	test("a stranger learns nothing of a seat: the session refusal comes first", async () => {
		const w = await world()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(
			db,
			`seated-refs-stranger-${w.suffix}`
		)
		const { readStatTrail } = await import("$lib/server/sockets/statTrail")
		for (const id of [w.annMember.id, w.loose.id])
			await expect(
				readStatTrail(
					{
						sessionId: w.session.id,
						owner: { kind: "seated_member", id },
						slotId: HP
					} as any,
					stranger.id
				)
			).rejects.toThrow("This session is not one you are in.")
	})
})

describe("names read from the member", () => {
	test("a far end is named by its seat's member (their own name); a seat with no member reads the card", async () => {
		const w = await world()
		const { farEndsOf } = await import("./zones")
		const ruleset = getRuleset(TRIAL)!
		const set = (owner: string) => ({
			op: "set" as const,
			owner,
			entry: { entryType: "bond", name: "x" },
			field: "f",
			value: 1,
			key: "k"
		})
		const far = await farEndsOf(
			db as any,
			w.session.id,
			{ ruleset, owners: [] },
			[set(`character:${w.ann.id}`), set(`character:${w.bram.id}`)]
		)
		expect(far.owners.map((o) => [o.key, o.name])).toEqual([
			[`character:${w.ann.id}`, `Annabel ${w.suffix}`],
			[`character:${w.bram.id}`, `Bram ${w.suffix}`]
		])
	})
})
