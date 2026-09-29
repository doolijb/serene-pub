/** `switch-persona` switches the viewer's persona — core's widgets only. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerSwitchPersona } from "./switchPersona"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

describe("answerSwitchPersona", () => {
	test("passes the id on as a number; the page's own switch judges it", () => {
		const ids: number[] = []
		answerSwitchPersona({ personaId: 3 }, { switchPersona: (id) => ids.push(id) })
		answerSwitchPersona({ personaId: "5" }, { switchPersona: (id) => ids.push(id) })
		expect(ids).toEqual([3, 5])
	})

	test("core only: a plugin's widget is refused in words and no persona changes", async () => {
		expect(WIDGET_REQUEST_ASKERS["switch-persona"]).toBe("core")
		const ids: number[] = []
		const ask = guardWidgetRequests((async (_k: string, p: unknown) =>
			answerSwitchPersona(p, { switchPersona: (id) => ids.push(id) })) as WidgetRequestHandler)
		await expect(ask("switch-persona", { personaId: 1 }, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(
			"only core's own widgets ask 'switch-persona'"
		)
		expect(ids).toEqual([])
		await ask("switch-persona", { personaId: 1 }, { widgetId: "composer", owner: "core" })
		expect(ids).toEqual([1])
	})
})
