/** `prompt-details` opens a line's recorded prompt — for admins, with context debugging on. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerPromptDetails, type PromptLine, type PromptReport } from "./promptDetails"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

const lines: PromptLine[] = [
	{ id: 1, debugMeta: { prompt: "P", messages: [{ role: "user" }], tokens: 9 } },
	{ id: 2 }
]

function page(over: { isAdmin?: boolean; contextDebugging?: boolean } = {}) {
	const shown: PromptReport[] = []
	return {
		shown,
		deps: {
			isAdmin: over.isAdmin ?? true,
			contextDebugging: over.contextDebugging ?? true,
			findMessage: (id: number) => lines.find((m) => m.id === id),
			showReport: (r: PromptReport) => shown.push(r)
		}
	}
}

describe("answerPromptDetails", () => {
	test("shows the line's recorded prompt", () => {
		const { shown, deps } = page()
		answerPromptDetails({ messageId: 1 }, deps)
		expect(shown).toEqual([
			{ messageId: 1, prompt: "P", messages: [{ role: "user" }], meta: lines[0]!.debugMeta }
		])
	})

	test.each([{ isAdmin: false }, { contextDebugging: false }])("refuses when %j, in words", (over) => {
		const { shown, deps } = page(over)
		expect(() => answerPromptDetails({ messageId: 1 }, deps)).toThrow(
			"prompt details are for admins, with context debugging on"
		)
		expect(shown).toEqual([])
	})

	test.each([{ messageId: 2 }, { messageId: 99 }])("refuses %j (no recorded prompt), in words", (params) => {
		const { shown, deps } = page()
		expect(() => answerPromptDetails(params, deps)).toThrow("that message has no recorded prompt")
		expect(shown).toEqual([])
	})

	test("anyone may ask: the guard passes a plugin's widget on; the admin rule is the answer's", async () => {
		expect(WIDGET_REQUEST_ASKERS["prompt-details"]).toBe("any")
		const { deps } = page({ isAdmin: false })
		const ask = guardWidgetRequests((async (_k: string, p: unknown) => answerPromptDetails(p, deps)) as WidgetRequestHandler)
		await expect(ask("prompt-details", { messageId: 1 }, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(
			"prompt details are for admins"
		)
	})
})
