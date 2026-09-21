/**
 * Writing a session's numbers onto the world's timeline.
 *
 * Four claims, and the middle two are the whole reason this exists:
 *
 *  1. **A durable row is filed against the WORLD**, not the session — owner
 *     `cast_member` or `lorebook`, anchored to a history entry and a scene,
 *     with provenance ints that carry no keys.
 *  2. **It survives the session's deletion**, which is what the safeguard is
 *     for: everything `session_id` points at cascades away, and where a
 *     character ended up must not go with it.
 *  3. **No lorebook, no timeline.** A session with no world has nowhere to
 *     record to and its state dies with it. Correct, and not a gap.
 *  4. A derived slot is never recorded, and an absent value writes no row —
 *     "we did not record a mood" and "her mood was nothing" are different
 *     claims, and only the missing row can say the first.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	defineAttributeSlot,
	derivations,
	genre,
	_clearAttributeSlots
} from "@serene-pub/sdk"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
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
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-state-durable-")
	)
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
const BIRTHDATE = "core:slot/birthdate@1"
const AGE = "core:slot/age@1"
const GENRE = "test:genre/durable"

function declareSlots() {
	_clearAttributeSlots()
	const declared = [
		defineAttributeSlot(HP, {
			type: "integer",
			descriptor: "How much punishment they can still take.",
			appliesTo: ["cast"],
			config: { min: 0, max: 20 },
			default: 20
		}),
		defineAttributeSlot(MOOD, {
			type: "enum",
			descriptor: "How they are feeling.",
			appliesTo: ["cast"],
			config: { of: ["calm", "wary"] }
		}),
		defineAttributeSlot(WEATHER, {
			type: "enum",
			descriptor: "What the sky is doing.",
			appliesTo: ["world"],
			config: { of: ["clear", "storm"] }
		}),
		defineAttributeSlot(BIRTHDATE, {
			type: "text",
			descriptor: "When they were born.",
			appliesTo: ["cast"]
		}),
		defineAttributeSlot(AGE, {
			type: "derived",
			descriptor: "How old they are.",
			appliesTo: ["cast"],
			config: { derivation: derivations.age.id, from: BIRTHDATE }
		})
	]
	genre(GENRE, {
		name: { en: "Durable" },
		family: "test",
		slots: declared,
		events: {}
	})
}

let n = 0

async function world(opts: { lorebook?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `durable-${suffix}`)
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: `Verity ${suffix}`, description: "…" })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			genreId: GENRE
		})
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: verity.id })

	let lorebook: typeof schema.lorebooks.$inferSelect | undefined
	let binding: typeof schema.lorebookBindings.$inferSelect | undefined
	let entry: typeof schema.lorebookEntries.$inferSelect | undefined
	if (opts.lorebook !== false) {
		;[lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: `World ${suffix}` })
			.returning()
		await testDb
			.insert(schema.sessionLorebooks)
			.values({ sessionId: session.id, lorebookId: lorebook!.id })
		;[binding] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook!.id,
				characterId: verity.id,
				binding: `{{char:${verity.id}}}`,
				name: verity.name
			})
			.returning()
		;[entry] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: lorebook!.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: 0,
				title: "The bell drowned",
				content: "…",
				fields: { year: 412, month: 3 }
			})
			.returning()
	}

	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			role: "assistant",
			characterId: verity.id,
			content: "…"
		})
		.returning()
	await testDb.insert(schema.messages).values({
		id: legacy.id,
		sessionId: session.id,
		characterId: verity.id,
		role: "assistant"
	})

	return { user, verity, session, lorebook, binding, entry, message: legacy }
}

const setSessionValue = async (
	w: Awaited<ReturnType<typeof world>>,
	owner: { kind: "session" | "session_cast"; id: number },
	slotId: string,
	v: unknown
) =>
	await testDb.insert(schema.attributeValues).values({
		ownerKind: owner.kind,
		ownerId: owner.id,
		slotId,
		value: { v },
		sessionId: w.session.id,
		validFromMessageId: w.message.id,
		updatedBy: "user"
	})

const durableRows = async (ownerKind: string, ownerId: number) =>
	await testDb
		.select()
		.from(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.ownerKind, ownerKind),
				eq(schema.attributeValues.ownerId, ownerId)
			)
		)

describe("recording to the timeline", () => {
	test("the world's numbers land on the world, anchored and provenanced", async () => {
		declareSlots()
		const w = await world()
		await setSessionValue(w, { kind: "session", id: w.session.id }, WEATHER, "storm")
		await setSessionValue(
			w,
			{ kind: "session_cast", id: w.verity.id },
			HP,
			14
		)

		const { recordToTimeline } = await import("$lib/server/state/durable")
		const report = await recordToTimeline(testDb as unknown as Db, w.session.id, {
			reason: "mark",
			historyEntryId: w.entry!.id
		})
		expect(report.recorded).toBe(true)

		const [onWorld] = await durableRows("lorebook", w.lorebook!.id)
		expect(onWorld.slotId).toBe(WEATHER)
		expect(onWorld.value).toEqual({ v: "storm" })
		expect(onWorld.historyEntryId).toBe(w.entry!.id)
		// ⚠ Plain ints with no key — that is what lets the row outlive the run.
		expect(onWorld.sourceSessionId).toBe(w.session.id)
		expect(onWorld.sourceMessageId).toBe(w.message.id)
		expect(onWorld.updatedBy).toBe(`session:${w.session.id}`)
		// NOT session-scoped: `session_id` is the column that cascades.
		expect(onWorld.sessionId).toBeNull()
		expect(onWorld.branchId).toBeNull()

		const cast = await durableRows("cast_member", w.binding!.id)
		expect(cast.map((r) => r.slotId)).toContain(HP)
		expect(cast.find((r) => r.slotId === HP)!.value).toEqual({ v: 14 })
	})

	test("a value is recorded WITH the configuration it was written under", async () => {
		declareSlots()
		const w = await world()
		await setSessionValue(
			w,
			{ kind: "session_cast", id: w.verity.id },
			HP,
			14
		)
		const { recordToTimeline } = await import("$lib/server/state/durable")
		await recordToTimeline(testDb as unknown as Db, w.session.id, {
			reason: "mark",
			historyEntryId: w.entry!.id
		})
		const [config] = await testDb
			.select()
			.from(schema.attributeConfigs)
			.where(
				and(
					eq(schema.attributeConfigs.ownerKind, "cast_member"),
					eq(schema.attributeConfigs.ownerId, w.binding!.id),
					eq(schema.attributeConfigs.slotId, HP)
				)
			)
		// A 35 means one thing under a cap of 40 and is impossible under 20;
		// the number alone could never say what it meant.
		expect(config.config).toMatchObject({ min: 0, max: 20 })
		expect(config.historyEntryId).toBe(w.entry!.id)
	})

	test("a derived slot is never recorded, and an absent value writes no row", async () => {
		declareSlots()
		const w = await world()
		await setSessionValue(
			w,
			{ kind: "session_cast", id: w.verity.id },
			BIRTHDATE,
			"380-06"
		)
		const { recordToTimeline } = await import("$lib/server/state/durable")
		await recordToTimeline(testDb as unknown as Db, w.session.id, {
			reason: "mark",
			historyEntryId: w.entry!.id
		})
		const slots = (await durableRows("cast_member", w.binding!.id)).map(
			(r) => r.slotId
		)
		expect(slots).toContain(BIRTHDATE)
		// Defaulted, so it has a value and is recorded.
		expect(slots).toContain(HP)
		// Computed, so it has none to record.
		expect(slots).not.toContain(AGE)
		// Nobody has said anything about her mood: absent, not "nothing".
		expect(slots).not.toContain(MOOD)
	})

	test("a session with no world records nothing at all", async () => {
		declareSlots()
		const w = await world({ lorebook: false })
		await setSessionValue(
			w,
			{ kind: "session_cast", id: w.verity.id },
			HP,
			9
		)
		const { recordToTimeline } = await import("$lib/server/state/durable")
		const report = await recordToTimeline(
			testDb as unknown as Db,
			w.session.id,
			{ reason: "mark" }
		)
		expect(report).toMatchObject({ recorded: false, values: 0, configs: 0 })
	})
})

describe("the delete safeguard", () => {
	test("the session's state survives the session", async () => {
		declareSlots()
		const w = await world()
		await setSessionValue(
			w,
			{ kind: "session_cast", id: w.verity.id },
			HP,
			4
		)
		await setSessionValue(
			w,
			{ kind: "session", id: w.session.id },
			WEATHER,
			"storm"
		)
		// A scene, so the safeguard has a moment on the story clock to file at.
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({
				sessionId: w.session.id,
				lorebookId: w.lorebook!.id,
				historyEntryId: w.entry!.id,
				name: "The bell"
			})
			.returning()

		const { sessionsDeleteHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionsDeleteHandler.handler(
			{
				user: { id: w.user.id },
				io: { to: () => ({ emit: () => {} }) }
			} as any,
			{ id: w.session.id } as any,
			() => {}
		)

		// Everything session-scoped went with the session…
		expect(
			await testDb
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.id, w.session.id))
		).toHaveLength(0)
		// …and the world kept what the session made true.
		const cast = await durableRows("cast_member", w.binding!.id)
		const hp = cast.find((r) => r.slotId === HP)
		expect(hp?.value).toEqual({ v: 4 })
		expect(hp?.sourceSessionId).toBe(w.session.id)
		expect(hp?.sceneId).toBe(scene.id)
		const onWorld = await durableRows("lorebook", w.lorebook!.id)
		expect(
			onWorld.find((r) => r.slotId === WEATHER)?.value
		).toEqual({ v: "storm" })
	})
})

describe("scene capture", () => {
	test("capturing a moment records the state at it", async () => {
		declareSlots()
		const w = await world()
		await setSessionValue(
			w,
			{ kind: "session_cast", id: w.verity.id },
			HP,
			7
		)
		const { sceneCreateHandler } = await import(
			"$lib/server/sockets/scenes"
		)
		const res: any = await sceneCreateHandler.handler(
			{ user: { id: w.user.id } } as any,
			{
				scene: {
					sessionId: w.session.id,
					lorebookId: w.lorebook!.id,
					historyEntryId: w.entry!.id,
					name: "The bell drowned",
					selectedMessageIds: [w.message.id]
				}
			} as any,
			async () => {}
		)
		const sceneId = res.scene.id
		const cast = await durableRows("cast_member", w.binding!.id)
		const hp = cast.find((r) => r.slotId === HP)
		expect(hp?.value).toEqual({ v: 7 })
		// The scene names the history entry, which is the moment on the story
		// clock the numbers are true at.
		expect(hp?.sceneId).toBe(sceneId)
		expect(hp?.historyEntryId).toBe(w.entry!.id)
	})
})
