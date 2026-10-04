/**
 * The chat wire's two adjustments to the parsed messages (B2, 2026-10-03):
 * the label-only seed line is not sent, and depth-placed system text is
 * folded where the connection hoists or rejects it (AN3).
 *
 * The default shape is pinned first — every caller with no connection in
 * scope must keep getting exactly the messages it got before.
 */

import { describe, it, expect } from "vitest"
import {
	parseSplitChatPrompt,
	foldedSystemAside,
	speakerCue
} from "$lib/shared/utils/parseSplitChatPrompt"
import { midSystemFor } from "$lib/shared/connectionAdapters/midSystem"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const sys = (t: string) => `<@role:system>\n${t}\n`
const usr = (t: string) => `<@role:user>\n${t}\n`
const ast = (t: string) => `<@role:assistant>\n${t}\n`

const CHAT = { labelSeed: "drop", midSystem: "keep" } as const
const FOLD = { labelSeed: "drop", midSystem: "fold" } as const

describe("parseSplitChatPrompt — default shape (no connection in scope)", () => {
	it("keeps the seed line and every system message where it sits", () => {
		const prompt =
			sys("You are Aria.") + usr("Jody: hi") + sys("Remember: be brief.") + ast("Aria:")
		expect(parseSplitChatPrompt(prompt)).toEqual([
			{ role: "system", content: "You are Aria." },
			{ role: "user", content: "Jody: hi" },
			{ role: "system", content: "Remember: be brief." },
			{ role: "assistant", content: "Aria:" }
		])
	})
})

describe("labelSeed: drop", () => {
	it("does not send a label-only seed, and adds nothing when one voice speaks", () => {
		const prompt =
			sys("You are Aria.") + usr("Jody: hi") + ast("Aria: Hello.") + usr("Jody: how are you?") + ast("Aria:")
		const out = parseSplitChatPrompt(prompt, CHAT)
		expect(out.at(-1)).toEqual({ role: "user", content: "Jody: how are you?" })
		expect(out.some((m) => m.content === "Aria:")).toBe(false)
	})

	it("keeps a seed that carries text — the extend verb's partial is a real prefill", () => {
		const out = parseSplitChatPrompt(usr("Jody: hi") + ast("Aria: Once upon"), CHAT)
		expect(out.at(-1)).toEqual({ role: "assistant", content: "Aria: Once upon" })
	})

	it("says whose turn it is when another voice has spoken — on the last user message", () => {
		const prompt =
			usr("Jody: hi") + ast("Narrator: The door creaks.") + usr("Jody: who's there?") + ast("Aria:")
		const out = parseSplitChatPrompt(prompt, CHAT)
		expect(out.at(-1)).toEqual({
			role: "user",
			content: `Jody: who's there?\n\n${speakerCue("Aria")}`
		})
	})

	it("ends a run of the model's own lines with the handoff turn naming the next speaker", () => {
		const prompt = usr("Jody: hi") + ast("Aria: Hello.") + ast("Bea:")
		const out = parseSplitChatPrompt(prompt, CHAT)
		expect(out).toEqual([
			{ role: "user", content: "Jody: hi" },
			{ role: "assistant", content: "Aria: Hello." },
			{ role: "user", content: speakerCue("Bea") }
		])
	})
})

