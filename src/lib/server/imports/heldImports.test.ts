import { afterEach, describe, expect, test, vi } from "vitest"
import {
	HELD_IMPORT_GONE,
	HELD_IMPORT_LIMITS,
	clearHeldImports,
	heldImportCount,
	holdImport,
	takeHeldImport
} from "./heldImports"
import {
	IMPORTS_RUNNING_ON_SERVER,
	IMPORTS_RUNNING_PER_USER,
	SERVER_BUSY_IMPORTING,
	TOO_MANY_IMPORTS,
	importsRunning,
	withImportLimit
} from "./importLimit"

afterEach(() => {
	clearHeldImports()
	vi.useRealTimers()
})

const card = (s: string) => Buffer.from(s)

describe("held imports", () => {
	test("the person who held it takes it back, once", () => {
		const id = holdImport(1, "card", card("mine"))
		expect(takeHeldImport(1, "card", id).toString()).toBe("mine")
		expect(() => takeHeldImport(1, "card", id)).toThrow(HELD_IMPORT_GONE)
	})

	test("someone else's id reads exactly like a missing one, and leaves it waiting", () => {
		const id = holdImport(1, "card", card("mine"))
		expect(() => takeHeldImport(2, "card", id)).toThrow(HELD_IMPORT_GONE)
		expect(() => takeHeldImport(2, "card", "no-such-id")).toThrow(
			HELD_IMPORT_GONE
		)
		expect(takeHeldImport(1, "card", id).toString()).toBe("mine")
	})

	test("a card's id cannot settle a lorebook import", () => {
		const id = holdImport(1, "card", card("mine"))
		expect(() => takeHeldImport(1, "lorebook", id)).toThrow(
			HELD_IMPORT_GONE
		)
	})

	test("anything but a string id is refused the same way", () => {
		for (const id of [undefined, null, 7, {}, ["x"]]) {
			expect(() => takeHeldImport(1, "card", id)).toThrow(
				HELD_IMPORT_GONE
			)
		}
	})

	test("each person keeps only their newest few", () => {
		const ids = Array.from(
			{ length: HELD_IMPORT_LIMITS.perUser + 1 },
			(_, i) => holdImport(1, "lorebook", { lorebookJson: `{"n":${i}}` })
		)
		const other = holdImport(2, "card", card("theirs"))
		expect(heldImportCount(1)).toBe(HELD_IMPORT_LIMITS.perUser)
		expect(() => takeHeldImport(1, "lorebook", ids[0])).toThrow(
			HELD_IMPORT_GONE
		)
		expect(takeHeldImport(1, "lorebook", ids.at(-1)).lorebookJson).toBe(
			`{"n":${ids.length - 1}}`
		)
		expect(takeHeldImport(2, "card", other).toString()).toBe("theirs")
	})

	test("nothing outlives the time limit", () => {
		vi.useFakeTimers()
		const id = holdImport(1, "card", card("mine"))
		vi.advanceTimersByTime(HELD_IMPORT_LIMITS.ttlMs + 1)
		expect(() => takeHeldImport(1, "card", id)).toThrow(HELD_IMPORT_GONE)
	})

	test("other people's conflicts cannot push out someone holding less than they do", () => {
		// The store's ceiling used to drop the oldest first, whoever owned
		// it: two people holding four large files pushed a third person's one
		// out within seconds (S4 review). The heaviest holder gives way first.
		const unit = HELD_IMPORT_LIMITS.totalBytes / 4
		const mine = holdImport(1, "card", Buffer.alloc(unit))
		const theirs = [
			holdImport(2, "card", Buffer.alloc(unit)),
			holdImport(2, "card", Buffer.alloc(unit))
		]
		holdImport(3, "card", Buffer.alloc(unit))
		holdImport(3, "card", Buffer.alloc(unit))
		expect(takeHeldImport(1, "card", mine).length).toBe(unit)
		expect(() => takeHeldImport(2, "card", theirs[0])).toThrow(
			HELD_IMPORT_GONE
		)
	})

	test("the store stays under its byte ceiling, oldest dropped first", () => {
		const half = Buffer.alloc(HELD_IMPORT_LIMITS.totalBytes / 2)
		const a = holdImport(1, "card", half)
		const b = holdImport(2, "card", half)
		const c = holdImport(3, "card", Buffer.alloc(16))
		expect(() => takeHeldImport(1, "card", a)).toThrow(HELD_IMPORT_GONE)
		expect(takeHeldImport(2, "card", b).length).toBe(half.length)
		expect(takeHeldImport(3, "card", c).length).toBe(16)
	})
})

