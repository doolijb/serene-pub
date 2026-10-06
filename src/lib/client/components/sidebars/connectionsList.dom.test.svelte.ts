/**
 * The Connections view lists CONNECTIONS, and a connection holds its models
 * (notes 42, owner 2026-10-03).
 *
 * Mounted whole, in the dock (happy-dom lays nothing out, so the view
 * measures compact and opening a connection replaces the list): the
 * defaults sit on top, the connections under them as rows or cards with
 * their type, state and model count, and opening one shows its models in
 * place — no "Show N models" fold — with Back returning to the list.
 *
 * Every view the list can open other than an API connection's is stood in
 * for: they have their own tests, and this one is about the way in and out.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

const { emitted, socket, listeners, listen, pickers } = vi.hoisted(() => {
	const emitted: Array<[string, any]> = []
	const listeners = new Map<string, Set<(msg: any) => void>>()
	return {
		/** The New Connection picker's props: `selectedItem` is its binding. */
		pickers: [] as Array<Record<string, any>>,
		emitted,
		socket: {
			emit: (event: string, payload: unknown) => emitted.push([event, payload]),
			on: () => {},
			off: () => {}
		},
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			let set = listeners.get(key)
			if (!set) listeners.set(key, (set = new Set()))
			set.add(handler)
			return () => set!.delete(handler)
		}
	}
})
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket,
	typedSocketOrNull: () => socket
}))
vi.mock("$lib/client/sockets/socketInstance", () => ({ getSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: () => () => {}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, warning: () => {}, info: () => {}, success: () => {} }
}))
vi.mock("$lib/client/components/connections/ManagedConnectionView.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/CapabilityView.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/ModelFinderView.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/SetupChatFlow.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/DownloadsView.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/OnnxEndpointView.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/OnnxModelView.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/ModelDetailView.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/ConnectionTypeForm.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/ConnectionStopScripts.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/ConnectionCapabilities.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/EmbeddingQueuePanel.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/NerLanePanel.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/EmbeddingSwitchDialog.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/connections/EntitySwitchDialog.svelte", () => ({ default: () => {} }))
vi.mock("$lib/client/components/sidebars/ConnectionServicePicker.svelte", () => ({
	default: (_anchor: unknown, props: Record<string, any>) => {
		pickers.push(props)
	}
}))

import ConnectionsSidebar from "./ConnectionsSidebar.svelte"

const CHAT = "text->text"
const model = (id: number, name: string) => ({
	id,
	name,
	model: name.toLowerCase(),
	enabled: true,
	missingSince: null,
	satisfiableCapabilities: [CHAT]
})
const row = (over: Record<string, unknown>) => ({
	preset: null,
	hasCredential: true,
	modality: "text-gen",
	modelsSync: { syncedAt: null, error: null },
	...over
})
const LIST = [
	row({
		id: 1,
		name: "Hosted",
		type: "openai",
		baseUrl: "https://hosted.test/v1",
		models: [model(11, "Nemo"), model(12, "Qwen")]
	}),
	row({
		id: 2,
		name: "Desk",
		type: "llamacpp",
		baseUrl: "http://desk.test:8080",
		models: [model(21, "Llama")]
	})
]

function hear(key: string, msg: unknown) {
	for (const handler of [...(listeners.get(key) ?? [])]) handler(msg)
	flushSync()
}
async function settle() {
	for (let i = 0; i < 4; i++) await tick()
	flushSync()
}
const text = (el: Element) => el.textContent?.replace(/\s+/g, " ") ?? ""
const button = (el: Element, name: string) =>
	[...el.querySelectorAll("button")].find(
		(b) => b.getAttribute("aria-label") === name || b.textContent?.trim() === name
	) as HTMLButtonElement | undefined

let target: HTMLElement
let view: Record<string, any>

beforeEach(async () => {
	emitted.length = 0
	listeners.clear()
	pickers.length = 0
	try {
		globalThis.localStorage?.removeItem?.("serene-pub:viewMode:connectionsIndex")
	} catch {
		// No storage: the toggle starts at its default either way.
	}
	target = document.createElement("div")
	document.body.appendChild(target)
	view = mount(ConnectionsSidebar, {
		target,
		context: new Map<string, unknown>([
			[
				"systemSettingsCtx",
				{
					settings: { isAndroidWrapper: false },
					capabilityDefaults: { [CHAT]: { connectionId: 1, connectionModelId: 11 } }
				}
			],
			["koboldCppSettingsCtx", { settings: undefined }],
			[
				"panelsCtx",
				{ digest: {}, openPanel: () => {}, closePanel: () => {} }
			],
			["userCtx", { user: { id: 1, isAdmin: true } }]
		])
	})
	flushSync()
	hear("connections:list", { connectionsList: LIST })
	await settle()
})

afterEach(() => {
	unmount(view)
	target.remove()
})

