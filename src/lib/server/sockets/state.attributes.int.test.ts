/**
 * What a session tracks — 🚧 RF fix 8 (owner ruling 2026-10-23): "attributes
 * are the ruleset's; sessions never add attributes". A genre brings none, the
 * world (a lorebook's sheets, its timeline) adds none, the session picks none:
 * the session's rules declare them, and a holder opts out of an optional one
 * (an attribute carry). Only what the session tracks is written back to the
 * world; the rest carries forward.
 *
 * The fixture: a genre that names nothing; a world (lorebook) with a sheet
 * bringing Mood and a timeline value for Weather; Gold declared and in
 * nobody's set; rules declared per test.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, defineRuleset, genre, _clearAttributeSlots } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-state-attributes-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"
const MOOD = "core:slot/mood@1"
const WEATHER = "core:slot/weather@1"
const GOLD = "core:slot/gold@1"
const SPRITE = "core:slot/sprite-set@1"

function declareSlots() {
	_clearAttributeSlots()
	defineAttributeSlot(HP, {
		type: "integer",
		label: "Health",
		descriptor: "How much punishment they can still take.",
		appliesTo: ["cast"],
		config: { min: 0, max: 20 },
		default: 20
	})
	defineAttributeSlot(MOOD, {
		type: "enum",
		label: "Mood",
		descriptor: "How they are carrying themselves.",
		appliesTo: ["cast"],
		config: { of: ["calm", "wary"] }
	})
	defineAttributeSlot(WEATHER, {
		type: "enum",
		label: "Weather",
		descriptor: "What the sky is doing.",
		appliesTo: ["world"],
		config: { of: ["clear", "storm"] }
	})
	// A slot a mechanism keeps: never an attribute a session picks.
	defineAttributeSlot(SPRITE, {
		type: "text",
		label: "Sprite set",
		descriptor: "The sprite set shown.",
		appliesTo: ["cast"],
		pickable: false
	})
	defineAttributeSlot(GOLD, {
		type: "integer",
		label: "Gold",
		descriptor: "Coin to hand.",
		appliesTo: ["cast"],
		config: { min: 0 }
	})
}

const socketOf = (userId: number) => ({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any

let n = 0

async function world() {
	declareSlots()
	const k = ++n
	const GENRE = `test:genre/attributes-${k}`
	// 🚧 RF fix 8: a genre names no slots — refused if it tried.
	genre(GENRE, {
		name: { en: "Attributes" },
		family: "test",
		events: {}
	})
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `attributes-owner-${k}`)
	const guest = await createTestUser(testDb, `attributes-guest-${k}`)
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: `Verity ${k}`, description: "A rider." })
		.returning()
	const [lorebook] = await testDb.insert(schema.lorebooks).values({ userId: user.id, name: `World ${k}` }).returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${k}`, genreId: GENRE })
		.returning()
	await testDb.insert(schema.sessionGuests).values({ sessionId: session.id, userId: guest.id })
	await testDb.insert(schema.sessionCharacters).values({ sessionId: session.id, characterId: character.id })
	await testDb
		// The real shape: the lorebook is the session row's own binding.
		.update(schema.sessions)
		.set({ lorebookId: lorebook.id })
		.where(eq(schema.sessions.id, session.id))
	await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId: lorebook.id, characterId: character.id, binding: `{{char:${k}}}`, name: character.name })
	// The world brings Mood through a sheet on its lorebook…
	const { declareSheet, setOwnerSheets } = await import("$lib/server/state/declarations")
	const sheet = `author${k}:sheet/world@1`
	await declareSheet(testDb as never, user.id, sheet, { label: { en: "World" }, slots: [{ id: MOOD }] })
	await setOwnerSheets(testDb as never, { kind: "lorebook", id: lorebook.id }, [sheet], { userId: user.id })
	// …and Weather through its timeline: a value an earlier session recorded.
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "lorebook",
		ownerId: lorebook.id,
		slotId: WEATHER,
		value: { v: "storm" },
		sessionId: null,
		updatedBy: "session:0"
	})
	return { user, guest, character, lorebook, session }
}

const tracked = async (sessionId: number) => {
	const { vocabularyFor } = await import("$lib/server/state/resolve")
	return (await vocabularyFor(testDb as never, sessionId)).entries.map((e) => e.decl.id).sort()
}

async function pick(
	userId: number,
	sessionId: number,
	params: { worldAttributes?: boolean; picks?: { slotId: string; enabled: boolean | null }[] }
) {
	const { stateSetAttributePicks } = await import("./state")
	const said: Array<[string, any]> = []
	const res = await stateSetAttributePicks
		.handler(socketOf(userId), { sessionId, ...params }, (event: string, data: unknown) => said.push([event, data]))
		.catch(() => undefined)
	return { res, error: said.find(([e]) => e.endsWith(":error"))?.[1]?.error as string | undefined }
}

/** Rules borrowing Health and Mood — what a session on them tracks. */
function rulesBorrowing(k: number, slots: string[] = [HP, MOOD]): string {
	const id = `test:ruleset/attributes-${k}@1`
	defineRuleset(id, {
		name: { en: "Borrowed" },
		attributes: slots.map((slot) => ({ id: slot.replace(/^core:slot\/|@1$/g, ""), slot, borrowed: true as const }))
	})
	return id
}

