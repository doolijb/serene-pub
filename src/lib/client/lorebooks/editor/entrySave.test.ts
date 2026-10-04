/**
 * The entry editor's writes: an amendment names its line, waits for its own
 * row, and a base save an amendment still overrides says which one.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const handlers = new Map<string, (data: any) => void>()

vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (data: any) => void) => {
		handlers.set(key, handler)
		return () => handlers.delete(key)
	}
}))

import {
	amendmentDateToast,
	entryAmendmentParams,
	fileEntryAmendments,
	isOurAmendment,
	lineName,
	maskedBaseWarning,
	maskedFields,
	maskingAmendment
} from "./entrySave"
import { MAIN_LINE } from "$lib/shared/lorebooks/lineReading"

const target = { lorebookId: 4, entryId: 9, branchId: 7 }

function list(
	entries: Array<Partial<Sockets.Amendments.EntryRow> & { id: number }>,
	lorebookId = 4
): Sockets.Amendments.List.Response {
	return {
		lorebookId,
		entries: entries.map((e) => ({
			entryId: 9,
			branchId: 7,
			year: 3,
			month: null,
			day: null,
			fields: {},
			historyEntryId: null,
			createdAt: "",
			updatedAt: "",
			...e
		})),
		cast: [],
		presences: [],
		branches: [
			{
				id: 7,
				lorebookId: 4,
				name: "The long winter",
				forkedFromBranchId: null,
				forkYear: 2,
				forkMonth: null,
				forkDay: null
			}
		]
	}
}

beforeEach(() => handlers.clear())

describe("entryAmendmentParams", () => {
	test("carries the line being read (#37: never silently main)", () => {
		const params = entryAmendmentParams(target, {
			year: 3,
			fields: { enabled: false }
		})
		expect(params).toEqual({
			lorebookId: 4,
			entryId: 9,
			branchId: 7,
			year: 3,
			month: null,
			day: null,
			fields: { enabled: false }
		})
	})

	test("main is an explicit null", () => {
		expect(
			entryAmendmentParams(
				{ ...target, branchId: null },
				{ year: 1, fields: {} }
			).branchId
		).toBeNull()
	})
})

describe("isOurAmendment", () => {
	const params = entryAmendmentParams(target, { year: 3, fields: {} })

	test("a new row for this entry, line and date is ours", () => {
		expect(isOurAmendment(list([{ id: 11 }]), params, new Set())).toBe(true)
	})

	test("a row with other fields is somebody else's write", () => {
		expect(
			isOurAmendment(
				list([{ id: 11, fields: { enabled: false } }]),
				params,
				new Set()
			)
		).toBe(false)
	})

	test("a row already known is not", () => {
		expect(isOurAmendment(list([{ id: 11 }]), params, new Set([11]))).toBe(
			false
		)
	})

	test("the same date on main is not the fork's write", () => {
		expect(
			isOurAmendment(list([{ id: 11, branchId: null }]), params, new Set())
		).toBe(false)
	})

	test("another book's list is not", () => {
		expect(isOurAmendment(list([{ id: 11 }], 5), params, new Set())).toBe(
			false
		)
	})
})

describe("fileEntryAmendments", () => {
	test("waits for its own row on the book's list, one half at a time", async () => {
		const emits: any[] = []
		const socket = { emit: (event: string, p: any) => emits.push({ event, p }) }
		const done = fileEntryAmendments(
			socket as any,
			target,
			[
				{ year: 3, fields: { enabled: false } },
				{ year: 5, fields: { enabled: true } }
			],
			[1]
		)
		expect(emits).toHaveLength(1)
		expect(emits[0].p.branchId).toBe(7)
		expect([...handlers.keys()].sort()).toEqual([
			"amendments:create:error",
			"amendments:list#4"
		])
		// Somebody else's write: not ours, keep waiting.
		handlers.get("amendments:list#4")!(list([{ id: 1 }]))
		expect(emits).toHaveLength(1)
		handlers.get("amendments:list#4")!(
			list([{ id: 1 }, { id: 2, fields: { enabled: false } }])
		)
		await Promise.resolve()
		await Promise.resolve()
		expect(emits).toHaveLength(2)
		expect(emits[1].p.year).toBe(5)
		handlers.get("amendments:list#4")!(
			list([
				{ id: 1 },
				{ id: 2, fields: { enabled: false } },
				{ id: 3, year: 5, fields: { enabled: true } }
			])
		)
		const last = await done
		expect(last?.entries.map((e) => e.id)).toEqual([1, 2, 3])
	})

	test("a refusal rejects with the server's sentence", async () => {
		const socket = { emit: () => {} }
		const done = fileEntryAmendments(
			socket as any,
			target,
			[{ year: 3, fields: {} }],
			[]
		)
		handlers.get("amendments:create:error")!({ error: "Not in this book." })
		await expect(done).rejects.toThrow("Not in this book.")
	})
})

describe("amendmentDateToast (A18(b))", () => {
	test("a change that re-dates the entry is not filed as of a moment, and says where it goes", () => {
		const toast = amendmentDateToast({ year: 5, content: "Moved." })
		expect(toast?.title).toBe("A date can't be amended")
		expect(toast?.description).toMatch(/Change the base/)
		expect(amendmentDateToast({ day: null })).not.toBeNull()
	})

	test("a change that leaves the date alone files as usual", () => {
		expect(amendmentDateToast({ content: "Later.", enabled: false })).toBeNull()
	})
})

describe("lineName", () => {
	test("names the fork from the reply, and main as null", () => {
		expect(lineName(list([]), 7)).toBe("The long winter")
		expect(lineName(list([]), null)).toBeNull()
	})
})

describe("masked base saves (#99)", () => {
	test("a field the resolver still overrides is masked", () => {
		expect(
			maskedFields(
				{ content: "new", name: "Harbour" },
				{ content: "amended", name: "Harbour" }
			)
		).toEqual(["content"])
	})

	test("names the latest amendment on this line that set the winning value", () => {
		const overlays = [
			{ id: 1, branchId: null, year: 2, fields: { content: "old" } },
			{ id: 2, branchId: null, year: 4, fields: { content: "amended" } },
			{ id: 3, branchId: 99, year: 6, fields: { content: "amended" } }
		]
		expect(maskingAmendment("content", "amended", overlays, MAIN_LINE)?.id).toBe(2)
	})

	test("the warning names the field and the amendment's date", () => {
		const warning = maskedBaseWarning([
			{
				field: "content",
				amendment: { id: 2, branchId: null, year: 4, fields: {} }
			}
		])
		expect(warning?.description).toContain("the content")
		expect(warning?.description).toMatch(/dated .*4/)
		expect(maskedBaseWarning([])).toBeNull()
	})
})

describe("maskingAmendment reads the ancestor chain (ruling 5)", () => {
	test("on a fork of a branch, the parent's overlay before the fork is named; after it is not", async () => {
		const { lineOf } = await import("$lib/shared/lorebooks/lineReading")
		const branches = [
			{ id: 1, forkedFromBranchId: null, forkYear: 10 },
			{ id: 2, forkedFromBranchId: 1, forkYear: 6 }
		]
		const overlays = [
			{ id: 1, branchId: 1, year: 5, fields: { content: "amended" } },
			{ id: 2, branchId: 1, year: 8, fields: { content: "amended" } },
			{ id: 3, branchId: 9, year: 2, fields: { content: "amended" } }
		]
		const line = lineOf(2, branches)
		expect(maskingAmendment("content", "amended", overlays, line)?.id).toBe(1)
	})
})
