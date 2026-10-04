/**
 * A core genre's own panels (R79, K7): `sessions:view` resolves a core
 * genre's panel naming a core component to core's remote, served by
 * `/core-ui/<slug>` — as the page's own default widgets are
 * (`sessionPage/coreWidgets.ts`) — holding its declaration's section scopes
 * as its grants. Never looked up as a plugin named `core` (which
 * `notCoreRow` hides), so never dropped; never native.
 */
import { beforeAll, describe, expect, onTestFinished, test, vi } from "vitest"
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

const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any

describe("sessions:view — a core genre's panels are core's remotes (K7, R79)", () => {
	test("a core component is served by /core-ui with its section scopes", async () => {
		// The frame it seats is a plugin's document: offered only behind the extension flag.
		vi.stubEnv("SP_PLUGINS_ENABLED", "1")
		onTestFinished(() => {
			vi.unstubAllEnvs()
		})
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const owner = await createTestUser(testDb, "core-genre-owner")
		const typeId = "core:inlet/core-remote-mode"
		await testDb.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: typeId,
			version: 1,
			kind: "inlet",
			status: "live",
			sessionShape: {
				panels: [
					{ id: "bars", title: "Bars", component: "stats", scopes: ["session:state", "made-up"] },
					{ id: "sky", title: "Sky", component: "world-state", scopes: ["session:state"] },
					{ id: "cards", title: "Cards", component: "scene-portraits", scopes: ["session:full", "made-up"] },
					{ id: "plain", title: "Plain", component: "scene-portraits" },
					// The conversation is the page's primary alone: never a panel.
					{ id: "log2", title: "Second log", component: "messages", scopes: ["session:full"] },
					// The retired frame shortcut: names no component, never offered.
					{
						id: "doc",
						title: "Doc",
						surface: { kind: "frame", pluginId: "acme.frame", entry: "doc.html" },
						scopes: ["session:full"]
					}
				]
			}
		})
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, genreId: `${typeId}@1` })
			.returning()

		const { sessionsViewHandler } = await import("./sessions")
		const res = await sessionsViewHandler.handler(fakeSocket(owner.id), { sessionId: session.id } as any, () => {})
		const byId = new Map(res.modePanels.map((p) => [p.id, p]))

		// Core's module, core's box, core's grants.
		expect(byId.get("bars")).toMatchObject({
			surface: { kind: "remote", owner: "core", component: "stats" },
			src: "/core-ui/stats",
			grants: ["session:state"]
		})
		expect(byId.get("sky")).toMatchObject({
			surface: { kind: "remote", owner: "core", component: "world-state" },
			src: "/core-ui/world-state",
			grants: ["session:state"]
		})
		// Granted its declared section scopes as the page's own core widgets
		// are (`coreDefaultWidgets`), an unknown one dropped.
		expect(byId.get("cards")).toMatchObject({
			surface: { kind: "remote", owner: "core", component: "scene-portraits" },
			src: "/core-ui/scene-portraits"
		})
		expect(byId.get("cards")?.grants).toEqual(["session:full"])
		// Declaring none, it holds none.
		expect(byId.get("plain")).not.toHaveProperty("grants")
		expect(byId.has("log2")).toBe(false)
		expect(byId.has("doc")).toBe(false)
	}, 60_000)

	test("a genre a plugin provides is the plugin's, even spelled core:… — its panels are never core's", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const owner = await createTestUser(testDb, "posing-genre-owner")
		const [plugin] = await testDb
			.insert(schema.plugins)
			.values({
				pluginId: "acme.poser",
				name: "Poser",
				bundleSource: "// x",
				bundleHash: "deadbeef",
				enabled: true,
				manifest: {}
			})
			.returning()
		const typeId = "core:inlet/posing-mode"
		await testDb.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: typeId,
			version: 1,
			kind: "inlet",
			status: "live",
			ownerPluginId: plugin.id,
			sessionShape: {
				panels: [{ id: "grab", title: "Grab", component: "stats", scopes: ["session:full", "session:state"] }]
			}
		})
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, genreId: `${typeId}@1` })
			.returning()

		const { sessionsViewHandler } = await import("./sessions")
		const res = await sessionsViewHandler.handler(fakeSocket(owner.id), { sessionId: session.id } as any, () => {})
		// Its `stats` is the plugin's own component — which the plugin does
		// not declare — so it is not offered; nothing mounts as core's.
		expect(res.modePanels.some((p) => p.id === "grab")).toBe(false)
		expect(res.modePanels.some((p) => p.surface?.kind === "remote" && p.surface.owner === "core" && p.id === "grab")).toBe(false)
	}, 60_000)
})
