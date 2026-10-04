import { describe, expect, test } from "vitest"
import { inPlayOrder } from "./sceneOrder"

describe("inPlayOrder — scenes as the story was played", () => {
	test("the scene played first comes first, whatever its id", () => {
		const scenes = [
			{ id: 1, selectedMessageIds: [40, 41] },
			{ id: 2, selectedMessageIds: [12] },
			{ id: 3, selectedMessageIds: [30, 29] }
		]
		expect(inPlayOrder(scenes).map((s) => s.id)).toEqual([2, 3, 1])
	})

	test("a scene with no messages keeps the place it was written in", () => {
		// Written: 2 (played at 90), 3 (no messages), 4 (played at 10), 5 (none).
		const scenes = [
			{ id: 5, selectedMessageIds: [] },
			{ id: 2, selectedMessageIds: [90] },
			{ id: 4, selectedMessageIds: [10] },
			{ id: 3, selectedMessageIds: null }
		]
		expect(inPlayOrder(scenes).map((s) => s.id)).toEqual([4, 3, 2, 5])
	})

	test("a copied message takes the place of the message it copies", () => {
		// Scene 10 over the parent's messages 3–4; scene 11 over the branch's
		// copies 5–6 of the parent's messages 1–2, so it was played first.
		const copyOf = new Map([
			[5, 1],
			[6, 2]
		])
		const scenes = [
			{ id: 10, selectedMessageIds: [3, 4] },
			{ id: 11, selectedMessageIds: [5, 6] }
		]
		expect(
			inPlayOrder(scenes, (id) => copyOf.get(id) ?? id).map((s) => s.id)
		).toEqual([11, 10])
	})

	test("scenes at one place keep the order they were written in", () => {
		const scenes = [
			{ id: 8, selectedMessageIds: [7] },
			{ id: 6, selectedMessageIds: [7, 9] }
		]
		expect(inPlayOrder(scenes).map((s) => s.id)).toEqual([6, 8])
	})
})
