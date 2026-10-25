/**
 * `start-history-entry` (W3) steps the lorebook on from the entry the
 * session reads now, on the session's line, through the page's
 * `entries:iterateNext`; refused, in words, with nothing to step from.
 */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import {
	answerStartHistoryEntry,
	type StartHistoryEntryDeps
} from "./startHistoryEntry"

const reading = (over: Partial<Sockets.Sessions.StoryClock.Response> = {}) => ({
	sessionId: 7,
	lorebookId: 4,
	branchId: 12,
	own: null,
	present: { year: 5 },
	linePresent: { year: 5 },
	calendar: null,
	isOwner: true,
	...over
})

function deps(
	over: Partial<StartHistoryEntryDeps> & {
		r?: ReturnType<typeof reading>
	} = {}
) {
	const started: unknown[] = []
	const d: StartHistoryEntryDeps = {
		sessionId: () => 7,
		readStoryClock: async () => over.r ?? reading(),
		readHistory: async () => [
			{ id: 1, year: 4, branchId: null },
			{ id: 2, year: 5, branchId: 12 }
		],
		readLines: async () => [{ id: 12, forkedFromBranchId: null }],
		sceneList: () => [],
		opensScenes: () => true,
		startNextEntry: async (ask) => {
			started.push(ask)
			return 99
		},
		...over
	}
	return { d, started }
}

describe("answerStartHistoryEntry", () => {
	test("steps on from Now, onto the session's line, and resolves with the new entry", async () => {
		const { d, started } = deps()
		await expect(answerStartHistoryEntry({}, d)).resolves.toEqual({
			entryId: 99
		})
		expect(started).toEqual([{ lorebookId: 4, id: 2, branchId: 12 }])
	})

	test("a session with no shared book and an own book starts the next entry in the own book", async () => {
		const { d, started } = deps({
			r: reading({ lorebookId: null, branchId: 12 }),
			ownBookId: () => 9
		})
		await expect(answerStartHistoryEntry({}, d)).resolves.toEqual({
			entryId: 99
		})
		expect(started).toEqual([{ lorebookId: 9, id: 1, branchId: null }])
	})

	test("refuses, in words and starting nothing: no book, not the owner, nothing to step from", async () => {
		for (const [r, why] of [
			[reading({ lorebookId: null }), /no lorebook/],
			[reading({ isOwner: false }), /only the lorebook's owner/],
			[
				reading({ present: { year: 1 } }),
				/no history entry to follow yet/
			]
		] as const) {
			const { d, started } = deps({ r: r as never })
			await expect(answerStartHistoryEntry({}, d)).rejects.toThrow(why)
			expect(started).toEqual([])
		}
	})

	test("core's widgets only", () => {
		expect(WIDGET_REQUEST_ASKERS["start-history-entry"]).toBe("core")
	})
})
