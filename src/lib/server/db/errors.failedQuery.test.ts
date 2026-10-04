/**
 * A failed query, read the way drizzle-orm (0.44+) raises it.
 *
 * The wrapper's message is `Failed query: <sql>\nparams: <values>`, with the
 * driver's error — SQLSTATE, constraint, Postgres' own sentence — under
 * `.cause`. These pin the two halves of the rule in `db/errors.ts`: checks
 * read the driver error, and the wrapper's text never reaches a person.
 */
import { describe, expect, test } from "vitest"
import { DrizzleQueryError } from "drizzle-orm"
import {
	driverErrorOf,
	driverReasonOf,
	errorWithoutQueryText,
	isFailedQuery,
	isUniqueViolation,
	messageWithoutQueryText,
	payloadWithoutQueryText,
	QUERY_FAILED_SENTENCE,
	sqlStateOf,
	withoutQueryParams,
	withoutQueryText
} from "./errors"

const SECRET = "SECRET-PARAM"

function uniqueViolation(params: unknown[] = [SECRET]): DrizzleQueryError {
	const cause = Object.assign(
		new Error('duplicate key value violates unique constraint "users_username_unique"'),
		{ code: "23505", constraint: "users_username_unique" }
	)
	return new DrizzleQueryError(
		'insert into "users" ("username") values ($1) returning "id"',
		params,
		cause
	)
}

describe("reading the driver error", () => {
	test("the SQLSTATE and constraint are on the cause, not the wrapper", () => {
		const e = uniqueViolation()
		expect((e as unknown as { code?: string }).code).toBeUndefined()
		expect(sqlStateOf(e)).toBe("23505")
		expect(isUniqueViolation(e)).toBe(true)
		expect(isUniqueViolation(e, "users_username_unique")).toBe(true)
		expect(isUniqueViolation(e, "some_other_index")).toBe(false)
		expect(isFailedQuery(e)).toBe(true)
	})

	test("an unwrapped error is read as it came", () => {
		const raw = Object.assign(new Error("boom"), { code: "23505" })
		expect(driverErrorOf(raw)).toBe(raw)
		expect(sqlStateOf(raw)).toBe("23505")
		expect(isFailedQuery(raw)).toBe(false)
		expect(sqlStateOf(new Error("no code"))).toBeUndefined()
		expect(sqlStateOf(null)).toBeUndefined()
		expect(isUniqueViolation("a string")).toBe(false)
	})
})

describe("the wrapper's text never reaches a person", () => {
	test("withoutQueryText keeps the words before the query, and nothing of it", () => {
		const text = `Character "Ada": ${uniqueViolation().message}`
		expect(withoutQueryText(text)).toBe(
			`Character "Ada": ${QUERY_FAILED_SENTENCE}`
		)
		expect(withoutQueryText("That name is taken.")).toBe(
			"That name is taken."
		)
	})

	test("an :error payload loses the query at any top-level string", () => {
		const data = { error: uniqueViolation().message, characterId: 7 }
		const out = payloadWithoutQueryText("characters:create:error", data)
		expect(out).toEqual({ error: QUERY_FAILED_SENTENCE, characterId: 7 })
		expect(JSON.stringify(out)).not.toContain(SECRET)
		expect(data.error).toContain(SECRET) // the caller's object is not mutated
	})

	test("any other event loses it in a top-level string array, and hears each original", () => {
		const heard: string[] = []
		const data = {
			ok: true,
			errors: [`Lorebook "Sea": ${uniqueViolation().message}`, "Persona \"Bo\": no file"]
		}
		const out = payloadWithoutQueryText(
			"import:sillytavern:execute",
			data,
			(o) => heard.push(o)
		)
		expect(out.errors).toEqual([
			`Lorebook "Sea": ${QUERY_FAILED_SENTENCE}`,
			'Persona "Bo": no file'
		])
		expect(heard).toHaveLength(1)
		expect(heard[0]).toContain(SECRET)
	})

	test("a person's own text that merely quotes the marker is left alone", () => {
		const data = { content: "The log said Failed query: and nothing else." }
		expect(payloadWithoutQueryText("messages:update", data)).toBe(data)
	})

	test("a document quoting an already-withheld line is sent whole", () => {
		// The support report quotes the log ring, whose lines keep the SQL and
		// withhold the values — cutting it at the first "Failed query: " would
		// lose the rest of the report.
		const line = withoutQueryParams(`[sockets] x: ${uniqueViolation().message}`)
		const data = { markdown: `## Recent warnings\n\n${line}\n\n## Browser\n\nfine` }
		expect(payloadWithoutQueryText("admin:supportReport", data)).toBe(data)
		// …while the same line with its values still in it is not.
		const raw = { markdown: `## Recent\n\n${uniqueViolation().message}` }
		expect(payloadWithoutQueryText("admin:supportReport", raw).markdown).toBe(
			`## Recent\n\n${QUERY_FAILED_SENTENCE}`
		)
	})

	test("nothing to replace returns the very same object", () => {
		const data = { error: "That name is taken." }
		expect(payloadWithoutQueryText("x:error", data)).toBe(data)
		expect(payloadWithoutQueryText("x:error", null)).toBe(null)
		const thunk = () => ({})
		expect(payloadWithoutQueryText("x", thunk)).toBe(thunk)
	})
})

