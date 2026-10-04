/**
 * A whisper reaches only the people who may hear it (plan A28, earshot 🔒).
 *
 * `core:slot/whisper@1` declares `earshot: 'holder'`: its value is heard by
 * its holder alone. The prompts have honoured that since lair pass R1
 * (`withinEarshot`). A person's view is its data audience — the session's
 * owner, who whispers, and whoever portrays the holder — and every `state:*`
 * reply that carries values is that view: `state:get` (and so the
 * `session_state.v1` section every widget and plugin frame is handed),
 * `state:ledger`, `state:proposals`, and the state a write's own reply
 * carries (`state:set`, `state:configure`, `state:decide`).
 *
 * The table: the owner runs it; Ash and Bram are two guests' own presences;
 * Vell is a cast member the model voices; a third guest watches with no
 * character of their own. The owner whispers to all three.
 * Each guest hears their own character's whisper and nobody else's; the
 * owner hears every one; a plain stat stays everybody's.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, genre, getAttributeSlot } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-state-earshot-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const WHISPER = "core:slot/whisper@1"
const GRIT = "test:slot/stamina@1"

/** Each whisper distinct enough to find anywhere in a payload. */
const TO_ASH = "the east door is a lie"
const TO_BRAM = "keep the lamp for yourself"
const TO_VELL = "the idol is hollow"

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } }
	} as any
}

let n = 0

type Seated = { vell: { id: number }; ash: { id: number }; bram: { id: number }; suffix: string }

/**
 * The owner, two guests with a presence each, and a model-voiced member.
 * `extra` adds slots to the table's genre — built once the cards exist, so
 * an expression can name a member by id.
 */
async function table(extra?: (seated: Seated) => any[]) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `earshot-owner-${suffix}`)
	const guestA = await createTestUser(testDb, `earshot-guest-a-${suffix}`)
	const guestB = await createTestUser(testDb, `earshot-guest-b-${suffix}`)
	const watcher = await createTestUser(testDb, `earshot-watcher-${suffix}`)
	const card = async (userId: number, name: string) =>
		(await testDb.insert(schema.characters).values({ userId, name, description: "…" }).returning())[0]!
	const vell = await card(owner.id, `Vell ${suffix}`)
	const ash = await card(guestA.id, `Ash ${suffix}`)
	const bram = await card(guestB.id, `Bram ${suffix}`)

	defineAttributeSlot(GRIT, {
		type: "integer",
		label: { en: "Stamina" },
		descriptor: "How much is left in the tank.",
		appliesTo: ["cast"],
		config: { min: 0, max: 20 },
		default: 10
	})
	const GENRE = `test:genre/earshot-${suffix}`
	genre(GENRE, {
		name: { en: "Earshot" },
		family: "test",
		slots: [getAttributeSlot(WHISPER)!, getAttributeSlot(GRIT)!, ...(extra?.({ vell, ash, bram, suffix }) ?? [])],
		events: {}
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, name: `Delve ${suffix}`, genreId: GENRE })
		.returning()
	const sessionId = session!.id
	await testDb.insert(schema.sessionCharacters).values({ sessionId, characterId: vell.id })
	await testDb.insert(schema.sessionPersonas).values([
		{ sessionId, personaId: ash.id, position: 0 },
		{ sessionId, personaId: bram.id, position: 1 }
	] as any)
	await testDb.insert(schema.sessionGuests).values([
		{ sessionId, userId: guestA.id },
		{ sessionId, userId: guestB.id },
		{ sessionId, userId: watcher.id, isPlayer: false }
	] as any)

	// The owner whispers to all three, through the same door a person's
	// write takes; and everyone has grit, which everybody hears.
	for (const [who, text] of [
		[vell, TO_VELL],
		[ash, TO_ASH],
		[bram, TO_BRAM]
	] as const) {
		await call("stateSet", owner.id, {
			sessionId,
			owner: { kind: "session_cast", id: who.id },
			slotId: WHISPER,
			value: text
		})
		await call("stateSet", owner.id, {
			sessionId,
			owner: { kind: "session_cast", id: who.id },
			slotId: GRIT,
			value: 12
		})
	}
	return { sessionId, owner, guestA, guestB, watcher, vell, ash, bram }
}

type HandlerName = "stateGet" | "stateLedger" | "stateSet" | "stateConfigure" | "stateProposals" | "stateDecide"