describe("🚧 RF fix 8: attributes are the rules' — a genre brings none, the world adds none, the session picks none", () => {
	test("rules that declare none: nothing tracked, whatever the world brings, and the card says so", async () => {
		const w = await world()
		expect(await tracked(w.session.id)).toEqual([])
		const { stateAttributes } = await import("./state")
		const res = await stateAttributes.handler(socketOf(w.user.id), { sessionId: w.session.id }, () => {})
		expect(res).toMatchObject({ declaresAttributes: false })
		expect(res.carries).toBeUndefined()
	})

	test("the rules' attributes, and only theirs — never the world's sheet or its timeline", async () => {
		const w = await world()
		const rules = rulesBorrowing(n, [HP])
		await testDb.update(schema.sessions).set({ primaryRuleset: rules }).where(eq(schema.sessions.id, w.session.id))
		expect(await tracked(w.session.id)).toEqual([HP])
		const { stateAttributes } = await import("./state")
		const res = await stateAttributes.handler(socketOf(w.user.id), { sessionId: w.session.id }, () => {})
		expect(res.declaresAttributes).toBe(true)
		expect(res.carries?.map((r) => r.slotId)).toEqual([HP])
	})

	test("a session adds none: a pick is refused in words, by anyone", async () => {
		const w = await world()
		for (const who of [w.user.id, w.guest.id])
			expect((await pick(who, w.session.id, { picks: [{ slotId: GOLD, enabled: true }] })).error).toMatch(/a session adds none/)
		expect((await pick(w.user.id, w.session.id, { worldAttributes: true })).error).toMatch(/a session adds none/)
		expect(await tracked(w.session.id)).toEqual([])
	})

	test("only what the session tracks is written back to the world; the rest carries forward", async () => {
		const w = await world()
		await testDb.update(schema.sessions).set({ primaryRuleset: rulesBorrowing(n) }).where(eq(schema.sessions.id, w.session.id))
		// Recording writes the world under Full (plan A22; Review changes, the
		// default, would file proposals instead).
		await testDb
			.insert(schema.userSettings)
			.values({ userId: w.user.id, loreWriteMode: "full" })
			.onConflictDoUpdate({ target: schema.userSettings.userId, set: { loreWriteMode: "full" } })
		// The session plays on: Mood moves; Weather it never tracks.
		const { setValue } = await import("$lib/server/state/write")
		await setValue(
			testDb as never,
			{ sessionId: w.session.id, updatedBy: "user" },
			{ owner: { kind: "session_cast", id: w.character.id }, slotId: MOOD, value: "wary" }
		)
		const { recordToTimeline } = await import("$lib/server/state/durable")
		await recordToTimeline(testDb as never, w.session.id, { reason: "mark" })
		const weather = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "lorebook"),
					eq(schema.attributeValues.ownerId, w.lorebook.id),
					eq(schema.attributeValues.slotId, WEATHER),
					isNull(schema.attributeValues.sessionId)
				)
			)
		// Untouched: the one row an earlier session recorded, still "storm".
		expect(weather.map((r) => (r.value as { v: unknown }).v)).toEqual(["storm"])
		const mood = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "cast_member"),
					eq(schema.attributeValues.slotId, MOOD),
					eq(schema.attributeValues.sourceSessionId, w.session.id)
				)
			)
		expect(mood.map((r) => (r.value as { v: unknown }).v)).toEqual(["wary"])
	})

	test("a slot a mechanism keeps is never tracked, even with a value on the world's timeline", async () => {
		const w = await world()
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "lorebook",
			ownerId: w.lorebook.id,
			slotId: SPRITE,
			value: { v: "armour" },
			sessionId: null,
			updatedBy: "session:0"
		})
		expect(await tracked(w.session.id)).not.toContain(SPRITE)
	})
})