describe("the Connections view lists connections", () => {
	test("the defaults sit on top; the connections are the list under them", () => {
		const body = text(target)
		expect(body).toContain("Sessions can reply")
		expect(body).toContain("Other jobs")
		const strip = body.indexOf("Sessions can reply")
		const heading = body.indexOf("Connections 2")
		expect(heading).toBeGreaterThan(strip)
		const list = target.querySelector(
			'[aria-labelledby="connections-index-heading"]'
		)!
		expect(text(list)).toContain("Hosted")
		expect(text(list)).toContain("Desk")
		// No model is listed on the index: models live inside a connection.
		expect(body).not.toContain("Qwen")
	})

	test("the list/card pair swaps rows for cards with type, state and count", async () => {
		expect(target.querySelectorAll("[data-connection-card]")).toHaveLength(0)
		button(target, "Card view")!.click()
		await settle()
		const cards = [...target.querySelectorAll("[data-connection-card]")]
		expect(cards).toHaveLength(2)
		const desk = cards.find((c) => text(c).includes("Desk"))!
		expect(text(desk)).toContain("1 model")
		// The type, where the title has not already said it.
		expect(text(desk)).toMatch(/llama\.cpp/i)
		const hosted = cards.find((c) => text(c).includes("Hosted"))!
		expect(text(hosted)).toContain("2 models")
		expect(text(hosted)).toContain("Chat")
	})

	test("opening a connection shows its models in place; Back returns", async () => {
		const open = [...target.querySelectorAll("button")].find((b) =>
			text(b).includes("Hosted")
		)!
		open.click()
		await settle()
		expect(emitted).toContainEqual(["connections:get", { id: 1 }])
		hear("connections:get", {
			connection: {
				id: 1,
				name: "Hosted",
				type: "openai",
				baseUrl: "https://hosted.test/v1",
				notes: ""
			}
		})
		await settle()

		const body = text(target)
		expect(body).toContain("2 models")
		// Listed, not folded behind "Show 2 models".
		expect(body).toContain("Nemo")
		expect(body).toContain("Qwen")
		expect(body).not.toContain("Show 2 models")
		expect(target.querySelector("[data-connection-models]")).not.toBeNull()

		const back = [...target.querySelectorAll("button")].find((b) =>
			/back/i.test(b.getAttribute("aria-label") ?? "")
		)!
		back.click()
		await settle()
		expect(text(target)).toContain("Connections 2")
		expect(text(target)).not.toContain("Qwen")
	})
})

/**
 * New connection on a machine whose ONNX runtime didn't load. The picker
 * disables the local ONNX cards itself (its own test); a card chosen before
 * the machine's verdict arrived must still not create, and the dialog says
 * why in place of the difficulty — Enter in the name field included, which
 * submits without the Create button.
 */
describe("New connection with a local ONNX service this machine can't run", () => {
	const REASON =
		"Not available on this machine: the Android app can't run the ONNX runtime"

	test("Create is disabled, the reason is shown, and Enter sends nothing", async () => {
		unmount(view)
		target.replaceChildren()
		listeners.clear()
		view = mount(ConnectionsSidebar, {
			target,
			context: new Map<string, unknown>([
				[
					"systemSettingsCtx",
					{
						settings: {
							isAndroidWrapper: true,
							localOnnxAvailability: {
								available: false,
								reason: "the Android app can't run the ONNX runtime"
							}
						},
						capabilityDefaults: {}
					}
				],
				["koboldCppSettingsCtx", { settings: undefined }],
				["panelsCtx", { digest: {}, openPanel: () => {}, closePanel: () => {} }],
				["userCtx", { user: { id: 1, isAdmin: true } }]
			])
		})
		flushSync()
		// Nothing connected: the empty index's "Add a connection" opens New.
		hear("connections:list", { connectionsList: [] })
		await settle()
		button(target, "Add a connection")!.click()
		await settle()
		expect(pickers.length).toBeGreaterThan(0)

		pickers.at(-1)!.selectedItem = {
			key: "type:local-onnx",
			label: "Local embeddings (ONNX)",
			category: "local",
			type: "local-onnx",
			difficulty: "One download",
			description: "",
			modality: "embeddings"
		}
		await settle()

		const dialog = document.body
		expect(text(dialog)).toContain(REASON)
		expect(text(dialog)).not.toContain("Difficulty: One download")
		// Named with its visible word first (label in name), then why.
		const create = button(dialog, `Create connection — ${REASON}`)!
		expect(create.textContent?.trim()).toBe("Create")
		expect(create.disabled).toBe(true)

		emitted.length = 0
		const name = document.getElementById("newConnName") as HTMLInputElement
		// The service's label prefilled the name, so Enter would submit.
		expect(name.value).toBe("Local embeddings (ONNX)")
		name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
		await settle()
		expect(emitted.filter(([e]) => e === "connections:create")).toHaveLength(0)
	})
})
