/**
 * The legacy row's swipe/reasoning metadata, built in one place.
 *
 * Stored as `metadata.reasoning` and `swipes.reasoningHistory` (renamed from
 * the retired _thinking_ keys, NOMENCLATURE §23; the 0.5.3 upgrade writes the
 * new keys itself, and a pre-squash dev database gets the rewrite replayed by
 * the ledger splice).
 *
 * Lives here rather than inside `generateResponse` because the invariants it
 * maintains are `projectLegacy`'s, stated in that module's header and read by
 * both the boot migration and the store's runtime mirror:
 *
 *  - `content === metadata.swipes.history[currentIdx]` whenever swipes exist.
 *  - `metadata.reasoning` mirrors `reasoningHistory[currentIdx]`.
 *  - `reasoningHistory` is parallel to `history` — same length, same indices.
 *
 * A generation path that writes those three by hand is a path that can break
 * them, and two of the four reasoning defects were exactly that. It is also pure
 * — no db, no sockets — which is what lets it be tested as a unit at all;
 * `generateResponse` imports `$lib/server/db` at module scope and cannot be.
 */

/**
 * Build the metadata patch for a generation's current state.
 *
 * @param existingMeta   current message metadata object
 * @param content        the generated content, **as it will be written to the
 *                       `content` column** — stripped of reasoning markup, with
 *                       any continue-prefix already applied. Passing the raw
 *                       buffer here is what let `history[idx]` and `content`
 *                       disagree, so that swiping away and back reintroduced
 *                       markup the column had already lost.
 * @param reasoning      the reasoning trace; `null` to CLEAR the shown slot's
 *                       (a generation that ended with none, after its live
 *                       frames showed some); undefined to leave it alone
 * @param writeToHistory whether to write `content` into the active swipe slot.
 *                       False for the "clear the slot" paths that only touch
 *                       the reasoning.
 * @returns the updated metadata object, or null when nothing needs to change
 */
export function buildReasoningMetadata(
	existingMeta: any,
	content: string,
	reasoning: string | null | undefined,
	writeToHistory: boolean
): any | null {
	const hasReasoning = reasoning !== undefined
	const swipes = existingMeta?.swipes

	if (swipes && Array.isArray(swipes.history)) {
		const idx = swipes.currentIdx ?? 0

		const history: string[] = [...swipes.history]
		// Every slot, slot 0 included. It used to be `idx > 0`, while the
		// reasoning write below had no such guard — so regenerating a message
		// whose currentIdx is 0 (which `sessionMessages:regenerate` does
		// without touching currentIdx) stored the new reasoning against the
		// PREVIOUS generation's text, and left `history[0]` disagreeing with
		// the `content` column that `projectLegacy` requires it to equal.
		if (writeToHistory && typeof idx === "number" && idx >= 0) {
			history[idx] = content
		}

		// Build reasoningHistory always parallel (same length) as history
		const reasoningHistory: (string | null)[] = [
			...(swipes.reasoningHistory || [])
		]
		while (reasoningHistory.length < history.length)
			reasoningHistory.push(null)
		if (hasReasoning && typeof idx === "number") {
			reasoningHistory[idx] = reasoning ?? null
		}
		// Trim excess (should never happen, but guard the invariant)
		reasoningHistory.length = history.length

		return {
			...existingMeta,
			...(hasReasoning ? { reasoning } : {}),
			swipes: {
				...swipes,
				history,
				reasoningHistory
			}
		}
	}

	// No swipes — only update metadata.reasoning
	if (hasReasoning) {
		return {
			...(existingMeta || {}),
			reasoning
		}
	}

	return null // no changes needed
}
