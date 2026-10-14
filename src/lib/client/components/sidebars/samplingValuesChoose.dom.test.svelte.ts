/**
 * Choose parameters, in place (design D.2): with `choose` on the values form
 * draws every parameter of the shape with a checkbox; one that is not sent is
 * dimmed and reads "not sent" where its value would be. Off, it draws only the
 * sent ones. Group labels say how many of the group are sent.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import type { SettingsSchema } from "@serene-pub/sdk"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

import SamplingValuesForm from "./SamplingValuesForm.svelte"

const schema: SettingsSchema = {
	temperature: {
		type: "number",
		group: "Core",
		default: 0.7,
		min: 0,
		max: 2
	},
	topP: { type: "number", group: "Core", default: 0.9, min: 0, max: 1 },
	seed: { type: "integer", group: "Other", default: 1, min: 0, max: 99 }
}

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

function render(choose: boolean) {
	const props = $state({
		schema,
		values: { temperature: 0.5 } as Record<string, unknown>,
		enabled: ["temperature"],
		choose
	})
	app = mount(SamplingValuesForm, { target: document.body, props })
	flushSync()
	return props
}

const param = (key: string) =>
	document.querySelector<HTMLElement>(`[data-sampling-param="${key}"]`)

describe("SamplingValuesForm — choose mode", () => {
	test("off: only the sent parameters, with their controls", () => {
		render(false)
		expect(param("temperature")).toBeTruthy()
		expect(param("topP")).toBeNull()
		expect(document.querySelector("#sv-temperature-on")).toBeNull()
		expect(document.body.textContent).toContain("1 of 2 sent")
	})

	test("on: every parameter, the unsent ones dimmed and marked", () => {
		render(true)
		const topP = param("topP")!
		expect(topP.className).toContain("opacity-60")
		expect(topP.textContent).toContain("not sent")
		expect(topP.querySelector('input[type="range"]')).toBeNull()
		expect(param("temperature")!.className).not.toContain("opacity-60")
		expect(param("seed")).toBeTruthy()
	})

	test("ticking one sends it and starts it at its declared default", () => {
		const props = render(true)
		const box = document.querySelector<HTMLInputElement>("#sv-topP-on")!
		box.click()
		flushSync()
		expect(props.enabled).toEqual(["temperature", "topP"])
		expect(props.values.topP).toBe(0.9)
		expect(param("topP")!.className).not.toContain("opacity-60")
		expect(param("topP")!.querySelector('input[type="range"]')).toBeTruthy()
	})
})
