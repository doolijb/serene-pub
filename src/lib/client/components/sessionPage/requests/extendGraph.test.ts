/**
 * `extend-graph` opens the page's Extend graph review (W3) — refused, in
 * words, when this session has no scene the graph has not read.
 */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerExtendGraph } from "./extendGraph"

describe("answerExtendGraph", () => {
	test("opens the review when there are scenes to read; refuses when there are none", () => {
		let opened = 0
		const deps = (n: number) => ({
			ungraphedScenes: () => n,
			openExtendGraph: () => void opened++
		})
		answerExtendGraph({}, deps(3))
		expect(opened).toBe(1)
		expect(() => answerExtendGraph({}, deps(0))).toThrow(
			"this session has no scenes waiting for the graph"
		)
		expect(opened).toBe(1)
		expect(WIDGET_REQUEST_ASKERS["extend-graph"]).toBe("core")
	})
})
