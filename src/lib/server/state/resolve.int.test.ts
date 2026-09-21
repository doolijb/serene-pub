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
import { eq } from "drizzle-orm"
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

// ── Two indexes, one set of entries (R17) ───────────────────────────────────

describe("the cast, twice over", () => {
	test("byId and the slug are the SAME object", async () => {
		declareSlots()
		const w = await world()
		const { stateFor, castKey } = await import("$lib/server/state/resolve")
		await putValue("session_cast", w.character.id, HP, 14, {
			sessionId: w.session.id,
			validFromMessageId: w.message.id
		})
		const state = await stateFor(db, w.session.id)
		const byId = state.cast.byId[String(w.character.id)]
		const bySlug = state.cast[castKey(w.character.name)]
		// Not "deeply equal" — the same object. A template editing one and a
		// script editing the other must be editing one thing.
		expect(bySlug).toBe(byId)
		expect(byId.id).toBe(w.character.id)
		expect(byId.name).toBe(w.character.name)
		expect(byId.key).toBe(castKey(w.character.name))
		expect(byId.hp).toBe(14)
	})

	test("byId is always there, empty or not", async () => {
		declareSlots()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(db, `empty-cast-${++n}`)
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				name: "Empty",
				genreId: GENRE
			})
			.returning()
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db, session.id)
		expect(state.cast.byId).toEqual({})
	})
})

// ── who (R16) ───────────────────────────────────────────────────────────────

describe("who", () => {
	/** A session with two characters, a persona, and some turns. */
	async function peopled() {
		const suffix = `${++n}`
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(db, `who-${suffix}`)
		const mk = async (name: string, isPersona = false) =>
			(
				await db
					.insert(schema.characters)
					.values({
						userId: user.id,
						name: `${name} ${suffix}`,
						description: "…",
						isPersona
					})
					.returning()
			)[0]
		const verity = await mk("Verity")
		const marrow = await mk("Marrow")
		const player = await mk("Rook", true)
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: true,
				name: `Run ${suffix}`,
				genreId: GENRE
			})
			.returning()
		for (const [i, c] of [verity, marrow].entries())
			await db.insert(schema.sessionCharacters).values({
				sessionId: session.id,
				characterId: c.id,
				position: i
			})
		await db
			.insert(schema.sessionPersonas)
			.values({ sessionId: session.id, personaId: player.id, position: 0 })
		const say = async (speakerId: number | null) => {
			const [row] = await db
				.insert(schema.messages)
				.values({
					sessionId: session.id,
					role: "assistant",
					characterId: speakerId
				})
				.returning()
			return row
		}
		return { user, verity, marrow, player, session, say }
	}

	test("an absent role is an absent KEY, never a null", async () => {
		declareSlots()
		const w = await peopled()
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db, w.session.id)
		// Nobody has spoken and nobody asked, so four of the seven are simply
		// not there — "nobody has spoken yet" is a different sentence from
		// "the speaker is nothing".
		expect("speaker" in state.who).toBe(false)
		expect("last" in state.who).toBe(false)
		expect("previous" in state.who).toBe(false)
		expect("user" in state.who).toBe(false)
		// Two that are: the owner's persona, and the seated active cast.
		expect(state.who.owner?.id).toBe(w.player.id)
		expect(state.who.active.map((e) => e.id)).toEqual([
			w.verity.id,
			w.marrow.id
		])
		// No `narrator` and no `addressed`, ever.
		expect("narrator" in state.who).toBe(false)
		expect("addressed" in state.who).toBe(false)
	})

	test("last and previous are the two most recent DIFFERENT speakers", async () => {
		declareSlots()
		const w = await peopled()
		await w.say(w.marrow.id)
		await w.say(w.verity.id)
		// Answering herself does not make her her own predecessor.
		await w.say(w.verity.id)
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db, w.session.id)
		expect(state.who.last?.id).toBe(w.verity.id)
		expect(state.who.previous?.id).toBe(w.marrow.id)
	})

	test("every role points at the SAME entry the cast holds", async () => {
		declareSlots()
		const w = await peopled()
		await w.say(w.verity.id)
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db, w.session.id, {
			speakerId: w.verity.id,
			userId: w.user.id
		})
		const entry = state.cast.byId[String(w.verity.id)]
		expect(state.who.speaker).toBe(entry)
		expect(state.who.last).toBe(entry)
		expect(state.who.active[0]).toBe(entry)
		// The asking user's own persona — a character, seated as their voice.
		expect(state.who.user?.id).toBe(w.player.id)
		expect(state.who.user).toBe(state.cast.byId[String(w.player.id)])
	})

	test("a speaker nobody is in this cast leaves the key absent", async () => {
		declareSlots()
		const w = await peopled()
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db, w.session.id, { speakerId: 9_999_999 })
		// Half an entry — an identity with no values — would be worse than no
		// answer at all.
		expect("speaker" in state.who).toBe(false)
	})
})

// ── Derivations written as expressions (R11) ────────────────────────────────

