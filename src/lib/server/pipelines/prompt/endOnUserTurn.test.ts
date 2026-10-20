/**
 * 🚧 Every chat prompt ends on a user turn (owner ruling 2026-10-18, the
 * Dungeon Crawler 100-turn walk, B1): the host folds the trailing reminder
 * into the last user turn, adds the handoff turn after the model's own line,
 * keeps a continuation's trailing assistant turn where the connection
 * continues on the chat wire — and refuses, in a sentence, what is still
 * instructions alone.
 */
import { describe, expect, it, vi } from "vitest"
import { endOnUserTurn, NO_USER_TURN_REFUSAL } from "./endOnUserTurn"
import { foldedSystemAside, speakerCue } from "$lib/shared/utils/parseSplitChatPrompt"

const sys = (content: string) => ({ role: "system", content })
const user = (content: string) => ({ role: "user", content })
const bot = (content: string) => ({ role: "assistant", content })

describe("endOnUserTurn", () => {
	it("a prompt already ending on a user turn is handed back untouched — the same array", () => {
		const messages = [sys("You are the Narrator."), user("Pip: I look around.")]
		const out = endOnUserTurn(messages)
		expect(out).toEqual({ ok: true, messages, repaired: null })
		expect(out.ok && out.messages).toBe(messages)
	})

	it("the walk's Narrator prompt — a trailing Response reminder — ends on the player's line, the reminder folded in", () => {
		const out = endOnUserTurn([sys("You are the Narrator."), user("Pip: I look around."), sys("Response reminder:\nTell it.")])
		expect(out.ok).toBe(true)
		if (!out.ok) return
		expect(out.messages.map((m) => m.role)).toEqual(["system", "user"])
		expect(out.messages[1]!.content).toBe(`Pip: I look around.\n\n${foldedSystemAside("Response reminder:\nTell it.")}`)
		expect(out.repaired).toMatch(/folded into the last user turn/)
	})

	it("a round nobody spoke in — the Narrator's line last — gets the handoff turn", () => {
		const out = endOnUserTurn([sys("You keep the books."), user("Pip: I wait."), bot("Narrator: The water stills.")])
		expect(out.ok && out.messages.at(-1)).toEqual({ role: "user", content: speakerCue("Narrator") })
	})

	it("instructions after the model's own line become a user turn of their own", () => {
		const out = endOnUserTurn([sys("Rules."), bot("Narrator: It is quiet."), sys("Answer in JSON.")])
		expect(out.ok && out.messages.map((m) => m.role)).toEqual(["system", "assistant", "user"])
		expect(out.ok && out.messages.at(-1)!.content).toBe(foldedSystemAside("Answer in JSON."))
	})

	it("a continuation on a connection that continues on the chat wire keeps its trailing assistant turn", async () => {
		const messages = [sys("Rules."), user("Ann: Go on."), bot("Narrator: The door")]
		expect(endOnUserTurn(messages, { prefill: true })).toEqual({ ok: true, messages, repaired: null })
		// Anthropic continues on the chat wire; OpenAI-compatible endpoints do not.
		const { endChatOnUserTurn } = await import("$lib/server/pipelines/runtime/dispatch")
		expect(endChatOnUserTurn({ messages, meta: {} }, { type: "anthropic", wireMode: "chat" }).messages).toBe(messages)
		expect(endChatOnUserTurn({ messages, meta: {} }, { type: "openai", wireMode: "chat" }).messages.at(-1)).toEqual({
			role: "user",
			content: speakerCue("Narrator")
		})
	})

	it("instructions alone: the dropped seed's speaker is handed the turn; with nobody named, refused in a sentence", () => {
		const named = endOnUserTurn([sys("Greet the party.")], { seedLabel: "Narrator" })
		expect(named.ok && named.messages.at(-1)).toEqual({ role: "user", content: speakerCue("Narrator") })
		expect(endOnUserTurn([sys("Greet the party."), sys("Remember.")])).toEqual({ ok: false, refusal: NO_USER_TURN_REFUSAL })
	})
})

describe("dispatch's guard (endChatOnUserTurn)", () => {
	it("only the chat wire: a completion payload and a payload with no messages go out as they came", async () => {
		const { endChatOnUserTurn } = await import("$lib/server/pipelines/runtime/dispatch")
		const flat = { prompt: "x", messages: undefined, meta: {} }
		expect(endChatOnUserTurn(flat, { type: "openai", wireMode: "chat" })).toBe(flat)
		const split = { messages: [sys("a"), user("b"), sys("c")], meta: {} }
		expect(endChatOnUserTurn(split, { type: "openai", wireMode: "completion" })).toBe(split)
		const fixed = endChatOnUserTurn(split, { type: "openai", wireMode: "chat" })
		expect(fixed.messages.map((m: any) => m.role)).toEqual(["system", "user"])
		expect(fixed.meta).toBe(split.meta)
	})

	it("a prompt that cannot be repaired is refused with the sentence, and logged", async () => {
		const { endChatOnUserTurn } = await import("$lib/server/pipelines/runtime/dispatch")
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		expect(() => endChatOnUserTurn({ messages: [sys("only rules")], meta: {} }, { type: "openai", wireMode: "chat" })).toThrow(
			NO_USER_TURN_REFUSAL
		)
		expect(warn).toHaveBeenCalled()
		warn.mockRestore()
	})
})
