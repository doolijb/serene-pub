/**
 * The New Connection picker on a machine that can't run local ONNX models.
 *
 * The local ONNX types stay on offer as disabled cards that say why, in words
 * on the card rather than only in a tooltip. Hidden, they would read as a
 * feature this build lacks; enabled, they would lead to a form whose Save the
 * server refuses.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import ConnectionServicePicker from "./ConnectionServicePicker.svelte"

let target: HTMLElement
let view: ReturnType<typeof mount> | null = null
/** What the picker's `bind:selectedItem` would hand its parent. */
let selected = $state<any>()

function render(localOnnxAvailability?: {
	available: boolean
	reason: string | null
}) {
	selected = undefined
	target = document.createElement("div")
	document.body.appendChild(target)
	view = mount(ConnectionServicePicker, {
		target,
		props: {
			get selectedItem() {
				return selected
			},
			set selectedItem(v) {
				selected = v
			},
			label: "Service",
			initialModality: "embeddings"
		},
		context: new Map<string, unknown>([
			["systemSettingsCtx", { settings: { localOnnxAvailability } }]
		])
	})
	flushSync()
}

/** The card whose title is exactly this label. */
function card(label: string): HTMLButtonElement {
	const found = [...target.querySelectorAll("button[role=radio]")].find(
		(b) => b.querySelector("span span")?.textContent?.trim() === label
	)
	if (!found) throw new Error(`no card labelled ${label}`)
	return found as HTMLButtonElement
}

afterEach(() => {
	if (view) unmount(view)
	view = null
	target.remove()
})

describe("local ONNX in the service picker", () => {
	test("unavailable: listed, disabled, and the reason is on the card", () => {
		render({
			available: false,
			reason: "the Android app can't run the ONNX runtime"
		})
		const onnx = card("Local embeddings (ONNX)")
		expect(onnx.disabled).toBe(true)
		expect(onnx.textContent).toContain(
			"Not available on this machine: the Android app can't run the ONNX runtime"
		)
		// The difficulty line gives way to the reason, so it is not said twice.
		expect(onnx.textContent).not.toContain("One download")
		// Everything else in the section is untouched.
		expect(card("Ollama").disabled).toBe(false)
	})

	test.each([
		["available", { available: true, reason: null }],
		["settings not yet arrived", undefined]
	])("%s: an ordinary card", (_, verdict) => {
		render(verdict)
		const onnx = card("Local embeddings (ONNX)")
		expect(onnx.disabled).toBe(false)
		expect(onnx.textContent).not.toContain("Not available")
	})
})

/**
 * `openai-embeddings` merged into `openai` (owner ruling 2026-10-05), so the
 * Embeddings section lists the OpenAI-compatible services that embed the way
 * it lists Ollama: as entries of their own that create the one `openai`
 * connection with the service's preset.
 */
describe("OpenAI-compatible services under Embeddings", () => {
	const EMBEDDING_SERVICES = [
		"OpenAI (Official)",
		"OpenRouter",
		"Google Gemini (Experimental)",
		"Together AI",
		"Mistral AI (Experimental)",
		"LocalAI"
	]

	test("the services that embed are listed; one that doesn't is not", () => {
		render()
		for (const label of EMBEDDING_SERVICES)
			expect(card(label).disabled, label).toBe(false)
		expect(() => card("Groq")).toThrow()
		expect(() => card("Custom (OpenAI-Compatible)")).toThrow()
	})

	test("picking one picks the openai type with that service's preset", () => {
		render()
		card("OpenRouter").click()
		flushSync()
		expect(selected).toMatchObject({
			type: "openai",
			presetSlug: "openrouter",
			modality: "embeddings"
		})
		expect(card("OpenRouter").getAttribute("aria-checked")).toBe("true")
	})
})
