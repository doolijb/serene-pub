import { describe, expect, test } from "vitest"
import { createNavStack, INDEX_ENTRY, type NavEntry } from "./navStack"

const entry = (over: Partial<NavEntry>): NavEntry => ({
	...INDEX_ENTRY,
	...over
})

describe("the connections panel's Back", () => {
	test("an empty trail lands on the index", () => {
		expect(createNavStack().pop()).toEqual(INDEX_ENTRY)
	})

	test("capability → model → back → capability → back → index", () => {
		const stack = createNavStack()
		const capability = entry({
			view: "capability",
			capability: "text->embedding"
		})
		stack.push(INDEX_ENTRY) // opened from the list: nothing to remember
		stack.push(capability) // the model was opened from the capability
		expect(stack.pop()).toEqual(capability)
		expect(stack.pop()).toEqual(INDEX_ENTRY)
	})

	test("a model opened from a connection returns to THAT connection", () => {
		// The KoboldCPP image model: the model belongs to the image row, but
		// Back must land on the text row it was opened from (plan B3).
		const stack = createNavStack()
		stack.push(entry({ view: "connection", connectionId: 7 }))
		expect(stack.pop()).toMatchObject({
			view: "connection",
			connectionId: 7
		})
	})

	test("the finder returns to what opened it", () => {
		const stack = createNavStack()
		stack.push(entry({ view: "capability", capability: "text->text" }))
		expect(stack.pop().view).toBe("capability")
	})

	test("entries are copies — a later change to the scope is not replayed", () => {
		const stack = createNavStack()
		const from = entry({ view: "finder", finderScope: { connectionId: 1 } })
		stack.push(from)
		from.finderScope.connectionId = 2
		expect(stack.pop().finderScope).toEqual({ connectionId: 1 })
	})

	test("clear forgets the trail", () => {
		const stack = createNavStack()
		stack.push(entry({ view: "connection", connectionId: 1 }))
		stack.clear()
		expect(stack.size).toBe(0)
		expect(stack.pop()).toEqual(INDEX_ENTRY)
	})

	test("the trail is capped", () => {
		const stack = createNavStack()
		for (let i = 0; i < 50; i++)
			stack.push(entry({ view: "connection", connectionId: i }))
		expect(stack.size).toBe(20)
		expect(stack.pop().connectionId).toBe(49)
	})
})
