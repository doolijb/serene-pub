/**
 * 🚧 Live scenes as the conversation's dossier tells them (§14 C): a scene
 * row's lane, boundaries, clocks and summary state reach the widget; the
 * scene-boundaries verdict mirrors the server's refusals; a tick selection
 * may not take a line inside a live range, the open scene's included.
 */
import { describe, expect, test } from "vitest"
import {
	capturedLineIds,
	conversationSceneOf,
	removeSceneBody,
	sceneBefore,
	sceneBoundariesFor,
	type LiveSceneRow
} from "./liveSceneProjection"

const base: LiveSceneRow = {
	id: 4,
	name: "Scene 2",
	lorebookId: 9,
	historyEntryId: 30,
	selectedMessageIds: [12, 13],
	historyEntry: { id: 30, year: 1, month: 3, day: 12, isCompleted: false }
}

describe("conversationSceneOf", () => {
	test("a live scene carries its lane, its boundaries, both clocks and its summary state", () => {
		expect(
			conversationSceneOf({
				...base,
				channel: "main:1",
				openedAtMessageId: 12,
				closedAtMessageId: 13,
				openedStoryClockYear: 1,
				openedStoryClockMonth: 3,
				openedStoryClockDay: 12,
				openedStoryClockHour: 9,
				openedStoryClockMinute: 0,
				closedStoryClockYear: 1,
				closedStoryClockMonth: 3,
				closedStoryClockDay: 12,
				summaryStatus: "done"
			})
		).toEqual({
			id: 4,
			name: "Scene 2",
			lorebookId: 9,
			historyEntryId: 30,
			selectedMessageIds: [12, 13],
			historyEntry: { id: 30, year: 1, month: 3, day: 12, isCompleted: false, nextEntry: null },
			channel: "main",
			openedAtMessageId: 12,
			closedAtMessageId: 13,
			openedAt: { year: 1, month: 3, day: 12, hour: 9, minute: 0 },
			closedAt: { year: 1, month: 3, day: 12, hour: null, minute: null },
			summaryStatus: "done",
			hasSummary: false
		})
	})

	test("lane E: summary text is said, and the cast is named only when the page can name it", () => {
		const row: LiveSceneRow = {
			...base,
			openedAtMessageId: 12,
			summary: "They met.",
			participantCharacters: [5, 6]
		}
		expect(conversationSceneOf(row).hasSummary).toBe(true)
		expect("cast" in conversationSceneOf(row)).toBe(false)
		const named = conversationSceneOf(row, (ids) =>
			ids.map((id) => ({ ref: `character:${id}`, name: `N${id}`, face: null }))
		)
		expect(named.cast).toEqual([
			{ ref: "character:5", name: "N5", face: null },
			{ ref: "character:6", name: "N6", face: null }
		])
		// A page that cannot name them (a guest's) sends none.
		expect("cast" in conversationSceneOf(row, () => null)).toBe(false)
		expect(conversationSceneOf({ ...row, summary: "  " }).hasSummary).toBe(false)
	})

	test("a scene captured by selection has no boundaries or clocks; an unknown summary state is left out", () => {
		const scene = conversationSceneOf({ ...base, summaryStatus: "weird" })
		expect(scene.openedAtMessageId).toBeNull()
		expect(scene.closedAtMessageId).toBeNull()
		expect(scene.openedAt).toBeNull()
		expect(scene.channel).toBe("main")
		expect("summaryStatus" in scene).toBe(false)
		// 🚧 §15 G8: `review` is a summary state the divider draws.
		expect(conversationSceneOf({ ...base, summaryStatus: "review" }).summaryStatus).toBe("review")
	})
})

describe("sceneBoundariesFor", () => {
	const yes = { isOwner: true, readsLorebook: true, opensScenes: true, loreWritesOff: false }
	test("the owner of a session reading a lorebook, in a genre that writes scenes, with lore writes on", () => {
		expect(sceneBoundariesFor(yes)).toBe(true)
	})
	test("any one of the server's refusals hides the boundaries", () => {
		expect(sceneBoundariesFor({ ...yes, isOwner: false })).toBe(false)
		expect(sceneBoundariesFor({ ...yes, readsLorebook: false })).toBe(false)
		expect(sceneBoundariesFor({ ...yes, opensScenes: false })).toBe(false)
		expect(sceneBoundariesFor({ ...yes, loreWritesOff: true })).toBe(false)
	})
})

describe("capturedLineIds", () => {
	const messages = [
		{ id: 1, channel: "main" },
		{ id: 2, channel: "main" },
		{ id: 3, channel: "sanctum" },
		{ id: 4, channel: "main" },
		{ id: 5, channel: null }
	]
	test("adds every loaded line of a live range on its lane, the open scene's included", () => {
		const open: LiveSceneRow = { ...base, id: 7, selectedMessageIds: [], channel: "main", openedAtMessageId: 4, closedAtMessageId: null }
		const closed: LiveSceneRow = { ...base, id: 6, selectedMessageIds: [1], channel: "main", openedAtMessageId: 1, closedAtMessageId: 2 }
		expect(capturedLineIds([1], [closed, open], messages).sort()).toEqual([1, 2, 4, 5])
	})
	test("with no live scene, the server's answer alone", () => {
		expect(capturedLineIds(new Set([3]), [base], messages)).toEqual([3])
	})
})

describe("sceneBefore (lane E)", () => {
	const s = (id: number, opened: number | null, channel = "main") =>
		({ id, channel, openedAtMessageId: opened }) as const
	test("the live scene before it on its lane, or null for the lane's first", () => {
		const list = [s(1, 2), s(2, 5), s(3, 8), s(4, 6, "sanctum"), s(5, null)]
		expect(sceneBefore(list[2], list)?.id).toBe(2)
		expect(sceneBefore(list[1], list)?.id).toBe(1)
		expect(sceneBefore(list[0], list)).toBeNull()
		expect(sceneBefore(list[3], list)).toBeNull()
		expect(sceneBefore(list[4], list)).toBeNull()
	})
})

describe("removeSceneBody", () => {
	test("lane E: joining the scene before says where the lines go and what of each summary", () => {
		expect(
			removeSceneBody(
				{ name: "The cellar", summarized: true },
				{ name: "The inn", summarized: true }
			)
		).toBe(
			"“The cellar” joins “The inn”: its lines stay in the conversation, now in “The inn”. Its own summary leaves the lorebook. The summary of “The inn” is kept, marked out of date."
		)
		expect(
			removeSceneBody({ name: null, summarized: false }, { name: null, summarized: false })
		).toBe(
			"This scene joins the scene before it: its lines stay in the conversation, now in the scene before it. The scene before it has no summary yet."
		)
	})

	test("says what goes and what stays", () => {
		expect(removeSceneBody({ name: "The cellar", summarized: true })).toBe(
			"“The cellar” stops being a scene: its lines stay in the conversation, outside any scene. The scene leaves the lorebook, with its summary."
		)
		expect(removeSceneBody({ name: null, summarized: false })).toMatch(/^This scene stops being a scene/)
	})
})
