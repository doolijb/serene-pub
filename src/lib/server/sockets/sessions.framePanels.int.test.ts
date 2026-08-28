/**
 * Frame panels through the real server resolution (plan 21 §7 / §9). A mode
 * declares a panel whose surface is a plugin frame; `sessions:view` must return
 * it in `modePanels` with a resolved `/plugin-ui/...` src when the owning plugin
 * is installed, pass native panels through untouched, and drop a frame whose
 * plugin is absent to a placeholder (no src) — never an error.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(() => {})

function fakeSocket(userId: number) {
	return { user: { id: userId }, io: { to: () => ({ emit: () => {} }) } } as any
}
const noop = () => {}
let n = 0

async function makeUser(name: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, name)
}

/** A mode that declares a frame panel + a native panel, and (optionally) an
 * installed plugin that owns the frame. */
async function scenario(installPlugin: boolean) {
	const k = n++
	const owner = await makeUser(`fp-owner-${k}`)
	const pluginId = `acme/mapper-${k}`

	if (installPlugin) {
		await testDb.insert(schema.plugins).values({
			pluginId,
			name: "Mapper",
			bundleSource: "// x",
			bundleHash: "deadbeef",
			enabled: true,
			manifest: {
				surfaces: {
					panels: [{ id: "map", entry: "ui/map.html", title: "Map" }]
				}
			}
		})
		await testDb.insert(schema.pluginFiles).values({
			pluginId,
			path: "ui/map.html",
			mime: "text/html",
			content: "<h1>map</h1>",
			hash: "abc",
			bytes: 12
		})
	}

	// A mode row (kind input, live) whose shape declares the panels.
	const typeId = `core:input/mapmode-${k}`
	await testDb.insert(schema.pipelineTypeRegistry).values({
		typeId,
		version: 1,
		kind: "input",
		status: "live",
		sessionShape: {
			panels: [
				{
					id: "map",
					title: "Map",
					role: "secondary",
					surface: { kind: "frame", pluginId, entry: "ui/map.html" },
					channels: ["map"]
				},
				{
					id: "notes",
					title: "Notes",
					role: "secondary",
					surface: { kind: "native", component: "sample-notes" }
				}
			]
		}
	})

	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, genreId: `${typeId}@1` })
		.returning()

	return { owner, session, pluginId }
}

describe("sessions:view — frame panels (21)", () => {
	test("resolves a mode's frame panel src when its plugin is installed", async () => {
		const { sessionsViewHandler } = await import("./sessions")
		const s = await scenario(true)
		const res = await sessionsViewHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noop
		)

		const map = res.modePanels.find((p) => p.id === "map")!
		expect(map.surface).toMatchObject({ kind: "frame", pluginId: s.pluginId })
		expect(map.src).toBe(`/plugin-ui/${s.pluginId}/ui/map.html`)
		expect(map.channels).toEqual(["map"])

		// native panel passes through with no src
		const notes = res.modePanels.find((p) => p.id === "notes")!
		expect(notes.surface).toMatchObject({
			kind: "native",
			component: "sample-notes"
		})
		expect(notes.src).toBeUndefined()

		// the same plugin's panel also shows in the global panel list
		expect(res.panels.some((f) => f.panelId === "map")).toBe(true)
	})

	test("a frame panel whose plugin is absent has no src (placeholder, not error)", async () => {
		const { sessionsViewHandler } = await import("./sessions")
		const s = await scenario(false)
		const res = await sessionsViewHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noop
		)
		const map = res.modePanels.find((p) => p.id === "map")!
		expect(map.surface).toMatchObject({ kind: "frame" })
		expect(map.src).toBeUndefined()
	})
})
