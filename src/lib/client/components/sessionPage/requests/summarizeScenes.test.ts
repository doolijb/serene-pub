/** 🚧 `summarize-scenes` — Chronicle's background summaries (live scenes §5, §7), core's widgets only. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerSummarizeScenes } from "./summarizeScenes"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

describe("answerSummarizeScenes", () => {
	test("names the scenes asked for, or none for every scene with no summary yet, and says how many were queued", async () => {
		const asked: Array<number[] | undefined> = []
		const deps = {
			summarizeScenes: async (ids?: number[]) => {
				asked.push(ids)
				return ids ? ids.length : 3
			}
		}
		expect(await answerSummarizeScenes({ sceneIds: [4] }, deps)).toEqual({ started: 1 })
		expect(await answerSummarizeScenes({}, deps)).toEqual({ started: 3 })
		expect(await answerSummarizeScenes(undefined, deps)).toEqual({ started: 3 })
		expect(asked).toEqual([[4], undefined, undefined])
	})

	test("an empty list asks for nothing; a list that is not whole numbers is refused in words", async () => {
		let called = false
		const deps = {
			summarizeScenes: async () => {
				called = true
				return 0
			}
		}
		expect(await answerSummarizeScenes({ sceneIds: [] }, deps)).toEqual({ started: 0 })
		expect(called).toBe(false)
		await expect(answerSummarizeScenes({ sceneIds: ["4"] }, deps)).rejects.toThrow(
			"summarize-scenes takes sceneIds as a list of whole numbers"
		)
	})

	test("core only: a plugin's widget is refused in words and nothing is summarized", async () => {
		expect(WIDGET_REQUEST_ASKERS["summarize-scenes"]).toBe("core")
		let asked = 0
		const ask = guardWidgetRequests((async (_k: string, p: unknown) =>
			answerSummarizeScenes(p, {
				summarizeScenes: async () => {
					asked++
					return 1
				}
			})) as WidgetRequestHandler)
		await expect(
			ask("summarize-scenes", {}, { widgetId: "acme:x", owner: "acme" })
		).rejects.toThrow("only core's own widgets ask 'summarize-scenes'")
		expect(asked).toBe(0)
		await ask("summarize-scenes", {}, { widgetId: "chronicle", owner: "core" })
		expect(asked).toBe(1)
	})
})
