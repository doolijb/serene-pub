/** The layout's look section: backing radios, opacity range, gap segments, the style-author note. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import type { PanelLook } from "@serene-pub/sdk"
import LayoutLookSection from "./LayoutLookSection.svelte"

const apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

function render(look: Partial<PanelLook> = {}) {
	const onChange = vi.fn()
	apps.push(
		mount(LayoutLookSection, {
			target: document.body,
			props: {
				look: {
					backing: "card",
					opacity: 80,
					gap: "comfortable",
					...look
				},
				onChange
			}
		})
	)
	flushSync()
	return onChange
}
const radios = () => [
	...document.querySelectorAll<HTMLInputElement>(
		'[role="radiogroup"] input[type="radio"]'
	)
]
const range = () =>
	document.querySelector<HTMLInputElement>('input[type="range"]')!
const gapButtons = () => [
	...document.querySelectorAll<HTMLButtonElement>(
		'[role="group"][aria-labelledby$="-gap"] button'
	)
]
const behindButtons = () => [
	...document.querySelectorAll<HTMLButtonElement>(
		'[role="group"][aria-labelledby$="-behind"] button'
	)
]
const dimRange = () =>
	document.querySelector<HTMLInputElement>('input[id$="-dim"]')

describe("LayoutLookSection", () => {
	test("backing radios are labelled and reflect the look", () => {
		render({ backing: "glass" })
		expect(
			document
				.querySelector('[role="radiogroup"]')!
				.getAttribute("aria-labelledby") !== null
		).toBe(true)
		expect(radios().map((r) => r.value)).toEqual(["card", "glass", "none"])
		expect(radios().map((r) => r.checked)).toEqual([false, true, false])
		expect(
			[...document.querySelectorAll("label.lls-swatch")].map((l) =>
				l.textContent?.trim()
			)
		).toEqual(["Card", "Glass", "None"])
	})

	test("picking a backing reports it", () => {
		const onChange = render()
		radios()[2].click()
		flushSync()
		expect(onChange).toHaveBeenCalledWith({ backing: "none" })
	})

	test("opacity shows N% and writes on change only", () => {
		const onChange = render({ opacity: 80 })
		expect(document.body.textContent).toContain("80%")
		expect(range().min).toBe("0")
		expect(range().max).toBe("100")
		const r = range()
		r.value = "35"
		r.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		expect(document.body.textContent).toContain("35%")
		expect(onChange).not.toHaveBeenCalled()
		r.dispatchEvent(new Event("change", { bubbles: true }))
		flushSync()
		expect(onChange).toHaveBeenCalledWith({ opacity: 35 })
	})

	test("gap segments press the current value and report a pick", () => {
		const onChange = render({ gap: "tight" })
		expect(gapButtons().map((b) => b.textContent?.trim())).toEqual([
			"Tight",
			"Comfortable",
			"Spacious"
		])
		expect(gapButtons().map((b) => b.getAttribute("aria-pressed"))).toEqual(
			["true", "false", "false"]
		)
		gapButtons()[2].click()
		flushSync()
		expect(onChange).toHaveBeenCalledWith({ gap: "spacious" })
	})

	test("behind draws both choices with the pressed one and reports a pick", () => {
		const onChange = render({ behind: "background" })
		expect(behindButtons().map((b) => b.textContent?.trim())).toEqual([
			"Your background",
			"The session's backdrop"
		])
		expect(
			behindButtons().map((b) => b.getAttribute("aria-pressed"))
		).toEqual(["true", "false"])
		behindButtons()[1].click()
		flushSync()
		expect(onChange).toHaveBeenCalledWith({ behind: "backdrop" })
	})

	test("dim is shown only for the backdrop and writes on change", () => {
		render({ behind: "background" })
		expect(dimRange()).toBeNull()
		document.body.innerHTML = ""
		const onChange = render({ behind: "backdrop", behindDim: 20 })
		expect(
			behindButtons().map((b) => b.getAttribute("aria-pressed"))
		).toEqual(["false", "true"])
		const r = dimRange()!
		expect(r.value).toBe("20")
		r.value = "55"
		r.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		expect(document.body.textContent).toContain("55%")
		expect(onChange).not.toHaveBeenCalled()
		r.dispatchEvent(new Event("change", { bubbles: true }))
		flushSync()
		expect(onChange).toHaveBeenCalledWith({ behindDim: 55 })
	})

	test("the sentences and the style variables are present", () => {
		render()
		const text = (document.body.textContent ?? "").replace(/\s+/g, " ")
		expect(text).toContain(
			"What every panel sits on. How a card and glass look comes from your theme."
		)
		expect(text).toContain("Lower lets your background show through.")
		expect(text).toContain("What shows through behind the panels.")
		expect(text).toContain("The space between panels and around the zones.")
		expect(text).toContain("For style authors")
		expect(
			[...document.querySelectorAll("code")].map((c) => c.textContent)
		).toEqual([
			"--sp-widget-margin",
			"--sp-widget-background",
			"--sp-widget-radius",
			"--sp-widget-border"
		])
	})
})