describe("imports running per person", () => {
	test(`a person may run ${IMPORTS_RUNNING_PER_USER} at once; the next is refused, then allowed once one ends`, async () => {
		const gates: Array<() => void> = []
		const running = Array.from({ length: IMPORTS_RUNNING_PER_USER }, () =>
			withImportLimit(
				1,
				() => new Promise<void>((resolve) => gates.push(resolve))
			)
		)
		await expect(withImportLimit(1, async () => "extra")).rejects.toThrow(
			TOO_MANY_IMPORTS
		)
		// Someone else is not held up by it.
		await expect(withImportLimit(2, async () => "other")).resolves.toBe(
			"other"
		)
		gates.shift()!()
		await running[0]
		await expect(withImportLimit(1, async () => "next")).resolves.toBe(
			"next"
		)
		gates.forEach((open) => open())
		await Promise.all(running)
		expect(importsRunning(1)).toBe(0)
	})

	test("a failed import gives its place back", async () => {
		await expect(
			withImportLimit(1, async () => {
				throw new Error("boom")
			})
		).rejects.toThrow("boom")
		expect(importsRunning(1)).toBe(0)
	})

	test("the refusal is a plain sentence", () => {
		expect(TOO_MANY_IMPORTS).toBe(
			"You already have 2 cards or lorebooks being read. Wait for one to finish, then try again."
		)
	})
})

describe("imports running on the server, for everyone together", () => {
	test(`the server runs ${IMPORTS_RUNNING_ON_SERVER} at once; the next person is refused until one ends`, async () => {
		const gates: Array<() => void> = []
		const running = Array.from(
			{ length: IMPORTS_RUNNING_ON_SERVER },
			(_, i) =>
				withImportLimit(
					10 + i,
					() => new Promise<void>((resolve) => gates.push(resolve))
				)
		)
		expect(importsRunning()).toBe(IMPORTS_RUNNING_ON_SERVER)
		await expect(withImportLimit(99, async () => "late")).rejects.toThrow(
			SERVER_BUSY_IMPORTING
		)
		gates.shift()!()
		await running[0]
		await expect(withImportLimit(99, async () => "late")).resolves.toBe(
			"late"
		)
		gates.forEach((open) => open())
		await Promise.all(running)
		expect(importsRunning()).toBe(0)
	})

	test("one person's own limit never fills the server alone", () => {
		expect(IMPORTS_RUNNING_ON_SERVER).toBeGreaterThan(
			IMPORTS_RUNNING_PER_USER
		)
	})

	test("a refused import takes no place", async () => {
		const gates: Array<() => void> = []
		const running = Array.from({ length: IMPORTS_RUNNING_PER_USER }, () =>
			withImportLimit(1, () => new Promise<void>((r) => gates.push(r)))
		)
		await expect(withImportLimit(1, async () => 0)).rejects.toThrow(
			TOO_MANY_IMPORTS
		)
		expect(importsRunning()).toBe(IMPORTS_RUNNING_PER_USER)
		gates.forEach((open) => open())
		await Promise.all(running)
		expect(importsRunning()).toBe(0)
	})

	test("the refusal is a plain sentence", () => {
		expect(SERVER_BUSY_IMPORTING).toBe(
			"Serene Pub is already reading as many cards and lorebooks as it can at once. Try again in a moment."
		)
	})
})
