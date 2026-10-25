/**
 * `history-entries` (W3) answers the Chronicle off what already exists: the
 * clock's read (anyone in the session), the book's history and lines (its
 * owner's), the page's scene list. Now is the newest dated entry on the
 * session's line up to where it stands; Earlier the rest, newest first; a
 * guest reads the clock alone.
 */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import {
	answerHistoryEntries,
	awaitsSummary,
	firstLineOf,
	summaryStatusOf,
	throughLabelOf,
	type HistoryEntriesDeps,
	type HistoryRow,
	type SceneRow
} from "./historyEntries"

type Reading = Sockets.Sessions.StoryClock.Response
const clock = (
	year: number,
	month: number | null = null,
	day: number | null = null
) => ({
	year,
	month,
	day,
	hour: null,
	minute: null
})

const OWNER_READING: Reading = {
	sessionId: 7,
	lorebookId: 4,
	branchId: null,
	own: null,
	present: clock(3, 2, 1),
	linePresent: clock(3, 2, 1),
	calendar: null,
	isOwner: true
}

const ROWS: HistoryRow[] = [
	{
		id: 1,
		year: 1,
		month: 1,
		day: 1,
		content: "The founding.\nMore.",
		branchId: null
	},
	{ id: 2, year: 2, month: 6, day: 1, content: "", branchId: null },
	{
		id: 3,
		year: 3,
		month: 2,
		day: 1,
		content: "\n  The duel at dawn  ",
		branchId: null
	},
	// After the present: has not happened yet for this session.
	{ id: 4, year: 9, month: 1, day: 1, content: "Later.", branchId: null },
	// Another line's: not this session's.
	{ id: 5, year: 3, month: 1, day: 1, content: "Elsewhere.", branchId: 77 },
	// Undated: a loose end, not a moment.
	{ id: 6, year: null, content: "Someday." }
]

const SCENES: SceneRow[] = [
	{
		id: 11,
		sessionId: 7,
		historyEntryId: 3,
		name: "Second",
		selectedMessageIds: [40, 41],
		summary: "s",
		graphed: false,
		branchId: null
	},
	{
		id: 10,
		sessionId: 7,
		historyEntryId: 3,
		name: "First",
		selectedMessageIds: [30],
		summary: "",
		graphed: false,
		branchId: null
	},
	{
		id: 9,
		sessionId: 7,
		historyEntryId: 1,
		name: "Old",
		selectedMessageIds: [5, 6],
		summary: "s",
		graphed: true,
		branchId: null
	}
]

function deps(over: Partial<HistoryEntriesDeps> & { reading?: Reading } = {}) {
	const asked: string[] = []
	const noted: unknown[] = []
	const d: HistoryEntriesDeps = {
		sessionId: () => 7,
		readStoryClock: async (ask) => {
			asked.push(`clock ${ask.sessionId}`)
			return over.reading ?? OWNER_READING
		},
		readHistory: async (book) => {
			asked.push(`history ${book}`)
			return ROWS
		},
		readLines: async (book) => {
			asked.push(`lines ${book}`)
			return []
		},
		sceneList: () => SCENES,
		opensScenes: () => true,
		noteStoryClock: (own) => noted.push(own),
		...over
	}
	return { d, asked, noted }
}

