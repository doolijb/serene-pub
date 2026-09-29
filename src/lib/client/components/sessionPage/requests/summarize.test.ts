/**
 * `summarize` opens the summarize modal on a selection — core's widgets only.
 * A refused ask leaves the page's selection alone, so the widget keeps its own.
 */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerSummarize, type SummaryKind } from "./summarize"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

function page(over: { opensScenes?: boolean; gap?: boolean } = {}) {
	const did: Array<string> = []
	let open = false
	return {
		did,
		deps: {
			scened: new Set([3]),
			opensScenes: () => over.opensScenes ?? true,
			select: (ids: number[]) => did.push(`select ${ids.join(",")}`),
			openSummarize: (kind: SummaryKind) => {
				did.push(`open ${kind}`)
				open = !over.gap
			},
			summarizeOpen: () => open
		}
	}
}

describe("answerSummarize", () => {
	test("selects the lines not yet in a scene and opens the modal; an unknown kind is world", () => {
		const { did, deps } = page()
		answerSummarize({ kind: "scene", messageIds: [1, 2, 3] }, deps)
		expect(did).toEqual(["select 1,2", "open scene"])
		const other = page()
		answerSummarize({ kind: "galaxy", messageIds: [4] }, other.deps)
		expect(other.did).toEqual(["select 4", "open world"])
	})

	test("refuses an empty selection (or one wholly scened), in words, selecting nothing", () => {
		const { did, deps } = page()
		expect(() => answerSummarize({ kind: "world", messageIds: [3] }, deps)).toThrow("select at least one message")
		expect(() => answerSummarize({}, deps)).toThrow("select at least one message")
		expect(did).toEqual([])
	})

	test("refuses a scene where the session opens none, in words, selecting nothing", () => {
		const { did, deps } = page({ opensScenes: false })
		expect(() => answerSummarize({ kind: "scene", messageIds: [1] }, deps)).toThrow(
			"this session does not open scenes"
		)
		expect(did).toEqual([])
		answerSummarize({ kind: "character", messageIds: [1] }, deps)
		expect(did).toEqual(["select 1", "open character"])
	})

	test("the modal's gap check refusing is the widget's refusal too", () => {
		const { deps } = page({ gap: true })
		expect(() => answerSummarize({ kind: "world", messageIds: [1, 5] }, deps)).toThrow("the selection has a gap")
	})

	test("core only: a plugin's widget is refused in words before anything is selected", async () => {
		expect(WIDGET_REQUEST_ASKERS.summarize).toBe("core")
		const { did, deps } = page()
		const ask = guardWidgetRequests((async (_k: string, p: unknown) => answerSummarize(p, deps)) as WidgetRequestHandler)
		await expect(
			ask("summarize", { kind: "world", messageIds: [1] }, { widgetId: "acme:x", owner: "acme" })
		).rejects.toThrow("only core's own widgets ask 'summarize'")
		expect(did).toEqual([])
		await ask("summarize", { kind: "world", messageIds: [1] }, { widgetId: "messages", owner: "core" })
		expect(did).toEqual(["select 1", "open world"])
	})
})
