import { describe, it, expect } from "vitest"
import { frameSrc, parseFrameSrc } from "$lib/server/plugins/frameHost"

/**
 * The `/plugin-ui/` URL contract (20 §12): the FIRST segment is the plugin id
 * and the rest is the stored file path.
 *
 * The route used to read two segments as the id, on the assumption that a
 * plugin address carries a slash. A slug is dotted (SDK `defineExtension`:
 * `^[a-z0-9]+([.-][a-z0-9]+)*$`), so that reading took the first path segment
 * for half the id and no dotted-slug plugin could mount a frame at all. These
 * cases are that reading's gravestone: what the producer writes, the route
 * must read back.
 */
describe("parseFrameSrc", () => {
	it("reads a dotted id as one segment", () => {
		expect(
			parseFrameSrc("showcase.twenty-questions/ui/tally.html")
		).toEqual({
			pluginId: "showcase.twenty-questions",
			path: "ui/tally.html"
		})
	})

	it("reads a hyphenated id", () => {
		expect(parseFrameSrc("dice-tray/index.html")).toEqual({
			pluginId: "dice-tray",
			path: "index.html"
		})
	})

	it("keeps a nested path whole", () => {
		expect(parseFrameSrc("acme.forge/ui/sub/file.js")).toEqual({
			pluginId: "acme.forge",
			path: "ui/sub/file.js"
		})
	})

	it("round-trips whatever frameSrc produced", () => {
		const src = frameSrc("chariot.dice-tray", "ui/sub/panel.html")
		expect(src).toBe("/plugin-ui/chariot.dice-tray/ui/sub/panel.html")
		expect(parseFrameSrc(src.replace("/plugin-ui/", ""))).toEqual({
			pluginId: "chariot.dice-tray",
			path: "ui/sub/panel.html"
		})
	})

	it("refuses traversal out of the plugin's files", () => {
		expect(parseFrameSrc("acme.forge/../../etc/passwd")).toBeUndefined()
		expect(parseFrameSrc("acme.forge/ui/../../secret")).toBeUndefined()
		expect(parseFrameSrc("../../etc/passwd")).toBeUndefined()
	})

	it("refuses an id outside the slug grammar", () => {
		expect(parseFrameSrc("Acme.Forge/ui/index.html")).toBeUndefined()
		expect(parseFrameSrc(".acme/ui/index.html")).toBeUndefined()
		expect(parseFrameSrc("acme_forge/ui/index.html")).toBeUndefined()
	})

	it("never reassembles a legacy slashed id", () => {
		// A `namespace/name` address is not expressible in this URL: the
		// parse stops at the first segment, so the lookup asks for the plugin
		// `acme` (nothing, in practice) rather than guessing that two
		// segments were one id — which is what broke every dotted slug.
		expect(parseFrameSrc("acme/x/ui/index.html")).toEqual({
			pluginId: "acme",
			path: "x/ui/index.html"
		})
	})

	it("refuses a tail that is not both an id and a path", () => {
		expect(parseFrameSrc("acme.forge")).toBeUndefined()
		expect(parseFrameSrc("")).toBeUndefined()
		expect(parseFrameSrc(undefined)).toBeUndefined()
	})
})
