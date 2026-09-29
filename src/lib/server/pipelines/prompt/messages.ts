/**
 * Session rows into the message objects a template renders.
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
 * `SessionMessageProcessor` does 1 and 2 and is used directly. Reimplementing the
 * name-resolution chain would have produced a version that agrees on the common
 * case and mislabels every message from a participant who has since left.
 */

import { SessionMessageProcessor } from "$lib/server/pipelines/prompt/contentProcessors"
import { stripJsonBlocks } from "$lib/server/pipelines/prompt/jsonBlocks"
import { resolveSeedLine } from "$lib/server/pipelines/prompt/seedLine"
import type { ChannelVoice } from "$lib/server/messages/channels"
import { parseChannel } from "@serene-pub/sdk"
import { InterpolationEngine } from "$lib/server/utils/interpolation/InterpolationEngine"
import type { ProcessedSessionMessage } from "$lib/server/pipelines/prompt/contentProcessors"

export interface ProcessMessagesInput {
	/** Rows in reading order, oldest first. */
	messages: readonly any[]
	/** The cast, for resolving who said what. */
	cast: {
		sessionCharacters?: readonly any[]
		sessionPersonas?: readonly any[]
		removedSessionCharacters?: readonly any[]
		removedSessionPersonas?: readonly any[]
		/**
		 * The seated envoys (U5g) — an envoy's row names it by reference and
		 * holds no `characterId`, so its name comes from here. `fallback`
		 * marks the genre's fallback envoy: the unclaimed line's name.
		 */
		envoys?: readonly { slug: string; name?: unknown; fallback?: boolean }[]
		/** Envoys declared but not seated — an action's envoy speaks unseated. */
		declaredEnvoys?: readonly {
			slug: string
			name?: unknown
			fallback?: boolean
		}[]
		/**
		 * The session's members by user id (lair pass B11) — the name a
		 * person's own line takes when no persona names it.
		 */
		memberNames?: Readonly<Record<number, string>>
		/**
		 * What the genre calls a person's persona-less line (lair re-plan
		 * R4) — the session's override, else the genre's; absent when the
		 * genre declares none. Wins over `memberNames` on such a line.
		 */
		playerLabel?: string
	}
	/**
	 * The session's narrator name — what a line nobody claims renders under
	 * when the genre declares no fallback envoy.
	 */
	narratorName?: string | null
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
	/**
	 * Whether the list ends with the line the model continues from.
	 *
	 * Default true, which is every reply pipeline: the seed is a real element of
	 * the prompt and the last line is what tells a model whose turn it is. A
	 * step that is ASKING rather than answering passes false — a prompt ending
	 * `Verity:` requests Verity's next paragraph however plainly the
	 * instructions asked for something else.
	 */
	seed?: boolean
	/**
	 * The voice of the channel this turn was **triggered on** (R-C,
	 * 2026-09-17) — `none` means no seed row at all.
	 *
	 * Arrives on the cast read, which is the one port this node and
	 * `core:task/build-template-context@1` share, so the two halves of the
	 * seed decision are answered from one fact. Absent for every genre that
	 * shapes no channel, and absent for a caller that hands rows in directly.
	 */
	turnChannelVoice?: ChannelVoice
	/**
	 * Cut JSON blocks out of what the cast said, on the way into this prompt.
	 *
	 * A reply that carried a document teaches the next turn's planner its own
	 * schema and the keeper somebody else's. Never applied to the stored row —
	 * see `jsonBlocks.ts` — and never to a player's own line, which is theirs.
	 */
	plainProse?: boolean
	/** Everything else `{{char}}`-style macros in a message body resolve against. */
	interpolationContext?: Record<string, unknown>
}

export interface ProcessedMessages {
	messages: ProcessedSessionMessage[]
	/** Which ids made it in, for the receipt and the token accounting. */
	includedIds: number[]
}

/** The id the seed carries, matching the 0.5 keyword path. */
export const SEED_MESSAGE_ID = -2

/**
 * The id a **folio block** carries (R-C, 2026-09-17) — one entry standing
 * for every message on a channel whose genre declared `role: 'folio'`.
 *
 * Negative, like the seed and the draft, because it belongs to no row: the
 * rows it folded together are reported individually in `includedIds`, which is
 * what the receipt and the token accounting are counting.
 */
export const FOLIO_MESSAGE_ID = -3

