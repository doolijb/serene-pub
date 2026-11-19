/** `stop-run` stops what the turn line lists — core's widgets only, no toast. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerStopRun, type StopRunDeps } from "./stopRun"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

const deps = (
	runs: Record<string, { mayStop?: boolean }>,
	summaries: string[] = []
) => {
	const seen: string[] = []
	const d: StopRunDeps = {
		runOf: (id) => runs[id],
		isSummary: (id) => summaries.includes(id),
		cancelRun: (id) => void seen.push(`pipelines:cancelRun ${id}`),
		cancelActivity: (id) => void seen.push(`activity:cancel ${id}`)
	}
	return { d, seen }
}

describe("answerStopRun", () => {
	test("a registered run the viewer may stop is cancelled by its run id", () => {
		const { d, seen } = deps({ r1: { mayStop: true } })
		answerStopRun({ id: "r1" }, d)
		expect(seen).toEqual(["pipelines:cancelRun r1"])
	})

	test("a summary's id (no registered run) goes to activity:cancel", () => {
		const { d, seen } = deps({}, ["act-9"])
		answerStopRun({ id: "act-9" }, d)
		expect(seen).toEqual(["activity:cancel act-9"])
	})

	test("an id that is neither a registered run nor a summary does nothing", () => {
		const { d, seen } = deps({ r1: { mayStop: true } }, ["act-9"])
		answerStopRun({ id: "nope" }, d)
		expect(seen).toEqual([])
	})

	test("a run the viewer may not stop, and a blank or missing id, do nothing", () => {
		const { d, seen } = deps({ r1: { mayStop: false }, r2: {} })
		answerStopRun({ id: "r1" }, d)
		answerStopRun({ id: "r2" }, d)
		answerStopRun({ id: "  " }, d)
		answerStopRun({ id: 7 }, d)
		answerStopRun(undefined, d)
		expect(seen).toEqual([])
	})

	test("core only: a plugin's widget is refused in words and nothing is stopped", async () => {
		expect(WIDGET_REQUEST_ASKERS["stop-run"]).toBe("core")
		const { d, seen } = deps({ r1: { mayStop: true } })
		const ask = guardWidgetRequests((async (_k: string, p: unknown) =>
			answerStopRun(p, d)) as WidgetRequestHandler)
		await expect(ask("stop-run", { id: "r1" }, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(
			"only core's own widgets ask 'stop-run'"
		)
		expect(seen).toEqual([])
		await ask("stop-run", { id: "r1" }, { widgetId: "turn-line", owner: "core" })
		expect(seen).toEqual(["pipelines:cancelRun r1"])
	})
})
