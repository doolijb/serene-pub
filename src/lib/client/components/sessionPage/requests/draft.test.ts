/** `draft` replaces the composer's draft — core's widgets only; it refuses nothing else. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerDraft } from "./draft"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

describe("answerDraft", () => {
	test("replaces the draft; no content empties it", () => {
		const drafts: string[] = []
		answerDraft({ content: "hello" }, { setDraft: (c) => drafts.push(c) })
		answerDraft({}, { setDraft: (c) => drafts.push(c) })
		expect(drafts).toEqual(["hello", ""])
	})

	test("core only: a plugin's widget is refused in words and the draft is untouched", async () => {
		expect(WIDGET_REQUEST_ASKERS.draft).toBe("core")
		const drafts: string[] = []
		const ask = guardWidgetRequests((async (_k: string, p: unknown) =>
			answerDraft(p, { setDraft: (c) => drafts.push(c) })) as WidgetRequestHandler)
		await expect(ask("draft", { content: "x" }, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(
			"only core's own widgets ask 'draft'"
		)
		expect(drafts).toEqual([])
		await ask("draft", { content: "x" }, { widgetId: "composer", owner: "core" })
		expect(drafts).toEqual(["x"])
	})
})
