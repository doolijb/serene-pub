/**
 * The composer's turn controls — Continue and "Pick who speaks" — press a
 * turn with `sessions:fireTurn`, and a refusal comes back as a sentence the
 * page toasts (lair pass F5 / B6).
 */
import { describe, expect, test } from "vitest"
import { fireTurn, fireTurnRefusal, pushSaysNoReply } from "./turnControls"

function recorder() {
	const sent: Array<{ event: string; params: unknown }> = []
	return {
		sent,
		socket: {
			emit: (event: string, params: unknown) => {
				sent.push({ event, params })
			}
		}
	}
}

describe("fireTurn", () => {
	test("Continue fires the head on sessions:fireTurn", () => {
		const { sent, socket } = recorder()
		fireTurn(socket, 7)
		expect(sent).toEqual([
			{ event: "sessions:fireTurn", params: { sessionId: 7 } }
		])
	})

	test("Continue names the channel of the composer it was pressed in (R5); main says nothing", () => {
		const { sent, socket } = recorder()
		fireTurn(socket, 7, undefined, "sanctum")
		fireTurn(socket, 7, undefined, "main")
		expect(sent).toEqual([
			{ event: "sessions:fireTurn", params: { sessionId: 7, channel: "sanctum" } },
			{ event: "sessions:fireTurn", params: { sessionId: 7 } }
		])
	})

	test("a pick names the character's ref, recorded as a pick", () => {
		const { sent, socket } = recorder()
		fireTurn(socket, 7, { characterId: 12 })
		expect(sent).toEqual([
			{
				event: "sessions:fireTurn",
				params: {
					sessionId: 7,
					entry: { ref: "character:12", via: "pick" }
				}
			}
		])
	})

	test("the narrator's turn (B8) names the null ref, recorded as a pick", () => {
		const { sent, socket } = recorder()
		fireTurn(socket, 7, { narrator: true })
		expect(sent).toEqual([
			{
				event: "sessions:fireTurn",
				params: { sessionId: 7, entry: { ref: null, via: "pick" } }
			}
		])
	})

	test("R8: Narrate says the composer it was pressed in — never main, and never a pick's", () => {
		const { sent, socket } = recorder()
		fireTurn(socket, 7, { narrator: true }, "sanctum")
		fireTurn(socket, 7, { narrator: true }, "main")
		fireTurn(socket, 7, { characterId: 12 }, "sanctum")
		expect(sent.map((s) => s.params)).toEqual([
			{ sessionId: 7, entry: { ref: null, via: "pick" }, channel: "sanctum" },
			{ sessionId: 7, entry: { ref: null, via: "pick" } },
			{ sessionId: 7, entry: { ref: "character:12", via: "pick" } }
		])
	})

	test("never the retired alias", () => {
		const { sent, socket } = recorder()
		fireTurn(socket, 1)
		fireTurn(socket, 1, { characterId: 2 })
		expect(sent.map((s) => s.event)).not.toContain(
			"sessions:triggerGenerateMessage"
		)
	})
})

describe("fireTurnRefusal", () => {
	test("a refusal for this session surfaces the server's sentence", () => {
		expect(
			fireTurnRefusal(
				{
					sessionId: 7,
					ok: false,
					error: "Nothing is prepared to take a turn."
				},
				7
			)
		).toBe("Nothing is prepared to take a turn.")
	})

	test("another session's refusal is not this page's", () => {
		expect(
			fireTurnRefusal({ sessionId: 8, ok: false, error: "No." }, 7)
		).toBeNull()
	})

	test("a person's own turn is not an error", () => {
		expect(
			fireTurnRefusal({ sessionId: 7, ok: false, reason: "person" }, 7)
		).toBeNull()
	})
})

describe("pushSaysNoReply (lair pass B9)", () => {
	const order = { order: [], candidates: [] }
	test("a write's push that says auto-advance will not fire ends the wait", () => {
		expect(
			pushSaysNoReply({ sessionId: 7, turnOrder: order, autoAdvancing: false }, 7)
		).toBe(true)
	})
	test("a push that says the head is about to fire keeps waiting for the reply", () => {
		expect(
			pushSaysNoReply({ sessionId: 7, turnOrder: order, autoAdvancing: true }, 7)
		).toBe(false)
	})
	test("the view's push (no autoAdvancing) and another session's say nothing", () => {
		expect(pushSaysNoReply({ sessionId: 7, turnOrder: order }, 7)).toBe(false)
		expect(
			pushSaysNoReply({ sessionId: 8, turnOrder: order, autoAdvancing: false }, 7)
		).toBe(false)
	})
})
