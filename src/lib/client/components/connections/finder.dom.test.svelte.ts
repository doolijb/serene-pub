/**
 * The finder, mounted: the picker rule (plan 2026-10-29 D2) where a person
 * sees it.
 *
 *   · a multi-file Get opens the quant picker with the recommended file
 *     pre-selected;
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
const emitted: Array<[string, any]> = []
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({
		emit: (event: string, payload: unknown) =>
			emitted.push([event, payload]),
		on: () => {},
		off: () => {}
	})
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
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, info: () => {}, success: () => {} }
}))
vi.mock("./downloads.svelte", () => ({
	downloads: {
		items: [],
		subscribe: () => () => {},
		setOnnx: () => {},
		cancel: () => {}
	}
}))

import ModelFinderView from "./ModelFinderView.svelte"
import { connectionsTestContext } from "$lib/client/contexts/testProvideConnections"

const mounted: ReturnType<typeof mount>[] = []
beforeEach(() => {
	emitted.length = 0
	handlers.clear()
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

const option = (label: string, filename: string, sizeBytes: number) => ({
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
