/**
 * F1: what a built component was built against decides whether this host
 * offers it at all — a plugin's by its manifest entry's `builtAgainst`, an
 * authored one's by its stored toolchain fingerprint.
 */
import { describe, expect, test } from "vitest"
import { HOST_ELEMENTS_VERSION, WIDGET_PROTOCOL, currentBuiltAgainst } from "@serene-pub/sdk"
import { authoredComponentRefusal, pluginComponentRefusal, pluginComponentRefusals } from "./compat"

const manifest = {
	components: [
		{ slug: "legacy", entry: "a.js" },
		{ slug: "today", entry: "b.js", builtAgainst: currentBuiltAgainst() },
		{ slug: "future", entry: "c.js", builtAgainst: { widgetProtocol: WIDGET_PROTOCOL + 1, hostElements: HOST_ELEMENTS_VERSION } },
		{ slug: "garbled", entry: "d.js", builtAgainst: "protocol two" }
	]
}

describe("plugin components", () => {
	test("today's record and no record mount; another protocol or an unreadable record is refused by name", () => {
		expect(pluginComponentRefusal(manifest, "legacy")).toBeUndefined()
		expect(pluginComponentRefusal(manifest, "today")).toBeUndefined()
		expect(pluginComponentRefusal(manifest, "future")).toBe(
			`built for widget protocol ${WIDGET_PROTOCOL + 1}; this host speaks ${WIDGET_PROTOCOL}`
		)
		expect(pluginComponentRefusal(manifest, "garbled")).toMatch(/not readable/)
		// Undeclared is the caller's own check, not a refusal.
		expect(pluginComponentRefusal(manifest, "absent")).toBeUndefined()
		expect(pluginComponentRefusal(null, "x")).toBeUndefined()
	})

	test("the admin list names every refused component, in declaration order", () => {
		expect(pluginComponentRefusals(manifest).map((r) => r.slug)).toEqual(["future", "garbled"])
		expect(pluginComponentRefusals({ components: "nope" })).toEqual([])
	})
})

describe("authored components", () => {
	test("judged off the stored fingerprint; one from before the record mounts", () => {
		expect(authoredComponentRefusal(null)).toBeUndefined()
		expect(authoredComponentRefusal("compiler@1 esbuild@0.28.0 sdk@0.6.0")).toBeUndefined()
		expect(
			authoredComponentRefusal(`compiler@1 widget-protocol@${WIDGET_PROTOCOL} host-elements@${HOST_ELEMENTS_VERSION} sdk@0.6.0`)
		).toBeUndefined()
		expect(authoredComponentRefusal(`compiler@3 widget-protocol@${WIDGET_PROTOCOL} host-elements@7.2`)).toBe(
			`built for host-element vocabulary 7.2; this host has ${HOST_ELEMENTS_VERSION}`
		)
	})
})
