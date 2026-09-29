/** `open-lore` points the lorebooks panel at a book, entry or scene, then opens it. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerOpenLore, type LoreTarget } from "./openLore"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

function page() {
	const did: Array<LoreTarget | "open"> = []
	return {
		did,
		deps: { showLore: (t: LoreTarget) => did.push(t), openLorebooksPanel: () => did.push("open") }
	}
}

describe("answerOpenLore", () => {
	test("points the panel at the target, then opens it", () => {
		const { did, deps } = page()
		answerOpenLore({ lorebookId: 3, scope: "scenes", sceneId: 8 }, deps)
		expect(did).toEqual([{ lorebookId: 3, scope: "scenes", entryId: undefined, sceneId: 8 }, "open"])
	})

	test("refuses nothing: fields of the wrong shape are dropped, and any scope but scenes is history", () => {
		const { did, deps } = page()
		answerOpenLore({ lorebookId: "3", scope: "nowhere", entryId: "x", sceneId: null }, deps)
		expect(did).toEqual([
			{ lorebookId: undefined, scope: "history", entryId: undefined, sceneId: undefined },
			"open"
		])
	})

	test("anyone may ask: a plugin's widget passes the askers guard", async () => {
		expect(WIDGET_REQUEST_ASKERS["open-lore"]).toBe("any")
		const { did, deps } = page()
		const ask = guardWidgetRequests((async (_k: string, p: unknown) => answerOpenLore(p, deps)) as WidgetRequestHandler)
		await ask("open-lore", { scope: "history", entryId: 5 }, { widgetId: "acme:x", owner: "acme" })
		expect(did.at(-1)).toBe("open")
	})
})
