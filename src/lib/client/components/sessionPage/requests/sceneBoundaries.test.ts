/**
 * 🚧 The conversation's scene boundaries (live scenes §14 C): the page's
 * answers to `scene-open`, `scene-close`, `scene-move`, `scene-rename` and
 * `scene-remove` — refused in words where the host would refuse anyway,
 * sent for the page's own session otherwise, and *Remove boundary* asked
 * before anything goes.
 */
import { describe, expect, test } from "vitest"
import {
	answerSceneClose,
	answerSceneMove,
	answerSceneOpen,
	answerSceneRemove,
	answerSceneRename,
	type BoundaryScene,
	type SceneBoundaryDeps
} from "./sceneBoundaries"

const OPEN: BoundaryScene = { id: 11, sessionId: 7, channel: "main", openedAtMessageId: 5, closedAtMessageId: null }
const CLOSED: BoundaryScene = { id: 10, sessionId: 7, channel: "main", openedAtMessageId: 2, closedAtMessageId: 3 }
const PICKED: BoundaryScene = { id: 20, sessionId: 7, selectedMessageIds: [1] }

function page(over: Partial<SceneBoundaryDeps> & { confirm?: boolean } = {}) {
	const sent: Array<[string, ...unknown[]]> = []
	const deps: SceneBoundaryDeps = {
		sessionId: () => 7,
		sceneBoundaries: () => true,
		sceneList: () => [CLOSED, OPEN, PICKED, { id: 99, sessionId: 8, openedAtMessageId: 1 }],
		findMessage: (id) => (id === 40 ? { channel: "sanctum" } : { channel: "main" }),
		openScene: async (ask) => {
			sent.push(["open", ask])
			return { scene: { id: 12 } }
		},
		closeScene: async (ask) => {
			sent.push(["close", ask])
			return { scene: { id: ask.sceneId } }
		},
		moveSceneBoundary: async (ask) => {
			sent.push(["move", ask])
			return { scene: { id: ask.sceneId } }
		},
		renameScene: async (ask) => {
			sent.push(["rename", ask])
		},
		confirmRemoveScene: async (scene, into) => {
			sent.push(["confirm", scene.id, into?.id ?? null])
			return over.confirm ?? true
		},
		deleteScene: async (id) => {
			sent.push(["delete", id])
		},
		mergeScene: async (ask) => {
			sent.push(["merge", ask])
			return { scene: { id: 10 } }
		},
		...over
	}
	return { deps, sent }
}

