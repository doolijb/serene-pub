import { describe, expect, test } from "vitest"
import {
	createNavStack,
	INDEX_ENTRY,
	MAX_DEPTH,
	type NavEntry,
	type NavView
} from "./navStack"

const entry = (over: Partial<NavEntry>): NavEntry => ({
	...INDEX_ENTRY,
	...over
})
const connection = (connectionId: number) =>
	entry({ view: "connection", connectionId })
const model = (connectionId: number, modelId: number) =>
	entry({ view: "model", connectionId, modelId })

describe("the connections panel's Back", () => {
	test("three places, and nothing else is one", () => {
		const views: NavView[] = ["index", "connection", "model"]
		// The type is the contract; this pins the one constant beside it.
		expect(views).toHaveLength(3)
		expect(MAX_DEPTH).toBe(2)
	})

	test("an empty trail lands on the index", () => {
		expect(createNavStack().back()).toEqual(INDEX_ENTRY)
	})

	test("index → connection → model → back → that connection → back → index", () => {
		const stack = createNavStack()
		stack.go(connection(7))
		stack.go(model(7, 70))
		expect(stack.depth).toBe(2)
		expect(stack.back()).toEqual(connection(7))
		expect(stack.back()).toEqual(INDEX_ENTRY)
	})

	test("a model opened from a connection returns to THAT connection", () => {
		// The KoboldCPP image model: the model belongs to the image row, but
		// Back must land on the text row it was opened from (plan B3).
		const stack = createNavStack()
		stack.go(connection(7))
		stack.go(model(8, 80))
		expect(stack.back()).toMatchObject({
			view: "connection",
			connectionId: 7
		})
	})

	test("a model opened from the list goes back to the index", () => {
		const stack = createNavStack()
		stack.go(connection(7))
		stack.go(model(7, 70), { fresh: true })
		expect(stack.depth).toBe(1)
		expect(stack.back()).toEqual(INDEX_ENTRY)
	})

	test("a connection opened from a model replaces the trail: its Back is the index", () => {
		// The model detail's "Open KoboldCPP".
		const stack = createNavStack()
		stack.go(connection(7))
		stack.go(model(7, 70))
		stack.go(connection(3))
		expect(stack.depth).toBe(1)
		expect(stack.current).toEqual(connection(3))
		expect(stack.back()).toEqual(INDEX_ENTRY)
	})

	test("a model opened from a model replaces it, under the same connection", () => {
		const stack = createNavStack()
		stack.go(connection(7))
		stack.go(model(7, 70))
		stack.go(model(7, 71))
		expect(stack.depth).toBe(2)
		expect(stack.current).toEqual(model(7, 71))
		expect(stack.back()).toEqual(connection(7))
	})

	test("the index clears the trail", () => {
		const stack = createNavStack()
		stack.go(connection(1))
		stack.go(INDEX_ENTRY)
		expect(stack.depth).toBe(0)
		expect(stack.current).toEqual(INDEX_ENTRY)
	})

	test("entries are copies — a later change is not replayed", () => {
		const stack = createNavStack()
		const from = connection(1)
		stack.go(from)
		from.connectionId = 2
		expect(stack.back()).toEqual(INDEX_ENTRY)
		stack.go(connection(1))
		const current = stack.current
		current.connectionId = 9
		expect(stack.current.connectionId).toBe(1)
	})

	test("clear forgets the trail", () => {
		const stack = createNavStack()
		stack.go(connection(1))
		stack.clear()
		expect(stack.depth).toBe(0)
		expect(stack.back()).toEqual(INDEX_ENTRY)
	})

	test("the trail never goes deeper than two, whatever the doors", () => {
		const stack = createNavStack()
		// A deterministic walk over every kind of move, many times over.
		let seed = 7
		const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31)
		for (let i = 0; i < 500; i++) {
			const pick = next() % 6
			if (pick === 0) stack.go(INDEX_ENTRY)
			else if (pick === 1) stack.go(connection(next() % 5))
			else if (pick === 2) stack.go(model(next() % 5, next() % 9))
			else if (pick === 3)
				stack.go(model(next() % 5, next() % 9), { fresh: true })
			else if (pick === 4)
				stack.go(connection(next() % 5), { fresh: true })
			else stack.back()
			expect(stack.depth).toBeLessThanOrEqual(MAX_DEPTH)
			// Back always means up one level.
			const depth = stack.depth
			if (depth > 0 && next() % 3 === 0) {
				stack.back()
				expect(stack.depth).toBe(depth - 1)
			}
		}
	})
})