describe("a derivation is an expression over the resolved state", () => {
	const STAMINA = "core:slot/stamina@1"
	const SPENT = "core:slot/spent@1"
	const CONDITION = "core:slot/condition@1"
	const DERIVE_GENRE = "test:genre/derive"

	function declareDerived() {
		_clearAttributeSlots()
		const stamina = defineAttributeSlot(STAMINA, {
			type: "integer",
			descriptor: "How much they have left in them.",
			appliesTo: ["cast"],
			config: { min: 0, max: 10 },
			default: 10
		})
		// Reads the stored slot…
		const spent = defineAttributeSlot(SPENT, {
			type: "derived",
			descriptor: "How much they have burned through.",
			appliesTo: ["cast"],
			derive: "10 | minus: owner.stamina"
		})
		// …and this one reads THAT, so the order is not the declaration order.
		const condition = defineAttributeSlot(CONDITION, {
			type: "derived",
			descriptor: "Whether they are visibly spent.",
			appliesTo: ["cast"],
			derive: "owner.spent > 5"
		})
		genre(DERIVE_GENRE, {
			name: { en: "Derive" },
			family: "test",
			// ⚠ `condition` is listed BEFORE the `spent` it reads, so a naive
			// pass in declaration order would compute it against nothing. The
			// order is the graph's.
			slots: [stamina, condition, spent],
			events: {}
		})
	}

	async function derivedWorld() {
		const suffix = `${++n}`
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(db, `derive-${suffix}`)
		const [character] = await db
			.insert(schema.characters)
			.values({ userId: user.id, name: `Wren ${suffix}`, description: "…" })
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				name: `Run ${suffix}`,
				genreId: DERIVE_GENRE
			})
			.returning()
		await db
			.insert(schema.sessionCharacters)
			.values({ sessionId: session.id, characterId: character.id })
		const [message] = await db
			.insert(schema.messages)
			.values({
				sessionId: session.id,
				role: "assistant",
				characterId: character.id
			})
			.returning()
		return { user, character, session, message }
	}

	test("a derived slot is computed, in dependency order", async () => {
		declareDerived()
		const w = await derivedWorld()
		await putValue("session_cast", w.character.id, STAMINA, 2, {
			sessionId: w.session.id,
			validFromMessageId: w.message.id
		})
		const { castKey, stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db, w.session.id)
		const entry: any = state.cast[castKey(w.character.name)]
		expect(entry.stamina).toBe(2)
		expect(entry.spent).toBe(8)
		// Reads `spent`, which is itself derived: the order is the graph's, not
		// the declaration list's. Declared last and computed last is a
		// coincidence here; reversing the declarations would not change it.
		expect(entry.condition).toBe(true)
	})

	test("a derived slot is never written, and is absent rather than zero", async () => {
		declareDerived()
		const w = await derivedWorld()
		const { setValue, StateRefusal } = await import(
			"$lib/server/state/write"
		)
		await expect(
			setValue(db, { sessionId: w.session.id, updatedBy: "user" }, {
				owner: { kind: "session_cast", id: w.character.id },
				slotId: SPENT,
				value: 4
			})
		).rejects.toBeInstanceOf(StateRefusal)
	})

	test("a circle is refused at save, where the person who wrote it is", async () => {
		declareDerived()
		const { checkDerivationGraph } = await import(
			"$lib/server/state/resolve"
		)
		const ring = [
			{
				id: "x:slot/a@1",
				type: "derived",
				descriptor: "A.",
				appliesTo: ["cast"],
				origin: "stored",
				derive: "owner.b | plus: 1"
			},
			{
				id: "x:slot/b@1",
				type: "derived",
				descriptor: "B.",
				appliesTo: ["cast"],
				origin: "stored",
				derive: "owner.a | plus: 1"
			}
		] as any
		expect(checkDerivationGraph(ring)).toMatch(/circle/)
		expect(checkDerivationGraph([ring[0]])).toBeNull()
	})
})

// ── Retirement (R3) ─────────────────────────────────────────────────────────

describe("a retired slot", () => {
	test("still resolves, still shows, and is flagged", async () => {
		declareSlots()
		const w = await world()
		const { retireAttributeSlot, defineStoredAttributeSlot } = await import(
			"@serene-pub/sdk"
		)
		const mine = "somebody:slot/dread@1"
		const decl = defineStoredAttributeSlot(
			mine,
			{
				type: "integer",
				descriptor: "How frightened they are.",
				appliesTo: ["cast"],
				config: { min: 0, max: 10 },
				default: 0
			},
			{ userId: w.user.id }
		)
		genre("test:genre/retired", {
			name: { en: "Retired" },
			family: "test",
			slots: [decl],
			events: {}
		})
		await db
			.update(schema.sessions)
			.set({ genreId: "test:genre/retired" })
			.where(eq(schema.sessions.id, w.session.id))
		await putValue("session_cast", w.character.id, mine, 7, {
			sessionId: w.session.id,
			validFromMessageId: w.message.id
		})
		retireAttributeSlot(mine)

		const { castKey, stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db, w.session.id)
		// Everything already written stays and still resolves — the values are
		// somebody's play, not a definition.
		expect((state.cast[castKey(w.character.name)] as any).dread).toBe(7)
		expect(state.slots.find((s) => s.id === mine)?.retired).toBe(true)
	})
})
