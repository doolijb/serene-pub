/** 🚧 `rewind-turn` · `forward-turn` (RF fix 5): Back and Forward, as the page presses them — core's widgets only. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
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

test("rewindPresses: one emit path for Back and Forward; no session id, nothing sent", () => {
	const sent: Array<[string, unknown]> = []
	const socket = { emit: (event: string, params: unknown) => void sent.push([event, params]) } as never
	let id: number | null = 7
	const presses = rewindPresses(socket, () => id)
	presses.rewindTurn()
	presses.forwardTurn()
	expect(sent).toEqual([
		["sessions:rewindTurn", { sessionId: 7 }],
		["sessions:forwardTurn", { sessionId: 7 }]
	])
	id = null
	presses.rewindTurn()
	presses.forwardTurn()
	expect(sent).toHaveLength(2)
})
