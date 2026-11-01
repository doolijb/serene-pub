import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { emitted, socket, listeners, listen } = vi.hoisted(() => {
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
		}
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
	requestWithInterest: (key: string, params: unknown, handler: any) => {
		listen(key, handler)
		emitted.push([key, params])
		return () => {}
	}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, info: () => {}, success: () => {} }
}))
vi.mock("$lib/client/accessibility/state.svelte", () => ({
	announce: () => {}
}))


import Page from "./+page.svelte"

let app: ReturnType<typeof mount> | null = null
function render() {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(Page, {
		target: host,
		context: new Map<string, unknown>([
			["userCtx", { user: { id: 1, isAdmin: true } }],
			["ollamaSettingsCtx", { settings: { ollamaManagerEnabled: true } }],
			["systemSettingsCtx", { settings: {}, capabilityDefaults: {} }]
		])
	})
	flushSync()
}
beforeEach(() => {
	emitted.length = 0
	listeners.clear()
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const row = (name: string, extra: Record<string, unknown>) => ({
	name,
	pull: `hf.co/org/${name}`,
	size: 4,
	recommended_vram: 8,
	tags: [],
	details: {
		parameter_size: "7B",
		quantization_level: "Q4",
		modified_at: "",
		description: `${name} description`
	},
	quants: [],
	...extra
})
const MULTI = row("Multi", {
	quants: [
		{
			label: "Q2_K",
			tag: "hf.co/org/Multi:Q2_K",
			filename: "m-q2.gguf",
			sizeBytes: 1e9,
			recommended: false
		},
		{
			label: "Q4_K_M",
			tag: "hf.co/org/Multi:Q4_K_M",
			filename: "m-q4.gguf",
			sizeBytes: 2e9,
			recommended: true
		}
	]
})
const SINGLE = row("Single", {
	quants: [
		{
			label: "Q4_K_M",
			tag: "hf.co/org/Single:Q4_K_M",
			filename: "single-q4.gguf",
			recommended: true
		}
	]
})
const LIBRARY = row("Library", {
	pull: "library-model:7b",
	quantsNote: "Ollama's library lists no quants for this name."
})
const recommend = () => {
	listeners.get("ollama:recommendedModels")!({
		recommendedModels: [MULTI, SINGLE, LIBRARY]
	})
	flushSync()
}
const item = (name: string) =>
	[...document.querySelectorAll("li")].find(
		(li) => li.querySelector("h3")?.textContent?.trim() === name
	) as HTMLElement
const button = (scope: HTMLElement, words: string) =>
	[...scope.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === words
	) as HTMLButtonElement | undefined
const radios = (scope: ParentNode) =>
	[...scope.querySelectorAll<HTMLInputElement>("input[type=radio]")]

describe("Document View › Ollama › recommended models", () => {
	test("a row with quants is a radio list, the recommended one checked", () => {
		render()
		recommend()
		expect(radios(item("Multi")).map((r) => r.checked)).toEqual([
			false,
			true
		])
	})

	test("Download pulls the checked tag", () => {
		render()
		recommend()
		const li = item("Multi")
		radios(li)[0].click()
		flushSync()
		button(li, "Download Q2_K")!.click()
		expect(
			emitted.filter(([e]) => e === "ollama:pullModel")
		).toEqual([["ollama:pullModel", { modelName: "hf.co/org/Multi:Q2_K" }]])
	})

	test("a single file is named before Download", () => {
		render()
		recommend()
		const li = item("Single")
		expect(radios(li).length).toBe(0)
		expect(li.textContent).toContain("single-q4.gguf")
		button(li, "Download")!.click()
		expect(
			emitted.find(([e]) => e === "ollama:pullModel")![1].modelName
		).toBe("hf.co/org/Single:Q4_K_M")
	})

	test("no quants says why, then pulls the list's own name", () => {
		render()
		recommend()
		const li = item("Library")
		expect(li.textContent).toContain("lists no quants for this name")
		button(li, "Download")!.click()
		expect(
			emitted.find(([e]) => e === "ollama:pullModel")![1].modelName
		).toBe("library-model:7b")
	})
})
