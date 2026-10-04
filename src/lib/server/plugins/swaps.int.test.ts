/**
 * Swap contributions at install (PLAN-turn-order R29, M2 review): the target
 * and the fit are checked before a plugin row is written, with the SDK's own
 * sentence, so a contribution is never offered to nobody or offered mis-wired.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { swapContributionProblems } from "./swaps"

let db: TestDb

const STRATEGY_PORTS = {
	in: { candidates: "core:shape/turn-candidates@1", messages: "core:shape/messages@1" },
	out: { main: "core:shape/turn-entries@1", order: "core:shape/turn-entries@1" }
}
const decl = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	// Public: a contribution runs in another package's pipeline (R62).
	declaration: { id, kind: "task", ports: STRATEGY_PORTS, public: true, ...extra }
})
const manifest = (
	definition: string,
	spec = "core:spec/chat-turn-order",
	node = "decide.rules.strategy",
	defs: Array<{ id: string; declaration: Record<string, unknown> }> = [decl(definition)]
) => ({
	slug: "acme",
	nodeDefinitions: defs,
	swaps: [{ spec, node, definition }]
})

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
}, 120_000)

describe("swapContributionProblems", () => {
	it("a well-formed contribution onto chat's strategy installs", async () => {
		expect(await swapContributionProblems(db, manifest("acme:task/turn-natural@1"))).toEqual([])
	})

	it("a definition the plugin does not ship is refused", async () => {
		const m = { ...manifest("acme:task/turn-natural@1"), nodeDefinitions: [] }
		expect((await swapContributionProblems(db, m))[0]).toContain("is not a definition this plugin ships")
	})

	it("a spec this instance does not publish is refused", async () => {
		expect(
			(await swapContributionProblems(db, manifest("acme:task/turn-natural@1", "core:spec/nope")))[0]
		).toContain("is not a pipeline this pub publishes")
	})

	it("a node not in session settings is refused — guide's turn order exposes nothing (R42)", async () => {
		expect(
			(await swapContributionProblems(db, manifest("acme:task/turn-natural@1", "core:spec/guide-turn-order", "strategy")))[0]
		).toContain("is not in session settings")
	})

	it("a definition that does not fit the pin is refused with the SDK's sentence", async () => {
		// Deliberately missing the `messages` in-port — the misfit under test.
		const misfit = manifest("acme:task/turn-odd@1", "core:spec/chat-turn-order", "decide.rules.strategy", [
			{
				id: "acme:task/turn-odd@1",
				declaration: {
					id: "acme:task/turn-odd@1",
					kind: "task",
					ports: { in: { candidates: "core:shape/turn-candidates@1" }, out: STRATEGY_PORTS.out }
				}
			}
		])
		expect((await swapContributionProblems(db, misfit))[0]).toContain(
			"'acme:task/turn-odd@1' cannot stand in for 'decide.rules.strategy'"
		)
	})
})

describe("R62 · a contribution must be public", () => {
	it("a private contribution is refused at install, naming the fix", async () => {
		const problems = await swapContributionProblems(
			db,
			manifest("acme:task/turn-natural@1", "core:spec/chat-turn-order", "decide.rules.strategy", [
				decl("acme:task/turn-natural@1", { public: undefined })
			])
		)
		expect(problems).toHaveLength(1)
		expect(problems[0]).toMatch(/is private.*visibility: 'public'/)
	})
})
