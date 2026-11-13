/** 🚧 `rewind-turn` · `forward-turn` (RF fix 5): Back and Forward, as the page presses them — core's widgets only. */
import { describe, expect, test, vi } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
const handlers = new Map<string, (data: any) => void>()
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (data: any) => void) => {
		handlers.set(key, handler)
		return () => {
			handlers.delete(key)
		}
	}
}))

import { answerForwardTurn, answerRewindTurn, rewindPresses } from "./rewindTurn"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

describe("answerRewindTurn · answerForwardTurn", () => {
	test("each presses its own, whatever the params", () => {
		const pressed: string[] = []
		const deps = { rewindTurn: () => void pressed.push("back"), forwardTurn: () => void pressed.push("forward") }
		answerRewindTurn({}, deps)
		answerForwardTurn({ anything: 1 }, deps)
		answerRewindTurn(undefined, deps)
		expect(pressed).toEqual(["back", "forward", "back"])
	})

	test("core only: a plugin's widget is refused in words and nothing is pressed", async () => {
		expect(WIDGET_REQUEST_ASKERS["rewind-turn"]).toBe("core")
		expect(WIDGET_REQUEST_ASKERS["forward-turn"]).toBe("core")
		const pressed: string[] = []
		const deps = { rewindTurn: () => void pressed.push("back"), forwardTurn: () => void pressed.push("forward") }
		const ask = guardWidgetRequests((async (kind: string, p: unknown) =>
			kind === "rewind-turn" ? answerRewindTurn(p, deps) : answerForwardTurn(p, deps)) as WidgetRequestHandler)
		await expect(ask("rewind-turn", {}, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(
			"only core's own widgets ask 'rewind-turn'"
		)
		await expect(ask("forward-turn", {}, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(
			"only core's own widgets ask 'forward-turn'"
		)
		expect(pressed).toEqual([])
		await ask("rewind-turn", {}, { widgetId: "messages", owner: "core" })
		await ask("forward-turn", {}, { widgetId: "messages", owner: "core" })
		expect(pressed).toEqual(["back", "forward"])
	})
})

describe("rewindPresses", () => {
	const setup = (id: number | null = 7) => {
		const sent: Array<[string, unknown]> = []
		const socket = { emit: (event: string, params: unknown) => void sent.push([event, params]) } as never
		const state = { id }
		return { sent, state, presses: rewindPresses(socket, () => state.id) }
	}
	const settle = () => new Promise((r) => setTimeout(r, 0))

	test("one emit path for Back and Forward; no session id, nothing sent", async () => {
		const { sent, state, presses } = setup()
		presses.rewindTurn()
		handlers.get("sessions:rewindTurn")!({ sessionId: 7 })
		await settle()
		presses.forwardTurn()
		expect(sent).toEqual([
			["sessions:rewindTurn", { sessionId: 7 }],
			["sessions:forwardTurn", { sessionId: 7 }]
		])
		handlers.get("sessions:forwardTurn")!({ sessionId: 7 })
		await settle()
		state.id = null
		presses.rewindTurn()
		presses.forwardTurn()
		expect(sent).toHaveLength(2)
	})

	test("a double press sends one; the reply frees the next", async () => {
		const { sent, presses } = setup()
		presses.rewindTurn()
		presses.rewindTurn()
		expect(sent).toHaveLength(1)
		handlers.get("sessions:rewindTurn")!({ sessionId: 7 })
		await settle()
		presses.rewindTurn()
		expect(sent).toHaveLength(2)
	})

	test("a reply for another session does not clear it", async () => {
		const { sent, presses } = setup()
		presses.rewindTurn()
		handlers.get("sessions:rewindTurn")!({ sessionId: 8 })
		await settle()
		presses.rewindTurn()
		expect(sent).toHaveLength(1)
	})

	test("the :error sibling clears it", async () => {
		const { sent, presses } = setup()
		presses.rewindTurn()
		handlers.get("sessions:rewindTurn:error")!({ sessionId: 7, error: "no" })
		await settle()
		presses.rewindTurn()
		expect(sent).toHaveLength(2)
	})

	test("Back pending blocks Forward", () => {
		const { sent, presses } = setup()
		presses.rewindTurn()
		presses.forwardTurn()
		expect(sent).toEqual([["sessions:rewindTurn", { sessionId: 7 }]])
	})
})
