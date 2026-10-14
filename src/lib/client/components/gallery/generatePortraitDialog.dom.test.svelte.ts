/**
 * 🚧 The Generate portrait dialog (I8): it asks for a preview when it opens
 * and whenever the count or the style moves, shows the cost line, the
 * notices and the review hint it is handed, refuses to generate while the
 * preview carries a refusal, and hands back the count and style chosen.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import GeneratePortraitDialog from "./GeneratePortraitDialog.svelte"

let view: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (view) unmount(view)
	view = null
	document.body.innerHTML = ""
})

type Preview = Sockets.Characters.PreviewPortrait.Response

function render(preview: Preview | null = null) {
	const calls: Array<[string, number, string]> = []
	const props = $state({
		open: true,
		characterName: "Verity",
		preview,
		previewing: false,
		running: false,
		onPreview: (n: number, s: string) => calls.push(["preview", n, s]),
		onGenerate: (n: number, s: string) => calls.push(["generate", n, s])
	})
	view = mount(GeneratePortraitDialog, { target: document.body, props })
	flushSync()
	return { props, calls }
}

const button = (name: RegExp) =>
	[...document.querySelectorAll("button")].find((b) =>
		name.test((b.textContent ?? "").trim())
	) as HTMLButtonElement | undefined

const preview = (over: Partial<Preview> = {}): Preview => ({
	characterId: 1,
	count: 2,
	style: "tags",
	pictures: 2,
	calls: 1,
	line: "2 pictures · 1 call",
	notices: [],
	review: true,
	...over
})

describe("the Generate portrait dialog", () => {
	test("asks for a preview on open, two pictures as tags by default", async () => {
		const { calls } = render()
		await tick()
		expect(calls[0]).toEqual(["preview", 2, "tags"])
		expect(document.body.textContent).toContain("Generate portrait")
	})

	test("a new count asks again", async () => {
		const { calls } = render(preview())
		await tick()
		button(/^3$/)!.click()
		flushSync()
		await tick()
		expect(calls.at(-1)).toEqual(["preview", 3, "tags"])
		expect(button(/^3$/)!.getAttribute("aria-checked")).toBe("true")
	})

	test("shows the cost line, the notices and the review hint", async () => {
		render(
			preview({
				notices: ["This model can't take a reference image, so it draws from the likeness prompt alone."]
			})
		)
		await tick()
		expect(document.querySelector('[data-testid="portrait-plan-line"]')?.textContent).toContain(
			"2 pictures · 1 call"
		)
		expect(document.body.textContent).toContain("can't take a reference image")
		expect(document.querySelector('[data-testid="portrait-review-hint"]')).toBeTruthy()
	})

	test("a refusal disables Generate and is said", async () => {
		render(preview({ calls: null, refusal: "No model is set for Images." }))
		await tick()
		expect(button(/Generate$/)!.disabled).toBe(true)
		expect(document.querySelector('[role="alert"]')?.textContent).toContain("No model is set")
	})

	test("Generate hands back the count and style", async () => {
		const { calls } = render(preview())
		await tick()
		button(/^4$/)!.click()
		flushSync()
		const form = document.querySelector('[data-testid="portrait-form"]') as HTMLFormElement
		form.requestSubmit()
		flushSync()
		expect(calls.at(-1)).toEqual(["generate", 4, "tags"])
	})
})
