import { describe, it, expect } from "vitest"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { predicateHolds } from "@serene-pub/sdk"

/**
 * `core:task/pair@1` — the document a junction can compare (contracts batch 2).
 *
 * A junction branches on ONE port and `equalsPath` compares two paths of ONE
 * document, so *is the accused the culprit?* was unaskable: nothing in core
 * merged two json ports, which is why Whodunit's verdict shipped with its
 * `accused` node wired to nothing.
 *
 * What is pinned:
 *
 *  · the document is `{ [firstKey]: first, [secondKey]: second }`, and the two
 *    keys are the spec's own words;
 *  · **an absent side is OMITTED, never null** — the whole point. A junction
 *    over this document must fire nothing on a turn where either side was
 *    never decided, and that only holds while the key is missing:
 *    `predicateHolds` answers `false` for an `undefined` side, but
 *    `null === null`, so a nulled pair compares EQUAL and the verdict fires on
 *    a turn where nobody accused anybody;
 *  · two identical keys HALT rather than collapse into one.
 *
 * `ctx` is never touched — the property is itself part of the contract — so
 * every call here passes `{}` for it.
 *
 * ⚠ The declaration lives in `serene-pub-sdk/contracts/src` and this file
 * reads the handler, which is a plain function: it runs through the dist lag
 * that keeps `reads<typeof C.pair>` and `registryHashes.test.ts` red until
 * `npm run sdk:build`.
 */

const pair = (input: any) =>
	coreBindings()["core:task/pair@1"]!(input, {} as any) as any

describe("pair", () => {
	it("puts both values under the names the spec chose", async () => {
		const res = await pair({
			first: "character:7",
			second: "character:9",
			params: { firstKey: "accused", secondKey: "culprit" }
		})
		expect(res.kind).toBe("ok")
		expect(res.value.main).toEqual({
			accused: "character:7",
			culprit: "character:9"
		})
	})

	it("names them first and second when the spec does not", async () => {
		const res = await pair({ first: 1, second: 2, params: {} })
		expect(res.value.main).toEqual({ first: 1, second: 2 })
	})

	it("omits an absent side — it never writes null", async () => {
		const noSecond = await pair({
			first: "character:7",
			params: { firstKey: "accused", secondKey: "culprit" }
		})
		expect(Object.keys(noSecond.value.main)).toEqual(["accused"])
		expect("culprit" in noSecond.value.main).toBe(false)

		const noFirst = await pair({
			second: "character:7",
			params: { firstKey: "accused", secondKey: "culprit" }
		})
		expect(Object.keys(noFirst.value.main)).toEqual(["culprit"])

		const neither = await pair({ params: {} })
		expect(neither.value.main).toEqual({})
	})

	it("⚠ the omission is what keeps a junction from firing on an undecided turn", async () => {
		const decided = await pair({
			first: "character:7",
			second: "character:7",
			params: { firstKey: "accused", secondKey: "culprit" }
		})
		const undecided = await pair({
			params: { firstKey: "accused", secondKey: "culprit" }
		})
		const fires = (doc: Record<string, unknown>) =>
			predicateHolds({ equalsPath: "culprit" }, doc.accused, doc)

		expect(fires(decided.value.main)).toBe(true)
		expect(fires(undecided.value.main)).toBe(false)
		// And why it cannot be null: the same run, the same absence, the
		// opposite answer.
		expect(fires({ accused: null, culprit: null })).toBe(true)
	})

	it("carries whole documents, not only keys", async () => {
		const first = { id: 7, name: "Vell" }
		const res = await pair({ first, second: 7, params: {} })
		// Exactly as it arrived — the node computes nothing.
		expect(res.value.main.first).toBe(first)
	})

	it("halts when both sides would be called the same thing", async () => {
		const res = await pair({
			first: "a",
			second: "b",
			params: { firstKey: "who", secondKey: " who " }
		})
		expect(res.kind).toBe("halt")
		expect(res.reason).toMatch(/compare equal to itself/)
	})
})
