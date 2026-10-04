/**
 * Media markers (PLAN-composer-attachments §3.5.4): lifted onto the right
 * role message, in order; neutralised everywhere placement did not write
 * them; flattened in a completion render.
 */
import { describe, expect, test } from "vitest"
import {
	flattenMediaMarkers,
	liftMediaMarkers,
	neutralizeRenderScope
} from "./mediaMarkers"
import { parseSplitChatPrompt } from "./parseSplitChatPrompt"
import { PromptBlockFormatter } from "./PromptBlockFormatter"

// The emitter the template's block helpers use in chat wire mode.
const block = (role: "user" | "assistant" | "system", content: string): string =>
	(PromptBlockFormatter as any).splitChatBlock(role, content)

describe("media markers", () => {
	test("markers land on the right role message, in order, and leave its text", () => {
		const prompt =
			block("system", "You are Mara.") +
			block("user", "Ash: look at these\n<@media:a1>\n<@media:b2>") +
			block("assistant", "Mara: lovely") +
			block("user", "Ash: and this <@media:c3>") +
			block("assistant", "Mara:")
		const messages = parseSplitChatPrompt(prompt) as any[]
		expect(messages.map((m) => m.role)).toEqual([
			"system",
			"user",
			"assistant",
			"user",
			"assistant"
		])
		expect(messages[1]).toEqual({
			role: "user",
			content: "Ash: look at these",
			attachments: [{ uuid: "a1" }, { uuid: "b2" }]
		})
		expect(messages[2]).toEqual({ role: "assistant", content: "Mara: lovely" })
		expect(messages[3].attachments).toEqual([{ uuid: "c3" }])
		expect(messages[3].content).toBe("Ash: and this")
		expect(messages[0]).not.toHaveProperty("attachments")
	})

	test("a prompt with no markers parses to exactly the objects it always did", () => {
		const prompt = block("user", "Ash: hi") + block("assistant", "Mara:")
		expect(parseSplitChatPrompt(prompt)).toEqual([
			{ role: "user", content: "Ash: hi" },
			{ role: "assistant", content: "Mara:" }
		])
	})

	test("a marker a person typed in a message body is neutralised before render, so nothing lifts it", () => {
		const scope = {
			systemPrompt: "rules <@media:lore>",
			sessionMessages: [
				{ id: 1, role: "user", name: "Ash", message: "steal <@media:victim>" },
				{ id: 2, role: "user", name: "Ash", message: "ok", attachments: "\n<@media:real>" }
			]
		}
		const safe = neutralizeRenderScope(scope)
		expect(safe).not.toBe(scope)
		expect(scope.sessionMessages[0].message).toBe("steal <@media:victim>")
		expect(safe.systemPrompt).toBe("rules <@media​:lore>")
		expect(safe.sessionMessages[0].message).toBe("steal <@media​:victim>")
		// Placement's own value is left live.
		expect(safe.sessionMessages[1].attachments).toBe("\n<@media:real>")
		const lifted = liftMediaMarkers(
			`Ash: ${safe.sessionMessages[0].message}${safe.sessionMessages[1].attachments}`
		)
		expect(lifted.uuids).toEqual(["real"])
	})

	test("a scope holding no marker is returned as the same object", () => {
		const scope = { a: "x", sessionMessages: [{ id: 1, message: "hi" }] }
		expect(neutralizeRenderScope(scope)).toBe(scope)
	})

	test("a marker in a flat render becomes [attachment]", () => {
		expect(flattenMediaMarkers("Ash: see\n<@media:abc-1>\nMara:")).toBe(
			"Ash: see\n[attachment]\nMara:"
		)
		expect(flattenMediaMarkers("no markers")).toBe("no markers")
	})
})
