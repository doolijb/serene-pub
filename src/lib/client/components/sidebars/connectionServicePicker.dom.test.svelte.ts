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
import type { ConnectionServiceCategory } from "$lib/shared/utils/connectionServiceItems"

let target: HTMLElement
let view: ReturnType<typeof mount> | null = null
/** What the picker's `bind:selectedItem` would hand its parent. */
let selected = $state<any>()

function render(
	localOnnxAvailability?: {
		available: boolean
		reason: string | null
	},
	opts: {
		initialModality?: string
		initialCategory?: ConnectionServiceCategory
	} = {
		initialModality: "embeddings"
	}
) {
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
			...opts
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
		// The setup-need chip gives way to the reason, so the card says one
		// thing on its second line.
		expect(onnx.textContent).not.toContain("Runs locally")
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

/** Type into the search box the way a person does. */
function typeSearch(q: string) {
	const input = target.querySelector<HTMLInputElement>("input[type=search]")!
	input.value = q
	input.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}

/** The no-results line, if it is showing. */
function noMatchLine(): HTMLParagraphElement | undefined {
	return [...target.querySelectorAll("p")].find((p) =>
		p.textContent?.trim().startsWith("No service")
	)
}

/**
 * A control in the no-results line, by its words. Scoped to that line: the
 * "Showing … only" line above the search has a Show all of its own.
 */
function lineButton(text: string): HTMLButtonElement | undefined {
	return [...(noMatchLine()?.querySelectorAll("button") ?? [])].find(
		(b) => b.textContent?.trim() === text
	)
}

/** The microtask `tick()` resolves on, then the DOM. */
async function settle() {
	await Promise.resolve()
	await Promise.resolve()
	flushSync()
}

/**
 * Each card says what the service asks of the person (plan 2026-10-06 §D),
 * where a "Beginner - Nothing to install" difficulty sat on every preset.
 */
describe("the chip on each card", () => {
	test("keyed, local and address-only services each say so", () => {
		render(undefined, {})
		expect(card("OpenRouter").textContent).toContain("Needs an API key")
		expect(card("Anthropic (Claude)").textContent).toContain(
			"Needs an API key"
		)
		expect(card("Ollama").textContent).toContain("Runs locally")
		expect(card("vLLM (Experimental)").textContent).toContain(
			"Runs locally"
		)
		expect(card("Custom (OpenAI-Compatible)").textContent).toContain(
			"Address only"
		)
		expect(target.textContent).not.toContain("Beginner")
		expect(target.textContent).not.toContain("Difficulty")
	})
})

describe("when nothing matches the search", () => {
	test("the line names the search and two ways out", () => {
		render(undefined, {})
		typeSearch("nonesuch")
		expect(target.querySelector("[role=radiogroup]")).toBeNull()
		// No stray space before the comma or the stop.
		expect(noMatchLine()!.textContent).toBe(
			"No service called “nonesuch”. Try Show all, or pick Custom (OpenAI-Compatible)."
		)
	})

	test("pick Custom selects it, clears the search and puts focus on its card", async () => {
		render(undefined, {})
		typeSearch("nonesuch")
		lineButton("Custom (OpenAI-Compatible)")!.click()
		await settle()
		expect(selected).toMatchObject({
			key: "preset:0",
			type: "openai",
			setupNeed: "address"
		})
		expect(
			target.querySelector<HTMLInputElement>("input[type=search]")!.value
		).toBe("")
		const custom = card("Custom (OpenAI-Compatible)")
		expect(custom.getAttribute("aria-checked")).toBe("true")
		expect(document.activeElement).toBe(custom)
	})

	test("Show all drops the seeded category and keeps a search that matches outside it", async () => {
		// The "Something I already run" door opens on Local / Self-hosted.
		render(undefined, { initialCategory: "local" })
		typeSearch("groq")
		lineButton("Show all")!.click()
		await settle()
		expect(card("Groq")).toBeDefined()
		const search =
			target.querySelector<HTMLInputElement>("input[type=search]")!
		expect(search.value).toBe("groq")
		expect(document.activeElement).toBe(search)
	})

	test("Show all clears a search that matches nothing anywhere", async () => {
		render(undefined, {})
		typeSearch("nonesuch")
		lineButton("Show all")!.click()
		await settle()
		expect(
			target.querySelector<HTMLInputElement>("input[type=search]")!.value
		).toBe("")
		expect(card("OpenRouter")).toBeDefined()
	})

	test("a section with no custom entry offers Show all alone", () => {
		render()
		typeSearch("nonesuch")
		expect(lineButton("Custom (OpenAI-Compatible)")).toBeUndefined()
		expect(lineButton("Show all")).toBeDefined()
		expect(noMatchLine()!.textContent).toBe(
			"No service called “nonesuch”. Try Show all."
		)
	})
})
