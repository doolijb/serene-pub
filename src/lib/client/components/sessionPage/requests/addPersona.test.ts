/** `add-persona` opens the add-persona modal — core's widgets only. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerAddPersona } from "./addPersona"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

describe("answerAddPersona", () => {
	test("opens the modal, whatever the params", () => {
		let shown = 0
		answerAddPersona({}, { showAddPersona: () => shown++ })
		expect(shown).toBe(1)
	})

	test("core only: a plugin's widget is refused in words and no modal opens", async () => {
		expect(WIDGET_REQUEST_ASKERS["add-persona"]).toBe("core")
		let shown = 0
		const ask = guardWidgetRequests((async (_k: string, p: unknown) =>
			answerAddPersona(p, { showAddPersona: () => shown++ })) as WidgetRequestHandler)
		await expect(ask("add-persona", {}, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(
			"only core's own widgets ask 'add-persona'"
		)
		expect(shown).toBe(0)
		await ask("add-persona", {}, { widgetId: "composer", owner: "core" })
		expect(shown).toBe(1)
	})
})
