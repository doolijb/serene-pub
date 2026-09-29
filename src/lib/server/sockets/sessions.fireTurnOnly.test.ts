/**
 * A turn is pressed with `sessions:fireTurn` and nothing else (lair pass
 * F5 / B6): the one-release alias `sessions:triggerGenerateMessage` is gone
 * from the server, the typed client map and the interest list, so a client
 * on the old verb fails loudly instead of being answered on an event nobody
 * listens for.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { GATED_EVENTS } from "$lib/shared/sockets/interest"

const ALIAS = "sessions:triggerGenerateMessage"
const read = (rel: string) =>
	readFileSync(resolve(__dirname, rel), "utf8")

describe("sessions:triggerGenerateMessage is retired", () => {
	test("the server registers no handler for it", () => {
		const src = read("./sessions.ts")
		expect(src).not.toContain(`event: "${ALIAS}"`)
		expect(src).not.toContain("triggerGenerateMessageHandler")
		expect(src).toContain(`event: "sessions:fireTurn"`)
	})

	test("the typed client map and the interest list do not name it", () => {
		expect(read("../../client/sockets/typedSocket.ts")).not.toContain(ALIAS)
		expect(GATED_EVENTS.has(ALIAS)).toBe(false)
		expect(GATED_EVENTS.has(`${ALIAS}:error`)).toBe(false)
	})
})
