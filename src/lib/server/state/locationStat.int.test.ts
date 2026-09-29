/**
 * Location is a modular premade stat (owner ruling 2026-09-26): "Location
 * shouldn't be built in, other than a premade field. World location state
 * isn't a default. One genre might want characters in different places."
 *
 * `core:slot/location@1` attaches to the world and the cast; a genre's sheet
 * says which owner carries it (`SheetSlotEntry.appliesTo`). Its value is words
 * or a reference to a place entry of the session's lorebook (`{ entryId }`).
 * Nothing in core reads a location the sheet did not put there, and places get
 * no stat of their own.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSheet, genre } from "@serene-pub/sdk"
import { ADVENTURE_GENRE_ID } from "@serene-pub/core-catalog"
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-state-location-stat-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const LOCATION = "core:slot/location@1"
const PLACE = "core:entry/location"

/** A genre whose characters can be in different places: location on the cast, not the world. */
const WANDERERS = "test:genre/wanderers"
const WANDERERS_SHEET = defineAttributeSheet("test:sheet/wanderers@1", {
	label: { en: "Wanderers" },
	slots: [{ id: LOCATION, appliesTo: ["cast"] }]
})
genre(WANDERERS, {
	name: { en: "Wanderers" },
	family: "test",
	sheets: [WANDERERS_SHEET],
	events: {}
})

let n = 0
async function world(genreId: string) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `state-location-stat-${suffix}`)
	const [verity, marrow] = await testDb
		.insert(schema.characters)
		.values([
			{ userId: user.id, name: `Verity ${suffix}`, description: "…" },
			{ userId: user.id, name: `Marrow ${suffix}`, description: "…" }
		])
		.returning()
	const [lorebook, elsewhere] = await testDb
		.insert(schema.lorebooks)
		.values([
			{ userId: user.id, name: `World ${suffix}` },
			{ userId: user.id, name: `Elsewhere ${suffix}` }
		])
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: true, name: `Run ${suffix}`, genreId, lorebookId: lorebook.id })
		.returning()
	await testDb.insert(schema.sessionCharacters).values([
		{ sessionId: session.id, characterId: verity.id },
		{ sessionId: session.id, characterId: marrow.id }
	])
	let position = 0
	const entry = (lorebookId: number, title: string, typeId: string) =>
		testDb
			.insert(schema.lorebookEntries)
			.values({ lorebookId, typeId, typeVersion: 1, position: position++, title, content: "…" })
			.returning()
			.then((r) => r[0]!)
	const harbor = await entry(lorebook.id, "Harbor", PLACE)
	const crypt = await entry(lorebook.id, "The Crypt", PLACE)
	const key = await entry(lorebook.id, "Rusty key", "core:entry/item")
	const farTower = await entry(elsewhere.id, "Far Tower", PLACE)
	return { user, verity, marrow, lorebook, session, harbor, crypt, key, farTower }
}

const db = () => testDb as unknown as Db
const cast = (id: number) => ({ kind: "session_cast" as const, id })
const castRead = (w: Awaited<ReturnType<typeof world>>) =>
	({
		read: async () => [
			{ character: { id: w.verity.id, name: w.verity.name } },
			{ character: { id: w.marrow.id, name: w.marrow.name } }
		]
	}) as any
const node = async (id: string) => {
	const { stateBindings } = await import("$lib/server/pipelines/runtime/bindings.state")
	return stateBindings({ runId: "loc" })[id]!
}

