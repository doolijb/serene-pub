/**
 * The pipeline's **own voice**, named (lair re-plan R5, 2026-09-28).
 *
 * The null turn entry (`{ ref: null }`) is the pipeline's own voice — the
 * narrator strategy's entry, a narrator genre's Continue with nothing
 * prepared, the Narrate press — and every line that voice writes is an
 * **unclaimed line** (no character, persona, envoy or side character claims
 * it). They are one speaker, so they carry one name, resolved here and
 * nowhere else:
 *
 * 1. the genre's **fallback envoy** (`EnvoyDecl.fallback`) — the Lair's
 *    Castellan, the Guide's Guide;
 * 2. else the session's narrator name (Edit Session's narrator prompt config);
 * 3. else the SDK's `UNCLAIMED_LINE_NAME` (_Narrator_) — never _Unknown_.
 *
 * The fallback envoy is **declared**, not seated: the voice is the genre's,
 * so an unseated fallback envoy still names it.
 *
 * Pure, and shared by both sides: the page's ready line, turn picker and
 * message names; the server's seed line, transcript names and the progress
 * card's `{speaker}`. A host that stamps a line at the write (the running
 * spec's sole action envoy, `unclaimedLineSpeaker`) decides *who* before this
 * is asked *what they are called*.
 *
 * ⚠ Not the `default` envoy (seated with no choice), and not the narrate
 * *function*'s name in Chat — that is the narrator name, whatever this says.
 */

import { i18nText, UNCLAIMED_LINE_NAME, type I18n } from "@serene-pub/sdk"

/** What the name is read from — both halves' shapes fit it. */
export interface OwnVoiceSource {
	/**
	 * The session's envoys: declarations (a locale map) on the server, the
	 * view's (a name already in the viewer's language) on the page. Only the
	 * one marked `fallback` is read.
	 */
	envoys?: ReadonlyArray<
		{ name?: unknown; fallback?: boolean } | null | undefined
	> | null
	/** The session's narrator name, when it has one. */
	narratorName?: string | null
}

/** The own voice's display name, in `language` (default English). */
export function ownVoiceName(
	source: OwnVoiceSource | null | undefined,
	language = "en"
): string {
	const fallback = source?.envoys?.find((e) => e?.fallback === true)
	const envoy = fallback
		? i18nText(fallback.name as I18n | undefined, language)?.trim()
		: undefined
	return (
		envoy ||
		source?.narratorName?.trim() ||
		i18nText(UNCLAIMED_LINE_NAME, language) ||
		UNCLAIMED_LINE_NAME.en
	)
}
