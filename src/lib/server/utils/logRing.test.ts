import { afterEach, describe, expect, test } from "vitest"
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
})