describe("answerHistoryEntries", () => {
	test("Now is the newest entry on the line up to the present; its scenes oldest first; Earlier newest first", async () => {
		const { d, asked, noted } = deps()
		const out = await answerHistoryEntries({}, d)
		expect(asked).toEqual(["clock 7", "history 4", "lines 4"])
		expect(noted).toEqual([null])
		expect(out.lorebookId).toBe(4)
		expect(out.ownerOnly).toBe(false)
		expect(out.clock).toMatchObject({
			own: false,
			behind: false,
			present: { year: 3, month: 2, day: 1 }
		})
		expect(out.current).toMatchObject({
			id: 3,
			date: { year: 3, month: 2, day: 1 },
			firstLine: "The duel at dawn",
			sceneCount: 2
		})
		expect(
			out.scenes.map((s) => [
				s.id,
				s.name,
				s.lineCount,
				s.order,
				s.summarized
			])
		).toEqual([
			[10, "First", 1, 1, false],
			[11, "Second", 2, 2, true]
		])
		expect(
			out.earlier.map((e) => [e.id, e.firstLine, e.sceneCount])
		).toEqual([
			[2, "", 0],
			[1, "The founding.", 1]
		])
		expect(out.earlierTotal).toBe(2)
		// Two of this session's scenes on main are not graphed yet.
		expect(out.ungraphedScenes).toBe(2)
		expect(out.opensScenes).toBe(true)
	})

	test("an own clock reads up to itself: an entry after it has not happened yet", async () => {
		const { d } = deps({
			reading: {
				...OWNER_READING,
				own: clock(2, 7),
				present: clock(2, 7)
			}
		})
		const out = await answerHistoryEntries({ earlierLimit: 0 }, d)
		expect(out.current?.id).toBe(2)
		expect(out.clock.own).toBe(true)
		expect(out.clock.behind).toBe(true)
		expect(out.earlier).toEqual([])
		expect(out.earlierTotal).toBe(1)
	})

	test("a guest reads the clock alone — the book's history is never asked", async () => {
		const { d, asked } = deps({
			reading: { ...OWNER_READING, isOwner: false }
		})
		const out = await answerHistoryEntries({}, d)
		expect(asked).toEqual(["clock 7"])
		expect(out.ownerOnly).toBe(true)
		expect(out.clock.label).toContain("3")
		expect([
			out.current,
			out.scenes,
			out.earlier,
			out.ungraphedScenes
		]).toEqual([null, [], [], 0])
	})

	test("no lorebook: lorebookId null and nothing else asked", async () => {
		const { d, asked } = deps({
			reading: {
				sessionId: 7,
				lorebookId: null,
				branchId: null,
				own: null,
				present: null,
				linePresent: null,
				calendar: null,
				isOwner: true
			}
		})
		const out = await answerHistoryEntries({}, d)
		expect(out.lorebookId).toBeNull()
		expect(asked).toEqual(["clock 7"])
	})

	test("refuses, in words: a bad earlierLimit, no session, the server's own refusal", async () => {
		await expect(
			answerHistoryEntries({ earlierLimit: -1 }, deps().d)
		).rejects.toThrow(/earlierLimit/)
		await expect(
			answerHistoryEntries({}, deps({ sessionId: () => null }).d)
		).rejects.toThrow(/no session/)
		await expect(
			answerHistoryEntries(
				{},
				deps({
					reading: {
						sessionId: 7,
						error: "This session is not one you are in."
					}
				}).d
			)
		).rejects.toThrow("This session is not one you are in.")
	})

	test("the read is the lore scope's", () => {
		expect(WIDGET_REQUEST_ASKERS["history-entries"]).toEqual({
			scope: "lore"
		})
	})
})

