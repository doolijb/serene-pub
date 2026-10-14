/**
 * Document View's KoboldCPP page lists embedding models the way the
 * Connections view's Models tab does (`ManagedModelsTab`): in their own list,
 * offered for embeddings only, with a move back to the text list. "Use for
 * embeddings" asks the server for the pair (`koboldcpp:connectEmbeddingModel`)
 * and moves the star through `connections:setDefault` behind the re-embed
 * price (`useStarConfirm`), never on its own.
 */
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

const LISTING = {
	currentModel: null,
	modelsDirSet: true,
	availableModels: [
		{
			name: "llama.gguf",
			modelName: "llama",
			kind: "text",
			kindSource: "detected"
		},
		{
			name: "nomic.gguf",
			modelName: "nomic",
			kind: "embeddings",
			kindSource: "detected"
		},
		{ name: "mystery.gguf", kind: "unknown", kindSource: "assumed" },
		{ name: "sd.safetensors", kind: "image", kindSource: "detected" }
	]
}

let app: ReturnType<typeof mount> | null = null
function render(capabilityDefaults: Record<string, unknown> = {}) {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(Page, {
		target: host,
		context: new Map<string, unknown>([
			["userCtx", { user: { id: 1, isAdmin: true } }],
			[
				"koboldCppSettingsCtx",
				{ settings: { koboldCppManagerEnabled: true } }
			],
			["systemSettingsCtx", { settings: {}, capabilityDefaults }]
		])
	})
	flushSync()
	listeners.get("koboldcpp:listModels")!(structuredClone(LISTING))
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

const settle = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
	await tick()
}
/** The list under a heading. */
const listUnder = (heading: string) => {
	const h2 = [...document.querySelectorAll("h2")].find(
		(h) => h.textContent?.trim() === heading
	)
	if (!h2) throw new Error(`no heading ${heading}`)
	let el = h2.nextElementSibling
	while (el && el.tagName !== "UL") el = el.nextElementSibling
	return el as HTMLUListElement
}
const titles = (list: HTMLElement) =>
	[...list.querySelectorAll("h3")].map((h) => h.textContent?.trim())
const button = (scope: HTMLElement, words: string) =>
	[...scope.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === words
	) as HTMLButtonElement | undefined

describe("Document View › KoboldCPP › embedding models", () => {
	test("are listed on their own, and only there", () => {
		render()
		expect(titles(listUnder("Embedding models"))).toEqual(["nomic"])
		// An unclassified file stays in the text list alone, as the Models
		// tab lists it; an image model in neither.
		expect(titles(listUnder("Text models"))).toEqual([
			"llama",
			"mystery.gguf"
		])
		const embeddings = listUnder("Embedding models")
		expect(button(embeddings, "Use in Reply")).toBeUndefined()
		expect(button(embeddings, "Load")).toBeUndefined()
		expect(button(embeddings, "Use in Embeddings")).toBeDefined()
	})

	test("Use in Embeddings asks for the pair, prices the move, then stars it", async () => {
		render()
		button(listUnder("Embedding models"), "Use in Embeddings")!.click()
		expect(emitted).toContainEqual([
			"koboldcpp:connectEmbeddingModel",
			{ filename: "nomic.gguf" }
		])
		// Never starred by the handler: nothing is written yet.
		expect(emitted.map(([e]) => e)).not.toContain("connections:setDefault")

		listeners.get("koboldcpp:connectEmbeddingModel")!({
			filename: "nomic.gguf",
			connectionId: 7,
			modelId: 70,
			name: "nomic.gguf"
		})
		await settle()
		expect(emitted).toContainEqual([
			"vectorization:reindexCost",
			{ target: { connectionId: 7, modelId: 70 } }
		])
		listeners.get("vectorization:reindexCost")!({
			rows: 0,
			target: { connectionId: 7, modelId: 70 }
		})
		await settle()
		expect(emitted.filter(([e]) => e === "connections:setDefault")).toEqual(
			[
				[
					"connections:setDefault",
					{ capability: "text->embedding", id: 7, modelId: 70 }
				]
			]
		)
	})

	test("a refusal is said on the page", async () => {
		render()
		button(listUnder("Embedding models"), "Use in Embeddings")!.click()
		listeners.get("koboldcpp:connectEmbeddingModel:error")!({
			error: "That model file is no longer on disk"
		})
		await settle()
		expect(document.querySelector("[role=alert]")?.textContent).toContain(
			"That model file is no longer on disk"
		)
	})

	test("the starred one says so", () => {
		render({
			"text->embedding": { connectionId: 7, connectionModelId: 70 }
		})
		listeners.get("connections:list")!({
			connectionsList: [
				{
					id: 7,
					type: "koboldcpp_managed",
					models: [
						{ id: 70, model: "nomic.gguf", name: "nomic.gguf" }
					]
				}
			]
		})
		flushSync()
		const inUse = button(
			listUnder("Embedding models"),
			"In the Embeddings loadout"
		)
		expect(inUse?.disabled).toBe(true)
	})

	test("each list moves a file to the other", () => {
		render()
		button(listUnder("Embedding models"), "Move to text models")!.click()
		button(listUnder("Text models"), "Move to embedding models")!.click()
		expect(emitted.filter(([e]) => e === "koboldcpp:setModelKind")).toEqual(
			[
				[
					"koboldcpp:setModelKind",
					{ filename: "nomic.gguf", kind: "text" }
				],
				[
					"koboldcpp:setModelKind",
					{ filename: "llama.gguf", kind: "embeddings" }
				]
			]
		)
	})
})

