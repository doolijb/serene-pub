/**
 * The Connections view lists CONNECTIONS, and a connection holds its models
 * (notes 42, owner 2026-10-03).
 *
 * Mounted whole, in the dock (happy-dom lays nothing out, so the view
 * measures compact and opening a connection replaces the list): the
 * connections as rows or cards with their type, state and model count, and
 * opening one shows its models in place — no "Show N models" fold — with
 * Back returning to the list. The defaults (status strip, jobs grid), the
 * job sheet, the finder and Set up chat are the Models view's since the
 * split (plan 2026-10-11); what is pinned here is that they are gone and
 * that the doors into them leave for Models.
 *
 * Every view the list can open other than an API connection's is stood in
 * for: they have their own tests, and this one is about the way in and out.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const {
	emitted,
	socket,
	listeners,
	listen,
	pickers,
	opened,
	toasts
} = vi.hoisted(() => {
	const emitted: Array<[string, any]> = []
	const listeners = new Map<string, Set<(msg: any) => void>>()
	return {
		/** Every success toast's title, in order. */
		toasts: [] as string[],
		/** What `panelsCtx.openPanel` was asked to open. */
		opened: [] as Array<Record<string, unknown>>,
		/** The New Connection picker's props: `selectedItem` is its binding. */
		pickers: [] as Array<Record<string, any>>,
		emitted,
		socket: {
			emit: (event: string, payload: unknown) =>
				emitted.push([event, payload]),
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
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: () => () => {},
	onConnect: () => () => {}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		error: () => {},
		warning: () => {},
		info: () => {},
		success: (t: { title: string }) => toasts.push(t.title)
	}
}))
vi.mock(
	"$lib/client/components/connections/ManagedConnectionView.svelte",
	() => ({ default: () => {} })
)
vi.mock("$lib/client/components/connections/DownloadsView.svelte", () => ({
	default: () => {}
}))
vi.mock("$lib/client/components/connections/OnnxEndpointView.svelte", () => ({
	default: () => {}
}))
vi.mock("$lib/client/components/connections/OnnxModelView.svelte", () => ({
	default: () => {}
}))
vi.mock("$lib/client/components/connections/ModelDetailView.svelte", () => ({
	default: () => {}
}))
vi.mock("$lib/client/components/connections/ConnectionTypeForm.svelte", () => ({
	default: () => {}
}))
vi.mock(
	"$lib/client/components/connections/ConnectionStopScripts.svelte",
	() => ({ default: () => {} })
)
vi.mock(
	"$lib/client/components/connections/ConnectionCapabilities.svelte",
	() => ({ default: () => {} })
)
vi.mock(
	"$lib/client/components/connections/EmbeddingQueuePanel.svelte",
	() => ({ default: () => {} })
)
vi.mock("$lib/client/components/connections/NerLanePanel.svelte", () => ({
	default: () => {}
}))
vi.mock(
	"$lib/client/components/connections/EmbeddingSwitchDialog.svelte",
	() => ({ default: () => {} })
)
vi.mock("$lib/client/components/connections/EntitySwitchDialog.svelte", () => ({
	default: () => {}
}))
vi.mock(
	"$lib/client/components/sidebars/ConnectionServicePicker.svelte",
	() => ({
		default: (_anchor: unknown, props: Record<string, any>) => {
			pickers.push(props)
		}
	})
)

import ConnectionsSidebar from "./ConnectionsSidebar.svelte"
import {
	CONNECTIONS_CONTEXT,
	createConnections
} from "$lib/client/contexts/connections.svelte"
import { buildConnectionServiceItems } from "$lib/shared/utils/connectionServiceItems"

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
	modelsSync: { at: null, error: null },
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
		(b) =>
			b.getAttribute("aria-label") === name ||
			b.textContent?.trim() === name
	) as HTMLButtonElement | undefined

