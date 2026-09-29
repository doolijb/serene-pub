/**
 * The per-character visibility switch is retired (2026-09-27): the session's
 * `characterDetail` genre field (Chat, Adventure) replaced it, and it renders
 * in the genre fields like any other declared field.
 *
 * The session form is a 2,000-line component with no mount harness, so this
 * reads its source: no control, no emit, no listener for the retired event,
 * and the event gone from the typed socket map and the interest list.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { GATED_EVENTS } from "$lib/shared/sockets/interest"

const read = (rel: string) =>
	readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

describe("the session form has no per-character visibility", () => {
	it("renders no control and emits nothing for it", () => {
		const form = read("./EditSessionForm.svelte")
		expect(form).not.toContain("updateSessionCharacterVisibility")
		expect(form).not.toContain("SessionCharacterVisibility")
		expect(form).not.toContain("getNextVisibility")
		// The active toggle beside it is still there.
		expect(form).toContain("sessions:toggleSessionCharacterActive")
	})

	it("the event is gone from the typed socket map and the interest list", () => {
		expect(read("../../sockets/typedSocket.ts")).not.toContain(
			"sessions:updateSessionCharacterVisibility"
		)
		expect([...GATED_EVENTS]).not.toContain(
			"sessions:updateSessionCharacterVisibility"
		)
	})
})