export function processMessages(
	input: ProcessMessagesInput
): ProcessedMessages {
	const interpolation = new InterpolationEngine()
	const processor = new SessionMessageProcessor(
		input.cast as any,
		interpolation,
		{ narratorName: input.narratorName }
	)

	const context = {
		char: input.charName,
		character: input.charName,
		user: input.personaName,
		persona: input.personaName,
		...(input.interpolationContext ?? {})
	} as any

	const processed: ProcessedSessionMessage[] = []
	/**
	 * Channels that enter the prompt as a **folio** (R-C): slug → the lines
	 * on it, in time order. Empty for every genre that declares no channel
	 * role, because the host puts `channelRole` on a row only when the genre
	 * shapes channels at all (`channelShapingOf`) — so a prompt for a genre
	 * written before R-C is assembled by exactly the code it always was.
	 */
	const folios = new Map<string, string[]>()
	/** The real ids the blocks folded together, for `includedIds`. */
	const folioIds: number[] = []
	for (const row of input.messages) {
		const one = processor.processItem(row, {
			interpolationContext: context,
			charName: input.charName,
			personaName: input.personaName,
			// Every message that reached here already survived selection; the
			// processor's own priority filter would be a second, invisible one.
			priority: 0
		})
		// Trimmed at compile as well as at save (ruling 2026-09-08). The two
		// guards cover different holes: the store cannot trim a mid-stream
		// partial — the frames split anywhere — and every row written before
		// the ruling is already stored padded. The template renders
		// `{{{name}}}: {{{message}}}` per line, so edge whitespace here is a
		// gap after the colon or a blank line before the next speaker.
		if (!one) continue
		let line =
			typeof one.message === "string"
				? { ...one, message: one.message.trim() }
				: one
		if (input.plainProse && one.role !== "user") {
			const prose =
				typeof line.message === "string"
					? stripJsonBlocks(line.message)
					: line.message
			// A line that was NOTHING but a block has no prose in it, and a
			// blank turn in a transcript renders as a name and a colon — which
			// is an invitation to continue it.
			if (typeof prose === "string" && !prose) continue
			line = { ...line, message: prose }
		}
		/**
		 * A folio channel's messages are not turns. They are one text —
		 * the manuscript the conversation is about — so they are collected
		 * here and emitted as a single block in front of the conversation
		 * rather than as a run of `Name:` lines the model would read as
		 * dialogue and continue.
		 */
		if (row?.channelRole === "folio") {
			// The slug is the reference; the lane is multiplicity (ruling
			// 2026-09-09), so every lane of a folio channel is one folio.
			const slug = parseChannel(row.channel).slug
			const text = typeof line.message === "string" ? line.message : ""
			if (text) {
				const lines = folios.get(slug) ?? []
				lines.push(text)
				folios.set(slug, lines)
			}
			if (typeof row.id === "number") folioIds.push(row.id)
			continue
		}
		processed.push(line)
	}

	/**
	 * In front of the conversation, one block per folio channel, labelled
	 * by the channel rather than by anybody: the individual speakers are what
	 * a folio drops. Declaration order is the map's insertion order, which
	 * is the order the channels' messages first appeared.
	 */
	for (const [slug, lines] of [...folios].reverse())
		processed.unshift({
			id: FOLIO_MESSAGE_ID,
			role: "user",
			name: slug,
			message: lines.join("\n\n")
		})

	/**
	 * A turn triggered on a channel whose voice is `none` writes no seed row
	 * (R-C) — the continue-prefill posture. A folio has no speaker to
	 * announce, so a trailing `Verity:` would be requesting a line of dialogue
	 * from a prompt whose subject is a manuscript.
	 *
	 * The turn's own channel when the trigger named one, and otherwise the
	 * **last** row's: the history arrives in reading order and the row that
	 * caused this turn is the newest one in it (the uncommitted draft, when
	 * there is one, is appended in exactly that place).
	 *
	 * ⚠ The row is the fallback rather than the answer, because it is only
	 * *usually* the answer: a turn triggered on a channel that has no rows yet
	 * reads the voice of whatever channel spoke last. It stays as the fallback
	 * until every trigger names its channel — a folio genre relies on it
	 * today, and dropping it would put a `Verity:` back at the end of a
	 * manuscript. Both are absent unless the genre shapes channels, so this
	 * reads `undefined` and changes nothing for every genre that declares none.
	 */
	const turnVoice =
		input.turnChannelVoice ?? input.messages.at(-1)?.channelVoice
	if (input.seed !== false && resolveSeedLine({ voice: turnVoice }).seed)
		processed.push({
			id: SEED_MESSAGE_ID,
			role: "assistant",
			name: input.seedName || input.charName,
			/**
			 * ⚠ The seed's trim is load-bearing, not tidiness.
			 *
			 * This is the one block in the whole prompt rendered *open* on the
			 * completion path — `contextHandlebarsHelpers.ts` keys `includeClose:
			 * false` on the `-2` id — so the prompt ends with this text and nothing
			 * after it. A trailing space on the partial therefore lands *inside*
			 * the open assistant block, which is exactly the mid-word continue
			 * (`"the sto"` + `"re."`) that cannot be detected downstream; and the
			 * Anthropic path rejects a prefill ending in whitespace outright.
			 */
			message: (input.continuationPrefill ?? "").trim()
		})

	return {
		messages: processed,
		// The rows a folio block folded together are counted one by one:
		// the block is a rendering of them, not a row of its own.
		includedIds: [
			...folioIds,
			...processed
				.filter(
					(m) =>
						m.id !== SEED_MESSAGE_ID && m.id !== FOLIO_MESSAGE_ID
				)
				.map((m) => m.id)
		]
	}
}
