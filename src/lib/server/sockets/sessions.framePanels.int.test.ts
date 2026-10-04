/**
 * Genre panels and package widgets through the real server resolution (plan
 * 21 §7 / §9). A mode declares panels naming components; `sessions:view` must
 * serve core's own component from `/core-ui` (dropping one core does not
 * declare), and offer no panel still spelling the retired `surface` frame
 * shortcut (2026-10-02) — a widget always names a component.
 *
 * And, since the namespacing ruling (2026-09-17), the other half: a plugin's
 * OWN widgets — `manifest.widgets`, which belong to no genre — are seated in
 * every session under `<pluginId>:<widgetId>`, and disabling the plugin takes
 * them off the wire without touching anything a person arranged.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HOST_ELEMENTS_VERSION, WIDGET_PROTOCOL, currentBuiltAgainst } from "@serene-pub/sdk"
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

/** A mode that declares core components and a stale frame panel, and
 * (optionally) an installed plugin that owns the frame's document. */
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
			manifest: {}
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
				// The retired frame shortcut: never offered, plugin or no.
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
					component: "scene-portraits",
					channels: ["map"],
					// R75: what it reads — a name that is no base section is
					// dropped, never trusted off the stored declaration.
					reads: ["settings", "made-up"]
				},
				// A component core does not declare: `/core-ui` would 404.
				{
					id: "ghost",
					title: "Ghost",
					role: "secondary",
					component: "sample-notes"
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

describe("sessions:view — a genre's panels (21)", () => {
	// Plugin widgets are part of the extension subsystem (SP_PLUGINS_ENABLED).
	beforeAll(() => {
		vi.stubEnv("SP_PLUGINS_ENABLED", "1")
	})
	afterAll(() => {
		vi.unstubAllEnvs()
	})

	test("resolves a mode's core component panels; a retired frame panel is not offered", async () => {
		const { sessionsViewHandler } = await import("./sessions")
		const s = await scenario(true)
		const res = await sessionsViewHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noop
		)

		// The `surface` shortcut is gone: its plugin installed or not, the
		// panel resolves to nothing and is not offered.
		expect(res.modePanels.some((p) => p.id === "map")).toBe(false)

		// Core's own component: core's remote, served by `/core-ui` (R79).
		const notes = res.modePanels.find((p) => p.id === "notes")!
		expect(notes.surface).toEqual({
			kind: "remote",
			owner: "core",
			component: "scene-portraits"
		})
		expect(notes.src).toBe("/core-ui/scene-portraits")
		expect(notes.channels).toEqual(["map"])
		// Only the sections it reads are sent to it (R75).
		expect(notes.reads).toEqual(["settings"])
		// One core does not declare is not offered, rather than offered broken.
		expect(res.modePanels.some((p) => p.id === "ghost")).toBe(false)
	})

	test("without the plugin the retired frame panel is still simply absent, never an error", async () => {
		const { sessionsViewHandler } = await import("./sessions")
		const s = await scenario(false)
		const res = await sessionsViewHandler.handler(
			fakeSocket(s.owner.id),
			{ sessionId: s.session.id } as any,
			noop
		)
		expect(res.modePanels.some((p) => p.id === "map")).toBe(false)
		expect(res.modePanels.some((p) => p.id === "notes")).toBe(true)
	})

	/**
	 * A plugin with two component widgets of its own (and one still spelling
	 * the retired frame shortcut) and a genre that declares none of them.
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
				widgets: [
					{
						id: "map",
						title: "Dice tray",
						component: "tray",
						channels: ["dice"],
						settings: {
							sides: { type: "number", default: 6 }
						}
					},
					{
						id: "log",
						title: "Roll log",
						component: "log"
					},
					// The retired frame shortcut: names no component, so it
					// is never offered.
					{
						id: "framed",
						title: "Framed",
						surface: { kind: "frame", pluginId, entry: "ui/x.html" }
					}
				],
				components: [
					{ slug: "tray", entry: "ui/tray.js" },
					{ slug: "log", entry: "ui/log.js" }
				]
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
						component: "scene-portraits",
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

	test("an enabled plugin's own widgets are seated under namespaced ids", async () => {
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
		expect(tray.src).toBe(`/plugin-ui/${s.pluginId}/ui/tray.js`)
		expect(tray.surface).toEqual({
			kind: "remote",
			owner: s.pluginId,
			component: "tray"
		})
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
		expect(genreMap.surface).toMatchObject({ kind: "remote", owner: "core" })
		expect(genreMap.settings).toEqual({
			zoom: { type: "number", default: 1 }
		})
		expect(res.modePanels.indexOf(genreMap)).toBeLessThan(
			res.modePanels.indexOf(tray)
		)
	})

	test("a plugin widget carries the sections it reads (R75), and none without", async () => {
		const s = await pluginOnlyScenario()
		const [row] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, s.pluginId))
		const manifest = row.manifest as { widgets: Array<Record<string, unknown>> }
		manifest.widgets[0].reads = ["settings", "made-up"]
		await testDb.update(schema.plugins).set({ manifest }).where(eq(schema.plugins.pluginId, s.pluginId))
		const res = await view(s.owner.id, s.session.id)
		const tray = res.modePanels.find((p) => p.id === `${s.pluginId}:map`)!
		expect(tray.reads).toEqual(["settings"])
		const log = res.modePanels.find((p) => p.id === `${s.pluginId}:log`)!
		expect(log).not.toHaveProperty("reads")
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
		// The genre's own widget is not collateral.
		expect(res.modePanels.some((p) => p.id === "map")).toBe(true)
	})
})

/**
 * R71: a package's top-level `widgets`, offered in every session of a genre
 * they are scoped to — with the base sections each reads (R75), clamped off
 * the stored manifest by the SDK's one rule.
 */
describe("sessions:view — package widgets (R71) carry what they read (R75)", () => {
	// Package widgets are part of the extension subsystem (SP_PLUGINS_ENABLED).
	beforeAll(() => {
		vi.stubEnv("SP_PLUGINS_ENABLED", "1")
	})
	afterAll(() => {
		vi.unstubAllEnvs()
	})

	async function packageScenario(adminDenied?: (manifest: Record<string, unknown>) => string[]) {
		const k = n++
		const owner = await makeUser(`pkg-owner-${k}`)
		const pluginId = `acme.hud-${k}`
		const manifest = {
			widgets: [
				{ id: "hud", title: "HUD", component: "hud", reads: ["settings", "made-up", "settings", "session_full"], maxInstances: 1 },
				// A cap that is not a positive integer is no cap (brief 7b).
				{ id: "all", title: "Everything", component: "all", maxInstances: 1.5 },
				// The twenty-questions shape: scopes declared ONLY on a top-level widget.
				{ id: "log", title: "Log", component: "log", scopes: ["session:full", "session:state"] },
				// Asks for a scope of its own — granted only if its plugin was.
				{ id: "greedy", title: "Greedy", component: "log", scopes: ["characters"] },
				// F1: built against a host contract this host does / does not speak.
				{ id: "today", title: "Today", component: "today" },
				{ id: "future", title: "Future", component: "future" },
				{ id: "old-vocab", title: "Old vocabulary", component: "old-vocab" }
			],
			components: [
				{ slug: "hud", entry: "ui/hud.js" },
				{ slug: "all", entry: "ui/all.js" },
				{ slug: "log", entry: "ui/log.mjs" },
				{ slug: "today", entry: "ui/today.js", builtAgainst: currentBuiltAgainst({ sdk: "0.6.0" }) },
				{ slug: "future", entry: "ui/future.js", builtAgainst: { widgetProtocol: WIDGET_PROTOCOL + 1, hostElements: HOST_ELEMENTS_VERSION } },
				{ slug: "old-vocab", entry: "ui/old-vocab.js", builtAgainst: { widgetProtocol: WIDGET_PROTOCOL, hostElements: "0.3" } }
			]
		}
		await testDb.insert(schema.plugins).values({
			pluginId,
			name: "HUD",
			bundleSource: "// x",
			bundleHash: "deadbeef",
			enabled: true,
			manifest,
			...(adminDenied ? { adminDenied: adminDenied(manifest) } : {})
		})
		const typeId = `core:inlet/pkgmode-${k}`
		await testDb.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: typeId,
			version: 1,
			kind: "inlet",
			status: "live",
			sessionShape: { panels: [] }
		})
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, genreId: `${typeId}@1` })
			.returning()
		return { owner, session, pluginId }
	}

	test("a declared list is clamped to base sections, once each; an absent one is left off (reads all)", async () => {
		const s = await packageScenario()
		const { sessionsViewHandler } = await import("./sessions")
		const res = await sessionsViewHandler.handler(fakeSocket(s.owner.id), { sessionId: s.session.id } as any, noop)
		const hud = res.modePanels.find((p) => p.id === `${s.pluginId}:hud`)!
		expect(hud.surface).toEqual({ kind: "remote", owner: s.pluginId, component: "hud" })
		expect(hud.reads).toEqual(["settings"])
		const all = res.modePanels.find((p) => p.id === `${s.pluginId}:all`)!
		expect(all).not.toHaveProperty("reads")
	})

	test("a widget's maxInstances rides on the wire for the Add menu; a bad one is no cap (brief 7b)", async () => {
		const s = await packageScenario()
		const { sessionsViewHandler } = await import("./sessions")
		const res = await sessionsViewHandler.handler(fakeSocket(s.owner.id), { sessionId: s.session.id } as any, noop)
		expect(res.modePanels.find((p) => p.id === `${s.pluginId}:hud`)!.maxInstances).toBe(1)
		expect(res.modePanels.find((p) => p.id === `${s.pluginId}:all`)).not.toHaveProperty("maxInstances")
		expect(res.modePanels.find((p) => p.id === `${s.pluginId}:log`)).not.toHaveProperty("maxInstances")
	})

	test("a top-level widget's scopes are refused until reviewed, then reach that widget's grants", async () => {
		const unreviewed = await packageScenario()
		const { sessionsViewHandler } = await import("./sessions")
		const before = await sessionsViewHandler.handler(fakeSocket(unreviewed.owner.id), { sessionId: unreviewed.session.id } as any, noop)
		expect(before.modePanels.find((p) => p.id === `${unreviewed.pluginId}:log`)).not.toHaveProperty("grants")

		const { reviewMarks, declaredPermissions } = await import("$lib/server/plugins/permissions")
		const s = await packageScenario((m) => reviewMarks(declaredPermissions(m)))
		const res = await sessionsViewHandler.handler(fakeSocket(s.owner.id), { sessionId: s.session.id } as any, noop)
		expect(res.modePanels.find((p) => p.id === `${s.pluginId}:log`)!.grants).toEqual(["session:full", "session:state"])
		// Per widget: one that asked nothing is given nothing; each gets only what IT asked,
		// never a sibling's grant.
		expect(res.modePanels.find((p) => p.id === `${s.pluginId}:hud`)).not.toHaveProperty("grants")
		expect(res.modePanels.find((p) => p.id === `${s.pluginId}:greedy`)!.grants).toEqual(["characters"])
	})

	test("a denied scope stays out of the widget's grants", async () => {
		const { reviewMarks, declaredPermissions } = await import("$lib/server/plugins/permissions")
		const s = await packageScenario((m) => [
			...reviewMarks(declaredPermissions(m)),
			"widget:session:full",
			"widget:characters"
		])
		const { sessionsViewHandler } = await import("./sessions")
		const res = await sessionsViewHandler.handler(fakeSocket(s.owner.id), { sessionId: s.session.id } as any, noop)
		expect(res.modePanels.find((p) => p.id === `${s.pluginId}:log`)!.grants).toEqual(["session:state"])
		// A widget cannot get a scope its plugin was not granted.
		expect(res.modePanels.find((p) => p.id === `${s.pluginId}:greedy`)).not.toHaveProperty("grants")
	})

	test("F1: a component built for a protocol or vocabulary major this host lacks is not offered; one without a record is", async () => {
		const s = await packageScenario()
		const { sessionsViewHandler } = await import("./sessions")
		const res = await sessionsViewHandler.handler(fakeSocket(s.owner.id), { sessionId: s.session.id } as any, noop)
		const offered = (id: string) => res.modePanels.some((p) => p.id === `${s.pluginId}:${id}`)
		expect(offered("today")).toBe(true)
		expect(offered("hud")).toBe(true) // no builtAgainst: built before the record
		expect(offered("future")).toBe(false)
		expect(offered("old-vocab")).toBe(false)
	})

	test("F1: the admin plugins list says which components this host will not mount, and why", async () => {
		const s = await packageScenario()
		const [row] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, s.pluginId))
		const { toPluginRow } = await import("./plugins")
		expect(toPluginRow(row as never).componentRefusals).toEqual([
			{ slug: "future", reason: `built for widget protocol ${WIDGET_PROTOCOL + 1}; this host speaks ${WIDGET_PROTOCOL}` },
			{ slug: "old-vocab", reason: `built for host-element vocabulary 0.3; this host has ${HOST_ELEMENTS_VERSION}` }
		])
	})

	test("with SP_PLUGINS_ENABLED off no package widget is offered", async () => {
		const s = await packageScenario()
		const { sessionsViewHandler } = await import("./sessions")
		vi.stubEnv("SP_PLUGINS_ENABLED", "")
		try {
			const res = await sessionsViewHandler.handler(fakeSocket(s.owner.id), { sessionId: s.session.id } as any, noop)
			expect(res.modePanels.some((p) => p.id.startsWith(`${s.pluginId}:`))).toBe(false)
		} finally {
			vi.stubEnv("SP_PLUGINS_ENABLED", "1")
		}
	})
})

