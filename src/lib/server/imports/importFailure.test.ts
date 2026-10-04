import { afterEach, describe, expect, test, vi } from "vitest"
import { DrizzleQueryError } from "drizzle-orm"
import { QUERY_FAILED_SENTENCE } from "$lib/server/db/errors"
import { importFailureSentence, isServerFailure } from "./importFailure"

const SECRET = "SECRET-PARAM-i7"

afterEach(() => vi.restoreAllMocks())

describe("an import's failure, as the person reads it", () => {
	test("a refusal a handler wrote is kept, and not logged", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {})
		const refusal = new Error("Lorebook \"Big\" has too many items (6000); the maximum supported is 5000.")
		expect(isServerFailure(refusal)).toBe(false)
		expect(importFailureSentence(refusal, "lorebook")).toBe(refusal.message)
		expect(log).not.toHaveBeenCalled()
	})

	test("the database's words become the plain sentence, and the whole error is logged", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {})
		const wrapped = new DrizzleQueryError(
			'insert into "lorebook_entries" ("content") values ($1)',
			[SECRET],
			new Error("invalid byte sequence")
		)
		// PGlite at COMMIT: no wrapper, a SQLSTATE and a severity.
		const raw = Object.assign(
			new Error('duplicate key value violates unique constraint "lorebooks_uuid_idx"'),
			{ code: "23505", severity: "ERROR" }
		)
		// A handler's own label around a failed query's text.
		const quoted = new Error(`Entry 3: ${wrapped.message}`)
		for (const e of [wrapped, raw, quoted]) {
			expect(isServerFailure(e)).toBe(true)
			expect(importFailureSentence(e, "lorebook \"Eldoria\"")).toBe(QUERY_FAILED_SENTENCE)
		}
		expect(log).toHaveBeenCalledTimes(3)
		expect(log).toHaveBeenCalledWith('[import] lorebook "Eldoria":', raw)
	})

	test("the machine's words and a bug's are the plain sentence too", () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		const enoent = Object.assign(
			new Error("ENOENT: no such file or directory, open '/tmp/serene-pub-import-x/characters/a.png'"),
			{ code: "ENOENT", errno: -2, syscall: "open" }
		)
		const bug = new TypeError("Cannot read properties of undefined (reading 'name')")
		for (const e of [enoent, bug])
			expect(importFailureSentence(e, "character")).toBe(QUERY_FAILED_SENTENCE)
	})

	test("a failure with no words of its own is the plain sentence, and is logged", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {})
		const wordless = [new Error(""), "", { reason: "?" }, 42, undefined]
		for (const e of wordless)
			expect(importFailureSentence(e, "persona")).toBe(QUERY_FAILED_SENTENCE)
		expect(log).toHaveBeenCalledTimes(wordless.length)
	})

	test("an error whose code is a word, not a SQLSTATE, is a refusal", () => {
		const own = Object.assign(new Error("Lore writes are off for this book."), {
			code: "LORE_WRITES_OFF"
		})
		expect(isServerFailure(own)).toBe(false)
	})
})