describe("🚧 live scenes (§7, lane D): the open scene and the summaries", () => {
	const LIVE: SceneRow[] = [
		{
			id: 20,
			sessionId: 7,
			historyEntryId: 3,
			name: "Scene 1",
			selectedMessageIds: [50, 51],
			summary: null,
			graphed: false,
			branchId: null,
			openedAtMessageId: 50,
			closedAtMessageId: 51,
			summaryStatus: "failed"
		},
		{
			id: 21,
			sessionId: 7,
			historyEntryId: 3,
			name: "Scene 2",
			selectedMessageIds: [],
			summary: null,
			graphed: false,
			branchId: null,
			openedAtMessageId: 60,
			closedAtMessageId: null,
			summaryStatus: "none"
		},
		{
			id: 22,
			sessionId: 7,
			historyEntryId: 3,
			name: "Old capture",
			selectedMessageIds: [10],
			summary: "Written before the status existed.",
			graphed: true,
			branchId: null,
			summaryStatus: "none"
		}
	]
	const openScenes = async (): Promise<Sockets.Scenes.OpenScenes.Response> => ({
		sessionId: 7,
		scenes: [
			{
				id: 21,
				name: "Scene 2",
				channel: "main",
				openedAtMessageId: 60,
				since: "Day 1",
				lineCount: 4,
				cast: [{ name: "Vell", evidence: "spoke 2 times" }]
			}
		],
		settings: {
			mode: "suggested",
			triggers: {
				dayCrossed: true,
				timeAction: true,
				placeChanged: true,
				narration: false,
				length: null,
				pause: null
			},
			summary: "onClose"
		}
	})

	test("the open scene's card off the fresh read; each row's summary state; how many await a summary", async () => {
		const { d } = deps({ sceneList: () => LIVE, readOpenScenes: openScenes })
		const out = await answerHistoryEntries({}, d)
		expect(out.openScene).toEqual({
			id: 21,
			name: "Scene 2",
			channel: "main",
			since: "Day 1",
			lineCount: 4,
			order: 2,
			cast: [{ name: "Vell", evidence: "spoke 2 times" }]
		})
		expect(out.summaryMode).toBe("onClose")
		expect(out.scenes.map((s) => [s.id, s.lineCount, s.summaryStatus])).toEqual([
			[22, 1, "done"],
			[20, 2, "failed"],
			[21, 4, "none"]
		])
		// The failed one; never the open one; never one already written.
		expect(out.unsummarizedScenes).toBe(1)
	})

	test("a live scene's moved boundary leaves its text out of date: the dot reads none and Summarize all counts it", async () => {
		// `scenes:moveBoundary` / `:merge` keep the text and set `none`.
		const moved: SceneRow = {
			id: 23,
			sessionId: 7,
			historyEntryId: 3,
			name: "Scene 0",
			selectedMessageIds: [40, 41, 42],
			summary: "Summarized before the boundary moved.",
			graphed: false,
			branchId: null,
			openedAtMessageId: 40,
			closedAtMessageId: 42,
			summaryStatus: "none"
		}
		expect(summaryStatusOf(moved)).toBe("none")
		expect(awaitsSummary(moved)).toBe(true)
		const { d } = deps({ sceneList: () => [...LIVE, moved], readOpenScenes: openScenes })
		const out = await answerHistoryEntries({}, d)
		expect(out.scenes.find((s) => s.id === 23)!.summaryStatus).toBe("none")
		// Scene 1 (failed) and this one; never the open scene, never the old capture.
		expect(out.unsummarizedScenes).toBe(2)
	})

	test("summaryStatusOf: a selection capture's text predates the status and reads done; a live scene's status stands", () => {
		const text = "A summary."
		// Captured by selection (no opening line): text with `none` is `done`.
		expect(summaryStatusOf({ summary: text, summaryStatus: "none", openedAtMessageId: null })).toBe("done")
		expect(summaryStatusOf({ summary: text, summaryStatus: "none" })).toBe("done")
		expect(summaryStatusOf({ summary: text, summaryStatus: null })).toBe("done")
		expect(summaryStatusOf({ summary: "  ", summaryStatus: "none", openedAtMessageId: null })).toBe("none")
		// Live: `none` is `none` whatever text it kept; the others read as they are.
		expect(summaryStatusOf({ summary: text, summaryStatus: "none", openedAtMessageId: 5 })).toBe("none")
		expect(summaryStatusOf({ summary: text, summaryStatus: "done", openedAtMessageId: 5 })).toBe("done")
		expect(summaryStatusOf({ summary: text, summaryStatus: "running", openedAtMessageId: 5 })).toBe("running")
		expect(summaryStatusOf({ summary: null, summaryStatus: "failed", openedAtMessageId: 5 })).toBe("failed")
		// 🚧 §15 G8: a finished run waiting for the person reads `review`, its
		// old text or none, and is not counted by *Summarize all*.
		expect(summaryStatusOf({ summary: text, summaryStatus: "review", openedAtMessageId: null })).toBe("review")
		expect(summaryStatusOf({ summary: null, summaryStatus: "review", openedAtMessageId: 5 })).toBe("review")
		expect(
			awaitsSummary({ id: 2, summary: null, summaryStatus: "review", openedAtMessageId: 5, closedAtMessageId: 7 })
		).toBe(false)
		// The open scene never awaits a summary, stale text or not.
		expect(
			awaitsSummary({ id: 1, summary: text, summaryStatus: "none", openedAtMessageId: 5, closedAtMessageId: null })
		).toBe(false)
	})

	test("no read of the open scene (an older page): no card, summaries as on request", async () => {
		const { d } = deps({ sceneList: () => LIVE })
		const out = await answerHistoryEntries({}, d)
		expect(out.openScene).toBeNull()
		expect(out.summaryMode).toBeUndefined()
	})

	test("a guest reads the clock alone: the open scene is never asked", async () => {
		let asked = 0
		const { d } = deps({
			reading: { ...OWNER_READING, isOwner: false },
			readOpenScenes: async () => {
				asked++
				return openScenes()
			}
		})
		const out = await answerHistoryEntries({}, d)
		expect(out.ownerOnly).toBe(true)
		expect(asked).toBe(0)
	})
})

