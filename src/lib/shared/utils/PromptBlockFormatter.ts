import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import _ from "lodash"

type BlockRole = "user" | "assistant" | "system" | "model" | "tool" | "function"

// Single source of truth for the SPLIT_CHAT role-marker pattern, shared
// between makeBlock (which neutralizes it inside user-controlled content —
// see the SPLIT_CHAT case below) and parseSplitChatPrompt
// (promptBuilder/utils.ts, which parses it back out). Two
// independently-maintained copies of this pattern is exactly the drift
// class that reopens the prompt-injection hole this pairing exists to
// close: if the parser ever gains a role, tolerates different whitespace,
// or changes delimiters, and the neutralizer isn't updated in lockstep, a
// literal "<@role:system>" in a chat message / character field / lore
// entry starts parsing as a real system-role message sent to the LLM API
// again. Exported as a bare pattern SOURCE (not a compiled RegExp) since
// each consumer needs different wrapping — makeBlock needs it global and
// unanchored (to find/replace every occurrence in a block's content),
// parseSplitChatPrompt needs it as a lookahead (for split) and anchored
// (for the per-block role/content match) — building each shape from one
// shared string keeps them from drifting apart the way two independently
// hand-written regexes could.
export const ROLE_MARKER_PATTERN = "<@role:(user|assistant|system)>"

export class PromptBlockFormatter {
	static readonly CHATML_OPEN = "<|im_start|>"
	static readonly CHATML_CLOSE = "<|im_end|>\n"
	static readonly BASIC_OPEN = "*** "
	static readonly BASIC_CLOSE = "\n\n"
	static readonly VICUNA_OPEN = "### "
	static readonly VICUNA_CLOSE = "\n"
	static readonly OPENAI_OPEN = "<|"
	static readonly OPENAI_CLOSE = "\n"
	static readonly LLAMA2_INST_OPEN = "<s>[INST] "
	static readonly LLAMA2_INST_CLOSE = " [/INST]</s>\n"
	static readonly CLAUDE_OPEN = "Human: "
	static readonly CLAUDE_CLOSE = "\nAssistant: "
	static readonly INSTRUCT_OPEN = "### Instruction:\n"
	static readonly INSTRUCT_CLOSE = "\n### Response:\n"

	static chatmlOpen(role: BlockRole) {
		return `${PromptBlockFormatter.CHATML_OPEN}${role}\n`
	}
	static chatmlClose = PromptBlockFormatter.CHATML_CLOSE
	static basicOpen(role: BlockRole) {
		return `${PromptBlockFormatter.BASIC_OPEN}${role}\n`
	}
	static basicClose = PromptBlockFormatter.BASIC_CLOSE
	static vicunaOpen(role: BlockRole) {
		return `${PromptBlockFormatter.VICUNA_OPEN}${_.capitalize(role)}:\n`
	}
	static vicunaClose = PromptBlockFormatter.VICUNA_CLOSE
	static openaiOpen(role: BlockRole) {
		return `${PromptBlockFormatter.OPENAI_OPEN}${role}|>\n`
	}
	static openaiClose = PromptBlockFormatter.OPENAI_CLOSE
	static llama2InstOpen(role: BlockRole) {
		switch (role) {
			case "system":
				return "<s>[INST] <<SYS>>\n"
			case "user":
				return "<s>\n"
			case "assistant":
				return "<s>\n"
		}
		return PromptBlockFormatter.LLAMA2_INST_OPEN
	}
	static llama2InstClose(role: BlockRole) {
		switch (role) {
			case "system":
				return "\n<</SYS>> [/INST]</s>\n"
			case "user":
				return "\n</s>\n"
			case "assistant":
				return "\n</s>\n"
		}
		return PromptBlockFormatter.LLAMA2_INST_CLOSE
	}
	static claudeOpen(role: BlockRole) {
		return role === "user"
			? PromptBlockFormatter.CLAUDE_OPEN
			: PromptBlockFormatter.CLAUDE_CLOSE
	}
	static claudeClose = "\n"
	static instructOpen() {
		return PromptBlockFormatter.INSTRUCT_OPEN
	}
	static instructClose = PromptBlockFormatter.INSTRUCT_CLOSE
	static tekkenBlock({
		system,
		user,
		assistant
	}: {
		system?: string
		user: string
		assistant?: string
	}): string {
		const sys = system ? ` <<SYS>>\n${system}\n<</SYS>>\n\n` : " "
		const inst = `[INST]${sys}${user} [/INST]`
		const reply = assistant ?? ""
		return `<s>${inst}\n${reply}</s>\n`
	}

