/**
 * Frame panels through the real server resolution (plan 21 §7 / §9). A mode
 * declares a panel whose surface is a plugin frame; `sessions:view` must return
 * it in `modePanels` with a resolved `/plugin-ui/...` src when the owning plugin
 * is installed, pass native panels through untouched, and drop a frame whose
 * plugin is absent to a placeholder (no src) — never an error.
 *
 * And, since the namespacing ruling (2026-09-17), the other half: a plugin's
 * OWN widgets — the ones it declares under `surfaces.panels`, which belong to
 * no genre — are seated in every session under `<pluginId>:<panelId>`, and
 * disabling the plugin takes them off the wire without touching anything a
 * person arranged.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
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
	const typeId = `core:inlet/mapmode-${k}`
	await testDb.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: typeId,
		version: 1,
		kind: "inlet",
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

	/**
	 * A plugin with two panels of its own and a genre that declares neither.
	 * Deliberately declares a panel named `map` — the id the genre above uses —
	 * so the namespacing is tested against the collision it exists to prevent.
	 */
	async function pluginOnlyScenario() {
		const k = n++
		const owner = await makeUser(`pw-owner-${k}`)
		const pluginId = `acme.tray-${k}`
		await testDb.insert(schema.plugins).values({
			pluginId,
			name: "Tray",
			bundleSource: "// x",
			bundleHash: "deadbeef",
			enabled: true,
			manifest: {
				surfaces: {
					panels: [
						{
							id: "map",
							entry: "ui/tray.html",
							title: "Dice tray",
							channels: ["dice"],
							settings: {
								sides: { type: "number", default: 6 }
							}
						},
						{ id: "log", entry: "ui/log.html", title: "Roll log" }
					]
				}
			}
		})
		const typeId = `core:inlet/plainmode-${k}`
		await testDb.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: typeId,
			version: 1,
			kind: "inlet",
			status: "live",
			sessionShape: {
				panels: [
					{
						id: "map",
						title: "The genre's own map",
						role: "secondary",
						surface: { kind: "native", component: "sample-notes" },
						settings: { zoom: { type: "number", default: 1 } }
					}
				]
			}
		})
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner.id,
				isGroup: false,
				genreId: `${typeId}@1`
			})
			.returning()
		return { owner, session, pluginId }
	}

	const view = async (userId: number, sessionId: number) => {
		const { sessionsViewHandler } = await import("./sessions")
		return sessionsViewHandler.handler(
			fakeSocket(userId),
			{ sessionId } as any,
			noop
		)
	}

	test("an enabled plugin's own panels are seated under namespaced ids", async () => {
		const s = await pluginOnlyScenario()
		const res = await view(s.owner.id, s.session.id)

		const mine = res.modePanels.filter((p) =>
			p.id.startsWith(`${s.pluginId}:`)
		)
		expect(mine.map((p) => p.id).sort()).toEqual([
			`${s.pluginId}:log`,
			`${s.pluginId}:map`
		])

		const tray = mine.find((p) => p.id === `${s.pluginId}:map`)!
		expect(tray.title).toBe("Dice tray")
		expect(tray.role).toBe("secondary")
		expect(tray.src).toBe(`/plugin-ui/${s.pluginId}/ui/tray.html`)
		expect(tray.channels).toEqual(["dice"])
		// The declared schema reaches the wire — without it the settings card
		// draws no controls, whoever declared the widget.
		expect(tray.settings).toEqual({ sides: { type: "number", default: 6 } })
		// Offered, never on: an install must not rearrange a live session.
		expect(tray.defaultActive).toBe(false)

		// The genre's plain `map` is untouched and still first, and it now
		// carries ITS declared settings too.
		const genreMap = res.modePanels.find((p) => p.id === "map")!
		expect(genreMap.title).toBe("The genre's own map")
		expect(genreMap.surface).toMatchObject({ kind: "native" })
		expect(genreMap.settings).toEqual({
			zoom: { type: "number", default: 1 }
		})
		expect(res.modePanels.indexOf(genreMap)).toBeLessThan(
			res.modePanels.indexOf(tray)
		)

		// ⏳ The pre-widget listing keeps the BARE declared id its readers
		// were written against.
		expect(
			res.panels
				.filter((f) => f.pluginId === s.pluginId)
				.map((f) => f.panelId)
				.sort()
		).toEqual(["log", "map"])
	})

	test("disabling the plugin takes its widgets off the wire, and nothing else", async () => {
		const s = await pluginOnlyScenario()
		expect(
			(await view(s.owner.id, s.session.id)).modePanels.some((p) =>
				p.id.startsWith(`${s.pluginId}:`)
			)
		).toBe(true)

		await testDb
			.update(schema.plugins)
			.set({ enabled: false })
			.where(eq(schema.plugins.pluginId, s.pluginId))

		const res = await view(s.owner.id, s.session.id)
		// Gone from both lists — the client sees no instance and draws
		// nothing. Its layout rows, settings and styles are untouched, which
		// is what lets a re-enable bring the arrangement back.
		expect(
			res.modePanels.some((p) => p.id.startsWith(`${s.pluginId}:`))
		).toBe(false)
		expect(res.panels.some((f) => f.pluginId === s.pluginId)).toBe(false)
		// The genre's own widget is not collateral.
		expect(res.modePanels.some((p) => p.id === "map")).toBe(true)
	})
})
