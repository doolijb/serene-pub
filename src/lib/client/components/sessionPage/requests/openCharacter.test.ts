/** `open-character` opens the characters panel on one character, for any widget. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerOpenCharacter } from "./openCharacter"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

function page() {
	const did: string[] = []
	return {
		did,
		deps: {
			openCharactersPanel: () => did.push("open"),
			viewCharacter: (id: number) => did.push(`view ${id}`)
		}
	}
}

describe("answerOpenCharacter", () => {
	test("opens the panel, then points it at the character", () => {
		const { did, deps } = page()
		answerOpenCharacter({ characterId: 4 }, deps)
		expect(did).toEqual(["open", "view 4"])
	})

	test.each([{}, { characterId: "four" }])("refuses %j in words, opening nothing", (params) => {
		const { did, deps } = page()
		expect(() => answerOpenCharacter(params, deps)).toThrow("open-character needs a characterId")
		expect(did).toEqual([])
	})

	test("anyone may ask: a plugin's widget passes the askers guard", async () => {
		expect(WIDGET_REQUEST_ASKERS["open-character"]).toBe("any")
		const { did, deps } = page()
		const ask = guardWidgetRequests((async (_k: string, p: unknown) => answerOpenCharacter(p, deps)) as WidgetRequestHandler)
		await ask("open-character", { characterId: 2 }, { widgetId: "acme:x", owner: "acme" })
		expect(did).toEqual(["open", "view 2"])
	})
})
