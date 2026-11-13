/** The entry tuning fold: drawn with advanced controls on, a hidden line off. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { createRawSnippet, flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => ({ emit, on: () => {}, off: () => {} })
}))

import EntryAdvancedFields from "./EntryAdvancedFields.svelte"

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	vi.clearAllMocks()
})

const extra = createRawSnippet(() => ({
	render: () => `<p data-extra>Extra door content</p>`
}))

function fold(ctx: object, draft: Record<string, any>) {
	app = mount(EntryAdvancedFields, {
		target: document.body,
		props: { draft, idPrefix: "t", vectorizationEnabled: false, extra },
		context: new Map<string, unknown>([["userSettingsCtx", ctx]])
	})
	flushSync()
}
const line = () =>
	document.body.textContent?.includes("Some controls are hidden.")

describe("EntryAdvancedFields", () => {
	test("off: no fold, no extra, the line stands in", () => {
		fold({ settings: { showAdvancedControls: false } }, {})
		expect(document.querySelector("details")).toBeNull()
		expect(document.body.textContent).not.toContain("Use regex")
		expect(document.querySelector("[data-extra]")).toBeNull()
		expect(line()).toBe(true)
	})

	test("on: the fold and its summary, no line", () => {
		fold({ settings: { showAdvancedControls: true } }, {})
		expect(
			document.querySelector("details summary")?.textContent
		).toContain("Regex, case, keyword chains, priority, conditions")
		expect(document.body.textContent).toContain("Use regex")
		expect(document.querySelector("[data-extra]")).not.toBeNull()
		expect(line()).toBe(false)
	})

	test("flipping the switch redraws without a remount", async () => {
		const ctx = $state({ settings: { showAdvancedControls: false } })
		fold(ctx, {})
		expect(document.querySelector("details")).toBeNull()
		ctx.settings.showAdvancedControls = true
		await tick()
		flushSync()
		expect(document.querySelector("details")).not.toBeNull()
		expect(line()).toBe(false)
	})

	test("hidden never means changed: the draft is untouched", async () => {
		const draft = $state<Record<string, any>>({
			useRegex: true,
			priority: 7,
			selectiveLogic: "andAll"
		})
		fold({ settings: { showAdvancedControls: false } }, draft)
		await tick()
		expect(draft.useRegex).toBe(true)
		expect(draft.priority).toBe(7)
		expect(draft.selectiveLogic).toBe("andAll")
	})
})
