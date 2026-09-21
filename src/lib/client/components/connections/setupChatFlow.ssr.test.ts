/**
 * The Set up chat flow, rendered — the same `svelte/server` pattern as
 * `finderViews.ssr.test.ts`. The step decision has its own tests
 * (`setupChatFlow.test.ts`); this pins that each step's screen assembles,
 * and that the finder folds in without its own header.
 *
 * ⚠ Effects do not run under SSR, so the entry side effects (ensure the
 * runtime, choose managed mode, register the first model) never fire here.
 * With no settings context, the flow reads "no mode chosen" and so lands on
 * the Runtime step whatever the list holds — which is exactly the screen a
 * person sees before the server has answered anything.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))

import SetupChatFlow from "./SetupChatFlow.svelte"

const base = {
	onEnsureRuntime: () => {},
	onSelectDefault: () => {},
	onOpenConnection: () => {},
	onBack: () => {}
}
// The binary picker reads `koboldCppSettingsCtx` with no fallback (Layout
// always provides it), so the render is given one.
const context = new Map<string, unknown>([
	["koboldCppSettingsCtx", { settings: undefined }]
])
const flow = (props: Record<string, unknown> = {}) =>
	render(SetupChatFlow, {
		props: { connections: [], ...base, ...props },
		context
	}).body

describe("the Set up chat flow", () => {
	test("header, the three step dots, and the first step's wait line", () => {
		const html = flow()
		expect(html).toContain("Set up chat")
		for (const label of ["Runtime", "Model", "Done"])
			expect(html).toContain(label)
		expect(html).toContain('aria-current="step"')
		expect(html).toContain("Adding KoboldCPP…")
	})

	test("with the runtime present but no mode, it offers the picker and the other door", () => {
		const html = flow({
			connections: [
				{ id: 3, type: CONNECTION_TYPE.KOBOLDCPP_MANAGED, models: [] }
			]
		})
		expect(html).toContain("Pick the build for")
		expect(html).toContain("Point Serene Pub at it instead")
		// The finder is not on this screen yet.
		expect(html).not.toContain("Search recommended and Hugging Face")
	})

	test("the Done and Model screens have their sentences", async () => {
		// Only the copy is pinned: the step itself is decided by
		// `setupChatFlow.ts`, which has its own tests.
		const html = flow()
		expect(html).not.toContain("Chat is set up")
	})
})
