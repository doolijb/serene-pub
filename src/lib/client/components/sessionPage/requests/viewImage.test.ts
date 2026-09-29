/**
 * `view-image`: core's messages show images from anywhere; a plugin's widget
 * only the app's own (R69).
 */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerViewImage } from "./viewImage"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

const core = { owner: "core" }
const plugin = { owner: "acme" }

function page() {
	const shown: string[] = []
	return { shown, deps: { viewImage: (src: string) => shown.push(src) } }
}

describe("answerViewImage", () => {
	test("core's widgets show an image from anywhere; a plugin's the app's own media", () => {
		const { shown, deps } = page()
		answerViewImage({ src: "https://example.com/a.png" }, core, deps)
		answerViewImage({ src: "data:image/png;base64,AA" }, core, deps)
		answerViewImage({ src: "/media/1.png" }, plugin, deps)
		expect(shown).toEqual(["https://example.com/a.png", "data:image/png;base64,AA", "/media/1.png"])
	})

	test.each([
		[{ src: "https://example.com/a.png" }, plugin],
		[{ src: "/media/../secret" }, plugin],
		[{ src: "javascript:alert(1)" }, core],
		[{}, core]
	])("refuses %j from %j in words, showing nothing", (params, from) => {
		const { shown, deps } = page()
		expect(() => answerViewImage(params, from, deps)).toThrow("view-image shows the app's own images only")
		expect(shown).toEqual([])
	})

	test("anyone may ask: the guard passes a plugin's widget on, and the answer holds it to the app's media", async () => {
		expect(WIDGET_REQUEST_ASKERS["view-image"]).toBe("any")
		const { shown, deps } = page()
		const ask = guardWidgetRequests((async (_k: string, p: unknown, from: { owner: string }) =>
			answerViewImage(p, from, deps)) as WidgetRequestHandler)
		await ask("view-image", { src: "/media/2.png" }, { widgetId: "acme:x", owner: "acme" })
		await expect(ask("view-image", { src: "https://x.test/y.png" }, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(
			"view-image shows the app's own images only"
		)
		expect(shown).toEqual(["/media/2.png"])
	})
})
