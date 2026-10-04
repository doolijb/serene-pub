/**
 * The workspace's one copy of the book follows a write without asking for
 * the book again (plans B4, B5).
 */
import { describe, expect, it } from "vitest"
import {
	castSignature,
	dropDeletedEntry,
	patchEmbedding,
	patchScene
} from "./bookPatches"

const rows = {
	"core:entry/world": [
		{ id: 1, name: "Harbour" },
		{ id: 2, name: "Lighthouse" }
	],
	"core:entry/item": [{ id: 7, name: "Key" }],
	"core:entry/location": [{ id: 9, name: "Crypt" }]
} as any

describe("dropDeletedEntry — a delete is patched, never a re-read of the book (B5)", () => {
	it("drops the row from the type the reply names, and leaves the rest alone", () => {
		const next = dropDeletedEntry(rows, { entryId: 2, typeId: "core:entry/world" })
		expect(next["core:entry/world"]!.map((r) => r.id)).toEqual([1])
		expect(next["core:entry/item"]).toBe(rows["core:entry/item"])
	})

	it("finds the row in any type when the reply names none", () => {
		const next = dropDeletedEntry(rows, { entryId: 7 })
		expect(next["core:entry/item"]).toEqual([])
		expect(next["core:entry/world"]!.length).toBe(2)
	})
})

describe("castSignature — the graph is re-read only when the cast moved (B5)", () => {
	const cast = [
		{ id: 1, name: "Maren", characterId: 3, nodeState: "active" },
		{ id: 2, name: "Tobin", characterId: null, nodeState: "active" }
	]

	it("is the same for the list an entry save cascades unchanged", () => {
		expect(castSignature(cast.map((r) => ({ ...r })))).toBe(castSignature(cast))
	})

	it("moves with a member added, renamed, re-carded or re-stated", () => {
		const base = castSignature(cast)
		expect(castSignature([...cast, { id: 3, name: "Ines" }])).not.toBe(base)
		expect(castSignature([{ ...cast[0]!, name: "Marren" }, cast[1]!])).not.toBe(base)
		expect(castSignature([{ ...cast[0]!, characterId: 4 }, cast[1]!])).not.toBe(base)
		expect(castSignature([{ ...cast[0]!, nodeState: "deceased" }, cast[1]!])).not.toBe(
			base
		)
	})
})

describe("patchEmbedding — a badge moves on the one row it names (B4)", () => {
	const sourceKindOf = (typeId: string) =>
		typeId === "core:entry/world" ||
		typeId === "core:entry/item" ||
		typeId === "core:entry/location"
			? "worldLore"
			: undefined

	it("finds the row among every type that reports under the source kind", () => {
		const next = patchEmbedding(
			rows,
			{ type: "worldLore", id: 9, embeddingModel: "nomic" },
			sourceKindOf
		)!
		expect((next["core:entry/location"]![0] as any).embeddingModel).toBe("nomic")
		expect(next["core:entry/world"]).toBe(rows["core:entry/world"])
	})

	it("is nothing to patch for a row the book does not hold, or another kind's", () => {
		expect(
			patchEmbedding(rows, { type: "worldLore", id: 99, embeddingModel: "x" }, sourceKindOf)
		).toBeNull()
		expect(
			patchEmbedding(rows, { type: "historyEntry", id: 1, embeddingModel: "x" }, sourceKindOf)
		).toBeNull()
	})
})

describe("patchScene — a saved scene's fields over its row (B4)", () => {
	it("lays the saved fields over the held row, keeping what the save did not send", () => {
		const scenes = [
			{ id: 1, name: "Dawn", sessionId: 4 },
			{ id: 2, name: "Dusk", sessionId: 4 }
		]
		const next = patchScene(scenes, { id: 2, name: "Nightfall" })
		expect(next[1]).toEqual({ id: 2, name: "Nightfall", sessionId: 4 })
		expect(next[0]).toBe(scenes[0])
	})
})
