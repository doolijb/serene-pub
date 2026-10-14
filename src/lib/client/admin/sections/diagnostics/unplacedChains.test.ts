import { describe, expect, it } from "vitest"
import { UNPLACED_SCRIPTS_HREF, unplacedChainCount, unplacedChainsLine } from "./unplacedChains"
import { USE_ORDER } from "../scripts/scriptsAdmin"

type UseRow = Sockets.Pipelines.Scripts.UseRow

const chain = (over: Partial<Extract<UseRow, { kind: "pipeline" }>> = {}): UseRow => ({
	kind: "pipeline",
	pipelineSlug: "core:chat",
	pipelineLabel: "Reply · Chat",
	nodeKey: "reply",
	stepLabel: "Reply",
	at: "old-point",
	stepKey: "s",
	optionId: "o1",
	unplaced: true,
	...over
})

describe("unplacedChainCount", () => {
	it("counts distinct unplaced chains, not scripts", () => {
		const scripts = [
			{ use: [chain(), chain({ unplaced: false, optionId: "o2" })] },
			// A second script in the same unplaced chain is the same chain.
			{ use: [chain()] },
			{ use: [chain({ nodeKey: "extract", optionId: "o3" })] },
			{ use: [{ kind: "connection", connectionId: 1, connectionName: "K" } as UseRow] },
			{ use: [] }
		]
		expect(unplacedChainCount(scripts)).toBe(2)
	})
	it("is 0 with nothing unplaced", () => {
		expect(unplacedChainCount([{ use: [chain({ unplaced: false })] }])).toBe(0)
	})
})

describe("unplacedChainsLine", () => {
	it("says nothing at 0, and agrees in number", () => {
		expect(unplacedChainsLine(0)).toBeNull()
		expect(unplacedChainsLine(1)).toBe("1 script chain has no place to run")
		expect(unplacedChainsLine(4)).toBe("4 script chains have no place to run")
	})
	it("links to the Scripts Use filter's own value", () => {
		expect(USE_ORDER).toContain("unplaced")
		expect(UNPLACED_SCRIPTS_HREF).toBe("/admin/scripts?use=unplaced")
	})
})
