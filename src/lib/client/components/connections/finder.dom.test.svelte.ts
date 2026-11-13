/**
 * The finder, mounted: the picker rule (plan 2026-10-29 D2) where a person
 * sees it.
 *
 *   · a multi-file Get opens the quant picker, inline under its row, with
 *     the recommended file pre-selected;
 *   · a single-file row names its file before Get, and Get downloads at once;
 *   · ONNX "add by id" always sends a precision;
 *   · an audio family with two precisions opens the picker on its
 *     `recommendedId`.
 *
 * Nothing here hands a DOM node to an assertion: a failing assert would
 * format the node, and a happy-dom node formats to gigabytes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
const viewMode = vi.hoisted(() => ({ mode: "compact" as "compact" | "desk" }))
vi.mock("$lib/client/shell/viewMode.svelte", () => ({
	DESK_MIN_PX: 900,
	ViewModeTracker: class {
		get mode() {
			return viewMode.mode
		}
		get width() {
			return 0
		}
		observe = () => ({ destroy: () => {} })
	}
}))
const emitted: Array<[string, any]> = []
const fakeSocket = {
	emit: (event: string, payload: unknown) => emitted.push([event, payload]),
	on: () => {},
	off: () => {}
}
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => fakeSocket,
	typedSocketOrNull: () => fakeSocket
}))
const handlers = new Map<string, (msg: any) => void>()
vi.mock("$lib/client/sockets/interest.svelte", async (original) => ({
	...(await original<Record<string, unknown>>()),
	declareInterest: (key: string, handler: (msg: any) => void) => {
		handlers.set(key, handler)
		return () => handlers.delete(key)
	},
	useInterest: (key: string, handler: (msg: any) => void) => {
		handlers.set(key, handler)
	}
}))
const toasts = vi.hoisted(() => ({
	error: vi.fn(),
	info: vi.fn(),
	success: vi.fn()
}))
vi.mock("$lib/client/utils/toaster", () => ({ toaster: toasts }))
vi.mock("./downloads.svelte", () => ({
	downloads: {
		items: [],
		subscribe: () => () => {},
		setOnnx: () => {},
		cancel: () => {}
	}
}))

import axe from "axe-core"
import ModelFinderView from "./ModelFinderView.svelte"
import ModelsSidebar from "$lib/client/components/sidebars/ModelsSidebar.svelte"
import { connectionsTestContext } from "$lib/client/contexts/testProvideConnections"

const mounted: ReturnType<typeof mount>[] = []
beforeEach(() => {
	viewMode.mode = "compact"
	emitted.length = 0
	handlers.clear()
	toasts.error.mockClear()
	toasts.info.mockClear()
	toasts.success.mockClear()
})
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

const KCPP = { id: 1, name: "KoboldCPP", type: "koboldcpp_managed" }
const AUDIO = { id: 2, name: "audio.cpp", type: "audiocpp_managed" }
const ONNX = {
	id: 3,
	name: "Local embeddings",
	type: "local-onnx",
	models: []
}

async function render(list: any[], props: Record<string, unknown> = {}) {
	const target = document.createElement("div")
	document.body.appendChild(target)
	mounted.push(
		mount(ModelFinderView, {
			target,
			props,
			context: new Map<unknown, unknown>([
				connectionsTestContext(list),
				["userCtx", { user: { isAdmin: true } }]
			])
		})
	)
	flushSync()
	await tick()
	return target
}

const reply = async (key: string, msg: unknown) => {
	handlers.get(key)?.(msg)
	flushSync()
	await tick()
}
const byLabel = (label: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => b.getAttribute("aria-label") === label
	)
const checkedRadioText = () =>
	[...document.querySelectorAll('[role="radio"][aria-checked="true"]')]
		.map((r) => r.textContent ?? "")
		.join("|")

const option = (label: string, filename: string, sizeBytes?: number) => ({
	label,
	filename,
	downloadUrl: `https://hf/${filename}`,
	sizeBytes
})
const model = (name: string, pullOptions: any[]) => ({
	name,
	description: "",
	parameterSize: "7B",
	recommendedVram: 8,
	tags: [],
	pullOptions
})

describe("the picker rule, rendered", () => {
	test("a multi-file Get opens the picker on the recommended file", async () => {
		await render([KCPP])
		await reply("koboldcpp:recommendedModels", {
			models: [
				model("org/multi-GGUF", [
					option("Q2_K", "m-Q2_K.gguf", 1e9),
					option("Q4_K_M", "m-Q4_K_M.gguf", 2e9),
					option("Q8_0", "m-Q8_0.gguf", 4e9)
				])
			]
		})
		const get = byLabel("Get org/multi-GGUF")
		expect(get === undefined).toBe(false)
		get!.click()
		flushSync()
		await tick()
		expect(document.body.textContent?.includes("Pick a size")).toBe(true)
		expect(checkedRadioText().includes("Q4_K_M")).toBe(true)
		// Nothing was downloaded by the press itself.
		expect(emitted.some(([e]) => e === "koboldcpp:downloadModel")).toBe(
			false
		)
	})

	test("a single-file row names its file and downloads at once", async () => {
		await render([KCPP])
		await reply("koboldcpp:recommendedModels", {
			models: [
				model("org/one-GGUF", [option("Q4_K_M", "only.gguf", 2e9)])
			]
		})
		expect(document.body.textContent?.includes("only.gguf")).toBe(true)
		byLabel("Get org/one-GGUF")!.click()
		flushSync()
		const sent = emitted.find(([e]) => e === "koboldcpp:downloadModel")
		expect(sent === undefined).toBe(false)
		expect(sent![1].filename).toBe("only.gguf")
		expect(sent![1].kind).toBe("text")
	})

	test("ONNX add-by-id always sends a precision", async () => {
		await render([ONNX], { capability: "text->embedding" })
		const open = [...document.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Add from Hugging Face by id")
		)
		open!.click()
		flushSync()
		await tick()
		const input = document.getElementById(
			"finder-hub-id"
		) as HTMLInputElement
		input.value = "org/bge-onnx"
		input.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		const submit = () =>
			(
				document.querySelector(
					'form button[type="submit"]'
				) as HTMLButtonElement
			).click()
		submit()
		flushSync()
		const first = emitted.find(([e]) => e === "connections:addHubModel")
		expect(first![1]).toEqual({
			id: 3,
			hubId: "org/bge-onnx",
			dtype: "fp32"
		})
	})

	test("ONNX add-by-id sends the precision that was chosen", async () => {
		await render([ONNX], { capability: "text->embedding" })
		;[...document.querySelectorAll("button")]
			.find((b) =>
				b.textContent?.includes("Add from Hugging Face by id")
			)!
			.click()
		flushSync()
		await tick()
		const input = document.getElementById(
			"finder-hub-id"
		) as HTMLInputElement
		input.value = "org/x"
		input.dispatchEvent(new Event("input", { bubbles: true }))
		const q4 = [
			...document.querySelectorAll(
				'[aria-label="Precision"] [role="radio"]'
			)
		].find((b) => b.textContent?.trim() === "q4") as HTMLButtonElement
		q4.click()
		flushSync()
		;(
			document.querySelector(
				'form button[type="submit"]'
			) as HTMLButtonElement
		).click()
		flushSync()
		const sent = emitted.find(([e]) => e === "connections:addHubModel")
		expect(sent![1].dtype).toBe("q4")
	})

	test("an audio family with two precisions opens on its recommendedId", async () => {
		await render([AUDIO], { capability: "text->audio" })
		const pkg = (id: string, precision: string) => ({
			id,
			name: `Qwen ${precision}`,
			task: "tts",
			family: "qwen3_tts",
			files: [],
			tags: [],
			confidence: "listed",
			state: "available",
			recommended: false,
			precision,
			sizeBytes: 2e9
		})
		await reply("audiocpp:listPackages", {
			packages: [],
			families: [
				{
					key: "audiocpp:qwen3_tts:",
					family: "qwen3_tts",
					variant: null,
					task: "tts",
					runtime: "audiocpp",
					displayName: "Qwen3-TTS",
					recommendedId: "p-bf16",
					precisions: [pkg("p-q8", "q8_0"), pkg("p-bf16", "bf16")]
				}
			]
		})
		byLabel("Get Qwen3-TTS")!.click()
		flushSync()
		await tick()
		expect(document.body.textContent?.includes("Choose a precision")).toBe(
			true
		)
		expect(checkedRadioText().includes("bf16")).toBe(true)
		const download = [...document.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Download")
		)
		download!.click()
		flushSync()
		const sent = emitted.find(([e]) => e === "audiocpp:downloadPackage")
		expect(sent![1]).toEqual({ id: "p-bf16" })
	})
})

describe("Get a model, a pane of the Models view", () => {
	const panelsCtx = $state<{
		digest: Record<string, any>
		openPanel: (...args: any[]) => void
	}>({ digest: {}, openPanel: vi.fn() })

	async function view(list: any[] = [{ ...KCPP, models: [] }]) {
		panelsCtx.digest = {}
		const target = document.createElement("div")
		document.body.appendChild(target)
		mounted.push(
			mount(ModelsSidebar, {
				target,
				props: {},
				context: new Map<unknown, unknown>([
					connectionsTestContext(list),
					["panelsCtx", panelsCtx],
					["userCtx", { user: { isAdmin: true } }],
					["systemSettingsCtx", { capabilityDefaults: {} }]
				])
			})
		)
		flushSync()
		await tick()
		return target
	}
	const settle = async () => {
		flushSync()
		await tick()
	}
	const heading = () =>
		[...document.querySelectorAll("h2")].find(
			(h) => h.textContent?.trim() === "Get a model"
		)
	const toolbarGet = () =>
		[...document.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Get a model"
		)
	const openFromToolbar = async () => {
		toolbarGet()!.click()
		await settle()
	}

	test("renders in a pane, not a dialog, with focus on its heading", async () => {
		await view()
		await openFromToolbar()
		expect(heading() === undefined).toBe(false)
		expect(
			document.querySelector('[role="dialog"]:not([hidden])') === null
		).toBe(true)
		expect(document.activeElement === heading()).toBe(true)
	})

	test("Back returns to the list (compact)", async () => {
		await view()
		await openFromToolbar()
		byLabel("Back")!.click()
		await settle()
		expect(heading() === undefined).toBe(true)
		expect(toolbarGet() === undefined).toBe(false)
	})

	test("at desk the list and the finder sit together", async () => {
		viewMode.mode = "desk"
		await view()
		await openFromToolbar()
		expect(heading() === undefined).toBe(false)
		expect(toolbarGet() === undefined).toBe(false)
	})

	test("Get keeps the pane", async () => {
		await view()
		await openFromToolbar()
		await reply("koboldcpp:recommendedModels", {
			models: [
				model("org/one-GGUF", [option("Q4_K_M", "only.gguf", 2e9)])
			]
		})
		byLabel("Get org/one-GGUF")!.click()
		await settle()
		expect(emitted.some(([e]) => e === "koboldcpp:downloadModel")).toBe(
			true
		)
		expect(heading() === undefined).toBe(false)
	})

	test("each door opens the pane with its scope", async () => {
		await view()
		panelsCtx.digest.modelsFinder = { capability: "text->audio" }
		await settle()
		expect(heading() === undefined).toBe(false)
		expect(checkedRadioText().includes("Speech")).toBe(true)
		expect(panelsCtx.digest.modelsFinder === undefined).toBe(true)

		// A door pressed while the finder is open lands its new scope.
		panelsCtx.digest.modelsFinder = { connectionId: KCPP.id }
		await settle()
		// The one destination is plain words in the sentence, no radio.
		expect(document.body.textContent?.includes(KCPP.name)).toBe(true)
		expect(panelsCtx.digest.modelsFinder === undefined).toBe(true)
		expect(document.activeElement === heading()).toBe(true)

		byLabel("Back")!.click()
		await settle()
		await openFromToolbar()
		expect(checkedRadioText().includes("Chat")).toBe(true)
	})

	test("axe finds no violations in the pane", async () => {
		const target = await view()
		await openFromToolbar()
		const result = await axe.run(target, {
			rules: { "color-contrast": { enabled: false } }
		})
		expect(result.violations.map((v) => v.id)).toEqual([])
	})
})

describe("the quant picker and Add by name, inline", () => {
	const panelsCtx = $state<{
		digest: Record<string, any>
		openPanel: (...args: any[]) => void
	}>({ digest: {}, openPanel: vi.fn() })

	async function view(list: any[] = [{ ...KCPP, models: [] }]) {
		panelsCtx.digest = {}
		const target = document.createElement("div")
		document.body.appendChild(target)
		mounted.push(
			mount(ModelsSidebar, {
				target,
				props: {},
				context: new Map<unknown, unknown>([
					connectionsTestContext(list),
					["panelsCtx", panelsCtx],
					["userCtx", { user: { isAdmin: true } }],
					["systemSettingsCtx", { capabilityDefaults: {} }]
				])
			})
		)
		flushSync()
		await tick()
		return target
	}
	const settle = async () => {
		flushSync()
		await tick()
		await tick()
	}
	const noDialog = () =>
		document.querySelector('[role="dialog"]:not([hidden])') === null
	const toolbarButton = (label: string) =>
		[...document.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === label
		)
	const multi = () =>
		model("org/multi-GGUF", [
			option("Q2_K", "m-Q2_K.gguf", 1e9),
			option("Q4_K_M", "m-Q4_K_M.gguf", 2e9),
			option("Q8_0", "m-Q8_0.gguf", 4e9)
		])
	async function openPicker() {
		await view()
		toolbarButton("Get a model")!.click()
		await settle()
		await reply("koboldcpp:recommendedModels", { models: [multi()] })
		byLabel("Get org/multi-GGUF")!.click()
		await settle()
	}

	test("Get opens the picker inline under its row, recommended pre-checked", async () => {
		await openPicker()
		const picker = document.querySelector(
			'section[aria-labelledby]:has([role="radiogroup"])'
		)
		expect(picker === null).toBe(false)
		expect(picker!.textContent?.includes("Pick a size")).toBe(true)
		// Inside the result card, not over the view.
		expect(!!picker!.closest(".panel-card")?.parentElement).toBe(true)
		expect(
			picker!.parentElement?.textContent?.includes("org/multi-GGUF")
		).toBe(true)
		expect(noDialog()).toBe(true)
		expect(checkedRadioText().includes("Q4_K_M")).toBe(true)
		expect(
			document.activeElement?.getAttribute("aria-checked") === "true"
		).toBe(true)
	})

	test("Download sends the chosen file and closes the picker", async () => {
		await openPicker()
		const q8 = [...document.querySelectorAll('[role="radio"]')].find((r) =>
			r.textContent?.includes("Q8_0")
		) as HTMLButtonElement
		q8.click()
		await settle()
		;[
			...document.querySelectorAll<HTMLButtonElement>(
				"section[aria-labelledby] button"
			)
		]
			.find((b) => b.textContent?.includes("Download"))!
			.click()
		await settle()
		const sent = emitted.find(([e]) => e === "koboldcpp:downloadModel")
		expect(sent![1].filename).toBe("m-Q8_0.gguf")
		expect(
			document.querySelector("section[aria-labelledby]") === null
		).toBe(true)
	})

	test("Cancel removes it and focus returns to that row's Get", async () => {
		await openPicker()
		const cancel = [
			...document.querySelectorAll("section[aria-labelledby] button")
		].find((b) => b.textContent?.trim() === "Cancel") as HTMLButtonElement
		cancel.click()
		await settle()
		expect(
			document.querySelector("section[aria-labelledby]") === null
		).toBe(true)
		expect(emitted.some(([e]) => e === "koboldcpp:downloadModel")).toBe(
			false
		)
		expect(document.activeElement === byLabel("Get org/multi-GGUF")).toBe(
			true
		)
	})

	test("Escape closes it the same way", async () => {
		await openPicker()
		document.activeElement!.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
		)
		await settle()
		expect(
			document.querySelector("section[aria-labelledby]") === null
		).toBe(true)
		expect(document.activeElement === byLabel("Get org/multi-GGUF")).toBe(
			true
		)
	})

	test("axe finds no violations with the picker open", async () => {
		await openPicker()
		const result = await axe.run(
			document.querySelector("section[aria-labelledby]")!.parentElement!,
			{ rules: { "color-contrast": { enabled: false } } }
		)
		expect(result.violations.map((v) => v.id)).toEqual([])
	})

	test("the dead-end card no longer points at Add → A connection", async () => {
		await view([])
		toolbarButton("Get a model")!.click()
		await settle()
		expect(
			document.body.textContent?.includes("Nothing here can hold")
		).toBe(true)
		expect(document.body.textContent?.includes("A connection")).toBe(false)
	})

	describe("Add by name", () => {
		const addHeading = () =>
			[...document.querySelectorAll("h2")].find(
				(h) => h.textContent?.trim() === "Add a model by name"
			)
		const LIST = [
			{ id: 4, name: "Compat host", type: "openai", models: [] }
		]
		// The toolbar's overflow menu holds the entry.
		async function openAdd() {
			await view(LIST)
			byLabel("More for models")!.click()
			await settle()
			const entry = [
				...document.querySelectorAll<HTMLElement>("[role=menuitem]")
			].find((m) => m.textContent?.includes("Add a model by name"))
			entry!.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					pointerType: "mouse"
				})
			)
			entry!.click()
			await settle()
		}

		test("opens a pane, not a dialog, with its heading focused", async () => {
			await openAdd()
			expect(addHeading() === undefined).toBe(false)
			expect(noDialog()).toBe(true)
			expect(document.activeElement === addHeading()).toBe(true)
		})

		test("Back returns to the list", async () => {
			await openAdd()
			byLabel("Back")!.click()
			await settle()
			expect(addHeading() === undefined).toBe(true)
		})

		test("Add model sends createModel and closes the pane", async () => {
			await openAdd()
			const input = document.querySelector(
				'input[placeholder^="meta-llama"]'
			) as HTMLInputElement
			input.value = "org/new-model"
			input.dispatchEvent(new Event("input", { bubbles: true }))
			flushSync()
			;[...document.querySelectorAll("button")]
				.find((b) => b.textContent?.trim() === "Add model")!
				.click()
			await settle()
			const sent = emitted.find(([e]) => e === "connections:createModel")
			expect(sent![1]).toEqual({
				id: 4,
				model: { model: "org/new-model" }
			})
			expect(addHeading() === undefined).toBe(true)
		})
	})
})

describe("the sentence line", () => {
	const OLLAMA = { id: 9, name: "Ollama", type: "ollama" }

	async function sentenceView(
		list: any[],
		props: Record<string, unknown> = {},
		settings: Record<string, unknown> = {}
	) {
		const target = document.createElement("div")
		document.body.appendChild(target)
		mounted.push(
			mount(ModelFinderView, {
				target,
				props,
				context: new Map<unknown, unknown>([
					connectionsTestContext(list),
					["userCtx", { user: { isAdmin: true } }],
					["systemSettingsCtx", { capabilityDefaults: {}, settings }]
				])
			})
		)
		flushSync()
		await tick()
		return target
	}
	/** A radio in the named group, found by text (the popover content). */
	const radio = (group: string, text: string) =>
		[
			...document.querySelectorAll(
				`[role="radiogroup"][aria-label="${group}"] [role="radio"]`
			)
		].find((r) => r.textContent?.trim().startsWith(text)) as
			| HTMLElement
			| undefined
	const triggerLabels = () =>
		[...document.querySelectorAll("button[aria-label]")]
			.map((b) => b.getAttribute("aria-label") ?? "")
			.filter((l) => /^(For|Download to|Memory tier): /.test(l))

	test("names the three choices in one sentence", async () => {
		await sentenceView([KCPP, OLLAMA])
		const labels = triggerLabels()
		expect(labels.includes("For: Chat")).toBe(true)
		expect(labels.some((l) => l.startsWith("Download to: "))).toBe(true)
		expect(labels.includes("Memory tier: Not sure")).toBe(true)
		const text = document.body.textContent ?? ""
		expect(text.includes("models for")).toBe(true)
		expect(text.includes("sized for")).toBe(true)
	})

	test("picking Images in the For popover re-asks for image models", async () => {
		await sentenceView([KCPP])
		// The chat ask is serial: its reply lets the next one go out.
		await reply("koboldcpp:recommendedModels", { models: [] })
		byLabel("For: Chat")!.click()
		flushSync()
		await tick()
		emitted.length = 0
		radio("For", "Images")!.click()
		flushSync()
		await tick()
		expect(triggerLabels().includes("For: Images")).toBe(true)
		const asked = emitted.filter(
			([e]) => e === "koboldcpp:recommendedModels"
		)
		expect(asked.some(([, p]) => p?.kind === "image")).toBe(true)
	})

	test("picking the other destination changes the Download to trigger", async () => {
		await sentenceView([KCPP, OLLAMA])
		const before = triggerLabels().find((l) => l.startsWith("Download to"))
		// Whichever one the finder chose first, pick the other.
		const other = before!.includes("Ollama") ? "KoboldCPP" : "Ollama"
		byLabel(before!)!.click()
		flushSync()
		await tick()
		radio("Download to", other)!.click()
		flushSync()
		await tick()
		const after = triggerLabels().find((l) => l.startsWith("Download to"))
		expect(after?.includes(other)).toBe(true)
		expect(after === before).toBe(false)
	})

	test("one destination is plain words, not a trigger", async () => {
		await sentenceView([KCPP])
		expect(triggerLabels().some((l) => l.startsWith("Download to"))).toBe(
			false
		)
		expect(document.body.textContent?.includes("KoboldCPP")).toBe(true)
	})

	test("an ONNX destination that cannot run says why and draws no tier", async () => {
		await sentenceView(
			[ONNX],
			{ capability: "text->embedding" },
			{
				localOnnxAvailability: {
					available: false,
					reason: "no runtime here"
				}
			}
		)
		expect(triggerLabels().some((l) => l.startsWith("Memory tier"))).toBe(
			false
		)
		expect(document.body.textContent?.includes("sized for")).toBe(false)
		expect(
			document.body.textContent?.includes(
				"Not available on this machine: no runtime here"
			)
		).toBe(true)
	})
})

