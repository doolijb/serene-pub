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

	test("grouped by where it lives: this machine before services; set-aside under Can't be used right now", () => {
		const kobold = {
			id: 2,
			name: "Local Kobold",
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			models: [
				model(21, "Llama Local", ["text->text"]),
				{
					...model(22, "Old Local", ["text->text"]),
					enabled: false
				}
			]
		}
		const html = renderList([openRouter, kobold])
		const here = html.indexOf("On this machine")
		const services = html.indexOf("Services")
		const cant = html.indexOf("Can't be used right now")
		expect(here).toBeGreaterThan(-1)
		expect(services).toBeGreaterThan(here)
		expect(cant).toBeGreaterThan(services)
		expect(html.indexOf("Old Local")).toBeGreaterThan(cant)
		expect(html).toContain("Switched off")
	})

	test("a local group's header carries the summed size", () => {
		const sized = (id: number, name: string, sizeBytes: number) => ({
			...model(id, name, ["text->text"]),
			facts: { sizeBytes, source: "file" }
		})
		const kobold = {
			id: 2,
			name: "Local Kobold",
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			models: [
				sized(21, "Llama One", 5_000_000_000),
				sized(22, "Llama Two", 7_000_000_000)
			]
		}
		const html = renderList([kobold])
		expect(html).toContain("12 GB")
	})

	function bigService(count: number) {
		return {
			...openRouter,
			models: Array.from({ length: count }, (_, i) =>
				model(100 + i, `Bulk ${String(i).padStart(2, "0")}`, [
					"text->text"
				])
			)
		}
	}

	test("a long service folds before the loadouts answer", () => {
		const html = renderList([bigService(13)])
		expect(html).toContain("13 models")
		expect(html).toContain("Show")
		expect(html).not.toContain("Bulk 00")
		expect(html).not.toContain("in a loadout")
	})

	test("a model in a loadout stays out of the fold, and the line counts it", () => {
		const html = renderList([bigService(13)], {
			inLoadout: new Set(["1:105"])
		})
		expect(html).toContain("Bulk 05")
		expect(html).not.toContain("Bulk 00")
		expect(html).toContain("13 models · 1 in a loadout")
	})

	test("twelve models do not fold", () => {
		const html = renderList([bigService(12)])
		expect(html).not.toContain("Show")
		expect(html).toContain("Bulk 00")
		expect(html).toContain("Bulk 11")
	})

	test("an Ollama row ends its meta line with lives in Ollama", () => {
		const html = renderList([
			{
				id: 3,
				name: "Home Ollama",
				type: CONNECTION_TYPE.OLLAMA,
				models: [model(31, "Qwen Home", ["text->text"])]
			}
		])
		expect(html).toContain("lives in Ollama")
	})

	test("nothing arriving: no Downloads button", () => {
		expect(renderList([openRouter])).not.toContain('title="Downloads"')
	})
})
