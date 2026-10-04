/**
 * What a session tracks (ruled 2026-09-25): "Genres set the baseline and
 * allow/deny custom attributes from being added. Only those tracked in the
 * session are updated in the lorebook, other stats carry forward. If a genre
 * allows attributes, session can set attributes or carry them in from the
 * lorebook as a defaulted opt in."
 *
 * The fixture: a genre whose baseline is Health; a world (lorebook) with a
 * sheet bringing Mood and a timeline value for Weather; Gold declared and in
 * nobody's set. The genre allows or denies custom attributes per test.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, genre, getAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
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

async function world(custom: "allow" | "deny") {
	declareSlots()
	const k = ++n
	const GENRE = `test:genre/attributes-${custom}-${k}`
	genre(GENRE, {
		name: { en: "Attributes" },
		family: "test",
		slots: [getAttributeSlot(HP)!],
		customAttributes: custom,
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

describe("the genre sets the baseline and decides whether anything else may come in", () => {
	test("a genre that denies tracks its baseline alone, whatever its world brings", async () => {
		const w = await world("deny")
		expect(await tracked(w.session.id)).toEqual([HP])
		const { stateAttributes } = await import("./state")
		const res = await stateAttributes.handler(socketOf(w.user.id), { sessionId: w.session.id }, () => {})
		expect(res).toMatchObject({ customAttributes: false, world: [], addable: [] })
		expect(res.baseline.map((r) => r.slotId)).toEqual([HP])
		// Nor can the session change it.
		expect((await pick(w.user.id, w.session.id, { picks: [{ slotId: GOLD, enabled: true }] })).error).toMatch(
			/tracks only its own attributes/
		)
	})

	test("a genre that allows carries in the world's attributes by default — its sheets and its timeline", async () => {
		const w = await world("allow")
		expect(await tracked(w.session.id)).toEqual([HP, MOOD, WEATHER].sort())
		const { stateAttributes } = await import("./state")
		const res = await stateAttributes.handler(socketOf(w.user.id), { sessionId: w.session.id }, () => {})
		expect(res.customAttributes).toBe(true)
		expect(res.worldAttributes).toBe(true)
		expect(res.world.map((r) => [r.slotId, r.tracked])).toEqual([
			[MOOD, true],
			[WEATHER, true]
		])
		expect(res.addable.map((r) => r.slotId)).toEqual([GOLD])
	})
})

describe("the session picks, and a pick carries forward", () => {
	test("switching the world off drops what it brought, never the baseline, and it stays listed to switch back", async () => {
		const w = await world("allow")
		const { res } = await pick(w.user.id, w.session.id, { worldAttributes: false })
		expect(await tracked(w.session.id)).toEqual([HP])
		expect(res!.world.map((r) => [r.slotId, r.tracked])).toEqual([
			[MOOD, false],
			[WEATHER, false]
		])
		await pick(w.user.id, w.session.id, { worldAttributes: true })
		expect(await tracked(w.session.id)).toEqual([HP, MOOD, WEATHER].sort())
	})

	test("a pick drops one world attribute, adds one of the session's own, and a cleared pick is the default again", async () => {
		const w = await world("allow")
		await pick(w.user.id, w.session.id, {
			picks: [
				{ slotId: WEATHER, enabled: false },
				{ slotId: GOLD, enabled: true }
			]
		})
		expect(await tracked(w.session.id)).toEqual([GOLD, HP, MOOD].sort())
		const { res } = await pick(w.user.id, w.session.id, { picks: [{ slotId: WEATHER, enabled: null }] })
		expect(await tracked(w.session.id)).toEqual([GOLD, HP, MOOD, WEATHER].sort())
		expect(res!.own.map((r) => r.slotId)).toEqual([GOLD])
	})

	test("the baseline cannot be dropped, and only the session's owner picks", async () => {
		const w = await world("allow")
		expect((await pick(w.user.id, w.session.id, { picks: [{ slotId: HP, enabled: false }] })).error).toMatch(
			/Health is part of this genre and cannot be dropped/
		)
		expect((await pick(w.guest.id, w.session.id, { worldAttributes: false })).error).toMatch(
			/Only the session's owner/
		)
		expect(await tracked(w.session.id)).toEqual([HP, MOOD, WEATHER].sort())
	})

	test("only what the session tracks is written back to the world; the rest carries forward", async () => {
		const w = await world("allow")
		// Recording writes the world under Full (plan A22; Review changes, the
		// default, would file proposals instead).
		await testDb
			.insert(schema.userSettings)
			.values({ userId: w.user.id, loreWriteMode: "full" })
			.onConflictDoUpdate({ target: schema.userSettings.userId, set: { loreWriteMode: "full" } })
		await pick(w.user.id, w.session.id, { picks: [{ slotId: WEATHER, enabled: false }] })
		// The session plays on: Mood moves; Weather it no longer tracks.
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
})

describe("a slot a mechanism keeps is never an attribute", () => {
	test("never offered, never carried in from the world, and refused as a pick", async () => {
		const w = await world("allow")
		// Even with a value on the world's timeline…
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "lorebook",
			ownerId: w.lorebook.id,
			slotId: SPRITE,
			value: { v: "armour" },
			sessionId: null,
			updatedBy: "session:0"
		})
		expect(await tracked(w.session.id)).not.toContain(SPRITE)
		const { stateAttributes } = await import("./state")
		const res = await stateAttributes.handler(socketOf(w.user.id), { sessionId: w.session.id }, () => {})
		expect([...res.world, ...res.addable].map((r) => r.slotId)).not.toContain(SPRITE)
		expect((await pick(w.user.id, w.session.id, { picks: [{ slotId: SPRITE, enabled: true }] })).error).toMatch(
			/Sprite set is kept by Serene Pub itself/
		)
		expect(await tracked(w.session.id)).not.toContain(SPRITE)
	})
})
