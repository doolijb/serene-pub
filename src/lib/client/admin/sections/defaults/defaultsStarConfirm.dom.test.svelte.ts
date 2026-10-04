/**
 * Admin → Defaults moves the embedding and entity stars with the same
 * confirmation as the Connections view (the W1-embed review): the embedding
 * row is priced by the server and asks before re-embedding; the entity row
 * asks before re-scanning. Nothing is written until the answer is yes, and a
 * "Keep" puts the picker back.
 *
 * The pickers are stood in for by a spy that records the props each one was
 * given, so a test can choose the way the page's own handler would be called.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { emitted, socket, listeners, listen, pickers } = vi.hoisted(() => {
	const emitted: Array<[string, any]> = []
	const listeners = new Map<string, (msg: any) => void>()
	return {
		emitted,
		socket: {
			emit: (event: string, payload: unknown) =>
				emitted.push([event, payload]),
			on: () => {},
			off: () => {}
		},
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => {
				if (listeners.get(key) === handler) listeners.delete(key)
			}
		},
		/** Every picker the page rendered, by the props it was handed. */
		pickers: [] as Array<Record<string, any>>
	}
})
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))

vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	getAdminInterestContext: () => ({
		useInterest: listen,
		requestWithInterest: (key: string, params: unknown, handler: any) => {
			listen(key, handler)
			emitted.push([key, params])
			return () => {}
		}
	})
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, info: () => {}, success: () => {} }
}))

vi.mock("$lib/client/components/inputs/Select.svelte", () => ({
	default: (_anchor: unknown, props: Record<string, any>) => {
		pickers.push(props)
	}
}))
vi.mock("$lib/client/components/admin/AdminPageHeader.svelte", () => ({
	default: () => {}
}))

import { capabilityLabel } from "@serene-pub/sdk"
import Page from "./Page.svelte"

const EMBED = "text->embedding"
const NER = "text->entities"

const model = (id: number, name: string) => ({
	id,
	name,
	model: name,
	enabled: true,
	missingSince: null
})
const combo = (id: string) => ({
	id,
	demanded: false,
	servable: true,
	requiredBy: [],
	optionalFor: []
})
const LIST = {
	combos: [combo(EMBED), combo(NER)],
	defaults: {
		[EMBED]: {
			connectionId: 1,
			connectionModelId: 11,
			samplingConfigId: null
		},
		[NER]: {
			connectionId: 3,
			connectionModelId: 31,
			samplingConfigId: null
		}
	},
	connectionOptions: {
		[EMBED]: [
			{
				id: 1,
				name: "Hosted",
				eligible: true,
				models: [model(11, "bge-small")]
			},
			{
				id: 2,
				name: "Local",
				eligible: true,
				models: [model(21, "bge-large")]
			}
		],
		[NER]: [
			{
				id: 3,
				name: "NER A",
				eligible: true,
				models: [model(31, "distilbert-NER")]
			},
			{
				id: 4,
				name: "NER B",
				eligible: true,
				models: [model(41, "xlm-NER")]
			}
		]
	},
	samplingOptions: {}
}