describe("a genre that puts location on the cast", () => {
	test("tracks it on each character and not on the world", async () => {
		const w = await world(WANDERERS)
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db(), w.session.id)
		expect(state.slots.find((s) => s.id === LOCATION)?.appliesTo).toEqual(["cast"])
		expect("location" in state.world).toBe(false)
		// Places get no default stat: nothing a place carries is tracked.
		expect(state.locations.byId).toEqual({})
	})

	test("two characters in different places: one in words, one at a place entry", async () => {
		const w = await world(WANDERERS)
		const { applyChange } = await import("$lib/server/state/write")
		const { stateFor } = await import("$lib/server/state/resolve")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		await applyChange(db(), ctx, { owner: cast(w.verity.id), slotId: LOCATION, value: "the old mill" })
		await applyChange(db(), ctx, { owner: cast(w.marrow.id), slotId: LOCATION, value: { entryId: w.harbor.id } })

		const state = await stateFor(db(), w.session.id)
		expect(state.cast.byId[String(w.verity.id)]?.location).toBe("the old mill")
		expect(state.cast.byId[String(w.marrow.id)]?.location).toEqual({ entryId: w.harbor.id, name: "Harbor" })

		// Stored as the entry id alone — the title is a read's, never a copy.
		const rows = await testDb.select().from(schema.attributeValues)
		const stored = rows.find((r) => r.ownerKind === "session_cast" && r.ownerId === w.marrow.id && r.slotId === LOCATION)
		expect(stored?.value).toEqual({ v: { entryId: w.harbor.id } })

		// The prompt reads it as a place name, per character.
		const { stateSummary, slotGuide } = await import("$lib/server/pipelines/prompt/adventureContext")
		const summary = stateSummary(state as any, [w.verity.name, w.marrow.name])
		expect(summary).toContain(`${w.verity.name}: location the old mill.`)
		expect(summary).toContain(`${w.marrow.name}: location Harbor.`)
		expect(summary).not.toMatch(/The world:.*location/)
		const guide = slotGuide(state as any)
		expect(guide).toMatch(/- location: .*on a character/)
		expect(guide).not.toMatch(/- location: .*on the world/)
	})

	test("the world may not hold it, and a reference must be a place of this world", async () => {
		const w = await world(WANDERERS)
		const { applyChange } = await import("$lib/server/state/write")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		await expect(
			applyChange(db(), ctx, { owner: { kind: "session", id: w.session.id }, slotId: LOCATION, value: "the square" })
		).rejects.toThrow(/world/)
		// An item is not a place.
		await expect(
			applyChange(db(), ctx, { owner: cast(w.verity.id), slotId: LOCATION, value: { entryId: w.key.id } })
		).rejects.toThrow(/not a location|core:entry\/location/)
		// Another world's place is not this session's.
		await expect(
			applyChange(db(), ctx, { owner: cast(w.verity.id), slotId: LOCATION, value: { entryId: w.farTower.id } })
		).rejects.toThrow(/not in this session's lorebook/)
	})

	test("the keeper moves a character between places, and a world hint proposes nothing", async () => {
		const w = await world(WANDERERS)
		const { applyChange } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		await applyChange(db(), ctx, { owner: cast(w.verity.id), slotId: LOCATION, value: { entryId: w.harbor.id } })

		const resolve = await node("core:query/resolve-state-changes@1")
		const out: any = await resolve(
			{
				scope: { sessionId: w.session.id },
				changes: [
					// A place the lorebook names becomes a reference to it…
					{ owner: w.verity.name, slot: "location", value: "the crypt" },
					// …and anywhere else stays words.
					{ owner: w.marrow.name, slot: "location", value: "the old mill" }
				],
				// This genre keeps no location on the world: the hint is not a change.
				plan: { worldHints: { location: "the square" } }
			},
			castRead(w)
		)
		expect(out.value.refused ?? []).toEqual([])
		expect(out.value.changes).toEqual([
			{ owner: cast(w.verity.id), slotId: LOCATION, value: { entryId: w.crypt.id } },
			{ owner: cast(w.marrow.id), slotId: LOCATION, value: "the old mill" }
		])

		const setState = await node("core:task/set-state@1")
		const applied: any = await setState(
			{ scope: { sessionId: w.session.id }, changes: out.value.changes, params: { mode: "apply" } },
			{} as any
		)
		expect(applied.value.applied).toHaveLength(2)
		expect(await valueOf(db(), { sessionId: w.session.id, owner: cast(w.verity.id), slotId: LOCATION })).toEqual({
			entryId: w.crypt.id
		})
		expect(await valueOf(db(), { sessionId: w.session.id, owner: cast(w.marrow.id), slotId: LOCATION })).toBe(
			"the old mill"
		)
	})
})

describe("Adventure keeps location on the world, by its sheet", () => {
	test("tracked on the world only; a character may not carry it", async () => {
		const w = await world(ADVENTURE_GENRE_ID)
		const { applyChange } = await import("$lib/server/state/write")
		const { stateFor } = await import("$lib/server/state/resolve")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		const before = await stateFor(db(), w.session.id)
		expect(before.slots.find((s) => s.id === LOCATION)?.appliesTo).toEqual(["world"])

		await expect(
			applyChange(db(), ctx, { owner: cast(w.verity.id), slotId: LOCATION, value: "the mill" })
		).rejects.toThrow(/world/)
		await applyChange(db(), ctx, { owner: { kind: "session", id: w.session.id }, slotId: LOCATION, value: { entryId: w.harbor.id } })

		const state = await stateFor(db(), w.session.id)
		expect(state.world.location).toEqual({ entryId: w.harbor.id, name: "Harbor" })
		expect(state.cast.byId[String(w.verity.id)]).not.toHaveProperty("location")

		const { sceneAnchor, slotGuide } = await import("$lib/server/pipelines/prompt/adventureContext")
		expect(sceneAnchor(state as any, undefined).location).toBe("Harbor")
		const guide = slotGuide(state as any)
		expect(guide).toMatch(/- location: .*on the world/)
		expect(guide).not.toMatch(/- location: .*on a character/)
	})

	test("a proposed move reads the room's title, the way the widget does (Lair W-GATE D4)", async () => {
		const w = await world(ADVENTURE_GENRE_ID)
		const { proposeChange, listedProposals } = await import("$lib/server/state/write")
		const { describeProposal } = await import("$lib/shared/state/ledgerLines")
		const ctx = { sessionId: w.session.id, updatedBy: "keeper" }
		await proposeChange(db(), ctx, {
			owner: { kind: "session", id: w.session.id },
			slotId: LOCATION,
			value: { entryId: w.crypt.id }
		})
		const [row] = await listedProposals(db(), w.session.id)
		// Named at read time; the stored payload keeps the id alone.
		expect(row?.payload.value).toEqual({ entryId: w.crypt.id, name: "The Crypt" })
		const stored = await testDb.select().from(schema.stateProposals)
		expect(stored.find((r) => r.id === row!.id)?.payload).toMatchObject({ value: { entryId: w.crypt.id } })
		expect((stored.find((r) => r.id === row!.id)?.payload as any).value.name).toBeUndefined()
		expect(describeProposal(row as any, { slotLabel: () => "Location" })).toBe("Location → The Crypt")
	})
})
