import { describe, expect, it } from "vitest"
import { layoutPipeline } from "./layout"

const node = (
	key: string,
	position: number,
	clauseId: string | null = null,
	clauseChain: string | null = null
) => ({
	key,
	label: key,
	kind: "task",
	definitionId: `test:${key}`,
	clauseId,
	clauseKind: clauseId ? "junction" : null,
	clauseChain,
	position,
	toggleable: false,
	enabledDefault: true,
	stepKey: null
})

const junction = (
	id: string,
	parentClauseId: string | null,
	parentClauseChain: string | null
) => ({
	id,
	kind: "junction",
	mode: null,
	max: null,
	over: null,
	parentClauseId,
	parentClauseChain,
	repeatWhile: null,
	on: "x",
	branches: null,
	stepKey: null
})

describe("layoutPipeline — a nested clause sits in its parent's branch", () => {
	// The Lair's shape: `pick` has branches `picked` and `planned`; the
	// `turn` junction runs inside `planned`, between `plan` and `save`.
	const graph = {
		clauses: [
			junction("pick", null, null),
			junction("pick.planned.turn", "pick", "planned")
		],
		nodes: [
			node("say", 1, "pick", "picked"),
			node("plan", 2, "pick", "planned"),
			node("scene", 3, "pick.planned.turn", "play"),
			node("save", 4, "pick", "planned")
		],
		edges: []
	} as any

	it("chains the nested clause between its branch neighbours", async () => {
		const { edges } = await layoutPipeline(graph, "DOWN")
		const pairs = edges.map((e) => `${e.source}->${e.target}`)
		expect(pairs).toContain("plan->pick.planned.turn")
		expect(pairs).toContain("pick.planned.turn->save")
		// Nothing links the other branch to it.
		expect(pairs).not.toContain("say->pick.planned.turn")
	})

	it("keeps an older wire (no branch named) on the scope's spine", async () => {
		const older = {
			...graph,
			clauses: graph.clauses.map((c: any) => ({
				...c,
				parentClauseChain: undefined
			}))
		}
		const { nodes } = await layoutPipeline(older, "DOWN")
		expect(nodes.map((n) => n.id)).toContain("pick.planned.turn")
	})
})