	static makeBlock({
		format,
		role,
		content,
		includeClose = true
	}: {
		format: string
		role: BlockRole
		content: string
		includeClose?: boolean
	}) {
		switch (format) {
			case PromptFormats.CHATML:
				return (
					this.chatmlOpen(role) +
					content +
					(includeClose ? this.chatmlClose : "")
				)
			case PromptFormats.BASIC:
				return (
					this.basicOpen(role) +
					content +
					(includeClose ? this.basicClose : "")
				)
			case PromptFormats.VICUNA:
				return (
					this.vicunaOpen(role) +
					content +
					(includeClose ? this.vicunaClose : "")
				)
			case PromptFormats.OPENAI:
				return (
					this.openaiOpen(role) +
					content +
					(includeClose ? this.openaiClose : "")
				)
			case PromptFormats.LLAMA2_INST:
				return (
					this.llama2InstOpen(role) +
					content +
					(includeClose ? this.llama2InstClose(role) : "")
				)
			case PromptFormats.CLAUDE:
				return (
					this.claudeOpen(role) +
					content +
					(includeClose ? this.claudeClose : "")
				)
			case PromptFormats.INSTRUCT:
				return (
					this.instructOpen() +
					content +
					(includeClose ? this.instructClose : "")
				)
			case PromptFormats.SPLIT_CHAT: {
				// Use /<@role:(user|assistant|system)>\s*/g, i.e. <@role:user>\n {content} \n
				//
				// content is user-controlled (chat messages, character/persona
				// fields, world-lore/history entries all flow through here via
				// the systemBlock/userBlock/assistantBlock Handlebars helpers)
				// and parseSplitChatPrompt re-derives message role boundaries by
				// searching the ENTIRE rendered prompt string for
				// ROLE_MARKER_PATTERN, with no way to distinguish a marker WE
				// inserted from one embedded in someone's message/field/entry.
				// Left unescaped, a chat participant typing the literal text
				// "<@role:system>" would have it parsed as a real system-role
				// message sent to the LLM API — for Anthropic, promoted straight
				// into the top-level system prompt. Neutralize any occurrence in
				// content before wrapping, by inserting a zero-width space
				// (written as an explicit \u200B escape, never pasted as a
				// literal invisible character — an actually-invisible character
				// in source is un-greppable and one "strip weird whitespace"
				// cleanup away from silently reopening this) between "role" and
				// the colon, breaking ROLE_MARKER_PATTERN's exact match while
				// staying visually identical to a human reader.
				//
				// This is sufficient even against an attacker trying to split
				// the marker across two adjacent blocks (e.g. ending one
				// message with "<@role:sys" hoping the next block's content
				// completes it) — every block is wrapped with a literal "\n" on
				// both sides here, and the pattern has no "s" flag, so it can't
				// match across the newline boundary between two blocks. Per-block
				// neutralization is therefore sufficient by construction, not
				// just in practice; if this wrapper's whitespace ever changes,
				// re-verify this property.
				//
				// Durable-fix note: the root cause is in-band signaling through
				// a concatenate-then-reparse round-trip. The correct long-term
				// architecture builds the messages[] array as structured data
				// end-to-end instead of serializing through one searchable
				// string — this neutralization is the correct fix to ship now
				// (minimal, contained, doesn't touch every adapter/format), not
				// a claim that this is the final design.
				const safeContent = content.replace(
					new RegExp(ROLE_MARKER_PATTERN, "g"),
					`<@role${"\u200B"}:$1>`
				)
				return `<@role:${role}>\n${safeContent}\n`
			}
			default:
				return (
					this.chatmlOpen(role) +
					content +
					(includeClose ? this.chatmlClose : "")
				)
		}
	}
}
