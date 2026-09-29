/** `fire-turn` fires the next turn as the page's own continue does — core's widgets only. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerFireTurn } from "./fireTurn"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

describe("answerFireTurn", () => {
	test("fires the turn, whatever the params", () => {
		let fired = 0
		answerFireTurn({}, { fireTurn: () => fired++ })
		expect(fired).toBe(1)
	})

	test("hands on the channel of the composer it was pressed in (R5), a string or nothing", () => {
		const seen: Array<string | undefined> = []
		const deps = { fireTurn: (channel?: string) => void seen.push(channel) }
		answerFireTurn({ channel: "sanctum" }, deps)
		answerFireTurn({}, deps)
		answerFireTurn({ channel: 7 }, deps)
		answerFireTurn({ channel: "  " }, deps)
		expect(seen).toEqual(["sanctum", undefined, undefined, undefined])
	})

	test("core only: a plugin's widget is refused in words and no turn fires", async () => {
		expect(WIDGET_REQUEST_ASKERS["fire-turn"]).toBe("core")
		let fired = 0
		const ask = guardWidgetRequests((async (_k: string, p: unknown) =>
			answerFireTurn(p, { fireTurn: () => fired++ })) as WidgetRequestHandler)
		await expect(ask("fire-turn", {}, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(
			"only core's own widgets ask 'fire-turn'"
		)
		expect(fired).toBe(0)
		await ask("fire-turn", {}, { widgetId: "turn-order", owner: "core" })
		expect(fired).toBe(1)
	})
})
