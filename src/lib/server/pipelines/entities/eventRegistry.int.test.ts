/**
 * B2 · the events page's registry layer (PLAN-turn-order §B2).
 *
 * Pinned: every core event is a row with its declaration's facts; the genres
 * whose surface lists an event are named on it; a package event carries its
 * owner and its recording scope per genre, and goes when its plugin does.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { sessionEvents } from "@serene-pub/sdk"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { STANDARD_GENRE_ID } from "$lib/server/pipelines/entities/sessionGenres"
import { eventRegistry } from "$lib/server/pipelines/entities/eventRegistry"
import {
	registerPluginEvents,
	withdrawPluginEvents
} from "$lib/server/plugins/pluginEvents"

let db: TestDb

const PLUGIN = "acme.registry-test"
const EVENT = `${PLUGIN}:event/rang@1`

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
}, 60_000)

afterAll(() => withdrawPluginEvents(PLUGIN))

describe("the event registry", () => {
	it("lists every core event with its declaration's facts", async () => {
		const { events } = await eventRegistry(db)
		const completed = events.find((e) => e.id === sessionEvents.messageCompleted)
		expect(completed).toMatchObject({
			owner: "core",
			family: "data",
			affectsUser: true
		})
		expect(completed!.causedBy.length).toBeGreaterThan(0)
		const respond = events.find((e) => e.id === sessionEvents.messageRespond)
		expect(respond?.family).toBe("action")
	})

	it("names the genres whose event surface lists the event", async () => {
		const { events, genres } = await eventRegistry(db)
		expect(genres.some((g) => g.genreId === STANDARD_GENRE_ID)).toBe(true)
		const created = events.find((e) => e.id === sessionEvents.sessionCreated)
		expect(created?.genres.map((g) => g.genreId)).toContain(STANDARD_GENRE_ID)
	})

	it("carries a package event's owner and recording scope, and drops it on withdrawal", async () => {
		const schema = await import("$lib/server/db/schema")
		await db.insert(schema.plugins).values({
			pluginId: PLUGIN,
			name: "Registry test",
			version: "1.0.0",
			bundleSource: "// none",
			bundleHash: "registry-test",
			enabled: true,
			manifest: {} as any
		})
		const refused = registerPluginEvents(
			{
				events: [
					{
						event: EVENT,
						payload: "core:shape/json@1",
						name: { en: "Bell rang" },
						description: { en: "Someone rang the bell." },
						domain: "session",
						genre: STANDARD_GENRE_ID,
						recordedBy: "any"
					}
				]
			},
			PLUGIN
		)
		expect(refused).toEqual([])
		const row = (await eventRegistry(db)).events.find((e) => e.id === EVENT)
		expect(row).toMatchObject({
			owner: PLUGIN,
			label: "Bell rang",
			payload: "core:shape/json@1",
			recordedBy: [{ genreId: STANDARD_GENRE_ID, recordedBy: "any" }]
		})
		// A disabled plugin's event leaves the page, and comes back with it.
		const { eq } = await import("drizzle-orm")
		await db.update(schema.plugins).set({ enabled: false }).where(eq(schema.plugins.pluginId, PLUGIN))
		expect((await eventRegistry(db)).events.some((e) => e.id === EVENT)).toBe(false)
		await db.update(schema.plugins).set({ enabled: true }).where(eq(schema.plugins.pluginId, PLUGIN))
		expect((await eventRegistry(db)).events.some((e) => e.id === EVENT)).toBe(true)
		withdrawPluginEvents(PLUGIN)
		expect((await eventRegistry(db)).events.some((e) => e.id === EVENT)).toBe(false)
	})
})