/**
 * Off is not a dead end (less-confusing J1): the page turns its own manager
 * on with the Add menu's press (`enableManager`), the flag and, when there is
 * none, the connection, instead of sending the person to Pub settings first.
 */
describe("Document View › KoboldCPP › while it is off", () => {
	function renderOff(settings: Record<string, unknown> = {}) {
		const host = document.createElement("div")
		document.body.append(host)
		app = mount(Page, {
			target: host,
			context: new Map<string, unknown>([
				["userCtx", { user: { id: 1, isAdmin: true } }],
				[
					"koboldCppSettingsCtx",
					{ settings: { koboldCppManagerEnabled: false } }
				],
				["systemSettingsCtx", { settings, capabilityDefaults: {} }]
			])
		})
		flushSync()
	}
	const turnOn = () =>
		button(document.body, "Turn on KoboldCPP, run by Serene Pub")

	test("never sends the person to settings", () => {
		renderOff()
		expect(document.body.textContent).not.toContain("System settings")
		expect(document.body.textContent).not.toContain("Pub settings")
	})

	test("waits for the connection list, then switches on and adds the connection", () => {
		renderOff()
		expect(turnOn()?.disabled).toBe(true)
		listeners.get("connections:list")!({ connectionsList: [] })
		flushSync()
		turnOn()!.click()
		flushSync()
		expect(
			emitted.find(
				([e]) => e === "systemSettings:updateKoboldCppManagerEnabled"
			)?.[1]
		).toEqual({ enabled: true })
		const create = emitted.find(([e]) => e === "connections:create")
		expect(create?.[1].connection.type).toBe("koboldcpp_managed")
	})

	test("adds no second connection when one is there", () => {
		renderOff()
		listeners.get("connections:list")!({
			connectionsList: [
				{ id: 4, name: "KoboldCPP", type: "koboldcpp_managed" }
			]
		})
		flushSync()
		turnOn()!.click()
		flushSync()
		expect(emitted.some(([e]) => e === "connections:create")).toBe(false)
		expect(
			emitted.some(
				([e]) => e === "systemSettings:updateKoboldCppManagerEnabled"
			)
		).toBe(true)
	})

	test("offers no switch in the Android app", () => {
		renderOff({ isAndroidWrapper: true })
		expect(turnOn()).toBeUndefined()
		expect(document.body.textContent).toContain(
			"not available in the Android app"
		)
	})
})
