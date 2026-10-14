/**
 * The logit bias field (plan logit-bias L3, L-b): rows of text and bias read
 * by the shared syntax reader, stored exactly as typed, with the outcome of a
 * SillyTavern import said inline and never as a toast.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

const { toasts } = vi.hoisted(() => ({ toasts: [] as unknown[] }))
vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		error: (t: unknown) => toasts.push(t),
		info: (t: unknown) => toasts.push(t),
		success: (t: unknown) => toasts.push(t)
	}
}))
vi.mock("$lib/client/components/inputs/Select.svelte", () => ({
	default: () => {}
}))

import { S, SAMPLING_SCHEMAS, type SettingsSchema } from "@serene-pub/sdk"
import LogitBiasField from "./LogitBiasField.svelte"
import SamplingValuesForm from "./SamplingValuesForm.svelte"
import { LOGIT_BIAS_OVERTHINKING_MARKERS } from "$lib/shared/utils/logitBias"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	toasts.length = 0
	document.body.innerHTML = ""
})

function mountField(initial: {
	value?: unknown
	declaredDefault?: unknown
	disabled?: boolean
}) {
	const props = $state({
		value: initial.value,
		declaredDefault: initial.declaredDefault ?? [],
		disabled: initial.disabled ?? false
	})
	app = mount(LogitBiasField, { target: document.body, props })
	flushSync()
	return props
}

const textInputs = () => [
	...document.querySelectorAll<HTMLInputElement>('input[type="text"]')
]
const biasInputs = () => [
	...document.querySelectorAll<HTMLInputElement>('input[type="number"]')
]
const button = (name: string) =>
	[...document.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name
	)

function type(input: HTMLInputElement, text: string) {
	input.value = text
	input.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}

describe("logit bias field — rows", () => {
	test("an unset value shows the declared default and writes nothing", () => {
		const props = mountField({
			value: undefined,
			declaredDefault: LOGIT_BIAS_OVERTHINKING_MARKERS
		})
		expect(textInputs()).toHaveLength(
			LOGIT_BIAS_OVERTHINKING_MARKERS.length
		)
		expect(textInputs()[0].value).toBe("perhaps")
		expect(biasInputs()[0].value).toBe("-2")
		expect(props.value).toBeUndefined()
	})

	test("the first edit writes the whole list as entries, text exactly as typed", () => {
		const props = mountField({
			value: undefined,
			declaredDefault: [{ text: "maybe", value: -2 }]
		})
		type(textInputs()[0], "  {Maybe} ")
		expect(Array.isArray(props.value)).toBe(true)
		expect(props.value).toEqual([{ text: "  {Maybe} ", value: -2 }])
		// The SDK constant is never mutated.
		expect(LOGIT_BIAS_OVERTHINKING_MARKERS[1]).toEqual({
			text: "maybe",
			value: -2
		})
	})

	test("an invalid row says why beside it; an empty row says it is ignored", () => {
		mountField({
			value: [
				{ text: "[1.5]", value: 3 },
				{ text: "", value: 0 },
				{ text: "fine", value: 1 }
			]
		})
		const [bad, empty, fine] = textInputs()

		expect(bad.getAttribute("aria-invalid")).toBe("true")
		const badNote = document.getElementById(
			bad.getAttribute("aria-describedby")!
		)
		expect(badNote?.textContent).toContain("Token ids are whole numbers")
		expect(badNote?.className).toContain("text-error-600-400")

		expect(empty.getAttribute("aria-invalid")).toBeNull()
		const emptyNote = document.getElementById(
			empty.getAttribute("aria-describedby")!
		)
		expect(emptyNote?.textContent?.trim()).toBe(
			"Ignored until it has text."
		)
		expect(emptyNote?.className).toContain("text-surface-600-400")

		expect(fine.getAttribute("aria-describedby")).toBeNull()
	})

	test("a bias is written once it is a number, clamped to ±100, and a blank one comes back", () => {
		const props = mountField({ value: [{ text: "wait", value: -2 }] })
		const bias = biasInputs()[0]

		type(bias, "")
		expect(props.value).toEqual([{ text: "wait", value: -2 }])
		bias.dispatchEvent(new Event("change", { bubbles: true }))
		expect(bias.value).toBe("-2")

		type(bias, "-7.5")
		expect(props.value).toEqual([{ text: "wait", value: -7.5 }])

		type(bias, "250")
		expect(bias.value).toBe("100")
		expect(props.value).toEqual([{ text: "wait", value: 100 }])
	})

	test("Add appends a blank row and focuses it; Remove and the arrows reorder", async () => {
		const props = mountField({
			value: [
				{ text: "a", value: 1 },
				{ text: "b", value: 2 }
			]
		})

		button("Add")!.click()
		flushSync()
		await tick()
		expect(props.value).toEqual([
			{ text: "a", value: 1 },
			{ text: "b", value: 2 },
			{ text: "", value: 0 }
		])
		expect(document.activeElement).toBe(textInputs()[2])

		expect(button("Move “a” up")!.disabled).toBe(true)
		button("Move “b” up")!.click()
		flushSync()
		await tick()
		expect((props.value as { text: string }[]).map((e) => e.text)).toEqual([
			"b",
			"a",
			""
		])
		// Focus follows the row; at the top its up arrow is off, so down.
		expect(document.activeElement).toBe(button("Move “b” down"))

		button("Remove the blank row")!.click()
		flushSync()
		await tick()
		expect(props.value).toEqual([
			{ text: "b", value: 2 },
			{ text: "a", value: 1 }
		])
		expect(document.activeElement).toBe(button("Remove “a”"))
	})

	test("an unreadable stored value is said, with Clear, instead of an empty editor", () => {
		const props = mountField({ value: "{not json" })
		expect(textInputs()).toHaveLength(0)
		expect(document.body.textContent).toContain(
			"This logit bias list can't be read"
		)
		button("Clear")!.click()
		flushSync()
		expect(props.value).toEqual([])
		expect(button("Add")).toBeTruthy()
	})

	test("a legacy { id: bias } object reads as [id] rows", () => {
		mountField({ value: { "1234": -5 } })
		expect(textInputs()[0].value).toBe("[1234]")
		expect(biasInputs()[0].value).toBe("-5")
	})

	test("disabled rows are read-only: no Add, Remove, arrows or import", () => {
		mountField({ value: [{ text: "x", value: 1 }], disabled: true })
		expect(textInputs()[0].disabled).toBe(true)
		expect(biasInputs()[0].disabled).toBe(true)
		expect(document.querySelectorAll("button")).toHaveLength(0)
		expect(document.querySelector('input[type="file"]')).toBeNull()
	})
})

describe("logit bias field — Import SillyTavern list", () => {
	async function importJson(json: string) {
		const input =
			document.querySelector<HTMLInputElement>('input[type="file"]')!
		const file = new File([json], "bias.json", { type: "application/json" })
		Object.defineProperty(input, "files", {
			value: [file],
			configurable: true
		})
		input.dispatchEvent(new Event("change", { bubbles: true }))
		await vi.waitFor(() => {
			flushSync()
			expect(
				document.querySelector('[role="status"]')?.textContent?.trim()
			).toBeTruthy()
		})
	}

	test("the button is named for the field, never the whole-data import", () => {
		mountField({ value: [] })
		const b = button("Import SillyTavern list")
		expect(b?.textContent?.trim()).toBe("Import SillyTavern list")
		expect(button("Import from SillyTavern")).toBeUndefined()
	})

	test("imported rows are appended after the existing ones and the outcome is said inline", async () => {
		const props = mountField({ value: [{ text: "kept", value: 1 }] })
		await importJson(
			JSON.stringify([
				{ id: "a", text: "hmm", value: -5 },
				{ id: "b", text: "{Wait}", value: -10 }
			])
		)
		expect(props.value).toEqual([
			{ text: "kept", value: 1 },
			{ text: "hmm", value: -5 },
			{ text: "{Wait}", value: -10 }
		])
		expect(
			document.querySelector('[role="status"]')?.textContent?.trim()
		).toBe("Added 2 logit bias entries.")
		expect(toasts).toHaveLength(0)
	})

	test("a file the parser refuses leaves the list alone and shows its error", async () => {
		const props = mountField({ value: [{ text: "kept", value: 1 }] })
		await importJson("not json at all")
		expect(props.value).toEqual([{ text: "kept", value: 1 }])
		const status = document.querySelector('[role="status"]')!
		expect(status.textContent).toContain("This file isn't JSON")
		expect(status.querySelector(".text-error-600-400")).toBeTruthy()
		expect(toasts).toHaveLength(0)
	})

	test("a later edit clears the report", async () => {
		mountField({ value: [] })
		await importJson(JSON.stringify([{ text: "hmm", value: -1 }]))
		type(textInputs()[0], "hmmm")
		await tick()
		flushSync()
		expect(
			document.querySelector('[role="status"]')?.textContent?.trim()
		).toBe("")
	})
})

describe("SamplingValuesForm", () => {
	test("a format: 'logit-bias' field draws the rows editor, not the JSON textarea", () => {
		const schema: SettingsSchema = {
			logitBias: SAMPLING_SCHEMAS[S.textGen].logitBias
		}
		const props = $state({
			schema,
			values: {} as Record<string, unknown>,
			enabled: ["logitBias"]
		})
		app = mount(SamplingValuesForm, { target: document.body, props })
		flushSync()

		expect(document.querySelector("textarea")).toBeNull()
		const group = document.querySelector('[role="group"]')!
		const label = document.getElementById(
			group.getAttribute("aria-labelledby")!
		)
		expect(label?.textContent).toContain("Logit Bias")
		expect(textInputs()).toHaveLength(
			LOGIT_BIAS_OVERTHINKING_MARKERS.length
		)

		type(textInputs()[0], "Perhaps")
		expect(Array.isArray(props.values.logitBias)).toBe(true)
		expect((props.values.logitBias as unknown[])[0]).toEqual({
			text: "Perhaps",
			value: -2
		})
	})
})