describe("diagnostics keep the SQL and withhold the values", () => {
	test("the raw message, a stack, and the JSON-escaped form", () => {
		const e = uniqueViolation()
		const raw = withoutQueryParams(e.message)
		expect(raw).toContain('insert into "users"')
		expect(raw).toContain("[params withheld]")
		expect(raw).not.toContain("params: ")
		expect(raw).not.toContain(SECRET)

		// A whole stack, read as text: nothing says where the values stop, so
		// they (and the frames after them) are withheld to the end.
		const stack = withoutQueryParams(String(e.stack))
		expect(stack).not.toContain(SECRET)
		expect(stack).toContain('insert into "users"')

		const json = withoutQueryParams(JSON.stringify({ error: e.message, n: 1 }))
		expect(json).not.toContain(SECRET)
		expect(JSON.parse(json)).toEqual({
			error: expect.stringContaining("[params withheld]"),
			n: 1
		})
	})

	test("a value holding a line that reads like a stack frame is withheld whole", () => {
		// The review's probe: prose with `\n   at the crossroads` in it ended
		// the withheld region early and left the rest in the log ring.
		const e = uniqueViolation(["The inn\n   at the crossroads SECRET-PROSE", SECRET])
		for (const text of [
			"warn: " + e.message,
			String(new Error(`wrapped: ${e.message}`).stack),
			JSON.stringify({ reason: e.message })
		]) {
			const out = withoutQueryParams(text)
			expect(out).not.toContain("SECRET-PROSE")
			expect(out).not.toContain(SECRET)
		}
	})

	test("a first value that reads '[withheld]' passes for nothing", () => {
		// The review's probe: `params: [withheld] hi,SECRET` was taken for an
		// already-withheld line, and the backstop let the rest through.
		const e = uniqueViolation(["[withheld] hi", SECRET])
		const out = payloadWithoutQueryText("characters:importResolve", {
			warnings: ["x: " + e.message]
		})
		expect(JSON.stringify(out)).not.toContain(SECRET)
		expect(withoutQueryParams(e.message)).not.toContain(SECRET)
		// …and the same text with `[params withheld]` spelled by hand.
		const spoof = uniqueViolation(["[params withheld]", SECRET]).message
		expect(JSON.stringify(payloadWithoutQueryText("x", { w: [spoof] }))).not.toContain(SECRET)
	})

	test("withholding twice changes nothing", () => {
		const once = withoutQueryParams(`[x] ${uniqueViolation().message}`)
		expect(withoutQueryParams(once)).toBe(once)
		expect(payloadWithoutQueryText("admin:supportReport", { md: once }).md).toBe(once)
	})

	test("whitespace collapsed onto one line still reads as a failed query", () => {
		const oneLine = uniqueViolation().message.replace(/\s+/g, " ")
		expect(withoutQueryParams(oneLine)).not.toContain(SECRET)
		expect(payloadWithoutQueryText("downloads:settled", { error: oneLine })).toEqual({
			error: QUERY_FAILED_SENTENCE
		})
	})
})

