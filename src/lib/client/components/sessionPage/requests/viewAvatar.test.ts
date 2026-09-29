/** `view-avatar` shows a participant's avatar by the ref a widget was shown. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerViewAvatar } from "./viewAvatar"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

const cast: Record<string, { name: string }> = { "c:1": { name: "Ada" } }

function page() {
	const shown: string[] = []
	return {
		shown,
		deps: {
			characterForRef: (ref: string) => cast[ref],
			viewAvatar: (who: { name: string }) => shown.push(who.name)
		}
	}
}

describe("answerViewAvatar", () => {
	test("shows the participant the ref names", () => {
		const { shown, deps } = page()
		answerViewAvatar({ ref: "c:1" }, deps)
		expect(shown).toEqual(["Ada"])
	})

	test("refuses a ref naming no one, in words", () => {
		const { shown, deps } = page()
		expect(() => answerViewAvatar({ ref: "c:9" }, deps)).toThrow("no participant 'c:9' in this session")
		expect(() => answerViewAvatar({}, deps)).toThrow("no participant 'undefined' in this session")
		expect(shown).toEqual([])
	})

	test("anyone may ask: a plugin's widget passes the askers guard", async () => {
		expect(WIDGET_REQUEST_ASKERS["view-avatar"]).toBe("any")
		const { shown, deps } = page()
		const ask = guardWidgetRequests((async (_k: string, p: unknown) => answerViewAvatar(p, deps)) as WidgetRequestHandler)
		await ask("view-avatar", { ref: "c:1" }, { widgetId: "acme:x", owner: "acme" })
		expect(shown).toEqual(["Ada"])
	})
})
