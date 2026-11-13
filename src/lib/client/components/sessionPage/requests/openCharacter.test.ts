/** `open-character` opens the characters panel on one character, for any widget. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerOpenCharacter } from "./openCharacter"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

/** A page whose book holds a cast member for card 4 (member 40) and no other. */
function page() {
	const did: string[] = []
	return {
		did,
		deps: {
			castMemberOf: (characterId: number) =>
				characterId === 4 ? { lorebookId: 7, castId: 40 } : null,
			openCastMember: ({ lorebookId, castId }: { lorebookId: number; castId: number }) =>
				did.push(`member ${castId} in book ${lorebookId}`),
			openCharactersPanel: () => did.push("open"),
			viewCharacter: (id: number) => did.push(`view ${id}`)
		}
	}
}

describe("answerOpenCharacter", () => {
	test("a card the session's book holds opens as its cast member, never the card", () => {
		const { did, deps } = page()
		answerOpenCharacter({ characterId: 4 }, deps)
		expect(did).toEqual(["member 40 in book 7"])
	})

	test("a card the book does not hold opens the characters panel, then points it at the card", () => {
		const { did, deps } = page()
		answerOpenCharacter({ characterId: 5 }, deps)
		expect(did).toEqual(["open", "view 5"])
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
		await ask("open-character", { characterId: 4 }, { widgetId: "acme:x", owner: "acme" })
		expect(did).toEqual(["open", "view 2", "member 40 in book 7"])
	})
})

describe("answerOpenCharacter when the page answers later", () => {
	/** A page whose `castMemberOf` answers with a Promise, and records the sheet. */
	function laterPage(answer: unknown) {
		const { did, deps } = page()
		return {
			did,
			deps: {
				...deps,
				castMemberOf: async () => answer as never,
				openSeatMemberSheet: (id: number) => did.push(`sheet ${id}`)
			}
		}
	}

	test("an address it resolves opens the member", async () => {
		const { did, deps } = laterPage({ lorebookId: 9, castId: 90 })
		await answerOpenCharacter({ characterId: 4 }, deps)
		expect(did).toEqual(["member 90 in book 9"])
	})

	test('"sheet" opens the read-only sheet and nothing else', async () => {
		const { did, deps } = laterPage("sheet")
		await answerOpenCharacter({ characterId: 4 }, deps)
		expect(did).toEqual(["sheet 4"])
	})

	test("null opens the card", async () => {
		const { did, deps } = laterPage(null)
		await answerOpenCharacter({ characterId: 4 }, deps)
		expect(did).toEqual(["open", "view 4"])
	})

	test("a refusal rejects, opening nothing", async () => {
		const { did, deps } = laterPage(null)
		const refused = {
			...deps,
			castMemberOf: async () => {
				throw new Error("Access denied.")
			}
		}
		await expect(answerOpenCharacter({ characterId: 4 }, refused)).rejects.toThrow("Access denied.")
		expect(did).toEqual([])
	})
})
