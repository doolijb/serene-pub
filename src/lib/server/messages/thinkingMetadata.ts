/**
 * The legacy row's swipe/thinking metadata, built in one place.
 *
 * Lives here rather than inside `generateResponse` because the invariants it
 * maintains are `projectLegacy`'s, stated in that module's header and read by
 * both the boot migration and the store's runtime mirror:
 *
 *  - `content === metadata.swipes.history[currentIdx]` whenever swipes exist.
 *  - `metadata.thinking` mirrors `thinkingHistory[currentIdx]`.
 *  - `thinkingHistory` is parallel to `history` — same length, same indices.
 *
 * A generation path that writes those three by hand is a path that can break
 * them, and two of the four thinking defects were exactly that. It is also pure
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
 * @param thinking       the reasoning trace, or undefined if there is none
 * @param writeToHistory whether to write `content` into the active swipe slot.
 *                       False for the "clear the slot" paths that only touch
 *                       thinking.
 * @returns the updated metadata object, or null when nothing needs to change
 */
export function buildThinkingMetadata(
	existingMeta: any,
	content: string,
	thinking: string | undefined,
	writeToHistory: boolean
): any | null {
	const hasThinking = thinking !== undefined
	const swipes = existingMeta?.swipes

	if (swipes && Array.isArray(swipes.history)) {
		const idx = swipes.currentIdx ?? 0

		const history: string[] = [...swipes.history]
		// Every slot, slot 0 included. It used to be `idx > 0`, while the
		// thinking write below had no such guard — so regenerating a message
		// whose currentIdx is 0 (which `sessionMessages:regenerate` does
		// without touching currentIdx) stored the new reasoning against the
		// PREVIOUS generation's text, and left `history[0]` disagreeing with
		// the `content` column that `projectLegacy` requires it to equal.
		if (writeToHistory && typeof idx === "number" && idx >= 0) {
			history[idx] = content
		}

		// Build thinkingHistory always parallel (same length) as history
		const thinkingHistory: (string | null)[] = [
			...(swipes.thinkingHistory || [])
		]
		while (thinkingHistory.length < history.length)
			thinkingHistory.push(null)
		if (hasThinking && typeof idx === "number") {
			thinkingHistory[idx] = thinking!
		}
		// Trim excess (should never happen, but guard the invariant)
		thinkingHistory.length = history.length

		return {
			...existingMeta,
			...(hasThinking ? { thinking } : {}),
			swipes: {
				...swipes,
				history,
				thinkingHistory
			}
		}
	}

	// No swipes — only update metadata.thinking
	if (hasThinking) {
		return {
			...(existingMeta || {}),
			thinking
		}
	}

	return null // no changes needed
}