describe("firstLineOf", () => {
	test("the first written line, trimmed and cut", () => {
		expect(firstLineOf("\n\n  hello  \nworld")).toBe("hello")
		expect(firstLineOf(null)).toBe("")
		expect(firstLineOf("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`)
	})
})

describe("🚧 pr-6s2: the own book and what a summary was written from", () => {
	const NO_BOOK: Reading = {
		...OWNER_READING,
		lorebookId: null,
		branchId: 2,
		present: null,
		linePresent: null
	}

	test("no shared lorebook, an own book: its history and lines are read, on the main line", async () => {
		const { d, asked } = deps({ reading: NO_BOOK, ownBookId: () => 9 })
		const out = await answerHistoryEntries({}, d)
		expect(out.lorebookId).toBe(9)
		expect(asked).toContain("history 9")
		expect(asked).toContain("lines 9")
	})

	test("no shared lorebook and no own book: the empty, no-book state", async () => {
		const { d, asked } = deps({ reading: NO_BOOK })
		const out = await answerHistoryEntries({}, d)
		expect(out.lorebookId).toBeNull()
		expect(asked).toEqual(["clock 7"])
	})

	test("a scene's loreSources answer with a spelled label; unknown time is empty", async () => {
		const withSources = (throughAt: string | null): SceneRow[] =>
			SCENES.map((s) =>
				s.id === 11
					? {
							...s,
							loreSources: { fromMessageId: 3, throughMessageId: 8, throughAt }
						}
					: s
			)
		const a = await answerHistoryEntries(
			{},
			deps({ sceneList: () => withSources("2026-10-03T14:20:00.000Z") }).d
		)
		const first = a.scenes.find((s) => s.id === 11)!
		expect(first.loreSources?.fromMessageId).toBe(3)
		expect(first.loreSources?.throughMessageId).toBe(8)
		expect(first.loreSources?.throughLabel).not.toBe("")
		expect(a.scenes.find((s) => s.id === 10)!.loreSources).toBeUndefined()
		const b = await answerHistoryEntries(
			{},
			deps({ sceneList: () => withSources(null) }).d
		)
		expect(b.scenes.find((s) => s.id === 11)!.loreSources?.throughLabel).toBe("")
	})

	test("throughLabelOf: null is empty", () => {
		expect(throughLabelOf(null)).toBe("")
	})
})
