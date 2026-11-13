/**
 * Set up chat, mounted on its model step with the finder embedded: Escape
 * inside the quant picker closes the picker and nothing else. Zag's dismissable
 * layer listens for Escape on the document in the capture phase, so the
 * picker's own handler is too late to keep the dialog (and its progress).
 *
 * Nothing here hands a DOM node to an assertion: a failing assert would
 * format the node, and a happy-dom node formats to gigabytes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/shell/viewMode.svelte", () => ({
	DESK_MIN_PX: 900,
	ViewModeTracker: class {
		get mode() {
			return "compact"
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

import SetupChatFlow from "./SetupChatFlow.svelte"
import { connectionsTestContext } from "$lib/client/contexts/testProvideConnections"

const KCPP = { id: 1, name: "KoboldCPP", type: "koboldcpp_managed", models: [] } as never

const option = (label: string, filename: string, sizeBytes: number) => ({
	label,
	filename,
	downloadUrl: `https://hf/${filename}`,
	sizeBytes
})
const MULTI = {
	name: "org/multi-GGUF",
	description: "",
	parameterSize: "7B",
	recommendedVram: 8,
	tags: [],
	pullOptions: [
		option("Q2_K", "m-Q2_K.gguf", 1e9),
		option("Q4_K_M", "m-Q4_K_M.gguf", 2e9),
		option("Q8_0", "m-Q8_0.gguf", 4e9)
	]
}

const mounted: ReturnType<typeof mount>[] = []
const onClose = vi.fn()
beforeEach(() => {
	emitted.length = 0
	handlers.clear()
	onClose.mockClear()
})
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

const settle = async () => {
	await new Promise((r) => setTimeout(r, 30))
	flushSync()
	await tick()
	await tick()
}
const byLabel = (label: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => b.getAttribute("aria-label") === label
	)
const pickerOpen = () =>
	document.querySelector("section[data-quant-picker]") !== null
const dialogText = () => document.body.textContent ?? ""

async function openPicker() {
	const target = document.createElement("div")
	document.body.appendChild(target)
	mounted.push(
		mount(SetupChatFlow, {
			target,
			props: {
				open: true,
				connections: [KCPP],
				onEnsureRuntime: () => {},
				onOpenConnection: () => {},
				onClose
			},
			context: new Map<unknown, unknown>([
				connectionsTestContext([KCPP]),
				["userCtx", { user: { isAdmin: true } }],
				[
					"koboldCppSettingsCtx",
					{ settings: { koboldCppManagedMode: "external" } }
				],
				["systemSettingsCtx", { capabilityDefaults: {} }]
			])
		})
	)
	await settle()
	await settle()
	handlers.get("koboldcpp:recommendedModels")?.({ models: [MULTI] })
	await settle()
	byLabel("Get org/multi-GGUF")!.click()
	await settle()
}

describe("Escape inside the quant picker, in Set up chat", () => {
	test("closes the picker and keeps the dialog open", async () => {
		await openPicker()
		expect(pickerOpen()).toBe(true)
		const radio = document.querySelector(
			'section[data-quant-picker] [role="radio"][aria-checked="true"]'
		)!
		radio.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true
			})
		)
		await settle()
		expect(pickerOpen()).toBe(false)
		expect(onClose).not.toHaveBeenCalled()
		// The server fills Reply; the dialog never writes it.
		expect(emitted.some(([e]) => e === "connections:setDefault")).toBe(
			false
		)
		expect(dialogText().includes("KoboldCPP is installed")).toBe(true)
	})
})
