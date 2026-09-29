/**
 * The seed line a turn ends with — whether there is one, and whose name it
 * carries (R-C, 2026-09-17).
 *
 * The seed is a real element of the prompt: a final, deliberately open
 * assistant entry whose name is what tells the model whose turn it is (see
 * `prompt/messages.ts`). Two nodes need an answer about it and neither can see
 * the other's — `core:task/build-template-context@1` resolves the **name**
 * from the cast and the prompt config, and `core:task/process-messages@1`
 * decides whether the **row** is written at all — so the rule itself lives
 * here, once, and each of them reads the half it is holding.
 *
 * ⚠ It was two rules for exactly as long as `voice: 'none'` existed and
 * `voice: 'narrator'` did not: the no-row half read a stamped row in
 * `processMessages` while the name was resolved from the cast alone and had no
 * way to hear about a channel. A second copy of the narrator branch beside the
 * first is how those two would have come to disagree — one answering for the
 * channel the turn was triggered on and the other for the channel the newest
 * message happens to be on.
 *
 * Absent voice — every genre that declares no channel of its own, which is
 * nearly all of them — is today's answer, expression for expression.
 */

import type { ChannelVoice } from "$lib/server/messages/channels"
import { ownVoiceName } from "$lib/shared/sessions/ownVoiceName"

export interface SeedLineInput {
	/**
	 * The voice of the channel this turn was **triggered on**, when its genre
	 * declared one. Absent for every genre that shapes no channel, and the
	 * reason every branch below falls through to the character path.
	 */
	voice?: ChannelVoice
	/**
	 * The speaking cast member's name, or **null** when nobody in the cast is
	 * speaking — a narrator turn, or a side character outside it.
	 *
	 * Null rather than an empty string, and the check below is `!= null` for
	 * that reason: a cast member whose name resolves to `""` is still the
	 * speaker, and falling through to the narrator on their behalf is the
	 * behaviour this reproduces rather than quietly improves.
	 */
	characterName?: string | null
	/** A side character's or an envoy's name, when one is speaking. */
	speakerName?: string | null
	/**
	 * The pipeline's own voice, named (lair re-plan R5; `ownVoiceName`): the
	 * genre's fallback envoy, else the prompt's narrator name. A
	 * narrator-voice channel seeds under it, and so does a turn nobody in the
	 * cast speaks — the null turn entry's, whose lines are exactly the
	 * unclaimed ones that name carries.
	 */
	ownVoiceName?: string
}

export interface SeedLine {
	/**
	 * Whether the prompt ends with a seed row at all. False only for
	 * `voice: 'none'` — the continue-prefill posture a folio channel wants,
	 * since a manuscript has no speaker to announce.
	 */
	seed: boolean
	/**
	 * The name on that row. Resolved whatever `seed` says, so a caller that
	 * only wants the name never has to know about the other half — and so the
	 * two halves cannot disagree about a turn whose row is never written.
	 */
	name: string
}

export function resolveSeedLine(input: SeedLineInput): SeedLine {
	const own = input.ownVoiceName || ownVoiceName(null)
	const name =
		// A channel that narrates seeds under the own voice's name whoever
		// is seated: the cast is still there, the turn is simply not theirs.
		input.voice === "narrator"
			? own
			: input.characterName != null
				? input.characterName
				: input.speakerName || own
	return { seed: input.voice !== "none", name }
}
