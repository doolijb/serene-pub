/** `actions-seen` clears the "new" marks on core's own lists — core's widgets only. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerActionsSeen } from "./actionsSeen"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

function page() {
	const seen: string[][] = []
	return { seen, deps: { markActionsSeen: (keys: string[]) => seen.push(keys) } }
}

describe("answerActionsSeen", () => {
	test("marks the keys seen; no keys marks none", () => {
		const { seen, deps } = page()
		answerActionsSeen({ keys: ["core:a", "core:b"] }, deps)
		answerActionsSeen({}, deps)
		expect(seen).toEqual([["core:a", "core:b"], []])
	})

	test("core only: a plugin's widget is refused in words and no mark is cleared", async () => {
		expect(WIDGET_REQUEST_ASKERS["actions-seen"]).toBe("core")
		const { seen, deps } = page()
		const ask = guardWidgetRequests((async (_k: string, p: unknown) => answerActionsSeen(p, deps)) as WidgetRequestHandler)
		await expect(ask("actions-seen", { keys: ["other:x"] }, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(
			"only core's own widgets ask 'actions-seen'"
		)
		expect(seen).toEqual([])
		await ask("actions-seen", { keys: ["core:a"] }, { widgetId: "actions", owner: "core" })
		expect(seen).toEqual([["core:a"]])
	})
})
