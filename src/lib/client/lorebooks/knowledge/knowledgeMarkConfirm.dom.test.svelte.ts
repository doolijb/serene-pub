/**
 * 🚧 The list badge a not-common-knowledge entry carries (`EntryMarks`).
 * ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
const held = vi.hoisted(() => ({ store: undefined as unknown }))
vi.mock("./bookKnowledge.svelte", async (original) => ({
	...(await original<Record<string, unknown>>()),
	getBookKnowledge: () => held.store
}))

import EntryMarks from "../sections/EntryMarks.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	held.store = undefined
})

function draw(id: number | undefined) {
	app = mount(EntryMarks, {
		target: document.body,
		props: { entry: { id }, vectorizationEnabled: true }
	})
	flushSync()
}
const badge = () =>
	document.body
		.querySelector('[title="Not common knowledge"]')
		?.textContent?.trim()

describe("the not common badge", () => {
	test("shows for a marked entry", () => {
		held.store = { isMarked: (id: number) => id === 4 }
		draw(4)
		expect(badge()).toBe("not common")
	})
	test("not for an unmarked entry, nor without a store", () => {
		held.store = { isMarked: (id: number) => id === 4 }
		draw(5)
		expect(badge()).toBeUndefined()
		unmount(app!)
		held.store = undefined
		draw(4)
		expect(badge()).toBeUndefined()
	})
})
