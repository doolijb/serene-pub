/**
 * 🚧 The knowledge store: the book's marks, the open entry's rows, the two
 * writes, and the replies of other tabs. A fake api stands for the socket
 * door; the interest registry is real, over a fake socket.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import {
	BookKnowledge,
	socketKnowledgeApi,
	type KnowledgeApi,
	type KnowledgeRow
} from "./bookKnowledge.svelte"

type Listener = (payload: any) => void

function makeClientSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		id: "tab-a",
		emits: [] as Array<{ event: string; payload: any }>,
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event) ?? []
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
		},
		emit(event: string, payload: any) {
			this.emits.push({ event, payload })
		},
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		},
		count(event: string) {
			return (listeners.get(event) ?? []).length
		}
	}
}

let client: ReturnType<typeof makeClientSocket>
beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
})
afterEach(() => {
	_resetInterestForTests()
	setSocket(null)
})

const BOOK = 4
const row = (
	castMemberId: number,
	over: Partial<KnowledgeRow> = {}
): KnowledgeRow => ({
	castMemberId,
	name: `M${castMemberId}`,
	entryId: 9,
	known: true,
	winner: null,
	hand: null,
	overruled: null,
	placeEntry: false,
	...over
})

const settle = async () => {
	flushSync()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

function fakeApi(over: Partial<KnowledgeApi> = {}) {
	const api = {
		list: vi.fn(async (p: any) => ({
			lorebookId: p.lorebookId,
			entryId: p.entryId,
			branchId: p.branchId,
			moment: p.moment,
			markedEntryIds: [3],
			rows: p.entryId ? [row(1)] : []
		})),
		setCommonKnowledge: vi.fn(async (p: any) => ({
			lorebookId: p.lorebookId,
			entryIds: p.entryIds,
			notCommonKnowledge: p.notCommonKnowledge,
			markedEntryIds: p.notCommonKnowledge ? [3, ...p.entryIds] : [3]
		})),
		setTie: vi.fn(async (p: any) => ({
			lorebookId: p.lorebookId,
			castMemberId: p.castMemberId,
			entryId: p.entryId,
			branchId: p.branchId,
			moment: p.moment,
			row: row(p.castMemberId, { hand: p.hand })
		})),
		...over
	}
	return api as typeof api & KnowledgeApi
}

const AT_NOW = { branchId: null, moment: null }

describe("the marks", () => {
	test("open reads them; isMarked follows", async () => {
		const api = fakeApi()
		const k = new BookKnowledge(api)
		expect(k.loaded).toBe(false)
		const release = k.open(BOOK)
		await settle()
		expect(api.list).toHaveBeenCalledWith({
			lorebookId: BOOK,
			branchId: null,
			moment: null
		})
		expect(k.loaded).toBe(true)
		expect(k.isMarked(3)).toBe(true)
		expect(k.isMarked(4)).toBe(false)
		release()
	})

	test("setMark sends ONE request for several ids and the marks follow", async () => {
		const api = fakeApi()
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		await settle()
		await k.setMark([5, 6, 7], true)
		expect(api.setCommonKnowledge).toHaveBeenCalledTimes(1)
		expect(api.setCommonKnowledge).toHaveBeenCalledWith({
			lorebookId: BOOK,
			entryIds: [5, 6, 7],
			notCommonKnowledge: true
		})
		expect([5, 6, 7].every((id) => k.isMarked(id))).toBe(true)
		await k.setMark([5, 6, 7], false)
		expect(k.isMarked(5)).toBe(false)
		expect(k.isMarked(3)).toBe(true)
		release()
	})

	test("another tab's write moves the marks, and the release stops it", async () => {
		const k = new BookKnowledge(fakeApi())
		const release = k.open(BOOK)
		await settle()
		const reply = (lorebookId: number, ids: number[]) =>
			client.dispatch("entryKnowledge:setCommonKnowledge", {
				lorebookId,
				entryIds: ids,
				notCommonKnowledge: true,
				markedEntryIds: ids
			})
		reply(BOOK + 1, [8])
		expect(k.isMarked(8)).toBe(false)
		reply(BOOK, [8])
		expect(k.isMarked(8)).toBe(true)
		expect(k.isMarked(3)).toBe(false)
		release()
		expect(client.count("entryKnowledge:setCommonKnowledge")).toBe(0)
		expect(client.count("entryKnowledge:setTie")).toBe(0)
	})

	test("a refusal rejects with the server's sentence", async () => {
		const api = fakeApi({
			setCommonKnowledge: async () => {
				throw new Error("Only the owner may mark entries.")
			}
		})
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		await settle()
		await expect(k.setMark([5], true)).rejects.toThrow(
			"Only the owner may mark entries."
		)
		expect(k.isMarked(5)).toBe(false)
		release()
	})
})

describe("the open entry's rows", () => {
	test("showEntry reads them at the reading", async () => {
		const api = fakeApi()
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		k.showEntry(9, {
			branchId: 2,
			moment: { year: 3, month: null, day: null }
		})
		await settle()
		expect(api.list).toHaveBeenCalledWith({
			lorebookId: BOOK,
			entryId: 9,
			branchId: 2,
			moment: { year: 3, month: null, day: null }
		})
		expect(k.entryId).toBe(9)
		expect(k.rowsLoaded).toBe(true)
		expect(k.rows.map((r) => r.castMemberId)).toEqual([1])
		k.showEntry(null, AT_NOW)
		expect(k.entryId).toBeNull()
		expect(k.rows).toEqual([])
		release()
	})

	test("a stale answer is dropped", async () => {
		const gates = new Map<number, (v: any) => void>()
		const api = fakeApi({
			list: (async (p: any) => {
				if (!p.entryId)
					return {
						lorebookId: p.lorebookId,
						markedEntryIds: [],
						rows: []
					}
				return new Promise((resolve) =>
					gates.set(p.entryId, (rows: KnowledgeRow[]) =>
						resolve({
							lorebookId: p.lorebookId,
							entryId: p.entryId,
							branchId: null,
							moment: null,
							markedEntryIds: [],
							rows
						})
					)
				)
			}) as any
		})
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		k.showEntry(1, AT_NOW)
		k.showEntry(2, AT_NOW)
		gates.get(2)!([row(20, { entryId: 2 })])
		await settle()
		gates.get(1)!([row(10, { entryId: 1 })])
		await settle()
		expect(k.entryId).toBe(2)
		expect(k.rows.map((r) => r.castMemberId)).toEqual([20])
		release()
	})

	test("setTie replaces the row from the reply", async () => {
		const api = fakeApi()
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		k.showEntry(9, AT_NOW)
		await settle()
		await k.setTie(1, 9, "kept_from")
		expect(api.setTie).toHaveBeenCalledWith({
			lorebookId: BOOK,
			castMemberId: 1,
			entryId: 9,
			hand: "kept_from",
			branchId: null,
			moment: null
		})
		expect(k.rows).toHaveLength(1)
		expect(k.rows[0].hand).toBe("kept_from")
		release()
	})

	test("a reply read at another reading re-reads instead", async () => {
		const api = fakeApi()
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		k.showEntry(9, AT_NOW)
		await settle()
		const before = (api.list as any).mock.calls.length
		client.dispatch("entryKnowledge:setTie", {
			lorebookId: BOOK,
			castMemberId: 1,
			entryId: 9,
			branchId: 7,
			moment: null,
			row: row(1, { hand: "knows" })
		})
		await settle()
		expect((api.list as any).mock.calls.length).toBe(before + 1)
		release()
	})

	test("marking the open entry re-reads its rows", async () => {
		const api = fakeApi()
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		k.showEntry(9, AT_NOW)
		await settle()
		const before = (api.list as any).mock.calls.length
		await k.setMark([9], true)
		await settle()
		expect((api.list as any).mock.calls.length).toBeGreaterThan(before)
		release()
	})

	test("a refusal of the hand switch rejects with the sentence", async () => {
		const k = new BookKnowledge(
			fakeApi({
				setTie: async () => {
					throw new Error("That cast member is not in this book.")
				}
			})
		)
		const release = k.open(BOOK)
		await expect(k.setTie(1, 9, "knows")).rejects.toThrow(
			"That cast member is not in this book."
		)
		release()
	})
})

describe("the shown member's rows", () => {
	const memberRow = (entryId: number, over: Partial<KnowledgeRow> = {}) =>
		row(1, { entryId, ...over })
	function memberApi(rows: () => KnowledgeRow[] = () => [memberRow(9)]) {
		return fakeApi({
			list: vi.fn(async (p: any) => ({
				lorebookId: p.lorebookId,
				castMemberId: p.castMemberId,
				branchId: p.branchId,
				moment: p.moment,
				markedEntryIds: [3],
				rows: p.castMemberId ? rows() : []
			})) as never,
			setTie: vi.fn(async (p: any) => ({
				lorebookId: p.lorebookId,
				castMemberId: p.castMemberId,
				entryId: p.entryId,
				branchId: p.branchId,
				moment: p.moment,
				row: memberRow(p.entryId, {
					castMemberId: p.castMemberId,
					hand: p.hand
				})
			})) as never
		})
	}

	test("showMember asks by castMemberId at the reading", async () => {
		const api = memberApi()
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		k.showMember(1, {
			branchId: 2,
			moment: { year: 3, month: null, day: null }
		})
		await settle()
		expect(api.list).toHaveBeenCalledWith({
			lorebookId: BOOK,
			castMemberId: 1,
			branchId: 2,
			moment: { year: 3, month: null, day: null }
		})
		expect(k.memberId).toBe(1)
		expect(k.memberRowsLoaded).toBe(true)
		expect(k.memberRows.map((r) => r.entryId)).toEqual([9])
		release()
	})

	test("the same ask is not repeated; null clears", async () => {
		const api = memberApi()
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		k.showMember(1, AT_NOW)
		await settle()
		const before = (api.list as any).mock.calls.length
		k.showMember(1, { branchId: null, moment: null })
		await settle()
		expect((api.list as any).mock.calls.length).toBe(before)
		k.showMember(null, AT_NOW)
		expect(k.memberRows).toEqual([])
		expect(k.memberRowsLoaded).toBe(false)
		release()
	})

	test("an earlier answer is dropped when a later ask has gone out", async () => {
		const answers: Array<(v: any) => void> = []
		const api = fakeApi({
			list: vi.fn(
				(p: any) =>
					new Promise((resolve) =>
						answers.push((rows: KnowledgeRow[]) =>
							resolve({
								lorebookId: p.lorebookId,
								castMemberId: p.castMemberId,
								branchId: p.branchId,
								moment: p.moment,
								markedEntryIds: [],
								rows
							})
						)
					)
			) as never
		})
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		k.showMember(1, AT_NOW)
		k.showMember(2, AT_NOW)
		// asks: marks, member 1, member 2
		answers[1]([memberRow(5)])
		await settle()
		expect(k.memberRowsLoaded).toBe(false)
		answers[2]([memberRow(6)])
		await settle()
		expect(k.memberRows.map((r) => r.entryId)).toEqual([6])
		release()
	})

	test("a failed read says the fallback sentence", async () => {
		const api = fakeApi({
			list: vi.fn(async (p: any) => {
				if (p.castMemberId) throw new Error("")
				return {
					lorebookId: p.lorebookId,
					branchId: null,
					moment: null,
					markedEntryIds: [],
					rows: []
				}
			}) as never
		})
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		k.showMember(1, AT_NOW)
		await settle()
		expect(k.memberRowsError).toBe(
			"What this member knows could not be read."
		)
		release()
	})

	test("a setTie reply updates the member's row, or appends it", async () => {
		const api = memberApi()
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		k.showMember(1, AT_NOW)
		await settle()
		await k.setTie(1, 9, "knows")
		expect(k.memberRows).toHaveLength(1)
		expect(k.memberRows[0].hand).toBe("knows")
		await k.setTie(1, 12, "kept_from")
		expect(k.memberRows.map((r) => [r.entryId, r.hand])).toEqual([
			[9, "knows"],
			[12, "kept_from"]
		])
		// A write for another member does not touch these rows.
		await k.setTie(2, 9, "knows")
		expect(k.memberRows).toHaveLength(2)
		release()
	})

	test("another tab's reply updates them; a reply at another reading re-reads", async () => {
		const api = memberApi()
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		k.showMember(1, AT_NOW)
		await settle()
		client.dispatch("entryKnowledge:setTie", {
			lorebookId: BOOK,
			castMemberId: 1,
			entryId: 9,
			branchId: null,
			moment: null,
			row: memberRow(9, { hand: "kept_from" })
		})
		expect(k.memberRows[0].hand).toBe("kept_from")
		const before = (api.list as any).mock.calls.length
		client.dispatch("entryKnowledge:setTie", {
			lorebookId: BOOK,
			castMemberId: 1,
			entryId: 9,
			branchId: 7,
			moment: null,
			row: memberRow(9)
		})
		await settle()
		expect((api.list as any).mock.calls.length).toBe(before + 1)
		release()
	})

	test("a marks reply re-reads the member's rows", async () => {
		const api = memberApi()
		const k = new BookKnowledge(api)
		const release = k.open(BOOK)
		k.showMember(1, AT_NOW)
		await settle()
		const before = (api.list as any).mock.calls.length
		await k.setMark([5], true)
		await settle()
		expect((api.list as any).mock.calls.length).toBe(before + 1)
		expect((api.list as any).mock.calls.at(-1)[0].castMemberId).toBe(1)
		release()
	})

	test("showing a member adds no listener", async () => {
		const k = new BookKnowledge(memberApi())
		const release = k.open(BOOK)
		const counts = () => [
			client.count("entryKnowledge:setCommonKnowledge"),
			client.count("entryKnowledge:setTie")
		]
		const before = counts()
		k.showMember(1, AT_NOW)
		k.showMember(2, AT_NOW)
		await settle()
		expect(counts()).toEqual(before)
		release()
		expect(counts()).toEqual([0, 0])
	})

	test("a book change drops the member's rows", async () => {
		const k = new BookKnowledge(memberApi())
		const release = k.open(BOOK)
		k.showMember(1, AT_NOW)
		await settle()
		release()
		const again = k.open(BOOK + 1)
		expect(k.memberRows).toEqual([])
		again()
	})
})

describe("the socket api", () => {
	test("each call carries its own request id and settles on its reply", async () => {
		const api = socketKnowledgeApi(client as never)
		const p = api.setCommonKnowledge({
			lorebookId: BOOK,
			entryIds: [1],
			notCommonKnowledge: true
		})
		await settle()
		const asked = client.emits.find(
			(e) => e.event === "entryKnowledge:setCommonKnowledge"
		)!
		expect(String(asked.payload.requestId)).toMatch(/^entry-knowledge-/)
		client.dispatch("entryKnowledge:setCommonKnowledge", {
			lorebookId: BOOK,
			entryIds: [1],
			notCommonKnowledge: true,
			markedEntryIds: [1],
			requestId: asked.payload.requestId
		})
		await expect(p).resolves.toMatchObject({ markedEntryIds: [1] })
	})

	test("a refusal for this request rejects with its sentence", async () => {
		const api = socketKnowledgeApi(client as never)
		const p = api.setTie({
			lorebookId: BOOK,
			castMemberId: 1,
			entryId: 9,
			hand: "knows",
			branchId: null,
			moment: null
		})
		await settle()
		const asked = client.emits.find(
			(e) => e.event === "entryKnowledge:setTie"
		)!
		client.dispatch("entryKnowledge:setTie:error", {
			error: "Only the owner may say who knows.",
			requestId: asked.payload.requestId
		})
		await expect(p).rejects.toThrow("Only the owner may say who knows.")
	})
})
