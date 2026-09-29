/** `pick-turn` opens the page's turn picker, for any widget; it refuses nothing. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerPickTurn } from "./pickTurn"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

describe("answerPickTurn", () => {
	test("opens the turn picker, whatever the params", () => {
		let shown = 0
		answerPickTurn({}, { showTurnPicker: () => shown++ })
		answerPickTurn(undefined, { showTurnPicker: () => shown++ })
		expect(shown).toBe(2)
	})

	test("anyone may ask: a plugin's widget passes the askers guard, an unknown kind does not", async () => {
		expect(WIDGET_REQUEST_ASKERS["pick-turn"]).toBe("any")
		let shown = 0
		const ask = guardWidgetRequests((async (_k: string, p: unknown) =>
			answerPickTurn(p, { showTurnPicker: () => shown++ })) as WidgetRequestHandler)
		await ask("pick-turn", {}, { widgetId: "acme:x", owner: "acme" })
		await expect(ask("pick-turns" as never, {} as never, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(
			"'pick-turns' is not something a host answers"
		)
		expect(shown).toBe(1)
	})
})
