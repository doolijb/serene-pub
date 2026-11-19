/** `open-lore` points the lorebooks panel at a book, entry or scene, then opens it. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerOpenLore, type LoreTarget } from "./openLore"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

function page(who: { owner?: boolean; own?: number | null; book?: number | null } = {}) {
	const did: Array<LoreTarget | "open"> = []
	return {
		did,
		deps: {
			showLore: (t: LoreTarget) => did.push(t),
			openLorebooksPanel: () => did.push("open"),
			isSessionOwner: () => who.owner ?? true,
			ownBookId: () => (who.own === undefined ? 9 : who.own),
			sessionBookId: () => (who.book === undefined ? 9 : who.book)
		}
	}
}

describe("answerOpenLore", () => {
	test("points the panel at the target, then opens it", () => {
		const { did, deps } = page()
		answerOpenLore({ lorebookId: 3, scope: "scenes", sceneId: 8 }, deps)
		expect(did).toEqual([{ lorebookId: 3, scope: "scenes", entryId: undefined, sceneId: 8 }, "open"])
	})

	test("a place (W4): the Places scope at its entry", () => {
		const { did, deps } = page()
		answerOpenLore({ lorebookId: 3, scope: "places", entryId: 12 }, deps)
		expect(did).toEqual([{ lorebookId: 3, scope: "places", entryId: 12, sceneId: undefined }, "open"])
	})

	test("a guest asking for the session's notes is refused and the panel never opens", () => {
		const { did, deps } = page({ owner: false })
		expect(() => answerOpenLore({ lorebookId: 9, scope: "scenes", sceneId: 1 }, deps)).toThrow(
			"the session's notes are the session owner's"
		)
		// No book named: the page would open its own book.
		expect(() => answerOpenLore({ scope: "history" }, deps)).toThrow("the session's notes are the session owner's")
		expect(did).toEqual([])
	})

	test("the owner opens the notes; a guest opens an attached lorebook", () => {
		const owner = page({ owner: true })
		answerOpenLore({ lorebookId: 9, scope: "history" }, owner.deps)
		expect(owner.did.at(-1)).toBe("open")
		const guest = page({ owner: false, book: 4 })
		answerOpenLore({ lorebookId: 4, scope: "history" }, guest.deps)
		answerOpenLore({ scope: "history" }, guest.deps)
		expect(guest.did.filter((d) => d === "open")).toHaveLength(2)
	})

	test("fields of the wrong shape are dropped, and any scope but scenes or places is history", () => {
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