/**
 * With the extension subsystem off (SP_PLUGINS_ENABLED unset) no plugin UI of
 * any kind is offered: not a plugin's own widget, not a genre's `shape.view`
 * session-view — while core's own components still are.
 */
describe("sessions:view — with SP_PLUGINS_ENABLED off no plugin UI is offered", () => {
	beforeAll(() => {
		vi.stubEnv("SP_PLUGINS_ENABLED", "")
	})
	afterAll(() => {
		vi.unstubAllEnvs()
	})

	async function flagOffScenario() {
		const k = n++
		const owner = await makeUser(`off-owner-${k}`)
		const pluginId = `acme.offview-${k}`
		await testDb.insert(schema.plugins).values({
			pluginId,
			name: "Off",
			bundleSource: "// x",
			bundleHash: "deadbeef",
			enabled: true,
			manifest: {
				surfaces: {
					"session-view": { entry: "ui/view.html", title: "View" }
				},
				widgets: [{ id: "tray", title: "Tray", component: "tray" }],
				components: [{ slug: "tray", entry: "ui/tray.js" }]
			}
		})
		const typeId = `core:inlet/offmode-${k}`
		await testDb.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: typeId,
			version: 1,
			kind: "inlet",
			status: "live",
			sessionShape: {
				view: pluginId,
				panels: [{ id: "notes", title: "Notes", role: "secondary", component: "scene-portraits" }]
			}
		})
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, genreId: `${typeId}@1` })
			.returning()
		return { owner, session, pluginId }
	}

	const view = async (userId: number, sessionId: number) => {
		const { sessionsViewHandler } = await import("./sessions")
		return sessionsViewHandler.handler(fakeSocket(userId), { sessionId } as any, noop)
	}

	test("offers no plugin widget or session view; core's component stays", async () => {
		const s = await flagOffScenario()
		const res = await view(s.owner.id, s.session.id)
		expect(res.sessionView).toBeUndefined()
		expect(res.modePanels.some((p) => p.id.startsWith(`${s.pluginId}:`))).toBe(false)
		expect(res.modePanels.some((p) => (p.src ?? "").startsWith("/plugin-ui/"))).toBe(false)
		expect(res.modePanels.find((p) => p.id === "notes")?.src).toBe("/core-ui/scene-portraits")
	})

	test("the same session with the flag on offers all of it", async () => {
		const s = await flagOffScenario()
		vi.stubEnv("SP_PLUGINS_ENABLED", "1")
		try {
			const res = await view(s.owner.id, s.session.id)
			expect(res.sessionView?.src).toBe(`/plugin-ui/${s.pluginId}/ui/view.html`)
			expect(res.modePanels.find((p) => p.id === `${s.pluginId}:tray`)?.src).toBe(`/plugin-ui/${s.pluginId}/ui/tray.js`)
		} finally {
			vi.stubEnv("SP_PLUGINS_ENABLED", "")
		}
	})
})
