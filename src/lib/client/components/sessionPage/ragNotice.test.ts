/**
 * The indexing notice's words and presses (less-confusing H1/H2): one word per
 * concept (Search by meaning · indexed · needs re-indexing), and the press it
 * offers is the one its sentence names.
 */
import { describe, expect, it } from "vitest"
import {
	markNoticeRead,
	noticeRead,
	RETRIEVAL_NOTICE_READ_KEY,
	ragNoticeActions,
	ragNoticeSentence,
	ragNoticeVariant,
	SEARCH_BY_MEANING_SETUP_HREF,
	type RagNoticeVariant
} from "./ragNotice"

const counts = (total: number, nullCount: number, staleCount = 0) => ({
	total,
	nullCount,
	staleCount,
	readyCount: total - nullCount - staleCount
})

const facts = {
	modelName: "bge-small",
	readyCount: 12,
	total: 40,
	queueRunning: true
}

describe("ragNoticeVariant", () => {
	it("has nothing to say without a lorebook, over an empty one, or once all is indexed", () => {
		expect(ragNoticeVariant(null)).toBeNull()
		expect(ragNoticeVariant(counts(0, 0))).toBeNull()
		expect(ragNoticeVariant(counts(5, 0))).toBeNull()
	})

	it("reads not indexed, needs re-indexing and part way", () => {
		expect(ragNoticeVariant(counts(4, 4))).toBe("none")
		expect(ragNoticeVariant(counts(5, 0, 5))).toBe("stale")
		expect(ragNoticeVariant(counts(5, 0, 2))).toBe("stale")
		expect(ragNoticeVariant(counts(40, 28))).toBe("processing")
		expect(ragNoticeVariant(counts(6, 2, 2))).toBe("processing")
	})
})

describe("ragNoticeSentence", () => {
	it("says indexed, never vectors, embedded or RAG", () => {
		for (const variant of ["none", "stale", "processing"] as const) {
			for (const queueRunning of [true, false]) {
				const s = ragNoticeSentence(variant, { ...facts, queueRunning })
				expect(s).not.toMatch(/vector|embedd|\bRAG\b/i)
			}
		}
	})

	it("names the model a stale lorebook needs re-indexing with", () => {
		expect(ragNoticeSentence("stale", facts)).toBe(
			"Lorebook entries were indexed with a different model and need re-indexing with bge-small."
		)
		expect(
			ragNoticeSentence("stale", { ...facts, modelName: null })
		).toMatch(/with the current model\.$/)
	})

	it("counts while indexing, and says the rest are waiting when the queue is idle", () => {
		expect(ragNoticeSentence("processing", facts)).toBe(
			"Indexing 12 of 40 lorebook entries."
		)
		expect(
			ragNoticeSentence("processing", { ...facts, queueRunning: false })
		).toBe(
			"12 of 40 lorebook entries are indexed. The rest are waiting to be indexed."
		)
	})

	it("says Search by meaning can't find entries that aren't indexed", () => {
		expect(ragNoticeSentence("none", facts)).toBe(
			"Lorebook entries aren't indexed yet, so Search by meaning can't find them."
		)
	})
})

describe("ragNoticeActions", () => {
	it("offers Re-index now when the lorebook needs re-indexing", () => {
		const actions = ragNoticeActions("stale", true)
		expect(actions.map((a) => a.label)).toEqual(["Re-index now"])
		expect(actions[0].kind).toBe("queue")
	})

	it("offers the setup link to Admin › Models › Loadouts when nothing is indexed", () => {
		const actions = ragNoticeActions("none", true)
		const link = actions.find((a) => a.kind === "link")
		expect(link?.label).toBe("Set up search by meaning")
		expect(link && "href" in link ? link.href : null).toBe(
			SEARCH_BY_MEANING_SETUP_HREF
		)
		expect(SEARCH_BY_MEANING_SETUP_HREF).toBe("/admin/defaults")
	})

	it("offers Prioritize in queue while indexing is part way", () => {
		expect(
			ragNoticeActions("processing", true).map((a) => a.label)
		).toEqual(["Prioritize in queue"])
	})

	it("offers a member nothing to press: the queue and Admin are an administrator's", () => {
		for (const variant of [
			"none",
			"stale",
			"processing"
		] as RagNoticeVariant[])
			expect(ragNoticeActions(variant, false)).toEqual([])
	})
})

/**
 * Once a session, then an icon (polish parity L1): this device remembers the
 * sessions whose notice it has shown. A convenience — a store that fails or
 * holds rubbish reads as "not shown", so the line shows.
 */
describe("the notice's read mark", () => {
	const store = () => {
		const m = new Map<string, string>()
		return {
			getItem: (k: string) => m.get(k) ?? null,
			setItem: (k: string, v: string) => void m.set(k, v),
			m
		}
	}

	it("is unread until marked, per session", () => {
		const s = store()
		expect(noticeRead(7, s)).toBe(false)
		markNoticeRead(7, s)
		expect(noticeRead(7, s)).toBe(true)
		expect(noticeRead(8, s)).toBe(false)
	})

	it("keeps one entry per session, newest last, at most 200", () => {
		const s = store()
		for (let i = 0; i < 205; i++) markNoticeRead(i, s)
		markNoticeRead(10, s)
		const ids = JSON.parse(s.m.get(RETRIEVAL_NOTICE_READ_KEY)!)
		expect(ids).toHaveLength(200)
		expect(ids.at(-1)).toBe(10)
		expect(ids.filter((n: number) => n === 10)).toHaveLength(1)
		expect(noticeRead(0, s)).toBe(false)
	})

	it("reads a broken or missing store as unread, and never throws", () => {
		const broken = {
			getItem: () => "{not json",
			setItem: () => {
				throw new Error("quota")
			}
		}
		expect(noticeRead(7, broken)).toBe(false)
		expect(() => markNoticeRead(7, broken)).not.toThrow()
		expect(noticeRead(7, null)).toBe(false)
		expect(() => markNoticeRead(7, null)).not.toThrow()
	})
})