/** Run one handler as `userId`; every payload it emitted to that user, and what it returned. */
async function call(name: HandlerName, userId: number, params: any) {
	const handlers = await import("./state")
	const emitted: Array<{ event: string; data: any }> = []
	const res = await (handlers[name] as any).handler(fakeSocket(userId), params, (event: string, data: any) =>
		emitted.push({ event, data })
	)
	const refused = emitted.find((e) => e.event.endsWith(":error"))
	if (refused) throw new Error(`${name}: ${refused.data.error}`)
	return { res, emitted, wire: JSON.stringify({ res, emitted }) }
}

/** Run one handler as `userId` expecting a refusal; the sentence it answered with. */
async function refusal(name: HandlerName, userId: number, params: any): Promise<string | null> {
	const handlers = await import("./state")
	const emitted: Array<{ event: string; data: any }> = []
	try {
		await (handlers[name] as any).handler(fakeSocket(userId), params, (event: string, data: any) =>
			emitted.push({ event, data })
		)
	} catch {
		// The refusal is the emitted sentence; the throw only stops the handler.
	}
	return emitted.find((e) => e.event.endsWith(":error"))?.data.error ?? null
}

/** The whisper a cast entry of `state` carries for `characterId`, under either key. */
const whisperOf = (state: any, characterId: number) => {
	const entry = state?.cast?.byId?.[String(characterId)] ?? {}
	return entry.whisper ?? entry.core_whisper
}
const gritOf = (state: any, characterId: number) =>
	state?.cast?.byId?.[String(characterId)]?.stamina

describe("state:get — each person hears their own character's whisper", () => {
	test("a guest reads their own whisper and nobody else's, under any key or role", async () => {
		const t = await table()
		const a = await call("stateGet", t.guestA.id, { sessionId: t.sessionId })
		expect(whisperOf(a.res.state, t.ash.id)).toBe(TO_ASH)
		expect(whisperOf(a.res.state, t.bram.id)).toBeUndefined()
		expect(whisperOf(a.res.state, t.vell.id)).toBeUndefined()
		// Nowhere in what reached the guest: not under a slug, not a role.
		expect(a.wire).not.toContain(TO_BRAM)
		expect(a.wire).not.toContain(TO_VELL)
		// What everybody hears is untouched.
		for (const id of [t.ash.id, t.bram.id, t.vell.id]) expect(gritOf(a.res.state, id)).toBe(12)

		const b = await call("stateGet", t.guestB.id, { sessionId: t.sessionId })
		expect(whisperOf(b.res.state, t.bram.id)).toBe(TO_BRAM)
		expect(b.wire).not.toContain(TO_ASH)
		expect(b.wire).not.toContain(TO_VELL)
	})

	test("the owner, who whispered, hears every one", async () => {
		const t = await table()
		const o = await call("stateGet", t.owner.id, { sessionId: t.sessionId })
		expect(whisperOf(o.res.state, t.ash.id)).toBe(TO_ASH)
		expect(whisperOf(o.res.state, t.bram.id)).toBe(TO_BRAM)
		expect(whisperOf(o.res.state, t.vell.id)).toBe(TO_VELL)
	})

	test("a guest with no character of their own hears no whisper at all", async () => {
		const t = await table()
		const c = await call("stateGet", t.watcher.id, { sessionId: t.sessionId })
		for (const text of [TO_ASH, TO_BRAM, TO_VELL]) expect(c.wire).not.toContain(text)
		expect(gritOf(c.res.state, t.vell.id)).toBe(12)
	})
})

describe("state:ledger — the same audience, row by row", () => {
	test("a guest's ledger lists their own whisper and no other", async () => {
		const t = await table()
		const a = await call("stateLedger", t.guestA.id, { sessionId: t.sessionId })
		const whispers = a.res.rows.filter((r: any) => r.slotId === WHISPER).map((r: any) => r.value)
		expect(whispers).toEqual([TO_ASH])
		expect(a.wire).not.toContain(TO_BRAM)
		expect(a.wire).not.toContain(TO_VELL)
		// Everybody's grit is still a line.
		expect(a.res.rows.filter((r: any) => r.slotId === GRIT)).toHaveLength(3)
	})

	test("the owner's ledger lists every whisper", async () => {
		const t = await table()
		const o = await call("stateLedger", t.owner.id, { sessionId: t.sessionId })
		const whispers = o.res.rows.filter((r: any) => r.slotId === WHISPER).map((r: any) => r.value)
		expect(whispers.sort()).toEqual([TO_ASH, TO_BRAM, TO_VELL].sort())
	})
})

