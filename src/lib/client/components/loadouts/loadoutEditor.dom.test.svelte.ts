/**
 * The loadout editor's three cards, on screen (lane E2): a model pick moves
 * the header's *what runs* line; a pair change swaps a sampling config that
 * does not fit and the Sampling card says so; the Workflow card appears only
 * for a template-payload pair, and its dials save to `workflow_values`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import { S } from "@serene-pub/sdk"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
const emitted: Array<[string, any]> = []
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({
		emit: (event: string, payload: unknown) => emitted.push([event, payload]),
		on: () => {},
		off: () => {}
	})
}))
const listeners = new Map<string, Array<(msg: any) => void>>()
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		listeners.set(key, [...(listeners.get(key) ?? []), handler])
		return () => {}
	},
	useInterest: (key: string, handler: (msg: any) => void) => {
		listeners.set(key, [...(listeners.get(key) ?? []), handler])
	}
}))
const VARIABLES = [
	{ name: "steps", type: "integer", default: 20 },
	{ name: "lora_strength", type: "number", default: 0.8, min: 0, max: 2 },
	{ name: "prompt", type: "string" }
]
vi.mock("$lib/client/components/connections/comfy/workflowsApi", () => ({
	workflowsApi: () => ({
		list: () => Promise.resolve([]),
		onServer: () => Promise.resolve(null),
		get: (id: number) =>
			Promise.resolve({ id, name: "Sprite", variables: VARIABLES })
	})
}))

import LoadoutSheet from "./LoadoutSheet.svelte"
import { summary } from "./loadoutFixtures"

const answer = (key: string, msg: any) =>
	listeners.get(key)?.forEach((h) => h(msg))
const settle = async () => {
	for (let i = 0; i < 4; i++) {
		await tick()
		await new Promise((r) => setTimeout(r, 0))
	}
	flushSync()
}

const TRANSFORMS = [
	{ id: "text->text", label: "Chat", output: "text", defaultLoadoutId: 1 },
	{ id: "text->image", label: "Images", output: "image", defaultLoadoutId: null }
]
function list(over: Partial<Sockets.Loadouts.List.Response> = {}) {
	return {
		loadouts: [],
		transforms: TRANSFORMS,
		canReply: false,
		samplingOptions: {
			"text->text": [
				{ id: 5, name: "Chat", shape: S.textGen, seedKey: "sampling-default" }
			],
			"text->image": [
				{ id: 7, name: "SD 1.5", shape: S.imageGen, seedKey: "sampling-sd15" }
			]
		},
		...over
	} as Sockets.Loadouts.List.Response
}
const model = (id: number, name: string, caps: string[]) => ({
	id,
	name,
	model: name,
	enabled: true,
	missingSince: null,
	satisfiableCapabilities: caps
})
const CONNECTIONS = [
	{
		id: 1,
		name: "KoboldCPP",
		type: "koboldcpp",
		models: [model(4, "Nemo 12B", ["text->text"])],
		modelsSync: { at: null, error: null }
	},
	{
		id: 2,
		name: "ComfyUI",
		type: "comfyui",
		models: [model(9, "sdxl_base", ["text->image"])],
		modelsSync: { at: null, error: null }
	}
] as any

const mounted: ReturnType<typeof mount>[] = []
function open(loadout: Sockets.Loadouts.Summary, l = list()) {
	const app = mount(LoadoutSheet, {
		target: document.body,
		props: { loadout, list: l, connections: CONNECTIONS, onClose: () => {} }
	})
	mounted.push(app)
	flushSync()
	return app
}
const runsLine = () =>
	document.querySelector<HTMLElement>('[aria-label^="What runs"]')?.textContent?.trim()
const radio = (name: RegExp) =>
	[...document.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) =>
		name.test(r.textContent ?? "")
	)
const button = (name: string) =>
	[...document.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent?.trim() === name
	)
const headings = () =>
	[...document.querySelectorAll("h3")].map((h) => h.textContent?.trim())

beforeEach(() => {
	emitted.length = 0
	listeners.clear()
})
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

describe("the Model card", () => {
	test("picking a model moves the what-runs line, and Save sends the pair", async () => {
		open(summary({ samplingConfigId: 5, fallbackName: "Reply" }))
		await settle()
		expect(runsLine()).toBe("Unfilled — falls back to Reply")
		radio(/Nemo 12B/)!.click()
		flushSync()
		expect(runsLine()).toBe("KoboldCPP · Nemo 12B · sampling Chat")
		expect(radio(/Nemo 12B/)!.getAttribute("aria-checked")).toBe("true")
		// A draft until Save: nothing written yet.
		expect(emitted.some(([e]) => e === "loadouts:update")).toBe(false)
		button("Save")!.click()
		flushSync()
		expect(emitted.find(([e]) => e === "loadouts:update")?.[1]).toEqual({
			id: 1,
			connectionId: 1,
			connectionModelId: 4
		})
	})
})

describe("the Sampling card", () => {
	test("a pair change swaps a config that does not fit, and says so", async () => {
		open(summary({ samplingConfigId: 9 }))
		answer("samplingConfigs:list", {
			samplingConfigsList: [
				{ id: 9, name: "SDXL", shape: S.imageGen, values: {}, enabled: [] },
				{
					id: 5,
					name: "Chat",
					shape: S.textGen,
					values: { temperature: 0.7 },
					enabled: ["temperature"]
				}
			]
		})
		await settle()
		radio(/Nemo 12B/)!.click()
		flushSync()
		const notice = [...document.querySelectorAll('[role="status"]')].find((n) =>
			/does not fit/.test(n.textContent ?? "")
		)
		expect(notice?.textContent).toContain(
			"SDXL does not fit this model, so sampling is now Chat."
		)
		const chat = radio(/^\s*Chat/)!
		expect(chat.getAttribute("aria-checked")).toBe("true")
		expect(chat.textContent).toContain("Temperature 0.7")
	})
})

describe("the Workflow card", () => {
	const imageLoadout = summary({
		id: 3,
		loadoutId: "core:loadout/sprites@1",
		name: "Sprites",
		transform: "text->image",
		connectionId: 2,
		connectionModelId: 9,
		workflowId: 11,
		workflowValues: { lora_strength: 0.5 }
	})

	test("is absent for a flat pair", async () => {
		open(imageLoadout)
		await settle()
		answer("images:drawingSheet", { sheet: { payload: "flat" } })
		await settle()
		expect(headings()).not.toContain("Workflow")
	})

	test("appears for a template pair; its dials say default or set here and save", async () => {
		open(imageLoadout)
		await settle()
		answer("images:drawingSheet", { sheet: { payload: "template" } })
		await settle()
		expect(headings()).toContain("Workflow")
		const text = document.body.textContent ?? ""
		expect(text).toContain("Default 20")
		expect(text).toContain("Set here · default 0.8")
		const steps = [...document.querySelectorAll<HTMLInputElement>("input")].find(
			(i) => i.getAttribute("aria-describedby")?.includes("steps")
		)!
		steps.value = "30"
		steps.dispatchEvent(new Event("change", { bubbles: true }))
		flushSync()
		button("Save")!.click()
		flushSync()
		expect(emitted.find(([e]) => e === "loadouts:update")?.[1]).toEqual({
			id: 3,
			workflowValues: { lora_strength: 0.5, steps: 30 }
		})
	})
})