describe("🚧 who carries what (attribute carries, RF fix 2 item 3)", () => {
	test("the session's owner switches a holder's attribute; a guest who does not play them cannot; a required one never switches", async () => {
		const w = await world()
		const { rulesetAttributeSlotId } = await import("@serene-pub/sdk")
		const RULES = `test:ruleset/carry-socket-${n}@1`
		defineRuleset(RULES, {
			name: { en: "Carry" },
			attributes: [
				{ id: "nerve", name: { en: "Nerve" }, kind: "pool", bounds: { max: 5 }, carriedBy: ["cast"], prose: "Nerve: courage held in reserve." },
				{ id: "heart", name: { en: "Heart" }, kind: "number", carriedBy: ["cast"], required: true, prose: "Heart: what keeps someone going." }
			]
		})
		await testDb.update(schema.sessions).set({ primaryRuleset: RULES }).where(eq(schema.sessions.id, w.session.id))
		const NERVE = rulesetAttributeSlotId(RULES, "nerve")
		const HEART = rulesetAttributeSlotId(RULES, "heart")
		const { stateAttributes, stateSetCarry } = await import("./state")
		const res = await stateAttributes.handler(socketOf(w.user.id), { sessionId: w.session.id }, () => {})
		// 🚧 RF fix 8: the optional one alone — Heart is no one's to switch.
		expect(res.carries?.map((r) => [r.slotId, r.required, r.holders.map((h) => [h.name, h.carries, h.mayChange])])).toEqual([
			[NERVE, false, [[w.character.name, true, true]]]
		])
		const setCarry = async (userId: number, slotId: string, carries: boolean) => {
			const said: Array<[string, any]> = []
			const out = await stateSetCarry
				.handler(socketOf(userId), { sessionId: w.session.id, owner: { kind: "session_cast", id: w.character.id }, slotId, carries }, (e: string, d: unknown) => said.push([e, d]))
				.catch(() => undefined)
			return { out, error: said.find(([e]) => e.endsWith(":error"))?.[1]?.error as string | undefined }
		}
		expect((await setCarry(w.guest.id, NERVE, false)).error).toBe(`Only whoever plays ${w.character.name}, or the session's owner, can change what ${w.character.name} carries.`)
		expect((await setCarry(w.user.id, HEART, false)).error).toBe("Everyone carries Heart: the rules require it.")
		const off = await setCarry(w.user.id, NERVE, false)
		expect(off.error).toBeUndefined()
		expect(off.out!.carries![0]!.holders[0]!.carries).toBe(false)
		const { stateFor } = await import("$lib/server/state/resolve")
		expect((await stateFor(testDb as never, w.session.id)).notCarried).toEqual({ [String(w.character.id)]: [NERVE] })
		// The guest is never offered the switch on someone else's holder.
		const theirs = await stateAttributes.handler(socketOf(w.guest.id), { sessionId: w.session.id }, () => {})
		expect(theirs.carries?.[0]?.holders[0]?.mayChange).toBe(false)
	})
})
