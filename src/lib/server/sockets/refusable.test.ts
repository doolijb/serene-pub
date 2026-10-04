/**
 * What `refusable` says, for the errors a handler can throw that are not a
 * failed query (that case is `refusable.int.test.ts`).
 *
 * A refusal a handler words is a sentence for the person. A bug's own words
 * ("Cannot read properties of undefined (reading 'id')") are not: they say
 * nothing the person can act on, so the handler's fallback stands in for
 * them, and the whole error still reaches the server log through the
 * re-throw.
 */
import { describe, expect, test, vi } from "vitest"
import { refusable } from "./refusable"

function collector() {
	const events: { event: string; data: any }[] = []
	return {
		events,
		emit: (event: string, data: any) => {
			events.push({ event, data })
		}
	}
}

async function refusalOf(thrown: unknown) {
	const handler = refusable(
		"test:refuse",
		async () => {
			throw thrown
		},
		"The link could not be saved."
	)
	const c = collector()
	const rethrown = await handler
		.handler({} as any, {}, c.emit)
		.catch((e: unknown) => e)
	return { events: c.events, rethrown }
}

describe("refusable", () => {
	test("a sentence the handler wrote reaches the person as written", async () => {
		const { events } = await refusalOf(
			new Error("Nothing can be linked to itself.")
		)
		expect(events).toEqual([
			{
				event: "test:refuse:error",
				data: { error: "Nothing can be linked to itself." }
			}
		])
	})

	test("a bug's own words answer with the fallback, and the bug is re-thrown", async () => {
		let bug: unknown
		try {
			;(undefined as any).id
		} catch (e) {
			bug = e
		}
		const { events, rethrown } = await refusalOf(bug)
		expect(events).toEqual([
			{
				event: "test:refuse:error",
				data: { error: "The link could not be saved." }
			}
		])
		expect(rethrown).toBe(bug)
	})

	test("so do a missing name and an impossible range", async () => {
		for (const bug of [
			new ReferenceError("book is not defined"),
			new RangeError("Invalid time value")
		]) {
			const { events } = await refusalOf(bug)
			expect(events[0]!.data).toEqual({
				error: "The link could not be saved."
			})
		}
	})

	test("a thrown value with no message answers with the fallback", async () => {
		const { events } = await refusalOf("nope")
		expect(events[0]!.data).toEqual({
			error: "The link could not be saved."
		})
	})

	test("a failure after the reply went out is not a refusal of what landed", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		const failure = new Error("relist failed")
		const handler = refusable(
			"test:save",
			async (_socket, _params, emitToUser) => {
				emitToUser("test:save", { id: 7 })
				emitToUser("test:list", () => ({ rows: [] }))
				throw failure
			},
			"The book could not be saved."
		)
		const c = collector()
		const result = await handler.handler({} as any, {}, c.emit)
		expect(c.events.map((e) => e.event)).toEqual(["test:save", "test:list"])
		expect(result).toEqual({ id: 7 })
		expect(logged).toHaveBeenCalledWith(
			"test:save: failed after its reply went out:",
			failure
		)
		logged.mockRestore()
	})

	test("the echo names the request beside the sentence", async () => {
		const handler = refusable(
			"test:refuse",
			async () => {
				throw new Error("That branch is not a line of this book.")
			},
			"The line could not be read.",
			undefined,
			(params: any) => ({ lorebookId: params?.lorebookId })
		)
		const c = collector()
		await handler
			.handler({} as any, { lorebookId: 7 } as any, c.emit)
			.catch(() => {})
		expect(c.events[0]!.data).toEqual({
			lorebookId: 7,
			error: "That branch is not a line of this book."
		})
	})
})
