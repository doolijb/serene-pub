/**
 * The reasoning phase as a status (owner note 39, 2026-10-03): while the reply's
 * trace streams the row reads *{speaker} is reasoning*, and the node's own
 * status (*is typing*) stands again at the first body token. One source — the
 * relay — for the row, the session list and the caller's frames.
 */

import { describe, expect, it, vi } from "vitest"
import { renderStatusText, type StatusText } from "@serene-pub/sdk"

vi.mock("$lib/server/db", () => ({ db: {} }))

const { createStatusRelay, REASONING_STATUS } = await import("./runStatus")

function relayWith(opts: { sideCharacterName?: string | null } = {}) {
	const shown: string[] = []
	const live = {
		status: async (text: StatusText) => {
			shown.push(renderStatusText(text))
		}
	}
	const relay = createStatusRelay({
		db: {} as any,
		sessionId: 1,
		runId: "run-reasoning",
		live: live as any,
		sideCharacterName: opts.sideCharacterName,
		// A run with a speaker reference but nobody to look up: the side
		// character's name is what fills `{speaker}`, without a read.
		speaker: opts.sideCharacterName ? null : undefined
	})
	return { relay, shown }
}

describe("StatusRelay.reasoning", () => {
	it("says reasoning while the trace streams, then the node's own status again", async () => {
		const { relay, shown } = relayWith({ sideCharacterName: "Wren" })
		relay.set("generate", { i18n: { en: "{speaker} is typing" } })
		relay.reasoning(true)
		relay.reasoning(true) // a repeat is not a new status
		relay.reasoning(false)
		await relay.end()
		expect(shown).toEqual([
			"Wren is typing",
			"Wren is reasoning",
			"Wren is typing"
		])
	})

	it("a run with nobody to name says plain reasoning, never a mangled {speaker}", async () => {
		const { relay, shown } = relayWith()
		relay.reasoning(true)
		await relay.end()
		expect(shown).toEqual(["reasoning"])
	})

	it("the status text is one constant — the row, the list and the card read the same words", () => {
		expect(REASONING_STATUS).toEqual({
			i18n: { en: "{speaker} is reasoning" }
		})
	})
})
