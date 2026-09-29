import { describe, expect, test } from "vitest"
import { instanceNameOf, isInstanceOf, widgetOfInstance } from "./instanceId"

describe("widget instance ids (S1)", () => {
	test("a copy is its widget up to the #; the widget itself is its own", () => {
		expect(widgetOfInstance("messages#sanctum")).toBe("messages")
		expect(widgetOfInstance("messages")).toBe("messages")
		// A plugin widget id keeps its colon and dots; only `#` splits.
		expect(widgetOfInstance("acme.maps:map#dungeon")).toBe("acme.maps:map")
		expect(widgetOfInstance("acme.maps:map")).toBe("acme.maps:map")
	})

	test("the instance name, or none", () => {
		expect(instanceNameOf("messages#sanctum")).toBe("sanctum")
		expect(instanceNameOf("messages")).toBeNull()
		// A bare `#` names nothing, and a leading one is no widget.
		expect(instanceNameOf("messages#")).toBeNull()
		expect(widgetOfInstance("#sanctum")).toBe("#sanctum")
	})

	test("isInstanceOf: the widget and its copies, never a widget whose id merely starts the same", () => {
		expect(isInstanceOf("messages", "messages")).toBe(true)
		expect(isInstanceOf("messages#sanctum", "messages")).toBe(true)
		expect(isInstanceOf("messages-log", "messages")).toBe(false)
		expect(isInstanceOf("world-state", "messages")).toBe(false)
	})
})
