/**
 * The run tree's lifetime and the owner's grant (E1c): a tree outlives its
 * root's run while a child dispatch is queued or parked, and is forgotten
 * only once both are done; Continue widens both caps by one window.
 */
import { beforeEach, describe, expect, it } from "vitest"
import {
	_resetLineage,
	_treeCount,
	admitDescendant,
	beginRoot,
	capsOf,
	childLineage,
	closeBranch,
	descendantCount,
	grantWindow,
	listenerLineage,
	MAX_RUN_DEPTH,
	MAX_RUN_DESCENDANTS,
	openBranch,
	releaseRoot
} from "./lineage"

const child = (depth: number) => ({
	parentRunId: "p",
	rootRunId: "root",
	depth
})

describe("run tree lifetime", () => {
	beforeEach(() => _resetLineage())

	it("keeps the count while a queued child is open after the root returns", () => {
		expect(admitDescendant(child(1))).toBeNull()
		openBranch("root")
		releaseRoot("root")
		// The root's run has returned; its queued child has not run yet.
		expect(descendantCount("root")).toBe(1)
		expect(admitDescendant(child(2))).toBeNull()
		expect(descendantCount("root")).toBe(2)
		closeBranch("root")
		expect(descendantCount("root")).toBe(0)
		expect(_treeCount()).toBe(0)
	})

	it("is forgotten at the root's return when no branch is open", () => {
		expect(admitDescendant(child(1))).toBeNull()
		releaseRoot("root")
		expect(_treeCount()).toBe(0)
	})

	it("a root held by runSpec keeps its count across a branch opened and closed mid-run", () => {
		beginRoot("root")
		expect(admitDescendant(child(1))).toBeNull()
		openBranch("root")
		closeBranch("root")
		// Still running: the count stays.
		expect(descendantCount("root")).toBe(1)
		releaseRoot("root")
		expect(_treeCount()).toBe(0)
	})

	it("a branch opened after the root returned (a click's form-answered) goes with that branch", () => {
		beginRoot("root")
		releaseRoot("root")
		expect(_treeCount()).toBe(0)
		openBranch("root")
		expect(_treeCount()).toBe(1)
		closeBranch("root")
		expect(_treeCount()).toBe(0)
	})

	it("releasing a root with no tree leaves nothing behind", () => {
		releaseRoot("never-dispatched")
		closeBranch("never-dispatched")
		expect(_treeCount()).toBe(0)
	})
})

describe("the owner's grant", () => {
	beforeEach(() => _resetLineage())

	it("widens the depth cap by one window per Continue", () => {
		expect(admitDescendant(child(MAX_RUN_DEPTH + 1))).toMatch(/cap of 4/)
		grantWindow("root")
		expect(capsOf("root")).toEqual({
			depth: MAX_RUN_DEPTH * 2,
			descendants: MAX_RUN_DESCENDANTS * 2
		})
		expect(admitDescendant(child(MAX_RUN_DEPTH + 1))).toBeNull()
		expect(admitDescendant(child(MAX_RUN_DEPTH * 2 + 1))).toMatch(
			/cap of 8/
		)
	})

	it("widens the descendant cap too", () => {
		for (let i = 0; i < MAX_RUN_DESCENDANTS; i++)
			expect(admitDescendant(child(1))).toBeNull()
		expect(admitDescendant(child(1))).toMatch(/fathered 16/)
		grantWindow("root")
		expect(admitDescendant(child(1))).toBeNull()
	})
})

describe("a run's own data events: the listener lane (R65)", () => {
	beforeEach(() => _resetLineage())

	it("never spends the tree's budget and never deepens the tree", () => {
		const lane = listenerLineage({ runId: "reply", lineage: child(MAX_RUN_DEPTH) })
		expect(lane.depth).toBe(MAX_RUN_DEPTH)
		for (let i = 0; i < MAX_RUN_DESCENDANTS; i++)
			expect(admitDescendant(lane, { count: false })).toBeNull()
		expect(admitDescendant(child(1))).toBeNull()
	})

	it("stops a write that keeps answering its own event, at the depth cap", () => {
		let lineage = listenerLineage({ runId: "r0" })
		for (let hop = 1; hop <= MAX_RUN_DEPTH; hop++) {
			expect(admitDescendant(lineage, { count: false })).toBeNull()
			lineage = listenerLineage({ runId: `r${hop}`, lineage })
		}
		expect(admitDescendant(lineage, { count: false })).toMatch(/writes in a row/)
	})

	it("a counted hop resets the echo", () => {
		const deep = listenerLineage({
			runId: "a",
			lineage: listenerLineage({ runId: "b" })
		})
		expect(deep.echo).toBe(2)
		expect((childLineage({ runId: "c", lineage: deep }) as { echo?: number }).echo).toBeUndefined()
	})
})

describe("the listener lane's own budget (R65 review)", () => {
	beforeEach(() => _resetLineage())

	it("a write answered by two writes stops at the lane budget, not after 2^depth runs", () => {
		const lane = listenerLineage({ runId: "r0" })
		for (let i = 0; i < MAX_RUN_DESCENDANTS; i++)
			expect(admitDescendant(lane, { count: false })).toBeNull()
		expect(admitDescendant(lane, { count: false })).toMatch(/answered 16/)
		// …and the tree's own budget is untouched.
		expect(admitDescendant(child(1))).toBeNull()
	})
})
