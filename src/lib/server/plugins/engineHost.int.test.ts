import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { RuntimeManager } from "./RuntimeManager"
import {
	syncPluginEngines,
	engineDeclarationError,
	engineTypesOf,
	_resetEngineHost
} from "./engineHost"
import {
	renderTemplate,
	knownEngines,
	_resetRenderers,
	CORE_TEMPLATE_ENGINE,
	TemplateEngineError
} from "$lib/server/pipelines/prompt/renderers"

/**
 * A manifest-declared template engine, end to end: declared in the stored
 * manifest, registered as a forwarding renderer at sync, rendering through the
 * real `RuntimeManager` sandbox, and released again when the plugin is
 * disabled. The registry seam (`renderTemplate`) is what the assemble step
 * calls, so what this proves is the sentence from 12 §2a: a template whose
 * `engine` names a plugin's id renders with the plugin's renderer — and
 * refuses by name, never falls back — with the pipeline none the wiser.
 */

const ENGINE = "acme.x:template/upcase@1"

// An "engine" honest enough to prove the plumbing: uppercases the template
// and substitutes one variable. What matters is that the bytes demonstrably
// came from inside the sandbox.
const BUNDLE = `module.exports = { hooks: {
	render: (i) => i.template.toUpperCase().replace("{NAME}", String(i.variables.name)),
	renderWrong: (i) => ({ not: "a string" })
} }`

let db: TestDb
let mgr: RuntimeManager

beforeAll(async () => {
	db = await createTestDb()
	mgr = new RuntimeManager({ onInvocation: () => {} })
	await db.insert(schema.plugins).values({
		pluginId: "acme/x",
		name: "Acme X",
		bundleSource: BUNDLE,
		bundleHash: "h-engine-test",
		enabled: true,
		manifest: { engines: { [ENGINE]: "render" } }
	})
	mgr.register({
		id: "acme/x",
		name: "Acme X",
		bundleSource: BUNDLE,
		bundleHash: "h-engine-test",
		backends: ["quickjs"],
		backend: "quickjs",
		sequential: false
	})
	mgr.markReady()
}, 60_000)

afterAll(async () => {
	_resetRenderers()
	_resetEngineHost()
	await mgr?.dispose()
})

describe("a plugin's template engine", () => {
	it("registers at sync and renders through the sandbox", async () => {
		await syncPluginEngines(db, mgr)
		expect(knownEngines().map((e) => e.id)).toContain(ENGINE)

		const rendered = await renderTemplate(ENGINE, {
			template: "hello {name}",
			variables: { name: "Vell" }
		})
		expect(rendered).toBe("HELLO {NAME}".replace("{NAME}", "Vell"))
	})

	it("a non-string render is an engine failure with the engine named", async () => {
		// Point the declaration at the misbehaving hook and re-sync — the
		// reconcile replaces the forwarding renderer because the hook moved.
		await db
			.update(schema.plugins)
			.set({ manifest: { engines: { [ENGINE]: "renderWrong" } } })
			.where(eq(schema.plugins.pluginId, "acme/x"))
		await syncPluginEngines(db, mgr)

		await expect(
			renderTemplate(ENGINE, { template: "x", variables: {} })
		).rejects.toThrow(TemplateEngineError)
		await expect(
			renderTemplate(ENGINE, { template: "x", variables: {} })
		).rejects.toThrow(/acme\.x:template\/upcase@1/)
	})

	it("is released when the plugin is disabled, and refuses by name", async () => {
		await db
			.update(schema.plugins)
			.set({ enabled: false })
			.where(eq(schema.plugins.pluginId, "acme/x"))
		await syncPluginEngines(db, mgr)

		expect(knownEngines().map((e) => e.id)).not.toContain(ENGINE)
		await expect(
			renderTemplate(ENGINE, { template: "x", variables: {} })
		).rejects.toThrow(/no renderer for template engine/)
	})

	it("core's engine is untouched throughout", async () => {
		// ⚠ This used to pass `undefined` and rely on `renderTemplate`
		// defaulting to core's engine. That default is gone, and its removal is
		// the point rather than a side effect: `world.ts` dereferenced a
		// template row for its `source` and dropped the `engine` beside it, so
		// the default was taken on EVERY run on every install and every context
		// template rendered as Handlebars whatever it declared — silently, and
		// fatally for the first plugin that shipped its own assembler. Both
		// template tables store `engine` NOT NULL now, so an absent one can
		// only mean a caller lost it.
		//
		// What this test is actually about — a plugin registering and releasing
		// its own engine never disturbs core's — is unchanged, and is asserted
		// by naming core's engine rather than by omitting one.
		const rendered = await renderTemplate(CORE_TEMPLATE_ENGINE, {
			template: "still {{name}}",
			variables: { name: "here" }
		})
		expect(rendered).toBe("still here")
	})
})

describe("declaration validation", () => {
	it("holds a plugin to its own namespace", () => {
		expect(engineDeclarationError("acme/x", ENGINE)).toBeNull()
		expect(
			engineDeclarationError("acme/x", "core:template/handlebars@2")
		).toMatch(/namespace/)
		expect(
			engineDeclarationError("acme/x", "rival.y:template/thing@1")
		).toMatch(/namespace/)
		expect(engineDeclarationError("acme/x", "not an id")).toMatch(/grammar/)
	})

	it("reads a manifest tolerantly", () => {
		expect(engineTypesOf(null)).toEqual({})
		expect(engineTypesOf({ engines: "nope" })).toEqual({})
		expect(
			engineTypesOf({ engines: { [ENGINE]: "render", bad: 7 } })
		).toEqual({ [ENGINE]: "render" })
	})
})
