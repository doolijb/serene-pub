/** `messages` answers with the page's next older page, for any widget. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerMessages } from "./messages"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

const page = { rows: [], nextCursor: "7" }

describe("answerMessages", () => {
	test("answers with the page's older page, ignoring the request's cursor", async () => {
		let asked = 0
		const olderPage = async () => (asked++, page)
		expect(await answerMessages({ cursor: "99", limit: 1 }, { olderPage })).toBe(page)
		expect(asked).toBe(1)
	})

	test("the pager's failure is the widget's refusal, in its words", async () => {
		const olderPage = async () => {
			throw new Error("the session is not loaded")
		}
		await expect(answerMessages({}, { olderPage })).rejects.toThrow("the session is not loaded")
	})

	test("anyone may ask: a plugin's widget passes the askers guard", async () => {
		expect(WIDGET_REQUEST_ASKERS.messages).toBe("any")
		const ask = guardWidgetRequests((async (_k: string, p: unknown) =>
			answerMessages(p, { olderPage: async () => page })) as WidgetRequestHandler)
		expect(await ask("messages", {}, { widgetId: "acme:x", owner: "acme" })).toBe(page)
	})
})
