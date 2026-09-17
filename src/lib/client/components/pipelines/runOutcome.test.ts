/**
 * `RunProgressCard`'s outcome mapping (2026-09-16): the regression was
 * "Progress card says 'Respond finished ✓' on an errored run" — a terminal
 * frame read as two flags, and anything that was neither `cancelled` nor
 * `error` drew a check mark, including a frame whose `error` never got set at
 * all. Pinned here as pure data, without a socket or a DOM.
 */

import { describe, expect, it } from "vitest"
import { renderStatusText } from "@serene-pub/sdk"
import { outcomeOf, outcomeIcon, outcomeStatusText } from "./runOutcome"

describe("outcomeOf", () => {
	it("reads the frame's own outcome first — never overridden by the flags", () => {
		expect(outcomeOf({ outcome: "err", cancelled: true })).toBe("err")
		expect(outcomeOf({ outcome: "halt" })).toBe("halt")
		expect(outcomeOf({ outcome: "ok" })).toBe("ok")
	})

	it("falls back to the two-flag reading for a future pipelines:progress caller not yet taught to say which", () => {
		expect(outcomeOf({ cancelled: true })).toBe("cancelled")
		expect(outcomeOf({ error: "boom" })).toBe("err")
		expect(outcomeOf({})).toBe("ok")
	})

	it("the exact regression: a terminal frame carrying an error is never read as ok", () => {
		expect(outcomeOf({ error: "the model returned nothing" })).not.toBe("ok")
	})
})

describe("outcomeIcon", () => {
	it("only `ok` draws a check mark; `cancelled` its own; `err` and `halt` share the warning icon", () => {
		expect(outcomeIcon("ok")).toBe("check")
		expect(outcomeIcon("cancelled")).toBe("ban")
		expect(outcomeIcon("err")).toBe("warning")
		expect(outcomeIcon("halt")).toBe("warning")
	})
})

describe("outcomeStatusText", () => {
	it("renders each outcome's caption", () => {
		expect(renderStatusText(outcomeStatusText("ok"))).toBe("finished")
		expect(renderStatusText(outcomeStatusText("cancelled"))).toBe("stopped")
		expect(renderStatusText(outcomeStatusText("err"))).toBe("failed")
	})

	it("halt names the node it stopped at", () => {
		expect(renderStatusText(outcomeStatusText("halt", "generate"))).toBe(
			"halted at generate"
		)
	})

	it("halt with no node key leaves the placeholder, same as any other unfilled var", () => {
		expect(renderStatusText(outcomeStatusText("halt"))).toBe(
			"halted at {node}"
		)
	})
})