let target: HTMLElement
let view: Record<string, any>
/** Each mount's shell: its connections context, released after the test. */
const shellReleases: Array<() => void> = []
/**
 * The shell's settings and the connections context it provides, as Layout
 * does: one settings object, read and patched by both.
 */
function shell(settings: Record<string, unknown>): Array<[string, unknown]> {
	const systemSettings = $state(settings)
	let connections!: ReturnType<typeof createConnections>
	shellReleases.push(
		$effect.root(() => {
			connections = createConnections({
				systemSettings: systemSettings as unknown as SystemSettingsCtx
			})
		})
	)
	return [
		[CONNECTIONS_CONTEXT, connections],
		["systemSettingsCtx", systemSettings]
	]
}

beforeEach(async () => {
	emitted.length = 0
	listeners.clear()
	pickers.length = 0
	opened.length = 0
	toasts.length = 0
	try {
		globalThis.localStorage?.removeItem?.(
			"serene-pub:viewMode:connectionsIndex"
		)
	} catch {
		// No storage: the toggle starts at its default either way.
	}
	target = document.createElement("div")
	document.body.appendChild(target)
	view = mount(ConnectionsSidebar, {
		target,
		context: new Map<string, unknown>([
			...shell({
				settings: { isAndroidWrapper: false },
				capabilityDefaults: {
					[CHAT]: { connectionId: 1, connectionModelId: 11 }
				}
			}),
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
	for (const release of shellReleases.splice(0)) release()
	target.remove()
})

describe("the Connections view lists connections", () => {
	test("the connections are the list; the defaults live in Models", () => {
		const body = text(target)
		// No status strip, no jobs grid, no Get a model, no downloads tray:
		// those moved to the Models view (plan 2026-10-11).
		expect(body).not.toContain("Replies:")
		expect(body).not.toContain("Other jobs")
		expect(button(target, "Get a model")).toBeUndefined()
		// No heading of its own (the shell titles the view, the filter box
		// counts it): the list is the labelled section, its groups under
		// `ListGroupLabel`s with the trade as their trailing words.
		expect(body).toContain("On this machine private · free")
		const list = target.querySelector('section[aria-label="Connections"]')!
		expect(list).not.toBeNull()
		expect(text(list)).toContain("Hosted")
		expect(text(list)).toContain("Desk")
		// No model is listed on the index: models live inside a connection.
		expect(body).not.toContain("Qwen")
	})

	test("the list/card pair swaps rows for cards with type, state and count", async () => {
		expect(target.querySelectorAll("[data-connection-card]")).toHaveLength(
			0
		)
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
		expect(
			target.querySelector('section[aria-label="Connections"]')
		).not.toBeNull()
		expect(text(target)).not.toContain("Qwen")
	})
})

/**
 * New connection on a machine whose ONNX runtime didn't load. The picker
 * disables the local ONNX cards itself (its own test); a card chosen before
 * the machine's verdict arrived must still not create, and the dialog says
 * why — Enter in the name field included, which submits without the Create
 * button.
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
				...shell({
					settings: {
						isAndroidWrapper: true,
						localOnnxAvailability: {
							available: false,
							reason: "the Android app can't run the ONNX runtime"
						}
					},
					capabilityDefaults: {}
				}),
				["koboldCppSettingsCtx", { settings: undefined }],
				[
					"panelsCtx",
					{ digest: {}, openPanel: () => {}, closePanel: () => {} }
				],
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
			setupNeed: "local",
			description: "",
			modality: "embeddings"
		}
		await settle()

		const dialog = document.body
		expect(text(dialog)).toContain(REASON)
		expect(text(dialog)).not.toContain("Difficulty")
		// Named with its visible word first (label in name), then why.
		const create = button(dialog, `Create connection — ${REASON}`)!
		expect(create.textContent?.trim()).toBe("Create")
		expect(create.disabled).toBe(true)

		emitted.length = 0
		const name = document.getElementById("newConnName") as HTMLInputElement
		// The service's label prefilled the name, so Enter would submit.
		expect(name.value).toBe("Local embeddings (ONNX)")
		name.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
		)
		await settle()
		expect(
			emitted.filter(([e]) => e === "connections:create")
		).toHaveLength(0)
	})
})

/**
 * The New connection dialog describes the service you picked (plan
 * 2026-10-06 §D): OpenRouter's own line and key page, where every preset
 * once showed OpenAI's description beside a filled "Difficulty:" pill.
 */
describe("New connection describes the picked service", () => {
	test("a keyed preset: its line, its key page, no Difficulty pill", async () => {
		hear("connections:list", { connectionsList: [] })
		await settle()
		button(target, "Add a connection")!.click()
		await settle()
		pickers.at(-1)!.selectedItem = buildConnectionServiceItems().find(
			(i) => i.label === "OpenRouter" && i.modality === "text-gen"
		)
		await settle()

		const dialog = document.body
		expect(text(dialog)).toContain(
			"OpenRouter — needs an API key from openrouter.ai"
		)
		const link = [...dialog.querySelectorAll("a")].find(
			(a) => a.textContent === "openrouter.ai"
		)!
		expect(link.getAttribute("href")).toBe("https://openrouter.ai/keys")
		expect(link.getAttribute("target")).toBe("_blank")
		expect(text(dialog)).not.toContain("Difficulty")
		expect(text(dialog)).not.toContain("OpenAI's website")
	})
})

describe("a new connection's first listing", () => {
	const OPENROUTER = {
		id: 3,
		name: "OpenRouter",
		type: "openai",
		preset: "openrouter",
		baseUrl: "https://openrouter.ai/api/v1/"
	}
	// Opening the view asks too (unforced); what matters is whether any
	// request is forced, since only a forced failure toasts.
	const forcedSyncsFor = (id: number) =>
		emitted.filter(
			([event, payload]) =>
				event === "connections:syncModels" &&
				payload?.id === id &&
				payload?.force === true
		).length
	const syncsFor = (id: number) =>
		emitted.filter(
			([event, payload]) =>
				event === "connections:syncModels" && payload?.id === id
		).length

	/**
	 * Ask for a connection through the New dialog, as a person would: the
	 * sidebar answers only acks for names it submitted itself (plan
	 * 2026-10-11 C3). The service is OpenRouter's whatever `name` is — the
	 * ack the test then hears is what the handler reads.
	 */
	async function submitNew(name: string) {
		hear("connections:list", { connectionsList: [] })
		await settle()
		button(target, "Add a connection")!.click()
		await settle()
		pickers.at(-1)!.selectedItem = buildConnectionServiceItems().find(
			(i) => i.label === "OpenRouter" && i.modality === "text-gen"
		)
		await settle()
		const input = document.getElementById("newConnName") as HTMLInputElement
		input.value = name
		input.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
		)
		await settle()
		expect(
			emitted.some(
				([event, payload]) =>
					event === "connections:create" &&
					payload?.connection?.name === name
			)
		).toBe(true)
	}

	async function create(hasCredential: boolean) {
		await submitNew(OPENROUTER.name)
		hear("connections:list", {
			connectionsList: [
				...LIST,
				row({ ...OPENROUTER, hasCredential, models: [] })
			]
		})
		emitted.length = 0
		hear("connections:create", { connection: OPENROUTER })
		await settle()
	}

	test("an ack for a name this tab never asked for is not ours", async () => {
		hear("connections:list", {
			connectionsList: [...LIST, row({ ...OPENROUTER, models: [] })]
		})
		emitted.length = 0
		hear("connections:create", { connection: OPENROUTER })
		await settle()
		expect(emitted).not.toContainEqual(["connections:get", { id: 3 }])
		expect(syncsFor(3)).toBe(0)
		expect(toasts).not.toContain("Connection created")
	})

	test("a service still waiting on its key is asked unforced, so no failure toast greets it", async () => {
		await create(false)
		expect(syncsFor(3)).toBeGreaterThan(0)
		expect(forcedSyncsFor(3)).toBe(0)
	})

	test("one that has its key is asked at once, forced", async () => {
		await create(true)
		expect(forcedSyncsFor(3)).toBe(1)
	})

	test("a custom server with no address yet is asked unforced", async () => {
		const CUSTOM = {
			id: 4,
			name: "My server",
			type: "openai",
			preset: null,
			baseUrl: ""
		}
		await submitNew(CUSTOM.name)
		hear("connections:list", {
			connectionsList: [...LIST, row({ ...CUSTOM, models: [] })]
		})
		emitted.length = 0
		hear("connections:create", { connection: CUSTOM })
		await settle()
		expect(forcedSyncsFor(4)).toBe(0)
	})
	test("a save's follow-up listing is not forced while the key is missing", async () => {
		hear("connections:list", {
			connectionsList: [
				...LIST,
				row({ ...OPENROUTER, hasCredential: false, models: [] })
			]
		})
		await settle()
		const open = [...target.querySelectorAll("button")].find((b) =>
			text(b).includes("OpenRouter")
		)!
		open.click()
		await settle()
		hear("connections:get", { connection: { ...OPENROUTER, notes: "" } })
		await settle()
		emitted.length = 0
		hear("connections:update", {
			connection: { ...OPENROUTER, notes: "" }
		})
		await settle()
		expect(syncsFor(3)).toBeGreaterThan(0)
		expect(forcedSyncsFor(3)).toBe(0)
	})
})

/**
 * The connection view names its next step (plan 2026-10-06 §B): the status
 * card's second line says the one thing to do, by the word on its control,
 * and the Models tab offers that word.
 */
describe("the status card names the next step", () => {
	const HOSTED = {
		id: 1,
		name: "Hosted",
		type: "openai",
		baseUrl: "https://hosted.test/v1",
		notes: ""
	}

	async function mountWith(
		list: unknown[],
		defaults: Record<string, unknown>
	) {
		unmount(view)
		target.replaceChildren()
		listeners.clear()
		emitted.length = 0
		view = mount(ConnectionsSidebar, {
			target,
			context: new Map<string, unknown>([
				...shell({
					settings: { isAndroidWrapper: false },
					capabilityDefaults: defaults
				}),
				["koboldCppSettingsCtx", { settings: undefined }],
				[
					"panelsCtx",
					{
						digest: {},
						openPanel: (o: Record<string, unknown>) =>
							opened.push(o),
						closePanel: () => {}
					}
				],
				["userCtx", { user: { id: 1, isAdmin: true } }]
			])
		})
		flushSync()
		hear("connections:list", { connectionsList: list })
		await settle()
		;[...target.querySelectorAll("button")]
			.find((b) => text(b).includes("Hosted"))!
			.click()
		await settle()
		hear("connections:get", { connection: HOSTED })
		await settle()
	}
	const card = () => target.querySelector('section[aria-label="Status"]')!
	const step = () => card().querySelector("[data-next-step]")

	test("an unfinished connection names Save, never Test, and Save again once edited", async () => {
		await mountWith(
			[
				row({
					...HOSTED,
					hasCredential: false,
					// OpenRouter's /models is public: a listing without a key.
					modelsSync: { at: "2026-10-06T00:00:00Z", error: null },
					models: [model(11, "Nemo")]
				})
			],
			{}
		)
		expect(text(card())).toContain("Needs an API key")
		expect(step()?.getAttribute("data-next-step")).toBe("unfinished")
		expect(text(step()!)).toContain(
			"Paste your API key below, then press Save."
		)
		expect(text(card())).not.toContain("then press Test")
		expect(text(card())).not.toContain("Nothing has failed")

		// The Settings tab is open (unfinished); an edit makes the draft dirty.
		const name = document.getElementById(
			"connection-name"
		) as HTMLInputElement
		name.value = "Hosted 2"
		name.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		expect(text(step()!)).toContain("Press Save to keep these changes.")
		expect(button(target, "Save changes to Hosted 2")).toBeDefined()
	})

	test("chat unset: Use in Reply on the rows; after Use the card offers Start a session", async () => {
		await mountWith(
			[
				row({
					...HOSTED,
					modelsSync: { at: "2026-10-06T00:00:00Z", error: null },
					models: [model(11, "Nemo"), model(12, "Qwen")]
				})
			],
			{}
		)
		expect(text(step()!)).toContain(
			"Pick a model under Models and press Use in Reply."
		)
		expect(step()?.getAttribute("data-next-step")).toBe("unfinished")
		// On the Models tab already: no button to switch to it.
		expect(button(card() as HTMLElement, "Choose a model")).toBeUndefined()
		const uses = [
			...target.querySelectorAll("[data-connection-models] button")
		].filter((b) => b.getAttribute("aria-label") === "Use in Reply")
		expect(uses).toHaveLength(2)
		expect(text(uses[0])).toContain("Use in Reply")

		// From Settings, the card's button switches back to Models.
		;[...target.querySelectorAll('[role="tab"]')]
			.find((t) => text(t).includes("Settings"))!
			.dispatchEvent(new MouseEvent("click", { bubbles: true }))
		await settle()
		expect(target.querySelector("[data-connection-models]")).toBeNull()
		button(card() as HTMLElement, "Choose a model")!.click()
		await settle()
		expect(target.querySelector("[data-connection-models]")).not.toBeNull()

		// The setDefault reply (the toast is the central listener's): the card
		// re-derives to "Replies come from …" with Start a session.
		hear("connections:setDefault", { capability: CHAT, id: 1, modelId: 12 })
		await settle()
		expect(step()?.getAttribute("data-next-step")).toBe("ready")
		expect(text(step()!)).toContain("Replies come from Qwen.")
		const rows = [
			...target.querySelectorAll("[data-connection-models] button")
		]
		expect(
			rows.some((b) => b.getAttribute("aria-label") === "Use in Reply")
		).toBe(false)
		// The chat default leads the list now.
		const names = [
			...target.querySelectorAll(
				"[data-connection-models] .text-lead"
			)
		].map((n) => text(n).trim())
		expect(names).toEqual(["Qwen", "Nemo"])
		button(card() as HTMLElement, "Start a session")!.click()
		expect(opened).toContainEqual({ key: "sessions", toggle: false })
	})

	test("a listing failure with a saved key is red and names Test again", async () => {
		await mountWith(
			[
				row({
					...HOSTED,
					modelsSync: {
						at: "2026-10-06T00:00:00Z",
						error: "401 Unauthorized"
					},
					models: []
				})
			],
			{}
		)
		// Opening asked for a listing; while it runs nothing has failed yet.
		expect(step()).toBeNull()
		hear("connections:syncModels", { results: [] })
		await settle()
		expect(step()?.getAttribute("data-next-step")).toBe("broken")
		expect(text(step()!)).toContain(
			"401 Unauthorized. Check the key and press Test again."
		)
		expect(button(card() as HTMLElement, "Test again")).toBeDefined()
	})

	test("past twelve models the dock list grows a filter over identifier and name", async () => {
		const many = Array.from({ length: 13 }, (_, i) =>
			model(100 + i, `Model ${i}`)
		)
		many.push({
			...model(200, "Claude Sonnet"),
			model: "anthropic/claude-sonnet"
		} as any)
		await mountWith(
			[
				row({
					...HOSTED,
					modelsSync: { at: "2026-10-06T00:00:00Z", error: null },
					models: many
				})
			],
			{ [CHAT]: { connectionId: 1, connectionModelId: 200 } }
		)
		const list = () => target.querySelector("[data-connection-models]")!
		const filter = list().querySelector("input") as HTMLInputElement
		expect(filter.getAttribute("placeholder")).toBe("Filter 14 models")
		filter.value = "anthropic/"
		filter.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		expect(text(list())).toContain("Claude Sonnet")
		expect(text(list())).not.toContain("Model 3")
		filter.value = "zzz"
		filter.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		expect(text(list())).toContain("Nothing matches.")
	})

	test("two models: no filter box", async () => {
		await mountWith(
			[
				row({
					...HOSTED,
					modelsSync: { at: "2026-10-06T00:00:00Z", error: null },
					models: [model(11, "Nemo"), model(12, "Qwen")]
				})
			],
			{ [CHAT]: { connectionId: 1, connectionModelId: 11 } }
		)
		expect(
			target.querySelector("[data-connection-models] input")
		).toBeNull()
	})
})

/**
 * Doors into the Models view's dialogs. The first-run KoboldCPP door names
 * Set up chat in the panels digest and opens Models; a door named from
 * outside is consumed here only when it is New connection (`"service"`,
 * `"local"`) — `"setup-chat"` and `"chat"` stay in the slot for Models.
 */
describe("doors", () => {
	let digest: Record<string, unknown>
	async function mountWithDigest(
		seed: Record<string, unknown>,
		list: unknown[] = LIST
	) {
		unmount(view)
		target.replaceChildren()
		listeners.clear()
		pickers.length = 0
		digest = { ...seed }
		view = mount(ConnectionsSidebar, {
			target,
			context: new Map<string, unknown>([
				...shell({
					settings: { isAndroidWrapper: false },
					capabilityDefaults: {}
				}),
				["koboldCppSettingsCtx", { settings: undefined }],
				[
					"panelsCtx",
					{
						digest,
						openPanel: (o: Record<string, unknown>) =>
							opened.push(o),
						closePanel: () => {}
					}
				],
				["userCtx", { user: { id: 1, isAdmin: true } }]
			])
		})
		flushSync()
		hear("connections:list", { connectionsList: list })
		await settle()
	}

	test("first run: KoboldCPP, run by Serene Pub opens Models' Set up chat", async () => {
		await mountWithDigest({}, [])
		const door = [...target.querySelectorAll("button")].find((b) =>
			text(b).includes("KoboldCPP, run by Serene Pub")
		)!
		expect(door).toBeDefined()
		expect(text(target)).not.toContain("Later, optionally")
		door.click()
		await settle()
		expect(digest.connectionsDoor).toBe("setup-chat")
		expect(opened).toContainEqual({ key: "models", toggle: false })
		// Nothing installed from here: the stepper's Runtime step does that.
		expect(
			emitted.some(([event]) => event === "connections:create")
		).toBe(false)
	})

	test("service: New connection, narrowed to services, consumed", async () => {
		await mountWithDigest({ connectionsDoor: "service" })
		expect(digest.connectionsDoor).toBeUndefined()
		expect(pickers.at(-1)?.initialCategory).toBe("cloud")
	})

	test("setup-chat, chat and a job are Models' doors, left in the slot", async () => {
		await mountWithDigest({
			connectionsDoor: "setup-chat",
			connectionsJob: "text->embedding"
		})
		expect(digest.connectionsDoor).toBe("setup-chat")
		expect(digest.connectionsJob).toBe("text->embedding")
		// New connection was not opened on either: no narrowed picker.
		expect(pickers.every((p) => p.initialCategory === undefined)).toBe(true)
		await mountWithDigest({ connectionsDoor: "chat" })
		expect(digest.connectionsDoor).toBe("chat")
	})
})

describe("a connection's Back", () => {
	test("in the dock the connection replaces the list, so it has Back", async () => {
		const open = [...target.querySelectorAll("button")].find((b) =>
			text(b).includes("Hosted")
		)!
		open.click()
		await settle()
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
		// The connection replaces the list at compact, so it has a Back.
		expect(button(target, "Back to all connections")).toBeDefined()
	})
})
