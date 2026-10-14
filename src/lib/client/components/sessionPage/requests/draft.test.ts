/**
 * `draft` replaces the composer's draft — core's widgets, refusing nothing
 * else, or 🚧 a plugin's widget holding the write grant on the channel the
 * composer is on (D4).
 */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerDraft } from "./draft"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

describe("answerDraft", () => {
	test("replaces the draft; no content empties it", () => {
		const drafts: string[] = []
		answerDraft({ content: "hello" }, { setDraft: (c) => drafts.push(c) })
		answerDraft({}, { setDraft: (c) => drafts.push(c) })
		expect(drafts).toEqual(["hello", ""])
	})

	test("🚧 a plugin's draft (D4) is held to the composer's channel: declared and written, asked again here", () => {
		const drafts: string[] = []
		let on = "ooc"
		const deps = { setDraft: (c: string) => drafts.push(c), composerChannel: () => on }
		const acme = { widgetId: "acme:x", owner: "acme", channels: ["ooc"], grants: ["channel:ooc:write"] } as never
		answerDraft({ content: "roll 2d6" }, deps, acme)
		expect(drafts).toEqual(["roll 2d6"])
		// The composer moved to a channel the widget did not declare: refused, never moved back.
		on = "main"
		expect(() => answerDraft({ content: "x" }, deps, acme)).toThrow("the composer is on 'main', which is not one of this widget's channels")
		// Declared, not written.
		on = "ooc"
		expect(() =>
			answerDraft({ content: "x" }, deps, { widgetId: "acme:x", owner: "acme", channels: ["ooc"], grants: ["channel:ooc"] } as never)
		).toThrow("not granted the write grant 'channel:ooc:write'")
		expect(drafts).toEqual(["roll 2d6"])
	})
})

/** Through the page's door (`guardWidgetRequests`) — the SDK's askers table, D4's once the SDK is rebuilt. */
describe("draft behind the askers table", () => {
	test("🚧 D4: refused without the channel write grant, answered with it; core's always", async () => {
		expect(WIDGET_REQUEST_ASKERS.draft).toEqual({ scope: "channel", write: true })
		const drafts: string[] = []
		const deps = { setDraft: (c: string) => drafts.push(c), composerChannel: () => "ooc" }
		const ask = guardWidgetRequests((async (_k: string, p: unknown, from: never) =>
			answerDraft(p, deps, from)) as WidgetRequestHandler)
		await expect(
			ask("draft", { content: "x" }, { widgetId: "acme:x", owner: "acme", channels: ["ooc"] } as never)
		).rejects.toThrow("'channel:<slug>:write' on any channel it declares")
		expect(drafts).toEqual([])
		await ask("draft", { content: "x" }, { widgetId: "acme:x", owner: "acme", channels: ["ooc"], grants: ["channel:ooc:write"] } as never)
		await ask("draft", { content: "y" }, { widgetId: "composer", owner: "core" })
		expect(drafts).toEqual(["x", "y"])
	})
})
