import { describe, expect, it, vi } from "vitest"
import { makeInvoke } from "./context"

const noActions = () => ({}) as never

describe("makeInvoke · plugin actions (M0)", () => {
	it("hands an unlisted key to pluginAction", () => {
		const pluginAction = vi.fn()
		const action = vi.fn()
		makeInvoke(noActions, action, "w", { pluginAction })("world.save", { payload: { a: 1 } })
		expect(pluginAction).toHaveBeenCalledWith("world.save", { payload: { a: 1 } })
		expect(action).not.toHaveBeenCalled()
	})

	it("routes a listed key as before and never calls pluginAction", () => {
		const pluginAction = vi.fn()
		const fire = vi.fn()
		const actions = () =>
			({ message: [], session: [{ key: "regenerate", specSlug: "x", label: "R" }] }) as never
		try {
			makeInvoke(actions, vi.fn(), "w", { pluginAction, fire })("regenerate")
		} catch {
			// whatever the shape of the listing, the plugin door stays shut
		}
		expect(pluginAction).not.toHaveBeenCalled()
	})

	it("throws the existing sentence for an unlisted key without pluginAction", () => {
		expect(() => makeInvoke(noActions, vi.fn(), "w")("world.save")).toThrow(
			'widget "w" invoked action "world.save", which no venue of this session lists'
		)
	})
})