describe("scene-open (Start scene here)", () => {
	test("opens a scene at the line, on the line's own lane, for the page's session", async () => {
		const { deps, sent } = page()
		expect(await answerSceneOpen({ messageId: 9 }, deps)).toEqual({ sceneId: 12 })
		expect(await answerSceneOpen({ messageId: 40 }, deps)).toEqual({ sceneId: 12 })
		expect(await answerSceneOpen({ messageId: 9, channel: "phone:2" }, deps)).toEqual({ sceneId: 12 })
		expect(sent).toEqual([
			["open", { sessionId: 7, channel: "main", atMessageId: 9 }],
			["open", { sessionId: 7, channel: "sanctum", atMessageId: 40 }],
			["open", { sessionId: 7, channel: "phone:2", atMessageId: 9 }]
		])
	})

	test("refuses, in words and sending nothing, a viewer who may not place boundaries or a line not named", async () => {
		const guest = page({ sceneBoundaries: () => false })
		await expect(answerSceneOpen({ messageId: 9 }, guest.deps)).rejects.toThrow(/only the session's owner/)
		const { deps, sent } = page()
		await expect(answerSceneOpen({}, deps)).rejects.toThrow("say which line the scene starts at")
		await expect(answerSceneOpen({ messageId: "9" }, deps)).rejects.toThrow("messageId must be a message id")
		expect([...guest.sent, ...sent]).toEqual([])
	})

	test("closeAt opens it closed over the run, in one write (Mark as scene, lane E)", async () => {
		const { deps, sent } = page()
		expect(await answerSceneOpen({ messageId: 4, closeAt: 6 }, deps)).toEqual({ sceneId: 12 })
		await expect(answerSceneOpen({ messageId: 6, closeAt: 4 }, deps)).rejects.toThrow(
			"a scene cannot end before the line it starts at"
		)
		await expect(answerSceneOpen({ messageId: 4, closeAt: "6" }, deps)).rejects.toThrow(
			"closeAt must be a message id"
		)
		expect(sent).toEqual([["open", { sessionId: 7, channel: "main", atMessageId: 4, closeAt: 6 }]])
	})

	test("the server's refusal is the widget's rejection", async () => {
		const { deps } = page({
			openScene: async () => {
				throw new Error("That would overlap Scene 2. A message belongs to one scene.")
			}
		})
		await expect(answerSceneOpen({ messageId: 3 }, deps)).rejects.toThrow(/overlap Scene 2/)
	})
})

describe("scene-close (End scene here)", () => {
	test("ends the open scene at the line, or at its lane's newest line", async () => {
		const { deps, sent } = page()
		expect(await answerSceneClose({ sceneId: 11, messageId: 8 }, deps)).toEqual({ sceneId: 11 })
		expect(await answerSceneClose({ sceneId: 11 }, deps)).toEqual({ sceneId: 11 })
		expect(sent).toEqual([
			["close", { sessionId: 7, sceneId: 11, atMessageId: 8 }],
			["close", { sessionId: 7, sceneId: 11 }]
		])
	})

	test("refuses a closed scene, a captured one and another session's, sending nothing", async () => {
		const { deps, sent } = page()
		await expect(answerSceneClose({ sceneId: 10 }, deps)).rejects.toThrow("that scene is already closed")
		await expect(answerSceneClose({ sceneId: 20 }, deps)).rejects.toThrow(/captured by selection/)
		await expect(answerSceneClose({ sceneId: 99 }, deps)).rejects.toThrow("that scene is not one of this session's")
		expect(sent).toEqual([])
	})
})

describe("scene-move", () => {
	test("moves a live scene's opening, and a closed one's end", async () => {
		const { deps, sent } = page()
		await answerSceneMove({ sceneId: 11, openedAt: 4 }, deps)
		await answerSceneMove({ sceneId: 10, closedAt: 4 }, deps)
		expect(sent).toEqual([
			["move", { sessionId: 7, sceneId: 11, openedAt: 4 }],
			["move", { sessionId: 7, sceneId: 10, closedAt: 4 }]
		])
	})

	test("closedAt: null reopens a closed scene (lane E); an open one is refused", async () => {
		const { deps, sent } = page()
		await answerSceneMove({ sceneId: 10, closedAt: null }, deps)
		await expect(answerSceneMove({ sceneId: 11, closedAt: null }, deps)).rejects.toThrow(
			"that scene is already open"
		)
		expect(sent).toEqual([["move", { sessionId: 7, sceneId: 10, closedAt: null }]])
	})

	test("refuses an open scene's end, a captured scene and a move to nowhere", async () => {
		const { deps, sent } = page()
		await expect(answerSceneMove({ sceneId: 11, closedAt: 9 }, deps)).rejects.toThrow(/still open/)
		await expect(answerSceneMove({ sceneId: 20, openedAt: 1 }, deps)).rejects.toThrow(/captured by selection/)
		await expect(answerSceneMove({ sceneId: 11 }, deps)).rejects.toThrow(/say which boundary moves/)
		expect(sent).toEqual([])
	})
})

describe("scene-rename (a divider's name)", () => {
	test("saves the trimmed name; a blank one clears it", async () => {
		const { deps, sent } = page()
		await answerSceneRename({ sceneId: 10, name: "  The cellar  " }, deps)
		await answerSceneRename({ sceneId: 20, name: "   " }, deps)
		await answerSceneRename({ sceneId: 11, name: null }, deps)
		expect(sent).toEqual([
			["rename", { sceneId: 10, name: "The cellar" }],
			["rename", { sceneId: 20, name: null }],
			["rename", { sceneId: 11, name: null }]
		])
	})

	test("refuses a name that is not text, and a viewer who may not", async () => {
		const { deps } = page()
		await expect(answerSceneRename({ sceneId: 10, name: 4 }, deps)).rejects.toThrow(/takes a name/)
		await expect(
			answerSceneRename({ sceneId: 10, name: "x" }, page({ sceneBoundaries: () => false }).deps)
		).rejects.toThrow(/only the session's owner/)
	})
})

describe("scene-remove (Remove boundary)", () => {
	test("asks first; the lane's first scene is deleted on yes, kept on no", async () => {
		const yes = page()
		expect(await answerSceneRemove({ sceneId: 10 }, yes.deps)).toEqual({ removed: true })
		expect(yes.sent).toEqual([
			["confirm", 10, null],
			["delete", 10]
		])
		const no = page({ confirm: false })
		expect(await answerSceneRemove({ sceneId: 10 }, no.deps)).toEqual({ removed: false })
		expect(no.sent).toEqual([["confirm", 10, null]])
	})

	test("a scene with one before it on its lane joins that one (lane E)", async () => {
		const { deps, sent } = page()
		expect(await answerSceneRemove({ sceneId: 11 }, deps)).toEqual({ removed: true, mergedInto: 10 })
		expect(sent).toEqual([
			["confirm", 11, 10],
			["merge", { sessionId: 7, sceneId: 11 }]
		])
		// Another lane's scene is not before it.
		const lanes = page({
			sceneList: () => [CLOSED, { ...OPEN, channel: "sanctum" }]
		})
		expect(await answerSceneRemove({ sceneId: 11 }, lanes.deps)).toEqual({ removed: true })
		expect(lanes.sent.at(-1)).toEqual(["delete", 11])
	})

	test("a captured scene has no boundary to remove: refused, nothing asked", async () => {
		const { deps, sent } = page()
		await expect(answerSceneRemove({ sceneId: 20 }, deps)).rejects.toThrow(/no boundary to remove/)
		expect(sent).toEqual([])
	})
})
