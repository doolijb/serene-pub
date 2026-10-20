import { describe, expect, it } from "vitest"
import { RENAMED_CORE_IDS } from "@serene-pub/core-catalog"
import {
	documentWithRenamedCoreIds,
	pluginSwapsOf,
	resolveRenamedCoreId
} from "./renamedCoreIds"

describe("resolveRenamedCoreId — a package's reference to a core id core renamed", () => {
	it("maps every id in core's rename table to its new id", () => {
		for (const { from, to } of RENAMED_CORE_IDS) expect(resolveRenamedCoreId(from)).toBe(to)
	})

	it("maps the head of an address and keeps its tail", () => {
		expect(resolveRenamedCoreId("core:spec/chat-turn-order#decide.rules.strategy")).toBe(
			"core:spec/story-turn-order#decide.rules.strategy"
		)
		expect(resolveRenamedCoreId("core:spec/adventure-look#look")).toBe("core:spec/story-look#look")
		expect(resolveRenamedCoreId("core:spec/chat-respond@^1")).toBe("core:spec/story-respond@^1")
		expect(resolveRenamedCoreId("core:ruleset/story@1#move")).toBe("core:ruleset/freeform@1#move")
	})

	it("leaves the new ids, a plugin's own ids and look-alikes alone", () => {
		for (const id of [
			"core:spec/story-respond",
			"core:genre/story",
			// Kept its id with the new meaning (the assistant): never aliased.
			"core:genre/chat",
			"core:spec/chat-respond-extra",
			"showcase.twenty-questions:spec/respond",
			"core:event/session-created@1",
			""
		])
			expect(resolveRenamedCoreId(id)).toBe(id)
	})

	it("reads a manifest's swaps onto the spec core ships now", () => {
		expect(
			pluginSwapsOf({
				swaps: [
					{ spec: "core:spec/chat-turn-order", node: "decide.rules.strategy", definition: "acme:task/t@1" },
					{ spec: "acme:spec/own", node: "n", definition: "acme:task/u@1" },
					{ spec: "core:spec/chat-respond" }
				]
			})
		).toEqual([
			{ spec: "core:spec/story-turn-order", node: "decide.rules.strategy", definition: "acme:task/t@1" },
			{ spec: "acme:spec/own", node: "n", definition: "acme:task/u@1" }
		])
		expect(pluginSwapsOf(null)).toEqual([])
	})

	it("reads a document's inlet lock onto the genre core ships now, and returns the same object when nothing moved", () => {
		const doc = { id: "acme:spec/look-again", input: { genre: "core:genre/adventure", event: "e" } }
		expect(documentWithRenamedCoreIds(doc)).toEqual({
			id: "acme:spec/look-again",
			input: { genre: "core:genre/story", event: "e" }
		})
		expect(doc.input.genre).toBe("core:genre/adventure")
		const own = { id: "acme:spec/x", input: { genre: "acme:genre/x", event: "e" } }
		expect(documentWithRenamedCoreIds(own)).toBe(own)
	})
})
