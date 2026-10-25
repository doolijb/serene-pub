/**
 * A session's ruleset settings against a real database (W3-A): read by any
 * member and changed only by the owner through `sessions:setRulesetSettings`
 * (a preset by name, one option, a refused choice), stored on
 * `sessions.ruleset_settings`, then played by the handler; and a slot a
 * ruleset owns offered only in that ruleset's sessions.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, genre, getAttributeSlot } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const VIS_ITINERIS = "core:ruleset/vis-itineris@1"
const GENRE = "test:genre/ruleset-settings"
const HP = "core:slot/hp@1"
/** A slot Vis Itineris owns: offered only in a Vis Itineris session. */
const KNACK = "test:slot/w3-knack@1"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-ruleset-settings-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	// TODO(sdk:build): `rulesetOwned` is typed once the built SDK carries it.
	defineAttributeSlot(KNACK, {
		type: "text",
		label: { en: "Knack" },
		descriptor: "A small trick they are good at.",
		appliesTo: ["cast"],
		rulesetOwned: VIS_ITINERIS
	} as Parameters<typeof defineAttributeSlot>[1])
	genreKeeping(GENRE, { name: { en: "Ruleset settings" }, family: "test", slots: [getAttributeSlot(HP)!], customAttributes: "allow", events: {} })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketOf = (userId: number) => ({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any

let n = 0
async function world(primaryRuleset = VIS_ITINERIS) {
	const k = ++n
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(db, `rs-owner-${k}`)
	const guest = await createTestUser(db, `rs-guest-${k}`)
	const [ann] = await db.insert(schema.characters).values({ userId: owner.id, name: `Ann ${k}`, description: "A knight." }).returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, name: `Run ${k}`, genreId: GENRE, primaryRuleset, rigour: "mechanics" })
		.returning()
	await db.insert(schema.sessionGuests).values({ sessionId: session!.id, userId: guest.id })
	await db.insert(schema.sessionCharacters).values({ sessionId: session!.id, characterId: ann!.id })
	await db.insert(schema.messages).values({ sessionId: session!.id, role: "character" })
	return { owner, guest, ann: ann!, session: session! }
}

async function call(userId: number, params: Record<string, unknown>) {
	const { sessionsSetRulesetSettings } = await import("$lib/server/sockets/state")
	const emitted: { event: string; data: any }[] = []
	try {
		const res = await sessionsSetRulesetSettings.handler(socketOf(userId), params as any, (event: string, data: any) =>
			emitted.push({ event, data })
		)
		return { res, emitted }
	} catch (e) {
		return { error: emitted.find((x) => x.event.endsWith(":error"))?.data?.error ?? String(e), emitted }
	}
}

const stored = async (sessionId: number) =>
	(await db.select({ v: schema.sessions.rulesetSettings }).from(schema.sessions).where(eq(schema.sessions.id, sessionId)))[0]!.v

describe("sessions:setRulesetSettings", () => {
	test("any member reads; only the owner changes; a preset by name, one option, a refused choice", async () => {
		const w = await world()
		const read = await call(w.guest.id, { sessionId: w.session.id })
		expect(read.res).toMatchObject({ sessionId: w.session.id, canEdit: false, rulesOptions: { rulesetId: VIS_ITINERIS, rulesetName: "Vis Itineris", preset: "vis-itineris" } })
		expect(read.res!.rulesOptions.options.map((o) => o.id)).toEqual(["degrees", "actions", "bonuses", "dying", "focus", "casting"])
		expect(read.res!.rulesOptions.presets.map((p) => p.label)).toEqual(["Vis Itineris", "Classic"])

		expect((await call(w.guest.id, { sessionId: w.session.id, preset: "classic" })).error).toBe(
			"Only the session's owner can change its rules options."
		)
		expect(await stored(w.session.id)).toEqual({})

		const classic = await call(w.owner.id, { sessionId: w.session.id, preset: "Classic" })
		expect(classic.res!.rulesOptions.preset).toBe("classic")
		expect(await stored(w.session.id)).toEqual({
			[VIS_ITINERIS]: { degrees: "classic", actions: "classic", bonuses: "classic", dying: "death-saves", focus: "concentration", casting: "slots" }
		})

		const one = await call(w.owner.id, { sessionId: w.session.id, values: { focus: "sustain" } })
		expect(one.res!.rulesOptions.preset).toBeUndefined()
		expect((await stored(w.session.id))[VIS_ITINERIS]).toMatchObject({ degrees: "classic", focus: "sustain" })

		const bad = await call(w.owner.id, { sessionId: w.session.id, values: { degrees: "tenfold" } })
		expect(bad.error).toMatch(/'tenfold' is not a choice for Degrees of success/)
		expect((await stored(w.session.id))[VIS_ITINERIS]).toMatchObject({ degrees: "classic" })
	})

	test("the handler plays what the session stored", async () => {
		const w = await world()
		const { resolveRulesetTurn } = await import("./resolve")
		// A natural 20 that misses the target by 5.
		const attack = () =>
			resolveRulesetTurn(
				db as any,
				{
					owners: [`session:${w.session.id}`, `character:${w.ann.id}`],
					mode: "apply",
					deltas: [{ owner: `character:${w.ann.id}`, op: "hit", check: "attack.melee", against: 25 }]
				},
				{ random: () => 0.999, runId: "t" }
			)
		const before = await attack()
		if ("halt" in before) throw new Error(before.halt)
		expect((before.ok.outcomes as any[])[0].check).toMatchObject({ natural: 20, band: "success" })
		expect(before.ok.facts.preset).toBe("vis-itineris")

		await call(w.owner.id, { sessionId: w.session.id, values: { degrees: "classic" } })
		const after = await attack()
		if ("halt" in after) throw new Error(after.halt)
		expect((after.ok.outcomes as any[])[0].check).toMatchObject({ natural: 20, band: "critical" })
		expect(after.ok.facts.settings).toMatchObject({ degrees: "classic" })
	})
})

describe("a slot a ruleset owns", () => {
	// 🚧 RF fix 8: a session adds no attributes — a ruleset's own slot is tracked where that ruleset is played, and never picked.
	test("a ruleset's own slot is never picked: refused in words, played or not", async () => {
		const { stateSetAttributePicks } = await import("$lib/server/sockets/state")
		for (const w of [await world("core:ruleset/freeform@1"), await world()])
			await expect(
				stateSetAttributePicks.handler(socketOf(w.owner.id), { sessionId: w.session.id, picks: [{ slotId: KNACK, enabled: true }] } as any, () => {})
			).rejects.toThrow(/a session adds none/)
	})

})
