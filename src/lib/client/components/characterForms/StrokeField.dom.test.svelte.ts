/**
 * Strokes paused (`strokesFlag.ts`, owner 2026-10-11): a card field is its
 * textarea alone — no Split, no Add stroke, no stroke list even when the card
 * has strokes. With the flag on, the field is what DESIGN-card-strokes §A.7
 * built.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { createRawSnippet, flushSync, mount, unmount } from "svelte"
import type { Stroke } from "@serene-pub/sdk"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
const strokesFlag = vi.hoisted(() => ({ on: false }))
vi.mock("$lib/shared/characters/strokesFlag", () => ({
	get STROKES_ENABLED() {
		return strokesFlag.on
	}
}))

import StrokeField from "./StrokeField.svelte"

const apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps.splice(0)) unmount(app)
	document.body.innerHTML = ""
	strokesFlag.on = false
})

const textarea = createRawSnippet(() => ({
	render: () => `<textarea data-test-prose>stored prose</textarea>`
}))

function render(strokes: Stroke[], prose = "stored prose") {
	apps.push(
		mount(StrokeField, {
			target: document.body,
			props: {
				kind: "description",
				label: "Description",
				strokes,
				prose,
				textarea,
				onBackToOneText: () => {}
			}
		})
	)
	flushSync()
}

const painted: Stroke[] = [
	{ kind: "description", text: "A knight.", when: { mode: "always" } },
	{ kind: "personality", text: "Steady.", when: { mode: "always" } }
]

describe("StrokeField — strokes paused", () => {
	test("a card with strokes shows only its textarea", () => {
		render(painted)
		expect(document.querySelector("[data-test-prose]")).toBeTruthy()
		expect(document.querySelector("[data-stroke-key]")).toBeNull()
		expect(document.querySelector("[data-stroke-compiled]")).toBeNull()
		expect(document.querySelector("[data-stroke-split]")).toBeNull()
		expect(document.querySelector("[data-stroke-start]")).toBeNull()
	})

	test("a card with none offers no Split into strokes", () => {
		render([])
		expect(document.querySelector("[data-test-prose]")).toBeTruthy()
		expect(document.body.textContent).not.toContain("Split into strokes")
		expect(document.body.textContent).not.toContain("Add stroke")
	})
})

describe("StrokeField — strokes on", () => {
	test("a field still one text offers Split, and Add stroke when the card has strokes", () => {
		strokesFlag.on = true
		render([painted[1]!])
		expect(document.querySelector("[data-stroke-split]")).toBeTruthy()
		expect(document.querySelector("[data-stroke-start]")).toBeTruthy()
	})
})