describe("a write's reply is the writer's view", () => {
	test("state:set — a guest's own write answers with the state as they hear it", async () => {
		const t = await table()
		const a = await call("stateSet", t.guestA.id, {
			sessionId: t.sessionId,
			owner: { kind: "session_cast", id: t.ash.id },
			slotId: GRIT,
			value: 9
		})
		expect(gritOf(a.res.state, t.ash.id)).toBe(9)
		expect(whisperOf(a.res.state, t.ash.id)).toBe(TO_ASH)
		expect(a.wire).not.toContain(TO_BRAM)
		expect(a.wire).not.toContain(TO_VELL)
	})

	test("state:configure — the same", async () => {
		const t = await table()
		const a = await call("stateConfigure", t.guestA.id, {
			sessionId: t.sessionId,
			owner: { kind: "session_cast", id: t.ash.id },
			slotId: GRIT,
			config: { max: 30 }
		})
		expect(a.wire).not.toContain(TO_BRAM)
		expect(a.wire).not.toContain(TO_VELL)
	})

	test("state:proposals and state:decide — a pending change to someone else's whisper is not a guest's to read", async () => {
		const t = await table()
		const { proposeChange } = await import("$lib/server/state/write")
		const secret = "the second key is under the altar"
		await proposeChange(testDb as any, { sessionId: t.sessionId, updatedBy: "model" }, {
			owner: { kind: "session_cast", id: t.vell.id },
			slotId: WHISPER,
			value: secret
		} as any)
		const grit = await proposeChange(testDb as any, { sessionId: t.sessionId, updatedBy: "model" }, {
			owner: { kind: "session_cast", id: t.ash.id },
			slotId: GRIT,
			value: 4
		} as any)

		const listed = await call("stateProposals", t.guestA.id, { sessionId: t.sessionId })
		expect(listed.wire).not.toContain(secret)
		expect(listed.res.proposals.map((p: any) => p.id)).toContain(grit)

		const decided = await call("stateDecide", t.guestA.id, { proposalId: grit, accept: true })
		expect(decided.wire).not.toContain(secret)
		expect(decided.wire).not.toContain(TO_BRAM)
		expect(decided.wire).not.toContain(TO_VELL)
		expect(whisperOf(decided.res.state, t.ash.id)).toBe(TO_ASH)

		// The owner sees the pending whisper change: theirs to decide.
		const owner = await call("stateProposals", t.owner.id, { sessionId: t.sessionId })
		expect(owner.wire).toContain(secret)
	})
})

