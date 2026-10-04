/**
 * Scenes in **play order**: the order their story was played in, never the
 * order their rows were written.
 *
 * A compile's scenes all hang from one history entry and share its date, so
 * the date cannot order them; the messages they were captured from can. A
 * message's **place in play** is its id — ids only grow, so a message said
 * later has a larger one, in one session or across the sessions of a line —
 * except for a branched session's copy of its parent's history: the copy is a
 * new row with a new, larger id, and its place is the place of the message it
 * copies (`metadata.copyOf`, read by the caller into `placeOf`). A scene's
 * place is its earliest message's.
 *
 * A scene captured from no messages has no place in play. It keeps the place
 * it was written in among the others (its slot in id order), and the played
 * scenes are ordered among the remaining slots.
 *
 * ⚠ Not the lorebook list's **Story order** sort, which orders rows by their
 * date and a scene row by its id (`PoolItem.order`). That sort shows rows;
 * this one feeds a telling — a compile synthesizes the scenes in the order it
 * is handed them.
 */

/** A scene as far as its place in play goes. */
export interface SceneInPlay {
	id: number
	selectedMessageIds?: readonly number[] | null
}

/**
 * The scenes in play order. `placeOf` names a message's place in play; the
 * default is the message id itself, which is right for every message that is
 * not a branched session's copy.
 */
export function inPlayOrder<T extends SceneInPlay>(
	scenes: readonly T[],
	placeOf: (messageId: number) => number = (id) => id
): T[] {
	const written = [...scenes].sort((a, b) => a.id - b.id)
	const placeOfScene = new Map<T, number | null>()
	for (const scene of written) {
		const ids = scene.selectedMessageIds ?? []
		placeOfScene.set(
			scene,
			ids.length ? Math.min(...ids.map((id) => placeOf(id))) : null
		)
	}
	const played = written
		.filter((scene) => placeOfScene.get(scene) != null)
		.sort(
			(a, b) =>
				placeOfScene.get(a)! - placeOfScene.get(b)! || a.id - b.id
		)
	let next = 0
	return written.map((scene) =>
		placeOfScene.get(scene) == null ? scene : played[next++]
	)
}