describe("midSystem: fold (AN3)", () => {
	it("folds the depth-0 reminder into the last user message, after its words", () => {
		const prompt =
			sys("You are Aria.") + usr("Jody: hi") + ast("Aria: Hello.") + usr("Jody: bye") + sys("Reminder.") + ast("Aria:")
		const out = parseSplitChatPrompt(prompt, FOLD)
		expect(out).toEqual([
			{ role: "system", content: "You are Aria." },
			{ role: "user", content: "Jody: hi" },
			{ role: "assistant", content: "Aria: Hello." },
			{ role: "user", content: `Jody: bye\n\n${foldedSystemAside("Reminder.")}` }
		])
		expect(out.filter((m) => m.role === "system")).toHaveLength(1)
	})

	it("folds a deeper note into the NEXT user message, before its words", () => {
		const prompt =
			sys("Top.") + usr("Jody: one") + ast("Aria: two") + sys("Note.") + usr("Jody: three") + ast("Aria:")
		const out = parseSplitChatPrompt(prompt, FOLD)
		expect(out[3]).toEqual({
			role: "user",
			content: `${foldedSystemAside("Note.")}\n\nJody: three`
		})
	})

	it("keeps a note between two of the model's lines in place, as a user message of its own", () => {
		const prompt =
			sys("Top.") + usr("Jody: hi") + ast("Aria: one") + sys("Note.") + ast("Aria: two") + usr("Jody: ok")
		const out = parseSplitChatPrompt(prompt, FOLD)
		expect(out.slice(2, 5)).toEqual([
			{ role: "assistant", content: "Aria: one" },
			{ role: "user", content: foldedSystemAside("Note.") },
			{ role: "assistant", content: "Aria: two" }
		])
	})

	it("merges a leading run of system messages into one", () => {
		const out = parseSplitChatPrompt(sys("A.") + sys("B.") + usr("Jody: hi"), FOLD)
		expect(out).toEqual([
			{ role: "system", content: "A.\n\nB." },
			{ role: "user", content: "Jody: hi" }
		])
	})

	it("turns system text with no user message anywhere into one", () => {
		const out = parseSplitChatPrompt(sys("Top.") + ast("Aria: Hi!") + sys("Late."), FOLD)
		expect(out).toEqual([
			{ role: "system", content: "Top." },
			{ role: "assistant", content: "Aria: Hi!" },
			{ role: "user", content: foldedSystemAside("Late.") }
		])
	})

	it("keeps attachments on the message an aside is folded into", () => {
		const prompt = sys("Top.") + usr("Jody: look <@media:abc-1>") + sys("Reminder.")
		const out = parseSplitChatPrompt(prompt, FOLD) as unknown as Array<Record<string, unknown>>
		const last = out.at(-1)!
		expect(last.role).toBe("user")
		expect(last.attachments).toEqual([{ uuid: "abc-1" }])
		expect(String(last.content)).toContain(foldedSystemAside("Reminder."))
	})

	it("keep leaves mid-conversation system messages alone", () => {
		const prompt = sys("Top.") + usr("Jody: hi") + sys("Reminder.") + ast("Aria:")
		expect(parseSplitChatPrompt(prompt, CHAT)).toEqual([
			{ role: "system", content: "Top." },
			{ role: "user", content: "Jody: hi" },
			{ role: "system", content: "Reminder." }
		])
	})
})

describe("midSystemFor — one declaration per connection type", () => {
	it.each([
		[CONNECTION_TYPE.OPENAI, "keep"],
		[CONNECTION_TYPE.ANTHROPIC, "fold"],
		[CONNECTION_TYPE.OLLAMA, "fold"],
		[CONNECTION_TYPE.KOBOLDCPP, "fold"],
		[CONNECTION_TYPE.KOBOLDCPP_MANAGED, "fold"],
		[CONNECTION_TYPE.LLAMACPP, "fold"],
		[CONNECTION_TYPE.LM_STUDIO, "fold"]
	])("%s on the chat wire: %s", (type, expected) => {
		expect(midSystemFor(type, "chat")).toBe(expected)
	})

	it("is keep on the completion wire, and for a type nobody described", () => {
		expect(midSystemFor(CONNECTION_TYPE.ANTHROPIC, "completion")).toBe("keep")
		expect(midSystemFor(CONNECTION_TYPE.KOBOLDCPP, "completion")).toBe("keep")
		expect(midSystemFor("no-such-type", "chat")).toBe("keep")
		expect(midSystemFor(null, "chat")).toBe("keep")
	})
})
