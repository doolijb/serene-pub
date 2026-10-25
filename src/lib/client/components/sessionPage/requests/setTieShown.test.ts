/** 🚧 `set-tie-shown` (ties on the graph, screen 2): a tie side's number shown or hidden — one `state:showTieSide`. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerSetTieShown, tieShownReplyKey, type TieShownWrite } from "./setTieShown"

describe("answerSetTieShown", () => {
	test("one write naming the side; the reply's word comes back; a refusal rejects in its words", async () => {
		const asked: Parameters<TieShownWrite>[0][] = []
		const write: TieShownWrite = async (ask) => {
			asked.push(ask)
			return { sessionId: ask.sessionId, shown: ask.shown }
		}
		const params = { owner: { kind: "session_cast", id: 4 }, entryType: "bond", towards: "character:5", shown: true }
		expect(await answerSetTieShown(params, 9, write)).toEqual({ shown: true })
		expect(asked).toEqual([{ sessionId: 9, owner: { kind: "session_cast", id: 4 }, entryType: "bond", towards: "character:5", shown: true }])
		await expect(answerSetTieShown(params, 9, async () => ({ error: "Only its holder can show that side." }))).rejects.toThrow(
			"Only its holder can show that side."
		)
		await expect(answerSetTieShown({ ...params, owner: { kind: "session", id: 1 } }, 9, write)).rejects.toThrow(/whose side/)
		await expect(answerSetTieShown({ ...params, shown: "yes" }, 9, write)).rejects.toThrow(/true or false/)
		await expect(answerSetTieShown(params, null, write)).rejects.toThrow(/no session/)
		expect(tieShownReplyKey({ request: "r1" })).toBe("r1")
	})

	test("a plugin's widget needs the session's write grant, as for set-attribute-value", async () => {
		expect(WIDGET_REQUEST_ASKERS["set-tie-shown"]).toEqual({ scope: "session:state", write: true })
		const params = { owner: { kind: "player_seat", id: 2 }, entryType: "bond", towards: "player-seat:1", shown: false }
		const write: TieShownWrite = async (ask) => ({ shown: ask.shown })
		await expect(answerSetTieShown(params, 9, write, { widgetId: "acme:x", owner: "acme", grants: [] } as never)).rejects.toThrow(/write grant/)
		expect(await answerSetTieShown(params, 9, write, { widgetId: "acme:x", owner: "acme", grants: ["session:state:write"] } as never)).toEqual({ shown: false })
	})
})
