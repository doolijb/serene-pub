/**
 * 🚧 **World-scope writes** (M0, SHAPES F1): a slot whose declaration
 * says `scope: 'world'` keeps its values on the book, not on the session. A
 * session write names the session's own layer (`session`, `session_cast`,
 * `session_location`); `worldOwnerOf` re-owns it onto the book the session
 * reads — its attached book, else its own — so the write lands on the book
 * layer, dated and under the book's write mode like any other.
 *
 * Applied only where the slot says `scope: 'world'`; the callers decide.
 */
import { lorebookLinks, normalizeOwner } from "$lib/server/state/lorebookState"
import { attachedOrOwnBookOf } from "$lib/server/lorebooks/ownBook"
import type { StateOwner } from "$lib/server/state/owners"
import { StateRefusal } from "$lib/server/state/write"

/** The owner a world-scope value is filed under, for a write the session made against `owner`. */
export async function worldOwnerOf(db: Db, sessionId: number, owner: StateOwner): Promise<StateOwner> {
	if (owner.kind === "player_seat") throw new StateRefusal("A player's seat holds nothing that lives on the world.")
	const book = await attachedOrOwnBookOf(db, sessionId)
	if (book == null) return owner
	const links = await lorebookLinks(db, book)
	const filter = normalizeOwner({ kind: owner.kind, id: owner.id }, links)
	if (!filter) return owner
	if (filter.kind === "lorebook") {
		// Only the session's own layer is re-owned; a book, member or place named already is where it goes.
		return owner.kind === "session" ? { kind: "lorebook", id: book } : owner
	}
	if (filter.kind === "cast_member" && (filter.id === undefined || filter.id < 0))
		throw new StateRefusal("This character is not in this world's cast, so a value that lives on the world has nowhere to go.")
	if (owner.kind === "session_cast" || owner.kind === "session_location") return { kind: filter.kind, id: filter.id! }
	return owner
}
