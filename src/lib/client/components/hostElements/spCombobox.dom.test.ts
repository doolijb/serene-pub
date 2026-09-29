/**
 * `sp-combobox` in a DOM: opening it offers every option, whatever it holds.
 * The field shows the picked option's label, and filtering on that label hid
 * every other option — Lore entries' Sort offered only the sort already in
 * force (the C7 gate's lore-entries spec caught it). Only what the person
 * types filters.
 */
import { afterEach, beforeAll, describe, expect, test } from "vitest"
import { flushSync } from "svelte"
import { makeSpElementClass } from "./spElement.svelte"
import SpCombobox from "./SpCombobox.svelte"

const tick = () => new Promise((r) => setTimeout(r, 0))

beforeAll(() => {
	customElements.define("sp-combobox", makeSpElementClass("sp-combobox", { component: SpCombobox, dataChildren: ["sp-option"] }))
})
afterEach(() => {
	document.body.replaceChildren()
})

async function combobox(value: string) {
	const el = document.createElement("sp-combobox")
	el.setAttribute("label", "Sort")
	el.setAttribute("value", value)
	for (const [v, label] of [
		["lastRead", "Last read"],
		["timesRead", "Times read"],
		["name", "Name"]
	]) {
		const o = document.createElement("sp-option")
		o.setAttribute("value", v)
		o.textContent = label
		el.append(o)
	}
	document.body.append(el)
	flushSync()
	await tick()
	flushSync()
	return el
}

const offered = () =>
	[...document.querySelectorAll("[role=option]")].map((o) => (o.textContent ?? "").replace(/\s+/g, " ").trim())

describe("sp-combobox options", () => {
	test("opened holding a pick, it offers every option", async () => {
		await combobox("lastRead")
		const input = document.querySelector("input[role=combobox]") as HTMLInputElement
		expect(input.value).toBe("Last read")
		;(document.querySelector('button[data-part="trigger"]') as HTMLButtonElement).click()
		flushSync()
		await tick()
		flushSync()
		expect(offered()).toEqual(["Last read", "Times read", "Name"])
	})

	test("what the person types still filters", async () => {
		await combobox("lastRead")
		const input = document.querySelector("input[role=combobox]") as HTMLInputElement
		input.focus()
		input.value = "na"
		input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "a", inputType: "insertText" }))
		flushSync()
		await tick()
		flushSync()
		expect(offered()).toEqual(["Name"])
	})
})
