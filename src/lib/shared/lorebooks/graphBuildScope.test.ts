/**
 * Which scenes a graph build reads (plan A3, review round): one line's own.
 */
import { describe, expect, it } from "vitest"
import { buildReadsScene, extendCountsOf } from "./graphBuildScope"

const scene = (
	id: number,
	branchId: number | null,
	sessionId: number | null,
	over: Record<string, unknown> = {}
) => ({
	id,
	branchId,
	sessionId,
	graphed: false,
	summary: "Something happened.",
	castResolvedAt: null as Date | null,
	...over
})

describe("buildReadsScene", () => {
	it("a session's Extend reads its own scenes on its own line only", () => {
		const scope = { branchId: 7, sessionId: 3 }
		expect(buildReadsScene(scene(1, 7, 3), scope)).toBe(true)
		// Played on main before the session moved to the branch: main's.
		expect(buildReadsScene(scene(2, null, 3), scope)).toBe(false)
		// Another session's scene on the same branch.
		expect(buildReadsScene(scene(3, 7, 4), scope)).toBe(false)
		// A sibling line the session left.
		expect(buildReadsScene(scene(4, 9, 3), scope)).toBe(false)
	})

	it("a book-wide build reads every session's scenes on the line, and no other line's", () => {
		const scope = { branchId: null, sessionId: null }
		expect(buildReadsScene(scene(1, null, 3), scope)).toBe(true)
		expect(buildReadsScene(scene(2, null, null), scope)).toBe(true)
		expect(buildReadsScene(scene(3, 7, 3), scope)).toBe(false)
	})
})

describe("extendCountsOf", () => {
	it("counts what an Extend will read, what waits for a summary, and what needs a cast worked out", () => {
		const counts = extendCountsOf(
			[
				scene(1, 7, 3),
				scene(2, 7, 3, { castResolvedAt: new Date() }),
				scene(3, 7, 3, { summary: "  " }),
				scene(4, 7, 3, { graphed: true }),
				scene(5, null, 3),
				scene(6, 7, 4)
			],
			{ branchId: 7, sessionId: 3 }
		)
		expect(counts).toEqual({ ready: 2, unsummarized: 1, unresolvedCast: 1 })
	})
})
