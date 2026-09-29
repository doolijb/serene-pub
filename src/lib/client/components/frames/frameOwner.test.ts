/**
 * A frame's owner, as its widget wire reports it to the page: the plugin its
 * address names — and never `core`, whose requests the page answers with the
 * app's own authority.
 */
import { describe, expect, test } from "vitest"
import { frameOwnerOf } from "./frameOwner"

describe("frameOwnerOf", () => {
	test("is the plugin the frame's address names", () => {
		expect(frameOwnerOf("/plugin-ui/chariot.dice-tray/ui/tray.html")).toBe("chariot.dice-tray")
	})

	test("is never core, however the address spells it", () => {
		expect(frameOwnerOf("/plugin-ui/core/ui/panel.html")).toBe("unknown")
		expect(frameOwnerOf("/plugin-ui/c%6Fre/ui/panel.html")).toBe("unknown")
	})

	test("is unknown for an address that names no plugin, or does not decode", () => {
		expect(frameOwnerOf("/media/abc")).toBe("unknown")
		expect(frameOwnerOf("/plugin-ui/%E0%A4%A/x.html")).toBe("unknown")
	})
})
