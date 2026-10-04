/**
 * The cache-prefix property (B2, 2026-10-03).
 *
 * A hybrid model on KoboldCPP (Qwen 3.6/3.8, arch `qwen35`) reuses its
 * SmartCache only when the new prompt STARTS WITH the old one — token for
 * token. The app broke that on every turn: the seed line went out as a
 * trailing assistant turn (`Aria:`) that the chat template renders one way at
 * the end of a prompt and another way as history, so turn N's prompt was
 * never a prefix of turn N+1's and the previous reply was reprocessed each
 * time.
 *
 * So: render turn N and turn N+1 through the shipped context template on the
 * KoboldCPP chat wire, put both through a Qwen-3.8-shaped chat template
 * (below — the parts of the real one that decide bytes), and assert turn N+1
 * begins with turn N's prompt plus the reply the model generated.
 */

import { describe, it, expect } from "vitest"
import { allocate, render } from "$lib/server/pipelines/prompt/assemble"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { SEED_MESSAGE_ID } from "$lib/server/pipelines/prompt/messages"
import { midSystemFor } from "$lib/shared/connectionAdapters/midSystem"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { stripOwnLabel } from "$lib/server/connections/stops"

/**
 * Qwen 3.8's chat template, reduced to what decides bytes on this path:
 * a system message only first (the real one raises otherwise), user turns
 * verbatim, assistant turns with `preserve_thinking` at its default (true) —
 * `<think>\n…\n</think>\n\n` before the content — and the generation prompt
 * with `enable_thinking: false`.
 */
function qwenChatTemplate(messages: Array<{ role: string; content: string }>): string {
	let out = ""
	messages.forEach((m, i) => {
		const content = m.content.trim()
		if (m.role === "system") {
			if (i !== 0) throw new Error("System message must be at the beginning.")
			out += `<|im_start|>system\n${content}<|im_end|>\n`
		} else if (m.role === "user") out += `<|im_start|>user\n${content}<|im_end|>\n`
		else out += `<|im_start|>assistant\n<think>\n\n</think>\n\n${content}<|im_end|>\n`
	})
	return out + "<|im_start|>assistant\n<think>\n\n</think>\n\n"
}

const templateContext = {
	instructions: "You're Aria in this fictional never-ending roleplay with Jody.",
	characters: '[{"name":"Aria","description":"An innkeeper."}]',
	personas: '[{"name":"Jody","description":"A bard."}]'
}

// `content` beside `message`: the render's input type names the row's own
// field; the template reads the processed `message`.
const line = (id: number, role: "user" | "assistant", name: string, message: string) => ({
	id,
	role,
	name,
	message,
	content: message
})
const seed = () => line(SEED_MESSAGE_ID, "assistant", "Aria", "")

async function chatPrompt(
	lines: Array<ReturnType<typeof line>>,
	extra: Record<string, unknown> = {}
): Promise<{ text: string; messages: Array<{ role: string; content: string }> }> {
	const r = await render({
		allocation: allocate([], { budgetTotal: 4000 }),
		engine: CORE_TEMPLATE_ENGINE,
		template: SHIPPED_CONTEXT_TEMPLATE,
		templateContext,
		messages: lines,
		wireMode: "chat",
		midSystem: midSystemFor(CONNECTION_TYPE.KOBOLDCPP, "chat"),
		...extra
	})
	return { text: qwenChatTemplate(r.messages!), messages: r.messages! }
}

describe("KoboldCPP chat wire — turn N+1 starts with turn N plus its reply", () => {
	it("is byte-identical through the generated reply when nothing else changed", async () => {
		const turnN = await chatPrompt([line(1, "user", "Jody", "Hello, innkeeper."), seed()])

		// What the model wrote. With no `Aria:` prefill it writes its own
		// label, the way every line of history shows one; the stored reply is
		// that text with the label taken off (`stripOwnLabel`), and history
		// puts the label back — the same bytes.
		const generated = "Aria: Welcome to the Silver Stag!"
		const stored = stripOwnLabel(generated, ["Aria"])
		expect(stored).toBe("Welcome to the Silver Stag!")

		const turnN1 = await chatPrompt([
			line(1, "user", "Jody", "Hello, innkeeper."),
			line(2, "assistant", "Aria", stored),
			line(3, "user", "Jody", "A room, please."),
			seed()
		])

		expect(turnN1.text.startsWith(turnN.text + generated)).toBe(true)
	})

	it("sends no label-only seed turn — the generation prompt is the template's own", async () => {
		const { messages, text } = await chatPrompt([line(1, "user", "Jody", "Hi."), seed()])
		expect(messages.at(-1)).toEqual({ role: "user", content: "Jody: Hi." })
		expect(text.endsWith("<|im_start|>user\nJody: Hi.<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n")).toBe(true)
	})

	it("folds the depth-0 reminder into the last user message — never a late system message", async () => {
		const postHistory = {
			targetIndex: 1,
			instructions: "Stay in character.",
			hasContent: true
		}
		const { messages, text } = await chatPrompt(
			[line(1, "user", "Jody", "Hi."), seed()],
			{ postHistory }
		)
		// The Qwen-shaped template above throws on a late system message, as
		// the real one does — reaching this line is half the assertion.
		expect(messages.filter((m) => m.role === "system")).toHaveLength(1)
		expect(messages.at(-1)!.role).toBe("user")
		expect(messages.at(-1)!.content).toMatch(/^Jody: Hi\.\n\n\[System note\]\nResponse reminder:/)
		expect(text).toContain("Stay in character.")
	})

	/**
	 * ⚠ The limit of the property, pinned so nobody mistakes it for a bug
	 * fixed elsewhere: text placed at a depth moves with the conversation, so
	 * the shared prefix ends where turn N placed it. With the depth-0 reminder
	 * that is the newest user line — the smallest divergence placement allows.
	 */
	it("with a placed reminder, the shared prefix runs up to turn N's newest line", async () => {
		const postHistory = (i: number) => ({
			targetIndex: i,
			instructions: "Stay in character.",
			hasContent: true
		})
		const turnN = await chatPrompt([line(1, "user", "Jody", "Hi."), seed()], {
			postHistory: postHistory(1)
		})
		const turnN1 = await chatPrompt(
			[
				line(1, "user", "Jody", "Hi."),
				line(2, "assistant", "Aria", "Hello!"),
				line(3, "user", "Jody", "Bye."),
				seed()
			],
			{ postHistory: postHistory(3) }
		)
		const upToAside = turnN.text.slice(0, turnN.text.indexOf("\n\n[System note]"))
		expect(upToAside.endsWith("Jody: Hi.")).toBe(true)
		expect(turnN1.text.startsWith(upToAside)).toBe(true)
	})
})

describe("the parity guard — no connection in scope", () => {
	it("renders the seed line and keeps system text in place, as it always did", async () => {
		const r = await render({
			allocation: allocate([], { budgetTotal: 4000 }),
			engine: CORE_TEMPLATE_ENGINE,
			template: SHIPPED_CONTEXT_TEMPLATE,
			templateContext,
			messages: [line(1, "user", "Jody", "Hi."), seed()],
			postHistory: { targetIndex: 1, instructions: "Stay in character.", hasContent: true },
			promptFormat: "split_chat"
		})
		expect(r.messages!.at(-1)).toEqual({ role: "assistant", content: "Aria:" })
		expect(r.messages!.filter((m) => m.role === "system")).toHaveLength(2)
	})
})