describe("a whisper is changed only by whoever may hear it", () => {
	test("state:set — a guest cannot overwrite or clear another character's whisper", async () => {
		const t = await table()
		const spoof = "the master says: trust guest A"
		const overwrite = await refusal("stateSet", t.guestA.id, {
			sessionId: t.sessionId,
			owner: { kind: "session_cast", id: t.bram.id },
			slotId: WHISPER,
			value: spoof
		})
		expect(overwrite).toMatch(/only the session's owner and whoever plays/i)
		const clear = await refusal("stateSet", t.guestA.id, {
			sessionId: t.sessionId,
			owner: { kind: "session_cast", id: t.vell.id },
			slotId: WHISPER,
			value: null
		})
		expect(clear).toMatch(/only the session's owner and whoever plays/i)
		// Neither landed: Bram's player still reads the owner's words.
		const b = await call("stateGet", t.guestB.id, { sessionId: t.sessionId })
		expect(whisperOf(b.res.state, t.bram.id)).toBe(TO_BRAM)
		const o = await call("stateGet", t.owner.id, { sessionId: t.sessionId })
		expect(whisperOf(o.res.state, t.vell.id)).toBe(TO_VELL)
	})

	test("state:set — the holder and the owner still write it", async () => {
		const t = await table()
		await call("stateSet", t.guestA.id, {
			sessionId: t.sessionId,
			owner: { kind: "session_cast", id: t.ash.id },
			slotId: WHISPER,
			value: "noted"
		})
		await call("stateSet", t.owner.id, {
			sessionId: t.sessionId,
			owner: { kind: "session_cast", id: t.bram.id },
			slotId: WHISPER,
			value: "a new word for Bram"
		})
		const o = await call("stateGet", t.owner.id, { sessionId: t.sessionId })
		expect(whisperOf(o.res.state, t.ash.id)).toBe("noted")
		expect(whisperOf(o.res.state, t.bram.id)).toBe("a new word for Bram")
	})

	test("state:configure — a guest cannot configure another character's whisper", async () => {
		const t = await table()
		const refused = await refusal("stateConfigure", t.guestA.id, {
			sessionId: t.sessionId,
			owner: { kind: "session_cast", id: t.bram.id },
			slotId: WHISPER,
			config: { maxLength: 3 }
		})
		expect(refused).toMatch(/only the session's owner and whoever plays/i)
	})

	test("state:decide — a pending change a guest cannot see is not theirs to accept or reject", async () => {
		const t = await table()
		const { proposeChange } = await import("$lib/server/state/write")
		const secret = "model-proposed words for Vell"
		const pid = await proposeChange(testDb as any, { sessionId: t.sessionId, updatedBy: "model" }, {
			owner: { kind: "session_cast", id: t.vell.id },
			slotId: WHISPER,
			value: secret
		} as any)
		// The same sentence as a proposal that does not exist: the id says nothing.
		expect(await refusal("stateDecide", t.guestA.id, { proposalId: pid, accept: true })).toBe("Proposal not found.")
		expect(await refusal("stateDecide", t.guestA.id, { proposalId: pid, accept: false })).toBe("Proposal not found.")
		const o = await call("stateGet", t.owner.id, { sessionId: t.sessionId })
		expect(whisperOf(o.res.state, t.vell.id)).toBe(TO_VELL)
		// Still pending, and still the owner's to decide.
		const decided = await call("stateDecide", t.owner.id, { proposalId: pid, accept: true })
		expect(decided.res.status).toBe("accepted")
		expect(whisperOf(decided.res.state, t.vell.id)).toBe(secret)
	})

	test("state:get — a guest is offered no whisper box on a character they do not hear", async () => {
		const t = await table()
		const configsOf = (res: any, id: number) =>
			res.owners.find((o: any) => o.kind === "session_cast" && o.id === id)?.configs ?? {}
		const a = await call("stateGet", t.guestA.id, { sessionId: t.sessionId })
		expect(Object.hasOwn(configsOf(a.res, t.ash.id), WHISPER)).toBe(true)
		expect(Object.hasOwn(configsOf(a.res, t.bram.id), WHISPER)).toBe(false)
		expect(Object.hasOwn(configsOf(a.res, t.vell.id), WHISPER)).toBe(false)
		// Everybody's stat is still offered everywhere.
		expect(Object.hasOwn(configsOf(a.res, t.bram.id), GRIT)).toBe(true)
		const o = await call("stateGet", t.owner.id, { sessionId: t.sessionId })
		for (const id of [t.ash.id, t.bram.id, t.vell.id]) expect(Object.hasOwn(configsOf(o.res, id), WHISPER)).toBe(true)
	})
})

describe("a value computed from a whisper is heard as the whisper is", () => {
	test("a derived slot reading its own member's whisper is heard by that member alone", async () => {
		let ECHO = ""
		const t = await table(({ suffix }) => {
			ECHO = `test:slot/echo-${suffix}@1`
			return [
				defineAttributeSlot(ECHO, {
					type: "derived",
					label: { en: "Echo" },
					descriptor: "What they were told, repeated.",
					appliesTo: ["cast"],
					derive: "owner.whisper"
				} as any)
			]
		})
		const a = await call("stateGet", t.guestA.id, { sessionId: t.sessionId })
		expect(a.wire).not.toContain(TO_BRAM)
		expect(a.wire).not.toContain(TO_VELL)
		// Ash's own echo is Ash's to read.
		expect(a.res.state.cast.byId[String(t.ash.id)][`echo-${n}`]).toBe(TO_ASH)
		// And a prompt hears it only in the holder's own voice.
		const { stateFor } = await import("$lib/server/state/resolve")
		const { withinEarshot } = await import("$lib/server/pipelines/prompt/adventureContext")
		const ashVoice = JSON.stringify(withinEarshot(await stateFor(testDb as any, t.sessionId), `character:${t.ash.id}`))
		expect(ashVoice).toContain(TO_ASH)
		expect(ashVoice).not.toContain(TO_BRAM)
		expect(ashVoice).not.toContain(TO_VELL)
		// The owner hears every echo.
		const o = await call("stateGet", t.owner.id, { sessionId: t.sessionId })
		expect(o.wire).toContain(TO_BRAM)
		expect(ECHO).not.toBe("")
	})

	test("a slot computed from another member's whisper reaches no guest and no voice", async () => {
		const t = await table(({ bram, suffix }) => [
			// Every member repeats Bram's whisper; so does the world.
			defineAttributeSlot(`test:slot/gossip-${suffix}@1`, {
				type: "derived",
				label: { en: "Gossip" },
				descriptor: "What everyone heard about Bram.",
				appliesTo: ["cast"],
				derive: `state.cast.byId["${bram.id}"].whisper`
			} as any),
			defineAttributeSlot(`test:slot/rumour-${suffix}@1`, {
				type: "derived",
				label: { en: "Rumour" },
				descriptor: "What the town says.",
				appliesTo: ["world"],
				derive: `state.cast.byId["${bram.id}"].whisper`
			} as any)
		])
		// Bram's own player included: a value computed across members is the owner's.
		for (const guest of [t.guestA, t.guestB, t.watcher]) {
			const g = await call("stateGet", guest.id, { sessionId: t.sessionId })
			const outsideBram = JSON.stringify({
				world: g.res.state.world,
				ash: g.res.state.cast.byId[String(t.ash.id)],
				vell: g.res.state.cast.byId[String(t.vell.id)]
			})
			expect(outsideBram).not.toContain(TO_BRAM)
		}
		const { stateFor } = await import("$lib/server/state/resolve")
		const { withinEarshot } = await import("$lib/server/pipelines/prompt/adventureContext")
		const full = await stateFor(testDb as any, t.sessionId)
		expect(JSON.stringify(withinEarshot(full, `character:${t.ash.id}`))).not.toContain(TO_BRAM)
		expect(JSON.stringify(withinEarshot(full, null))).not.toContain(TO_BRAM)
		const o = await call("stateGet", t.owner.id, { sessionId: t.sessionId })
		expect(o.res.state.world[`rumour-${n}`]).toBe(TO_BRAM)
	})

	test("a stored slot whose rule copies the whisper is heard as the whisper is", async () => {
		let MOOD = ""
		const t = await table(({ suffix }) => {
			MOOD = `test:slot/mood-${suffix}@1`
			return [
				defineAttributeSlot(MOOD, {
					type: "text",
					label: { en: "Mood" },
					descriptor: "How they carry themselves.",
					appliesTo: ["cast"],
					rules: [{ when: "owner.whisper", set: "owner.whisper" }]
				} as any)
			]
		})
		// A run touches Bram; the rule on Mood fires and files the whisper there.
		const { applyChangeSet } = await import("$lib/server/state/write")
		const gate = await applyChangeSet(
			testDb as any,
			{ sessionId: t.sessionId, updatedBy: "model" },
			[{ owner: { kind: "session_cast", id: t.bram.id }, slotId: GRIT, value: 5 } as any],
			{ mode: "apply", seed: "earshot-rule" }
		)
		expect(gate.refused).toEqual([])
		const o = await call("stateLedger", t.owner.id, { sessionId: t.sessionId })
		expect(o.res.rows.some((r: any) => r.slotId === MOOD && r.value === TO_BRAM)).toBe(true)

		const a = await call("stateGet", t.guestA.id, { sessionId: t.sessionId })
		expect(a.wire).not.toContain(TO_BRAM)
		const l = await call("stateLedger", t.guestA.id, { sessionId: t.sessionId })
		expect(l.wire).not.toContain(TO_BRAM)
		const b = await call("stateLedger", t.guestB.id, { sessionId: t.sessionId })
		expect(b.wire).toContain(TO_BRAM)
	})
})

describe("a stored value on a slot nobody declares any more", () => {
	test("on a cast member, only the owner and whoever plays the member read it", async () => {
		const t = await table()
		const orphan = "bram-orphaned-secret"
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "session_cast",
			ownerId: t.bram.id,
			slotId: "gone:slot/secret@1",
			value: { v: orphan },
			sessionId: t.sessionId,
			updatedBy: "user"
		} as any)
		const a = await call("stateLedger", t.guestA.id, { sessionId: t.sessionId })
		expect(a.wire).not.toContain(orphan)
		const b = await call("stateLedger", t.guestB.id, { sessionId: t.sessionId })
		expect(b.wire).toContain(orphan)
		const o = await call("stateLedger", t.owner.id, { sessionId: t.sessionId })
		expect(o.wire).toContain(orphan)
	})
})
