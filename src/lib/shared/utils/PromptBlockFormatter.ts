import {
	completionTemplateOf,
	framingFor,
	type BlockRole,
	type CompletionTemplate,
	CHATML_OPEN,
	CHATML_CLOSE,
	BASIC_OPEN,
	BASIC_CLOSE,
	VICUNA_OPEN,
	VICUNA_CLOSE,
	OPENAI_OPEN,
	OPENAI_CLOSE,
	LLAMA2_INST_OPEN,
	LLAMA2_INST_CLOSE,
	CLAUDE_OPEN,
	CLAUDE_CLOSE,
	INSTRUCT_OPEN,
	INSTRUCT_CLOSE
} from "$lib/shared/constants/completionTemplates"

export type { BlockRole }

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
	// The built-in markers, re-exported from the template data so the seed
	// rows and these constants cannot drift. Named here because callers and
	// tests reach for `PromptBlockFormatter.CHATML_OPEN`.
	static readonly CHATML_OPEN = CHATML_OPEN
	static readonly CHATML_CLOSE = CHATML_CLOSE
	static readonly BASIC_OPEN = BASIC_OPEN
	static readonly BASIC_CLOSE = BASIC_CLOSE
	static readonly VICUNA_OPEN = VICUNA_OPEN
	static readonly VICUNA_CLOSE = VICUNA_CLOSE
	static readonly OPENAI_OPEN = OPENAI_OPEN
	static readonly OPENAI_CLOSE = OPENAI_CLOSE
	static readonly LLAMA2_INST_OPEN = LLAMA2_INST_OPEN
	static readonly LLAMA2_INST_CLOSE = LLAMA2_INST_CLOSE
	static readonly CLAUDE_OPEN = CLAUDE_OPEN
	static readonly CLAUDE_CLOSE = CLAUDE_CLOSE
	static readonly INSTRUCT_OPEN = INSTRUCT_OPEN
	static readonly INSTRUCT_CLOSE = INSTRUCT_CLOSE

	/**
	 * ⚠ Whole-conversation, not per-block, and therefore NOT a template row.
	 *
	 * Unreachable from `makeBlock` and absent from every picker — see
	 * `PromptFormats.TEKKEN` for why the limit is recorded rather than designed
	 * around. Kept because deleting a public static is a wider change than the
	 * one this file is making; it renders nothing today either way.
	 */
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

	/**
	 * The role-array emitter, HAND-WRITTEN AND DELIBERATELY NOT DATA-DRIVEN.
	 *
	 * The split-chat template row carries empty framing (see
	 * `completionTemplates.ts`) precisely so that nothing here can read a marker
	 * out of a row an admin edited. The emitted marker, `ROLE_MARKER_PATTERN`
	 * and `parseSplitChatPrompt` are a three-way correspondence maintained by
	 * hand; making any leg of it authorable severs it by design.
	 *
	 * Byte-identical to the `case PromptFormats.SPLIT_CHAT:` arm it was lifted
	 * out of — only the leading indentation changed.
	 */
	private static splitChatBlock(role: BlockRole, content: string): string {
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

	/**
	 * One block, wrapped in whatever the template says wraps it.
	 *
	 * `format` takes a key (resolved against the built-ins) or an already
	 * resolved row, so a caller holding a `completion_templates` row renders
	 * from it directly. Everything about which markers are used is a lookup;
	 * the switch this replaced had nine arms and two of them — the empty string
	 * and any unrecognised name — silently rendered ChatML while every other
	 * layer in the app called that same input Vicuna.
	 */
	static makeBlock({
		format,
		role,
		content,
		includeClose = true
	}: {
		format: string | CompletionTemplate | null | undefined
		role: BlockRole
		content: string
		includeClose?: boolean
	}) {
		const template = completionTemplateOf(format)

		// `renderMode`, never a substring test on the name. `/split/i` used to
		// decide this, so a template called "my split format" took this branch.
		if (template.renderMode === "role_array")
			return PromptBlockFormatter.splitChatBlock(role, content)

		const { prefix, suffix } = framingFor(template, role)
		return prefix + content + (includeClose ? suffix : "")
	}
}
