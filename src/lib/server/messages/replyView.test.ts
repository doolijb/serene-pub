/**
 * 🚧 `replyView`'s front (lair fix 2, 2026-10-22): a reply that opens with
 * another non-cast voice's label — the GM's, an envoy's — has it taken off,
 * as its own label is: the last guard behind the stops. A delver's line read
 * "Dungeon Master: As you walk along the path…" in the owner's Lair.
 */
import { describe, expect, test } from "vitest"
import { replyView } from "./replyView"

const facts = {
	ownLabels: ["Suzume Akagane", "Suzume"],
	strayLabels: ["Dungeon Master", "Castellan", "Oracle"]
}

describe("replyView — a stray voice's label at the front", () => {
	test("the GM's label opening a delver's reply comes off", () => {
		const view = replyView("Dungeon Master: As you walk along the path…", undefined, facts, { final: true })
		expect(view.content).toBe("As you walk along the path…")
	})

	test("an envoy's too, and the reply's own after it", () => {
		expect(replyView("Castellan: Suzume: Hm.", undefined, facts, { final: true }).content).toBe("Hm.")
	})

	test("mid-reply, a name is prose — only the front is a label", () => {
		const text = "I glance back. The Dungeon Master: no, the dark itself watches."
		expect(replyView(text, undefined, facts, { final: true }).content).toBe(text)
	})

	test("streaming: a front that is so far only the start of the label is held back", () => {
		expect(replyView("Dungeon Mas", undefined, facts, { final: false }).content).toBe("")
		expect(replyView("Dungeon walls loom", undefined, facts, { final: false }).content).toBe("Dungeon walls loom")
	})

	test("without stray labels, nothing changes", () => {
		const view = replyView("Dungeon Master: As you walk…", undefined, { ownLabels: ["Suzume"] }, { final: true })
		expect(view.content).toBe("Dungeon Master: As you walk…")
	})
})