describe("nested payloads and serialised errors", () => {
	test("a failed query is found at any depth, and a shared value is cleaned at both keys", () => {
		const shared = { error: uniqueViolation().message }
		const data = {
			result: { error: uniqueViolation().message },
			failures: [{ name: "Ada", error: `Ada: ${uniqueViolation().message}` }],
			a: shared,
			b: shared
		}
		const out = payloadWithoutQueryText("x:error", data)
		expect(JSON.stringify(out)).not.toContain(SECRET)
		expect(out.result.error).toBe(QUERY_FAILED_SENTENCE)
		expect(out.failures[0]).toEqual({ name: "Ada", error: `Ada: ${QUERY_FAILED_SENTENCE}` })
		expect(out.b).toBe(out.a)
		expect(data.result.error).toContain(SECRET) // not mutated
	})

	test("bytes pass through untouched", () => {
		const bytes = Buffer.from("Failed query: x\nparams: y")
		const data = { file: bytes, error: uniqueViolation().message }
		const out = payloadWithoutQueryText("upload:error", data)
		expect(out.file).toBe(bytes)
		expect(out.error).toBe(QUERY_FAILED_SENTENCE)
	})

	test("a DrizzleQueryError serialises as the plain sentence and its SQLSTATE", () => {
		const e = uniqueViolation()
		expect(JSON.parse(JSON.stringify({ error: e }))).toEqual({
			error: { message: QUERY_FAILED_SENTENCE, code: "23505" }
		})
		expect(JSON.stringify(e)).not.toContain(SECRET)
	})
})

describe("an error passed on as text", () => {
	test("messageWithoutQueryText: the wrapper is the sentence, a quoting message keeps its words", () => {
		const e = uniqueViolation()
		expect(messageWithoutQueryText(e)).toBe(QUERY_FAILED_SENTENCE)
		expect(messageWithoutQueryText(new Error(`lore: ${e.message}`))).toBe(
			`lore: ${QUERY_FAILED_SENTENCE}`
		)
		expect(messageWithoutQueryText(new Error("plain"))).toBe("plain")
		expect(messageWithoutQueryText("a string")).toBe("a string")
	})

	test("errorWithoutQueryText: the same object when clean, a plain Error with the original as cause otherwise", () => {
		const clean = new TypeError("nope")
		expect(errorWithoutQueryText(clean)).toBe(clean)
		const e = uniqueViolation()
		const safe = errorWithoutQueryText(e) as Error
		expect(safe).not.toBe(e)
		expect(safe.message).toBe(QUERY_FAILED_SENTENCE)
		expect(safe.cause).toBe(e)
		const wrapped = errorWithoutQueryText(new Error(`node x: ${e.message}`)) as Error
		expect(wrapped.message).toBe(`node x: ${QUERY_FAILED_SENTENCE}`)
		// The cause rides for the server log and is never serialised.
		expect(JSON.stringify(safe)).toBe("{}")
	})

	test("driverReasonOf: Postgres' own reason, never the values", () => {
		const e = uniqueViolation()
		expect(driverReasonOf(e)).toBe(
			'duplicate key value violates unique constraint "users_username_unique"'
		)
		const quoted = driverReasonOf(new Error(`sync: ${e.message}`))
		expect(quoted).toContain('insert into "users"')
		expect(quoted).not.toContain(SECRET)
		expect(driverReasonOf(new Error("plain"))).toBe("plain")
	})
})