let app: ReturnType<typeof mount> | null = null
beforeEach(() => {
	emitted.length = 0
	pickers.length = 0
	listeners.clear()
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(Page, {
		target: host,
		context: new Map<string, unknown>([
			["userCtx", { user: { id: 1, isAdmin: true } }],
			["systemSettingsCtx", { settings: {}, capabilityDefaults: {} }],
			["panelsCtx", { digest: {}, openPanel: () => {} }]
		])
	})
	flushSync()
	listeners.get("connectionDefaults:list")!(structuredClone(LIST))
	flushSync()
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

/** The latest picker labelled so — a re-render hands a fresh one. */
const picker = (label: string) => {
	const found = pickers.findLast((p) => p.label === label)
	if (!found) throw new Error(`no picker "${label}"`)
	return found
}
const settle = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
	await tick()
}
const text = () => document.body.textContent?.replace(/\s+/g, " ") ?? ""
const button = (words: string) =>
	[...document.querySelectorAll("button")].find((b) =>
		b.textContent?.includes(words)
	) as HTMLButtonElement | undefined
const setDefaults = () =>
	emitted.filter(([e]) => e === "connections:setDefault")

describe("Admin → Defaults moves a star only after the confirmation", () => {
	test("choosing another embedding connection asks the price first and writes nothing yet", async () => {
		picker(`Connection for ${capabilityLabel(EMBED as any)}`).onValueChange(
			"2"
		)
		expect(setDefaults()).toEqual([])
		expect(emitted).toContainEqual([
			"vectorization:reindexCost",
			{ target: { connectionId: 2, modelId: 21 } }
		])
	})

	test("a price above zero opens the dialog; Switch and re-embed writes the star", async () => {
		picker(`Connection for ${capabilityLabel(EMBED as any)}`).onValueChange(
			"2"
		)
		listeners.get("vectorization:reindexCost")!({
			rows: 40,
			lorebooks: 2,
			sessions: 3,
			target: { connectionId: 2, modelId: 21 }
		})
		await settle()
		expect(text()).toContain("Switch embeddings to bge-large?")
		expect(text()).toContain("40 stored vectors are re-embedded")
		button("Switch and re-embed")!.click()
		await settle()
		expect(setDefaults()).toEqual([
			[
				"connections:setDefault",
				{ capability: EMBED, id: 2, modelId: 21 }
			]
		])
	})

	test("Keep writes nothing and puts the picker back", async () => {
		picker(`Connection for ${capabilityLabel(EMBED as any)}`).onValueChange(
			"2"
		)
		listeners.get("vectorization:reindexCost")!({
			rows: 40,
			target: { connectionId: 2, modelId: 21 }
		})
		await settle()
		const before = pickers.length
		button("Keep bge-small")!.click()
		await settle()
		expect(setDefaults()).toEqual([])
		// A fresh picker, showing the connection that is still starred.
		expect(pickers.length).toBeGreaterThan(before)
		expect(
			picker(`Connection for ${capabilityLabel(EMBED as any)}`).value
		).toBe("1")
	})

	test("a price of zero writes straight away", async () => {
		picker(`Model for ${capabilityLabel(EMBED as any)}`).onValueChange("11")
		// Unchanged: nothing to ask and nothing to write.
		expect(
			emitted.filter(([e]) => e === "vectorization:reindexCost")
		).toEqual([])
		picker(`Connection for ${capabilityLabel(EMBED as any)}`).onValueChange(
			"2"
		)
		listeners.get("vectorization:reindexCost")!({
			rows: 0,
			target: { connectionId: 2, modelId: 21 }
		})
		await settle()
		expect(setDefaults()).toHaveLength(1)
	})

	test("moving the entity star to another model asks before it re-scans", async () => {
		picker(`Connection for ${capabilityLabel(NER as any)}`).onValueChange(
			"4"
		)
		expect(setDefaults()).toEqual([])
		expect(emitted).toContainEqual(["ner:status", {}])
		listeners.get("ner:status")!({ annotatedRows: 120 })
		await settle()
		expect(text()).toContain("Switch entity extraction to xlm-NER?")
		expect(text()).toContain("120 entries and messages are re-scanned")
		button("Switch and re-scan")!.click()
		await settle()
		expect(setDefaults()).toEqual([
			["connections:setDefault", { capability: NER, id: 4, modelId: 41 }]
		])
	})

	test("turning either off asks nothing: what is stored stays", async () => {
		picker(`Connection for ${capabilityLabel(EMBED as any)}`).onValueChange(
			""
		)
		picker(`Connection for ${capabilityLabel(NER as any)}`).onValueChange(
			""
		)
		expect(setDefaults()).toEqual([
			[
				"connections:setDefault",
				{ capability: EMBED, id: null, modelId: null }
			],
			[
				"connections:setDefault",
				{ capability: NER, id: null, modelId: null }
			]
		])
	})
})
