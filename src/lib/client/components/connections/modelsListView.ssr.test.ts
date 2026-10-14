/**
 * The Models view's list column, rendered (plan 2026-10-11, lane L2).
 *
 * `render` from `svelte/server`, like the index's tests: what this pins is
 * the assembly — the empty state's two ways on, a row per model with its
 * connection chip, the job scope narrowing the rows, and a row's Use as
 * the *Use in…* menu — never layout. Inventory only since the loadouts
 * lane (DESIGN-image-generation §14): the status strip and the jobs grid
 * are the Loadouts view's, and this list must not draw them.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))

import ModelsListView from "./ModelsListView.svelte"
import { connectionsTestContext } from "$lib/client/contexts/testProvideConnections"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const noop = () => {}

function model(id: number, name: string, caps: string[]) {
	return {
		id,
		connectionId: 0,
		model: name.toLowerCase().replace(/\s+/g, "-"),
		name,
		enabled: true,
		missingSince: null,
		contextWindow: null,
		modality: null,
		promptFormat: null,
		tokenCounter: null,
		sortOrder: 0,
		satisfiableCapabilities: caps
	}
}

const openRouter = {
	id: 1,
	name: "Work key",
	type: CONNECTION_TYPE.OPENAI,
	preset: "openrouter",
	hasCredential: true,
	modelsSync: { at: "2026-10-11T00:00:00Z", error: null },
	models: [
		model(11, "Mistral Small", ["text->text"]),
		model(12, "Flux Schnell", ["text->image"])
	]
}

function renderList(
	list: unknown[],
	props: Record<string, unknown> = {}
): string {
	return render(ModelsListView, {
		props: {
			onOpenModel: noop,
			onSetUpChat: noop,
			onGetModel: noop,
			onAddByName: noop,
			onOpenConnections: noop,
			...props
		},
		context: new Map<string, unknown>([
			connectionsTestContext(list as any),
			["systemSettingsCtx", { settings: {}, capabilityDefaults: {} }],
			["userCtx", { user: { id: 1, isAdmin: true } }]
		])
	}).body
}

describe("the Models list", () => {
	test("no connections: no models yet, Set up chat and Add a connection", () => {
		const html = renderList([])
		expect(html).toContain("No models yet.")
		expect(html).toContain("Set up chat")
		expect(html).toContain(
			"Or add a connection to a service or a server you run."
		)
		expect(html).toContain("Add a connection")
		expect(html).toContain("Get a model")
	})

	test("one row per model, each with its connection chip", () => {
		const html = renderList([openRouter])
		expect(html).toContain("Mistral Small")
		expect(html).toContain("Flux Schnell")
		expect(html).toContain("Work key")
		expect(html).not.toContain("No models yet.")
		// The readiness block (status strip, jobs grid) moved on to the
		// Loadouts view; the Models view is inventory.
		expect(html).not.toContain("Sessions can't reply yet")
		expect(html).not.toContain("Sessions can reply")
	})

	test("a row's Use is Use in… once the loadouts are handed in", () => {
		const plain = renderList([openRouter])
		expect(plain).not.toContain("Use in…")
		const html = renderList([openRouter], {
			useInGroupsOf: () => [
				{
					transform: "text->text",
					label: "Reply",
					items: [
						{
							id: 1,
							name: "Reply",
							transform: "text->text",
							isDefault: true,
							current: false,
							state: "Unfilled"
						}
					]
				}
			]
		})
		expect(html).toContain("Use in…")
		expect(html).toContain("Use Mistral Small in…")
	})

	test("the job scope narrows the rows", () => {
		const html = renderList([openRouter], { initialScope: "images" })
		expect(html).toContain("Flux Schnell")
		expect(html).not.toContain("Mistral Small")
		expect(html).toContain("1 can draw")
	})

	test("a scope nothing serves says so", () => {
		const html = renderList([openRouter], { initialScope: "entities" })
		expect(html).toContain("Nothing matches.")
	})
})
