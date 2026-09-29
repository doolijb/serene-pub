/**
 * A `plugins` row stored under the reserved id `core` — installed before
 * installs refused it (`pluginIdFindings`) — is invisible everywhere plugin
 * rows become something the app serves, offers or registers (`notCoreRow`).
 *
 * The page answers `core` with the app's own authority (a line sent as the
 * viewer, a turn fired, a proposal decided), so a row that boot says is "never
 * loaded" must not surface a frame, a widget, a page, an engine, a layout, a
 * subscription, a preset, a template, a tool or a swap either, nor be
 * registered when an administrator switches it on. Each reader is shown the
 * same declarations twice — under `core` and under an ordinary plugin — so
 * every assertion that `core` is skipped sits beside the proof that the
 * reader would have surfaced it.
 */
import { afterAll, beforeAll, describe, expect, onTestFinished, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import { sessionEvents } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const TWIN = "acme.twin"

/** One layout document that validates: the conversation, alone. */
const LAYOUT = {
	version: 2,
	zones: {
		middle: {
			rows: ["grow"],
			cols: ["grow"],
			units: [
				{
					kind: "widget",
					key: "only",
					widget: "messages",
					row: { start: 1, span: 1 },
					col: { start: 1, span: 1 }
				}
			]
		}
	}
}

/** The event every row subscribes to — a granted permission, reviewed. */
const EVENT = "core:event/message-completed@1"
/** Core's create pipeline for Chat, as the swaps test seeds it: what a swap names. */
const SWAPPED_SPEC = "core:spec/create-chat"
/** The node of it a session may swap. */
const SWAPPED_NODE = "create"

/**
 * The same declarations under any owner: an engine, a layout, a frame widget,
 * a page, a remote widget, an event subscription, a preset, a template, a
 * tool and a swap. Each is named after its owner's slug (`default` for core,
 * `wide` for the twin), so two readers that key by name keep both.
 */
const manifest = (pluginId: string, slug: string) => ({
	templateEngines: { [`${pluginId}:template/echo@1`]: "render" },
	layouts: [
		{
			genreId: "core:genre/chat",
			slug,
			name: "Wide",
			preset: { layout: LAYOUT }
		}
	],
	surfaces: {
		panels: [{ id: "panel", entry: "ui/panel.html", title: "Panel" }],
		page: { entry: "ui/panel.html", title: "Page" }
	},
	widgets: [{ id: "widget", component: "widget", title: "Widget" }],
	components: [{ slug: "widget", entry: "ui/widget.mjs" }],
	permissions: [`event:${EVENT}`],
	eventHooks: [{ event: EVENT, hook: "onCompleted" }],
	presets: [{ slug, genre: "core:genre/chat", label: `Preset ${slug}` }],
	// Under core's own namespace for the core row: refused if it were ever read.
	templates: [
		{
			id: `${pluginId}:template/terse@1`,
			kind: "variables",
			variableId: "core:var/characters@1",
			engine: "core:template/handlebars@1",
			body: "{{name}}",
			label: `Terse ${slug}`
		}
	],
	tools: { [`lookup_${slug}`]: { hook: "lookup", description: "Looks a name up." } },
	swaps: [{ spec: SWAPPED_SPEC, node: SWAPPED_NODE, definition: `${pluginId}:task/echo@1` }]
})

let testDb: TestDb
let ownerId: number
let sessionId: number

beforeAll(async () => {
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	// Written straight to the table: the install path refuses the id now,
	// which is exactly why a stored one can only be a legacy row.
	for (const [pluginId, slug] of [
		["core", "default"],
		[TWIN, "wide"]
	] as const) {
		await testDb.insert(schema.plugins).values({
			pluginId,
			name: pluginId,
			version: "1.0.0",
			bundleSource: "module.exports = { hooks: { render: (i) => i.template } }",
			bundleHash: `hash-${pluginId}`,
			enabled: true,
			manifest: manifest(pluginId, slug),
			// The subscription's permission, reviewed and left granted.
			adminDenied: [`__reviewed:event:${EVENT}`]
		})
		for (const [path, mime] of [
			["ui/panel.html", "text/html"],
			["ui/widget.mjs", "text/javascript"]
		])
			await testDb.insert(schema.pluginFiles).values({
				pluginId,
				path,
				mime,
				content: Buffer.from("<p>x</p>").toString("base64"),
				hash: `${pluginId}-${path}`,
				bytes: 8
			})
	}
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, "core-row-owner")
	ownerId = owner.id
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: ownerId, isGroup: false })
		.returning()
	sessionId = session.id
}, 60_000)

afterAll(async () => {
	const { _resetRenderers } = await import("$lib/server/pipelines/prompt/renderers")
	const { _resetEngineHost } = await import("./engineHost")
	const { _resetEventHost } = await import("./eventHost")
	_resetRenderers()
	_resetEngineHost()
	_resetEventHost()
})

