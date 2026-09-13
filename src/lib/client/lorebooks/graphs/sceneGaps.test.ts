/**
 * Two people in the same room and nothing said about them: the scenes the
 * graph has no edge for, and the sentence that asks for one.
 */
import { describe, expect, it } from "vitest"
import {
	castPairKey,
	edgedCastPairs,
	notDrawnSentence,
	scenesNamingNone,
	unnamedPairsFor
} from "./sceneGaps"

const scene = (id: number, participants: number[]) => ({
	id,
	name: `Scene ${id}`,
	participantCharacters: participants
})

const castEdge = (id: number, a: number, b: number) => ({
	id,
	from: { kind: "cast" as const, bindingId: a },
	to: { kind: "cast" as const, bindingId: b }
})

describe("castPairKey — a pair is a pair whichever way round it is read", () => {
	it("keys the same two members the same way both ways", () => {
		expect(castPairKey(7, 3)).toBe(castPairKey(3, 7))
	})
})

describe("edgedCastPairs — which pairs the graph already names", () => {
	it("collects a pair from an edge in either direction", () => {
		const pairs = edgedCastPairs([castEdge(1, 3, 7)])
		expect(pairs.has(castPairKey(7, 3))).toBe(true)
	})

	it("ignores an edge that reaches an entry rather than a member", () => {
		expect(
			edgedCastPairs([
				{
					id: 2,
					from: { kind: "cast", bindingId: 3 },
					to: { kind: "entry", entryId: 7 }
				}
			]).size
		).toBe(0)
	})
})

describe("scenesNamingNone — scenes the graph is silent about", () => {
	const scenes = [scene(1, [3, 7]), scene(2, [3, 7, 9]), scene(3, [3])]

	it("counts a scene whose cast the graph names nothing about", () => {
		expect(scenesNamingNone(scenes, edgedCastPairs([]))).toBe(2)
	})

	it("leaves out a scene once any pair in it is named", () => {
		expect(
			scenesNamingNone(scenes, edgedCastPairs([castEdge(1, 3, 7)]))
		).toBe(0)
	})

	it("says nothing about a scene with nobody to pair", () => {
		expect(scenesNamingNone([scene(4, [3])], edgedCastPairs([]))).toBe(0)
	})
})

describe("unnamedPairsFor — who the open member shares a room with, unnamed", () => {
	const scenes = [scene(1, [3, 7]), scene(2, [3, 7]), scene(3, [3, 9])]

	it("names the other member and every scene they share", () => {
		const pairs = unnamedPairsFor(3, scenes, edgedCastPairs([]))
		expect(pairs).toEqual([
			{ otherId: 7, sceneIds: [1, 2] },
			{ otherId: 9, sceneIds: [3] }
		])
	})

	it("drops a pair the graph already names", () => {
		expect(
			unnamedPairsFor(3, scenes, edgedCastPairs([castEdge(1, 3, 7)])).map(
				(p) => p.otherId
			)
		).toEqual([9])
	})

	it("has nothing to say about a member in no scene", () => {
		expect(unnamedPairsFor(99, scenes, edgedCastPairs([]))).toEqual([])
	})
})

describe("notDrawnSentence — the ask", () => {
	it("counts two scenes as twice", () => {
		expect(notDrawnSentence("Verity", "the Lamplighters' Guild", 2)).toBe(
			"A scene puts Verity and the Lamplighters' Guild in the same room twice without naming what passed between them. Read it and name one"
		)
	})

	it("says it plainly for a single scene", () => {
		expect(notDrawnSentence("Verity", "Marrow", 1)).toBe(
			"A scene puts Verity and Marrow in the same room without naming what passed between them. Read it and name one"
		)
	})

	it("counts beyond twice in figures", () => {
		expect(notDrawnSentence("Verity", "Marrow", 4)).toBe(
			"A scene puts Verity and Marrow in the same room 4 times without naming what passed between them. Read it and name one"
		)
	})
})
