/**
 * A string field that names its blank (`unset`) draws two choices rather than
 * an empty box (ruled 2026-11-04): the first stores blank, the second shows a
 * box, and nothing is stored until the box commits. Every other field is drawn
 * as before.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import SchemaForm from "./SchemaForm.svelte"

const unset = { label: "Default (main)", other: "Another channel" }

describe("SchemaForm named blank", () => {
	let app: ReturnType<typeof mount> | null = null
	let host: HTMLElement
	let values: Record<string, unknown>
	let commits: number

	function open(
		schema: Record<string, any>,
		initial: Record<string, unknown> = {}
	) {
		const reactive = $state(initial)
		values = reactive
		commits = 0
		host = document.createElement("div")
		document.body.append(host)
		app = mount(SchemaForm, {
			target: host,
			props: { schema, values, oncommit: () => commits++ }
		})
		flushSync()
	}

	afterEach(() => {
		if (app) unmount(app)
		app = null
		document.body.innerHTML = ""
	})

	async function settle() {
		flushSync()
		await tick()
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
	}

	const box = () =>
		host.querySelector<HTMLInputElement>(
			'input[aria-label="Another channel"]'
		)
	const combos = () =>
		[
			...host.querySelectorAll<HTMLInputElement>('input[role="combobox"]')
		].map((i) => i.value)

	async function pick(label: string, text: string) {
		host.querySelector<HTMLButtonElement>(
			`button[aria-label="Show ${label} options"]`
		)!.click()
		await settle()
		;[...document.querySelectorAll<HTMLElement>('[role="option"]')]
			.find((o) => o.textContent?.trim() === text)!
			.click()
		await settle()
	}

	const field = {
		type: "string",
		label: "Channel",
		description: "A slug.",
		unset
	}

	test("a string with unset draws the two choices and no box", () => {
		open({ channel: field })
		expect(combos()).toEqual(["Default (main)"])
		expect(box()).toBeNull()
		expect(host.querySelector("#sf-channel")).toBeNull()
	})

	test("a stored value shows the second choice and the value; the box carries no placeholder (the description is drawn once)", () => {
		open({ channel: field }, { channel: "sanctum" })
		expect(combos()).toEqual(["Another channel"])
		expect(box()!.value).toBe("sanctum")
		expect(box()!.placeholder).toBe("")
	})

	test("picking the first stores blank and commits", async () => {
		open({ channel: field }, { channel: "sanctum" })
		await pick("Channel", "Default (main)")
		expect(values.channel).toBe("")
		expect(commits).toBe(1)
		expect(box()).toBeNull()
	})

	test("picking the second writes nothing until the box commits a trimmed value", async () => {
		open({ channel: field })
		await pick("Channel", "Another channel")
		expect(commits).toBe(0)
		expect(values.channel).toBeUndefined()
		expect(box()).not.toBeNull()
		box()!.value = "  sanctum "
		box()!.dispatchEvent(new Event("change", { bubbles: true }))
		await settle()
		expect(values.channel).toBe("sanctum")
		expect(commits).toBe(1)
	})

	test("a string without unset is one plain box", () => {
		open({ channel: { type: "string", label: "Channel" } })
		expect(host.querySelector("#sf-channel")).not.toBeNull()
		expect(host.querySelector('input[role="combobox"]')).toBeNull()
	})

	test("the same field declared advanced draws the same choice", async () => {
		open({ channel: { ...field, advanced: true } }, { channel: "sanctum" })
		expect(combos()).toEqual(["Another channel"])
		expect(box()!.value).toBe("sanctum")
		await pick("Channel", "Default (main)")
		expect(values.channel).toBe("")
		expect(commits).toBe(1)
	})

	test("unset on a number field is drawn as the number box", () => {
		open({ n: { type: "number", label: "Count", unset } })
		expect(host.querySelector<HTMLInputElement>("#sf-n")!.type).toBe(
			"number"
		)
		expect(host.querySelector('input[role="combobox"]')).toBeNull()
	})
})
