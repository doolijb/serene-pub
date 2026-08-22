/**
 * Chat rows into the message objects a template renders.
 *
 * Not a formatting detail. The default context template renders
 * `{{{name}}}: {{{message}}}` (defaults.ts), so a message that arrives as
 * `{id, role, content}` renders as `: ` — a prompt with its entire conversation
 * replaced by empty lines, and no error anywhere. That is exactly what the first
 * parity run produced, and it is the kind of failure that only a byte comparison
 * catches: every node reported success.
 *
 * Three things happen here, all of them legacy behaviour reused rather than
 * reimplemented:
 *
 * 1. **Naming.** Who said it — resolved from the message's own `characterId` or
 *    `personaId`, falling back to removed participants and then to their name as
 *    snapshotted at removal. A narrator line uses the name recorded on the
 *    message itself rather than the current speaker's.
 * 2. **Interpolation.** Per message, against a context where `{{char}}` is *that
 *    message's* speaker rather than this turn's.
 * 3. **The seed.** A final empty assistant entry the model continues from. It is
 *    a real element of the prompt — the last line is what tells the model whose
 *    turn it is — not scaffolding.
 *
 * `ChatMessageProcessor` does 1 and 2 and is used directly. Reimplementing the
 * name-resolution chain would have produced a version that agrees on the common
 * case and mislabels every message from a participant who has since left.
 */

import { ChatMessageProcessor } from "./contentProcessors"
import { InterpolationEngine } from "$lib/server/utils/interpolation/InterpolationEngine"
import type { ProcessedChatMessage } from "./contentProcessors"

export interface ProcessMessagesInput {
	/** Rows in reading order, oldest first. */
	messages: readonly any[]
	/** The cast, for resolving who said what. */
	cast: {
		chatCharacters?: readonly any[]
		chatPersonas?: readonly any[]
		removedChatCharacters?: readonly any[]
		removedChatPersonas?: readonly any[]
	}
	/** This turn's speaker and listener, as the template context resolved them. */
	charName: string
	personaName: string
	/**
	 * The name on the seed line — whoever is about to answer.
	 *
	 * Separate from `charName` because in no-perspective mode `{{char}}` is the
	 * whole cast list while the seed still needs one name to prompt with.
	 */
	seedName?: string
	/** Text an in-progress continuation has already produced. */
	continuationPrefill?: string
	/** Everything else `{{char}}`-style macros in a message body resolve against. */
	interpolationContext?: Record<string, unknown>
}

export interface ProcessedMessages {
	messages: ProcessedChatMessage[]
	/** Which ids made it in, for the receipt and the token accounting. */
	includedIds: number[]
}

/** The id the seed carries, matching the legacy engines (KeywordInfillEngine:290). */
export const SEED_MESSAGE_ID = -2

export function processMessages(
	input: ProcessMessagesInput
): ProcessedMessages {
	const interpolation = new InterpolationEngine()
	const processor = new ChatMessageProcessor(input.cast as any, interpolation)

	const context = {
		char: input.charName,
		character: input.charName,
		user: input.personaName,
		persona: input.personaName,
		...(input.interpolationContext ?? {})
	} as any

	const processed: ProcessedChatMessage[] = []
	for (const row of input.messages) {
		const one = processor.processItem(row, {
			interpolationContext: context,
			charName: input.charName,
			personaName: input.personaName,
			// Every message that reached here already survived selection; the
			// processor's own priority filter would be a second, invisible one.
			priority: 0
		})
		if (one) processed.push(one)
	}

	processed.push({
		id: SEED_MESSAGE_ID,
		role: "assistant",
		name: input.seedName || input.charName,
		message: input.continuationPrefill ?? ""
	})

	return {
		messages: processed,
		includedIds: processed
			.filter((m) => m.id !== SEED_MESSAGE_ID)
			.map((m) => m.id)
	}
}
