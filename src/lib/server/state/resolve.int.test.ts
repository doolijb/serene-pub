/**
 * The resolution chain, against a real database.
 *
 * Four claims, and each one is a way the chain has failed in every stat system
 * that ever shipped:
 *
 *  1. **Session beats lorebook beats card beats default** — nearest layer wins.
 *  2. **Absence inherits.** A layer with no row is not a layer saying zero,
 *     which is the difference between "nobody has set her mood" and "her mood
 *     is nothing".
 *  3. **`null` clears one layer and falls through**, so a session can go back
 *     to inheriting without deleting evidence.
 *  4. **A derived slot is computed, never stored**, and is *absent* rather than
 *     zero when the world has no clock.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import {
	defineAttributeSlot,
	derivations,
	genre,
	_clearAttributeSlots
} from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-state-resolve-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"
const MOOD = "core:slot/mood@1"
const WEATHER = "core:slot/weather@1"
const BIRTHDATE = "core:slot/birthdate@1"
const AGE = "core:slot/age@1"

/**
 * The genre these declarations belong to.
 *
 * ⚠ A session resolves the slots ITS GENRE brings, not every slot the process
 * has heard of — otherwise an instance that merely has an adventure genre
 * installed would draw a health bar on every standard chat. So a test about
 * resolution has to say which genre it is resolving for, and the sessions below
 * carry this id.
 */
const GENRE = "test:genre/stats"

/**
 * A genre's declarations, made the way a genre makes them. Core ships no slot
 * definitions — it owns the types — so a test that wants one declares it, which
 * is exactly the authorship the design describes.
 */
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
			config: { of: ["calm", "wary", "furious"] }
		}),
		defineAttributeSlot(WEATHER, {
			type: "enum",
			descriptor: "What the sky is doing.",
			appliesTo: ["world"],
			config: { of: ["clear", "fog", "storm"] }
		}),
		defineAttributeSlot(BIRTHDATE, {
			type: "text",
			descriptor: "When they were born, on the story calendar.",
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
		name: { en: "Stats" },
		family: "test",
		slots: declared,
		events: {}
	})
}

let n = 0

/** One session with a world, a cast of one, and a message to anchor to. */
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `state-resolve-${suffix}`)
	const [character] = await db
		.insert(schema.characters)
		.values({
			userId: user.id,
			name: `Verity ${suffix}`,
			description: "A rider."
		})
		.returning()
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			genreId: GENRE
		})
		.returning()
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: character.id })
	await db
		.insert(schema.sessionLorebooks)
		.values({ sessionId: session.id, lorebookId: lorebook.id })
	const [binding] = await db
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			characterId: character.id,
			binding: "{{char:1}}",
			name: character.name
		})
		.returning()
	const [message] = await db
		.insert(schema.messages)
		.values({ sessionId: session.id, role: "character" })
		.returning()
	return { user, character, lorebook, session, binding, message }
}

const putValue = async (
	ownerKind: string,
	ownerId: number,
	slotId: string,
	v: unknown,
	extra: { sessionId?: number; validFromMessageId?: number } = {}
) => {
	await db.insert(schema.attributeValues).values({
		ownerKind,
		ownerId,
		slotId,
		value: { v },
		sessionId: extra.sessionId ?? null,
		validFromMessageId: extra.validFromMessageId ?? null,
		updatedBy: "user"
	})
}

