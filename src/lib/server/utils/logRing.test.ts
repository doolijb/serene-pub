import { afterEach, describe, expect, test } from "vitest"
import { DrizzleQueryError } from "drizzle-orm"
import {
	clearLogRing,
	LOG_LINE_MAX,
	LOG_RING_SIZE,
	readLogRing,
	recordLogLine
} from "./logRing"

afterEach(() => clearLogRing())

describe("log ring", () => {
	test("keeps the newest LOG_RING_SIZE lines, oldest first", () => {
		for (let i = 0; i < LOG_RING_SIZE + 20; i++) recordLogLine("warn", [`line ${i}`])
		const lines = readLogRing()
		expect(lines).toHaveLength(LOG_RING_SIZE)
		expect(lines[0].text).toBe("line 20")
		expect(lines.at(-1)!.text).toBe(`line ${LOG_RING_SIZE + 19}`)
	})

	test("plain text: ANSI stripped, objects as JSON, errors as the top of the stack, long lines cut", () => {
		recordLogLine("error", ["\x1b[31m[Tag]\x1b[39m failed", { code: 7 }, new Error("boom")])
		const [line] = readLogRing()
		expect(line.level).toBe("error")
		expect(line.text).toMatch(/^\[Tag\] failed \{"code":7\} Error: boom/)
		expect(line.text.split("\n").length).toBeLessThanOrEqual(4)

		recordLogLine("warn", ["x".repeat(LOG_LINE_MAX * 2)])
		expect(readLogRing()[1].text.length).toBeLessThanOrEqual(LOG_LINE_MAX + 2)
	})

	test("never throws on an unserialisable argument", () => {
		const loop: any = {}
		loop.self = loop
		expect(() => recordLogLine("warn", [loop])).not.toThrow()
		expect(readLogRing()).toHaveLength(1)
	})

	describe("a failed query (drizzle's wrapper)", () => {
		const SECRET = "SECRET-PARAM"
		const wrapped = () =>
			new DrizzleQueryError(
				'insert into "messages" ("session_id", "content") values ($1, $2)',
				[42, SECRET],
				Object.assign(
					new Error('insert or update on table "messages" violates foreign key constraint "messages_session_id_sessions_id_fk"'),
					{ code: "23503", constraint: "messages_session_id_sessions_id_fk" }
				)
			)

		test("records the SQLSTATE, the constraint, the reason and the query's shape — never the values", () => {
			recordLogLine("error", ["Error handling event sessions:send:", wrapped()])
			const [line] = readLogRing()
			expect(line.text).toContain("23503")
			expect(line.text).toContain("messages_session_id_sessions_id_fk")
			expect(line.text).toContain("violates foreign key constraint")
			expect(line.text).toContain('insert into "messages"')
			expect(line.text).not.toContain(SECRET)
		})

		test("withholds the values when the message is logged as text, inside another error, or as JSON", () => {
			const e = wrapped()
			recordLogLine("error", ["save failed:", e.message])
			recordLogLine("error", [new Error(`the fire did not run: ${e.message}`)])
			recordLogLine("warn", [{ error: e.message }])
			recordLogLine("error", [new Error("outer", { cause: e })])
			const lines = readLogRing()
			expect(lines).toHaveLength(4)
			for (const l of lines) expect(l.text).not.toContain(SECRET)
			expect(lines[0].text).toContain("[params withheld]")
			// A wrapped cause reaches the ring as a line of its own.
			expect(lines[3].text).toMatch(/caused by: Failed query \(23503/)
		})

		test("a value holding a frame-shaped line is withheld whole, and an error keeps its frames", () => {
			// The review's probe: prose with `\n   at the crossroads` ended the
			// withheld region at that line and left the rest in the ring.
			const e = new DrizzleQueryError(
				'insert into "lore" ("content", "key") values ($1, $2)',
				["The inn\n   at the crossroads SECRET-PROSE", SECRET],
				new Error("boom")
			)
			recordLogLine("warn", ["warn: " + e.message])
			const wrapper = new Error(`the save failed: ${e.message}`)
			recordLogLine("error", [wrapper])
			const [asText, asError] = readLogRing()
			for (const l of [asText, asError]) {
				expect(l.text).not.toContain("SECRET-PROSE")
				expect(l.text).not.toContain(SECRET)
				expect(l.text).toContain('insert into "lore"')
			}
			// The message's end is known on an Error, so its frames survive.
			expect(asError.text).toMatch(/\[params withheld\]\n\s+at /)
		})
	})
})