describe("a stored 'core' plugin row", () => {
	test("is not loaded at boot", async () => {
		const { loadEnabledPlugins, loadPluginManifests } = await import("./store")
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			expect((await loadEnabledPlugins(testDb as never)).map((d) => d.id)).toEqual([TWIN])
			expect((await loadPluginManifests(testDb as never)).map((r) => r.pluginId)).toEqual([TWIN])
		} finally {
			warn.mockRestore()
		}
	})

	test("registers no engine in core's namespace", async () => {
		const { SandboxManager } = await import("./SandboxManager")
		const { syncPluginEngines } = await import("./engineHost")
		const { knownEngines } = await import("$lib/server/pipelines/prompt/renderers")
		const mgr = new SandboxManager({ onInvocation: () => {} })
		try {
			await syncPluginEngines(testDb as never, mgr)
			const ids = knownEngines().map((e) => e.id)
			expect(ids).toContain(`${TWIN}:template/echo@1`)
			expect(ids).not.toContain("core:template/echo@1")
		} finally {
			await mgr.dispose()
		}
	})

	test("projects no layout — not even core's reserved slug on core's own genre", async () => {
		const { syncPluginLayouts } = await import("$lib/server/db/pluginLayouts")
		const report = await syncPluginLayouts(testDb as never)
		expect(report.projected).toContain(`layout:core:genre/chat:${TWIN}/wide`)
		const rows = await testDb
			.select({ pluginId: schema.sessionLayoutPresets.pluginId })
			.from(schema.sessionLayoutPresets)
			.where(eq(schema.sessionLayoutPresets.pluginId, "core"))
		expect(rows).toEqual([])
		expect([...report.projected, ...report.refused.map((r) => r.key)].some((k) => k.includes(":core/"))).toBe(false)
	})

	test("offers no widget, frame or page", async () => {
		const { enabledPluginWidgetIds } = await import("./frameHost")
		const ids = [...(await enabledPluginWidgetIds(testDb as never))]
		expect(ids).toContain(`${TWIN}:panel`)
		expect(ids.some((id) => id.startsWith("core:"))).toBe(false)

		const { sessionsViewHandler } = await import("$lib/server/sockets/sessions")
		const socket = { user: { id: ownerId }, io: { to: () => ({ emit: () => {} }) } } as any
		// Package widgets are offered only behind the extension flag.
		vi.stubEnv("SP_PLUGINS_ENABLED", "1")
		const res = await sessionsViewHandler.handler(socket, { sessionId } as any, () => {}).finally(() =>
			vi.unstubAllEnvs()
		)
		const srcs = [...res.panels.map((p) => p.src), ...res.modePanels.map((p) => p.src ?? "")]
		// Both of the twin's: its frame widget, and its remote one.
		expect(srcs).toContain(`/plugin-ui/${TWIN}/ui/panel.html`)
		expect(srcs).toContain(`/plugin-ui/${TWIN}/ui/widget.mjs`)
		expect(srcs.some((s) => s.startsWith("/plugin-ui/core/"))).toBe(false)
		expect(res.panels.some((p) => p.pluginId === "core")).toBe(false)
		expect(
			res.modePanels.some((p) => (p.surface as { owner?: string; pluginId?: string }).owner === "core" ||
				(p.surface as { pluginId?: string }).pluginId === "core")
		).toBe(false)
	})

	test("is never served as a frame document or a plugin page", async () => {
		// Plugin frames and pages are served only behind the extension flag.
		vi.stubEnv("SP_PLUGINS_ENABLED", "1")
		onTestFinished(() => {
			vi.unstubAllEnvs()
		})
		const { GET } = await import("../../../routes/plugin-ui/[...rest]/+server")
		const get = (rest: string) =>
			GET({
				params: { rest },
				request: new Request(`http://localhost/plugin-ui/${rest}`)
			} as never) as Promise<Response>
		expect((await get(`${TWIN}/ui/panel.html`)).status).toBe(200)
		expect((await get("core/ui/panel.html")).status).toBe(404)

		const { load } = await import("../../../routes/x/[...rest]/+page.server")
		const page = (rest: string) => load({ params: { rest } } as never) as Promise<Record<string, unknown>>
		expect(await page(TWIN)).toMatchObject({ src: `/plugin-ui/${TWIN}/ui/panel.html` })
		expect(await page("core")).toEqual({})
	})

	test("subscribes no event listener, and the event map draws none", async () => {
		const { syncPluginEventHooks, pluginEvents } = await import("./eventHost")
		await syncPluginEventHooks(testDb as never)
		expect(pluginEvents().subscribers(EVENT).map((s) => s.pluginId)).toEqual([TWIN])

		// The map would draw it as `core:listener/…` — core's own listener namespace.
		const { eventMap } = await import("$lib/server/pipelines/entities/eventMap")
		const map = await eventMap(testDb as never)
		const listeners = map.edges.filter((e) => e.kind === "listens" && e.from === EVENT).map((e) => e.to)
		expect(listeners).toContain(`${TWIN}:listener/onCompleted`)
		expect(listeners).not.toContain("core:listener/onCompleted")
		expect(map.nodes.some((n) => n.id === "core:listener/onCompleted")).toBe(false)
	})

	test("projects no session preset", async () => {
		const { syncPluginPresets } = await import("$lib/server/pipelines/boot/registrySync")
		const report = await syncPluginPresets(testDb as never)
		expect(report.projected).toContain(`plugin:${TWIN}:wide`)
		expect(report.projected).not.toContain("plugin:core:default")
		const rows = await testDb
			.select({ seedKey: schema.sessionPresets.seedKey })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "plugin:core:default"))
		expect(rows).toEqual([])
	})

	test("projects no template — not even one refused under core's namespace", async () => {
		const { syncPluginTemplates } = await import("$lib/server/pipelines/boot/registrySync")
		const report = await syncPluginTemplates(testDb as never)
		expect(report.projected).toEqual([`${TWIN}:template/terse@1`])
		// Read, the row's declaration would have been refused here, by name.
		expect(report.refused).toEqual([])
	})

	test("offers no tool", async () => {
		const { toolProviders, resolveTool } = await import("$lib/server/pipelines/runtime/tools/resolve")
		const plugins = (await toolProviders(testDb as never)).flatMap((p) => (p.kind === "plugin" ? [p.binding] : []))
		expect(plugins.map((b) => [b.pluginId, b.name])).toEqual([[TWIN, "lookup_wide"]])
		expect(await resolveTool(testDb as never, "lookup_default")).toBeNull()
	})

	test("contributes no swap: not on the genre hub, not in a session's picker", async () => {
		// Core's create pipeline for Chat, with a node a session may swap —
		// what both rows' swaps name — and the definitions they name, live.
		const [spec] = await testDb.insert(schema.pipelineSpecs).values({ slug: SWAPPED_SPEC, name: "Create chat" }).returning()
		const [version] = await testDb
			.insert(schema.pipelineSpecVersions)
			.values({
				specId: spec.id,
				semver: "1.0.0",
				status: "published",
				canonicalHash: "core-row-create-chat",
				genre: { name: "Chat", shape: {} },
				inputGenre: "core:genre/chat",
				inputEvent: sessionEvents.sessionCreated
			})
			.returning()
		await testDb.update(schema.pipelineSpecs).set({ activeVersionId: version.id }).where(eq(schema.pipelineSpecs.id, spec.id))
		await testDb.insert(schema.pipelineNodes).values({
			specVersionId: version.id,
			nodeKey: SWAPPED_NODE,
			kind: "task",
			definitionId: "core:task/core-row-pinned",
			position: 0,
			expose: { session: true }
		})
		// `core:task/echo` passes the stand-in rule as core's by namespace.
		for (const [definitionId, isPublic] of [
			["core:task/core-row-pinned", false],
			[`${TWIN}:task/echo`, true],
			["core:task/echo", false]
		] as const)
			await testDb.insert(schema.pipelineDefinitionRegistry).values({ definitionId, kind: "task", isPublic })

		const { sessionGenresDetail } = await import("$lib/server/sockets/sessionAdmin")
		const admin = { user: { id: ownerId, isAdmin: true }, io: { to: () => ({ emit: () => {} }) } } as any
		const hub = await sessionGenresDetail.handler(admin, { genreId: "core:genre/chat" } as any, () => {})
		expect(hub.error).toBeUndefined()
		expect(hub.swaps?.map((s) => [s.pluginId, s.definition])).toEqual([[TWIN, `${TWIN}:task/echo@1`]])

		const { listSessionNodeSwaps } = await import("$lib/server/pipelines/entities/bindings")
		const offered = await listSessionNodeSwaps(testDb as never, {
			spec: SWAPPED_SPEC,
			nodeKey: SWAPPED_NODE,
			specVersionId: version.id
		})
		expect(offered.map((o) => o.definitionId)).toEqual(["core:task/core-row-pinned@1", `${TWIN}:task/echo@1`])
	})

	test("is never registered when an administrator switches it on", async () => {
		vi.stubEnv("SP_PLUGINS_ENABLED", "1")
		const { getManager } = await import("$lib/server/plugins")
		const mgr = getManager()
		const registered = vi.spyOn(mgr, "register")
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const { pluginsSetEnabled } = await import("$lib/server/sockets/plugins")
			const admin = { user: { id: ownerId, isAdmin: true } } as any
			// Through `syncManager`: the core row reads as absent, so the manager
			// holds nothing under the app's own name; the twin registers.
			for (const pluginId of ["core", TWIN])
				await pluginsSetEnabled.handler(admin, { pluginId, enabled: true }, () => {})
			expect(registered.mock.calls.map(([d]) => d.id)).toEqual([TWIN])
		} finally {
			registered.mockRestore()
			warn.mockRestore()
			vi.unstubAllEnvs()
			await mgr.dispose()
		}
	})

	test("switched off, it does not read core's own ids as a disabled plugin's", async () => {
		await testDb.update(schema.plugins).set({ enabled: false })
		const { disabledPlugins } = await import("./disabledPlugins")
		const off = await disabledPlugins(testDb as never)
		expect(off.ownsId(`${TWIN}:genre/x`)).toBe(true)
		expect(off.ownsId("core:genre/chat")).toBe(false)
		expect(off.slugs.has("core")).toBe(false)
	})
})
