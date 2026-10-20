/**
 * The waiting row's rule (`pendingReply.ts`; owner 2026-10-15, Dungeon
 * Crawler: "I'm not seeing the visual feedback that a message is being
 * processed, like in the chat genre").
 */
import { describe, expect, it } from "vitest"
import {
	isPendingReplyRow,
	openedReplyRuns,
	pendingReplyRows,
	type ReplyRunStatus
} from "./pendingReply"

const thinking = { i18n: { en: "The Planner is thinking" } }
const run = (runId: string, channel = "main", status: ReplyRunStatus["status"] = thinking): ReplyRunStatus => ({
	runId,
	status,
	channel
})

describe("pendingReplyRows", () => {
	it("a reply with a status and no row open yet: one generating row of the page's own, after the session's", () => {
		const rows = pendingReplyRows(7, [run("r1")], [{ id: 10, channel: null, isGenerating: false }], new Set())
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			id: -1,
			sessionId: 7,
			channel: "main",
			role: "assistant",
			content: "",
			isGenerating: true,
			generationStatus: thinking,
			isNarratorResponse: true
		})
		expect(isPendingReplyRow(rows[0] as any)).toBe(true)
		expect(isPendingReplyRow({ id: 10, metadata: {} })).toBe(false)
	})

	it("none once the reply's own row is generating on its channel — Chat's placeholder, the Narrator's row", () => {
		expect(pendingReplyRows(7, [run("r1")], [{ id: 11, channel: "main", isGenerating: true }], new Set())).toEqual([])
		// `main` unsaid on a row is `main`.
		expect(pendingReplyRows(7, [run("r1")], [{ id: 11, isGenerating: true }], new Set())).toEqual([])
	})

	it("none for a run whose row has opened before — still filing its books after the Narrator finished", () => {
		expect(pendingReplyRows(7, [run("r1")], [{ id: 11, isGenerating: false }], new Set(["r1"]))).toEqual([])
	})

	it("a generating row on ANOTHER channel does not count: the Story waits while a Planner lane streams", () => {
		const rows = pendingReplyRows(7, [run("r1")], [{ id: 12, channel: "parley", isGenerating: true }], new Set())
		expect(rows.map((r) => r.channel)).toEqual(["main"])
	})

	it("one per channel, in the order the runs started", () => {
		const rows = pendingReplyRows(7, [run("r1"), run("r2"), run("r3", "parley:2")], [], new Set())
		expect(rows.map((r) => [r.id, r.channel])).toEqual([
			[-1, "main"],
			[-2, "parley:2"]
		])
	})
})

describe("openedReplyRuns", () => {
	it("the runs with a generating row on their channel", () => {
		expect(
			openedReplyRuns([run("r1"), run("r2", "parley")], [{ id: 3, channel: "parley", isGenerating: true }])
		).toEqual(["r2"])
	})
})