describe("valueOf", () => {
	test("session beats lorebook beats card beats the declaration default", async () => {
		declareSlots()
		const w = await world()
		const { valueOf } = await import("$lib/server/state/resolve")
		const owner = { kind: "session_cast" as const, id: w.character.id }
		const ask = () =>
			valueOf(db, { sessionId: w.session.id, owner, slotId: HP })

		// Nothing anywhere: the declaration's default.
		expect(await ask()).toBe(20)

		await putValue("card", w.character.id, HP, 18)
		expect(await ask()).toBe(18)

		await putValue("cast_member", w.binding.id, HP, 15)
		expect(await ask()).toBe(15)

		await putValue("session_cast", w.character.id, HP, 12, {
			sessionId: w.session.id,
			validFromMessageId: w.message.id
		})
		expect(await ask()).toBe(12)
	})

	test("absence inherits — it never reads as zero", async () => {
		declareSlots()
		const w = await world()
		const { valueOf } = await import("$lib/server/state/resolve")
		await putValue("card", w.character.id, HP, 7)
		// The session has said nothing about this character at all.
		expect(
			await valueOf(db, {
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.character.id },
				slotId: HP
			})
		).toBe(7)
		// A slot nobody has valued and that declares no default is ABSENT.
		expect(
			await valueOf(db, {
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.character.id },
				slotId: MOOD
			})
		).toBeUndefined()
	})

	test("null clears one layer and falls through to the next", async () => {
		declareSlots()
		const w = await world()
		const { valueOf } = await import("$lib/server/state/resolve")
		await putValue("card", w.character.id, MOOD, "calm")
		await putValue("session_cast", w.character.id, MOOD, "furious", {
			sessionId: w.session.id,
			validFromMessageId: w.message.id
		})
		await putValue("session_cast", w.character.id, MOOD, null, {
			sessionId: w.session.id,
			validFromMessageId: w.message.id
		})
		expect(
			await valueOf(db, {
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.character.id },
				slotId: MOOD
			})
		).toBe("calm")
	})

	test("the world resolves session over lorebook", async () => {
		declareSlots()
		const w = await world()
		const { valueOf } = await import("$lib/server/state/resolve")
		const owner = { kind: "session" as const, id: w.session.id }
		await putValue("lorebook", w.lorebook.id, WEATHER, "fog")
		expect(
			await valueOf(db, {
				sessionId: w.session.id,
				owner,
				slotId: WEATHER
			})
		).toBe("fog")
		await putValue("session", w.session.id, WEATHER, "storm", {
			sessionId: w.session.id,
			validFromMessageId: w.message.id
		})
		expect(
			await valueOf(db, {
				sessionId: w.session.id,
				owner,
				slotId: WEATHER
			})
		).toBe("storm")
	})
})

describe("configuration", () => {
	test("deviations layer, nearest last, without dropping the others", async () => {
		declareSlots()
		const w = await world()
		const { configFor } = await import("$lib/server/state/resolve")
		await db.insert(schema.attributeConfigs).values({
			ownerKind: "cast_member",
			ownerId: w.binding.id,
			slotId: HP,
			config: { max: 40 }
		})
		await db.insert(schema.attributeConfigs).values({
			ownerKind: "session_cast",
			ownerId: w.character.id,
			slotId: HP,
			config: { min: -5 },
			sessionId: w.session.id,
			validFromMessageId: w.message.id
		})
		expect(
			await configFor(db, {
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.character.id },
				slotId: HP
			})
		).toEqual({ min: -5, max: 40 })
	})
})

describe("derived slots", () => {
	test("age is computed from a birthdate and the story date", async () => {
		declareSlots()
		const w = await world()
		const { valueOf } = await import("$lib/server/state/resolve")
		const owner = { kind: "session_cast" as const, id: w.character.id }

		await putValue("card", w.character.id, BIRTHDATE, "380-06")
		// No clock in this world yet: absent, and specifically not zero.
		expect(
			await valueOf(db, { sessionId: w.session.id, owner, slotId: AGE })
		).toBeUndefined()

		await db.insert(schema.lorebookEntries).values({
			lorebookId: w.lorebook.id,
			typeId: "core:entry/history",
			typeVersion: 1,
			position: 0,
			content: "The bell drowned.",
			fields: { year: 412, month: 3 }
		})
		expect(
			await valueOf(db, { sessionId: w.session.id, owner, slotId: AGE })
		).toBe(31)
	})

	test("a derived slot is never stored, so nothing writes one", async () => {
		declareSlots()
		const w = await world()
		const { setValue, StateRefusal } = await import(
			"$lib/server/state/write"
		)
		await expect(
			setValue(
				db,
				{ sessionId: w.session.id, updatedBy: "user" },
				{
					owner: { kind: "session_cast", id: w.character.id },
					slotId: AGE,
					value: 30
				}
			)
		).rejects.toBeInstanceOf(StateRefusal)
	})
})

describe("stateFor", () => {
	test("keys the world and the cast the way a template reads them", async () => {
		declareSlots()
		const w = await world()
		const { stateFor } = await import("$lib/server/state/resolve")
		await putValue("session", w.session.id, WEATHER, "storm", {
			sessionId: w.session.id,
			validFromMessageId: w.message.id
		})
		await putValue("session_cast", w.character.id, HP, 14, {
			sessionId: w.session.id,
			validFromMessageId: w.message.id
		})
		const state = await stateFor(db, w.session.id)
		expect(state.world.weather).toBe("storm")
		const key = w.character.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")
		expect(state.cast[key]?.hp).toBe(14)
		// Both keys, always — the bare one and the fully qualified one.
		expect(state.cast[key]?.core_hp).toBe(14)
	})
})