describe("the finder model page", () => {
	const OLLAMA = { id: 9, name: "Ollama", type: "ollama" }
	const REPO = "bartowski/Qwen3-8B-GGUF"
	const qwen = () => ({
		...model(REPO, [
			option("Q4_K_M", "Qwen3-8B-Q4_K_M.gguf"),
			option("Q8_0", "Qwen3-8B-Q8_0.gguf")
		]),
		description: "A model."
	})
	const settle = async () => {
		flushSync()
		await tick()
		await tick()
	}
	const searchBox = () => document.querySelector("input.input, input")
	const opener = () =>
		document.querySelector<HTMLElement>("[data-page-opener]")!
	const text = () => document.body.textContent ?? ""
	const byText = (label: string) =>
		[...document.querySelectorAll("button")].find((b) =>
			b.textContent?.trim().startsWith(label)
		)
	async function open(list: any[] = [{ ...KCPP, models: [] }]) {
		await render(list)
		await reply("koboldcpp:recommendedModels", { models: [qwen()] })
		opener().click()
		await settle()
	}
	const hubCards = () => emitted.filter(([e]) => e === "models:hubCard")

	test("a result's name opens the page and asks the Hub card once", async () => {
		await open()
		expect(
			document.querySelector("[data-panel-title]")?.textContent?.trim()
		).toBe("Qwen3-8B-GGUF")
		expect(hubCards()).toEqual([["models:hubCard", { repo: REPO }]])
		expect(searchBox() === null).toBe(true)
	})

	test("the Hub's answer fills the facts and the files' sizes", async () => {
		await render([{ ...KCPP, models: [] }])
		await reply("koboldcpp:recommendedModels", { models: [qwen()] })
		byLabel("Memory tier: Not sure")!.click()
		await settle()
		;[
			...document.querySelectorAll(
				'[role="radiogroup"][aria-label="Memory tier"] [role="radio"]'
			)
		]
			.find((r) => r.textContent?.includes("8"))!
			.dispatchEvent(new MouseEvent("click", { bubbles: true }))
		await settle()
		opener().click()
		await settle()
		const before = text()
		expect(before.includes("Licence")).toBe(false)
		await reply("models:hubCard", {
			repo: REPO,
			card: { license: "apache-2.0", contextLength: 32768 },
			files: [
				{ rfilename: "Qwen3-8B-Q4_K_M.gguf", size: 5e9 },
				{ rfilename: "Qwen3-8B-Q8_0.gguf", size: 9e9 }
			]
		})
		const after = text()
		expect(after.includes("Licence")).toBe(true)
		expect(after.includes("apache-2.0")).toBe(true)
		expect(after.includes("Context")).toBe(true)
		expect(after.includes("32k tokens")).toBe(true)
		expect(before.includes("5.0 GB")).toBe(false)
		expect(after.includes("5.0 GB")).toBe(true)
		expect(after.includes("Fits in 8 GB")).toBe(true)
	})

	test("a reply for a different repo changes nothing", async () => {
		await open()
		await reply("models:hubCard", {
			repo: "someone/else-GGUF",
			card: { license: "mit" }
		})
		expect(text().includes("Licence")).toBe(false)
		expect(text().includes("Reading the repo from Hugging Face")).toBe(true)
	})

	test("a failure is a sentence on the page, never a toast", async () => {
		await open()
		await reply("models:hubCard", {
			repo: REPO,
			error: "Hugging Face would not answer for that repo."
		})
		expect(
			text().includes("Hugging Face would not answer for that repo.")
		).toBe(true)
		expect(toasts.error).not.toHaveBeenCalled()
		expect(toasts.info).not.toHaveBeenCalled()
	})

	test("Download sends the checked quant and the page stays open", async () => {
		await open()
		byText("Download Q4_K_M")!.click()
		await settle()
		const sent = emitted.filter(([e]) => e === "koboldcpp:downloadModel")
		expect(sent.length).toBe(1)
		expect(
			JSON.stringify(sent[0][1]).includes("Qwen3-8B-Q4_K_M.gguf")
		).toBe(true)
		expect(
			document.querySelector("[data-panel-title]")?.textContent?.trim()
		).toBe("Qwen3-8B-GGUF")
	})

	test("Back returns to the results with the query kept and the opener focused", async () => {
		await render([{ ...KCPP, models: [] }])
		await reply("koboldcpp:recommendedModels", { models: [qwen()] })
		const box = searchBox() as HTMLInputElement
		box.value = "qwen"
		box.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		opener().click()
		await settle()
		expect(searchBox() === null).toBe(true)
		byLabel("Back")!.click()
		await settle()
		expect((searchBox() as HTMLInputElement | null)?.value).toBe("qwen")
		expect(document.activeElement === opener()).toBe(true)
		// No new search or card was asked for on the way back.
		expect(emitted.filter(([e]) => e === "models:hubCard").length).toBe(1)
	})

	test("Escape on the page is Back", async () => {
		await open()
		const heading = document.querySelector("[data-panel-title]")!
		heading.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
		)
		await settle()
		expect(searchBox() === null).toBe(false)
	})

	test("an Ollama library name opens a page with the note and no Hub ask", async () => {
		await render([{ ...OLLAMA, models: [] }])
		await reply("ollama:recommendedModels", {
			recommendedModels: [
				{
					name: "llama3.2:3b",
					description: "",
					parameterSize: "3B",
					recommendedVram: 4,
					tags: [],
					pullOptions: [],
					quantsNote:
						"Ollama's library lists no quants for this name."
				}
			]
		})
		opener().click()
		await settle()
		expect(
			text().includes("Ollama's library lists no quants for this name.")
		).toBe(true)
		expect(hubCards().length).toBe(0)
		byText("Download")!.click()
		await settle()
		const pulls = emitted.filter(([e]) => e === "ollama:pullModel")
		expect(pulls.length).toBe(1)
		expect(pulls[0][1].modelName).toBe("llama3.2:3b")
	})

	test("a KoboldCPP row with no files has its Download off, with Get's words", async () => {
		await render([{ ...KCPP, models: [] }])
		await reply("koboldcpp:recommendedModels", {
			models: [model("someone/Empty-GGUF", [])]
		})
		opener().click()
		await settle()
		const download = byText("Download") as HTMLButtonElement | undefined
		expect(download?.disabled).toBe(true)
		expect(download?.title).toBe("That repo lists no files to get")
	})

	test("Get on a row still opens the inline picker", async () => {
		await render([{ ...KCPP, models: [] }])
		await reply("koboldcpp:recommendedModels", { models: [qwen()] })
		byLabel(`Get ${REPO}`)!.click()
		await settle()
		expect(searchBox() === null).toBe(false)
		expect(text().includes("Pick a size")).toBe(true)
	})
})
