/** `decide-proposal` accepts or rejects a state proposal — core's widgets only. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerDecideProposal } from "./decideProposal"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

describe("answerDecideProposal", () => {
	test("decides the proposal; a missing accept rejects", () => {
		const decided: Array<[number, boolean]> = []
		const deps = { decide: (id: number, accept: boolean) => decided.push([id, accept]) }
		answerDecideProposal({ proposalId: 7, accept: true }, deps)
		answerDecideProposal({ proposalId: "8" }, deps)
		expect(decided).toEqual([
			[7, true],
			[8, false]
		])
	})

	test("core only: a plugin's widget is refused in words and nothing is decided", async () => {
		expect(WIDGET_REQUEST_ASKERS["decide-proposal"]).toBe("core")
		const decided: number[] = []
		const ask = guardWidgetRequests((async (_k: string, p: unknown) =>
			answerDecideProposal(p, { decide: (id) => decided.push(id) })) as WidgetRequestHandler)
		await expect(
			ask("decide-proposal", { proposalId: 1, accept: true }, { widgetId: "acme:x", owner: "acme" })
		).rejects.toThrow("only core's own widgets ask 'decide-proposal'")
		expect(decided).toEqual([])
		await ask("decide-proposal", { proposalId: 1, accept: true }, { widgetId: "ledger", owner: "core" })
		expect(decided).toEqual([1])
	})
})
