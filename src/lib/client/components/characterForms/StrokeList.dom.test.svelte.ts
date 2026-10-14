/**
 * One card field as its strokes (DESIGN-card-strokes §A.7): the list shows
 * only its kind of the card's one list, and every edit keeps the other kind
 * where it is. Reorder works from the keyboard; the When chip switches
 * modes; findings are said under the stroke they are about.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import type { Stroke } from "@serene-pub/sdk"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

import StrokeList from "./StrokeList.svelte"

const apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? ""
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-stroke-key]")]
const rowTexts = () =>
	rows().map((r) => r.querySelector<HTMLTextAreaElement>("[data-stroke-text]")!.value)
const openItems = () =>
	[...document.querySelectorAll<HTMLElement>("[role=menuitem]")].filter(
		(i) => i.closest("[role=menu]")?.getAttribute("data-state") === "open"
	)
async function click(el: Element | null | undefined) {
	expect(el).toBeTruthy()
	;(el as HTMLElement).click()
	await settle()
}
async function choose(trigger: Element | null | undefined, item: string) {
	await click(trigger)
	const el = openItems().find((i) => text(i) === item)
	expect(el, `the menu offers "${item}"`).toBeTruthy()
	el!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
	await click(el)
}

const d = (t: string, extra: Partial<Stroke> = {}): Stroke => ({
	kind: "description",
	text: t,
	when: { mode: "always" },
	...extra
})
const p = (t: string): Stroke => ({ kind: "personality", text: t, when: { mode: "always" } })

function render(strokes: Stroke[], extra: Record<string, unknown> = {}) {
	const props = $state({
		kind: "description" as const,
		label: "Description",
		strokes,
		...extra
	})
	apps.push(mount(StrokeList, { target: document.body, props }))
	flushSync()
	return props
}

describe("StrokeList", () => {
	test("shows only its kind, adds at the end of its kind, removes", async () => {
		const props = render([d("Tall."), p("Shy."), d("Old.")])
		expect(rowTexts()).toEqual(["Tall.", "Old."])

		await click(document.querySelector("[data-stroke-add]"))
		expect(rows()).toHaveLength(3)
		expect(props.strokes.map((s) => s.kind)).toEqual([
			"description",
			"personality",
			"description",
			"description"
		])
		// The new row takes focus, ready to type.
		expect(document.activeElement?.hasAttribute("data-stroke-text")).toBe(true)

		const second = rows()[1].querySelector('[aria-label="Stroke 2 options"]')
		await choose(second, "Remove")
		expect(rowTexts()).toEqual(["Tall.", ""])
		expect(props.strokes.map((s) => s.text)).toEqual(["Tall.", "Shy.", ""])
	})

	test("reorders by keyboard on the handle; the other kind stays put", async () => {
		const props = render([d("A"), p("x"), d("B")])
		const handle = rows()[1].querySelector<HTMLElement>("[data-stroke-handle]")!
		handle.focus()
		handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }))
		await settle()
		expect(rowTexts()).toEqual(["B", "A"])
		expect(props.strokes.map((s) => s.text)).toEqual(["B", "x", "A"])
		// Focus followed the stroke.
		expect(document.activeElement?.closest("[data-stroke-key]")).toBe(rows()[0])

		rows()[0]
			.querySelector("[data-stroke-handle]")!
			.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
		await settle()
		expect(props.strokes.map((s) => s.text)).toEqual(["A", "x", "B"])
	})

	test("the When chip switches modes; Keywords opens the keyword row", async () => {
		const props = render([d("Salt in the hair.")])
		const chip = () => document.querySelector("[data-stroke-when]")
		expect(text(chip())).toBe("Always")
		expect(document.querySelector("[data-stroke-keywords]")).toBeNull()

		await choose(chip()!.closest("button"), "Keywords…")
		expect(props.strokes[0].when).toEqual({
			mode: "keywords",
			keys: [],
			matchMode: "substring",
			caseSensitive: false
		})
		expect(document.querySelector("[data-stroke-keywords]")).toBeTruthy()
		expect(text(chip())).toBe("Keywords")

		await choose(chip()!.closest("button"), "Off")
		expect(props.strokes[0].when).toEqual({ mode: "off" })
		expect(document.querySelector("[data-stroke-keywords]")).toBeNull()
		expect(text(chip())).toBe("Off")
	})

	test("a duplicate slug is said under the stroke that repeats it", async () => {
		render([d("green", { slug: "eyes", label: "Eyes" }), d("grey", { slug: "eyes" })])
		await settle()
		const [first, second] = rows()
		expect(first.querySelector("[data-stroke-finding=slug]")).toBeNull()
		expect(text(second.querySelector("[data-stroke-finding=slug]"))).toMatch(/already used/)
	})

	test("token labels: per stroke and the kind's total with the model", async () => {
		render([d("A"), p("x"), d("B")], {
			tokens: { perStroke: [3, 9, 5], perKind: { description: 10, personality: 9 }, model: "llama-3" }
		})
		await settle()
		expect(rows().map((r) => text(r.querySelector("[data-stroke-tokens]")))).toEqual([
			"≈ 3 tokens",
			"≈ 5 tokens"
		])
		expect(text(document.querySelector("[data-stroke-total]"))).toContain("≈ 10 tokens (llama-3)")
	})

	test("the label drives the slug until it is set by hand", async () => {
		const props = render([d("green")])
		const label = document.querySelector<HTMLInputElement>("[data-stroke-label]")!
		label.value = "Eye colour"
		label.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		expect(props.strokes[0].slug).toBe("eye-colour")
	})
})
