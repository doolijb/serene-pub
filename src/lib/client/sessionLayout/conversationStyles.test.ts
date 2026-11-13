import { afterEach, describe, expect, test } from "vitest"
import {
	clearConversationStyleSources,
	conversationStyleSources,
	styleSourceOf
} from "./conversationStyles"
import { setWidgetStylePins } from "$lib/client/stores/widgetStyles.svelte"

afterEach(() => {
	clearConversationStyleSources()
	setWidgetStylePins({})
})

describe("styleSourceOf", () => {
	test("an id with no target wears its own", () => {
		expect(styleSourceOf("composer")).toBe("composer")
	})
	test("a composer with a target and no pin wears the target's", () => {
		conversationStyleSources.set("composer", "messages")
		expect(styleSourceOf("composer")).toBe("messages")
	})
	test("a composer pinned its own keeps it", () => {
		conversationStyleSources.set("composer", "messages")
		setWidgetStylePins({ composer: { id: 1, slug: "mine" } })
		expect(styleSourceOf("composer")).toBe("composer")
	})
	test("clearing forgets every target", () => {
		conversationStyleSources.set("composer", "messages")
		clearConversationStyleSources()
		expect(styleSourceOf("composer")).toBe("composer")
	})
})
