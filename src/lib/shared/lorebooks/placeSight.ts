/**
 * **Place sight** — which of a book's places a looker sees (plan A27).
 *
 * Two lookers, one rule:
 *
 * - **`session`** — a session playing the book. It sees a place that is on
 *   its line at its moment (the SQL half: `entryOnReadingSql`) and that, as
 *   the line's amendments leave it by then, is neither archived nor switched
 *   **Off**. Off is how a place leaves a line for a while ("Off for a
 *   while"), so a place switched Off is not in the story: not listed, not
 *   named, its stats not read, nothing written to it or pointed at it.
 * - **`book`** — the lorebook's own pages (the workspace, a pipeline reading
 *   the book's durable stats). It sees every place on the line that is not
 *   archived, Off ones included: an author edits a room they switched off.
 *
 * And inside a session, one narrower looker (plan A28): **a voice** — a
 * prompt written as somebody in the scene (a delver, a suspect, an
 * Adventure cast member). It knows the names of every place the session
 * sees, and reads the stats of one only: the place the scene is at (server
 * `pipelines/prompt/adventureContext.ts` `withinSight`, applied where a
 * voice's state becomes a prompt). The planner, the scene and the keeper are
 * nobody's voice and read with the session's sight.
 *
 * Every session reader of places answers by `seesPlace(…, "session")`: the
 * prompt's places (`stateFor`), the rooms listing and its "From here:" links,
 * the relationship hop's entry ends, the place owner and lore-reference write
 * doors, a lore link a pipeline writes, and a place a model names. An entry of
 * any kind is judged by the same rule where a session reads or writes it — a
 * link's end, a value's reference (docs/lorebooks.md: "neither archived nor
 * off").
 *
 * ⚠ Out of the story, not out of the book. What the book holds of a place
 * out of a session's sight is still the book's: what lies there still counts
 * toward an item's supply (`supply.ts holdingsFor`), the delete safeguard
 * still records a session's values there (`durable.ts recordToTimeline`),
 * and the ledger still names it (`sockets/state.ts ledgerFor`) — each reads
 * with `"book"`.
 *
 * Pure, and over the RESOLVED row — the wire row with the reading's
 * amendments applied (`entryAt`) — never the stored columns: a place archived
 * or switched off by an amendment is stored as neither.
 *
 * ⚠ Not a relationship's `visibility` (secret · acknowledged · public): that
 * is who in the story knows a link, and it has its own readers.
 */

/** Who is looking at a book's places: a session playing it, or the book's own pages. */
export type PlaceSight = "session" | "book"

/** Whether `sight` sees a place, as the reading resolved it. See the header. */
export function seesPlace(
	place: { enabled?: unknown; archived?: unknown },
	sight: PlaceSight
): boolean {
	if (place.archived === true) return false
	return sight === "book" || place.enabled !== false
}

/**
 * Why `sight` does not see an entry, told apart by where the mark comes from:
 * the entry itself (`archived`, `off`), or the line's dated changes at the
 * reading's moment (`archived-for-now`, `off-for-a-while`) — a stored row
 * that is on, switched off by an amendment. Null when it sees it.
 *
 * The same rule as `seesPlace`, for a door that has to say why in words that
 * lead somewhere: "switch it on" is no help when the entry is on and a dated
 * change is what keeps it off.
 */
export type UnseenReason = "archived" | "archived-for-now" | "off" | "off-for-a-while"

/** `seesPlace`'s answer as a reason: `stored` is the row's own marks, `resolved` the row as the reading has it. */
export function whyUnseen(
	stored: { enabled?: unknown; archived?: unknown },
	resolved: { enabled?: unknown; archived?: unknown },
	sight: PlaceSight
): UnseenReason | null {
	if (resolved.archived === true)
		return stored.archived === true ? "archived" : "archived-for-now"
	if (sight === "book" || resolved.enabled !== false) return null
	return stored.enabled === false ? "off" : "off-for-a-while"
}

/**
 * The one refusal for an entry a session does not see, by `named` (quoted as
 * given — a door passes the name the session would show, never a title the
 * asker may not know). Every session door that refuses one says this: a
 * value pointing at it, a model naming it, a lore link's end.
 */
export function unseenSentence(named: string, why: UnseenReason): string {
	switch (why) {
		case "archived":
			return `${named} is archived, so it is not in this session's story. Restore it in the lorebook first.`
		case "archived-for-now":
			return (
				`${named} is archived at this point in the story by a dated change in the lorebook, ` +
				`so it is not in this session's story here. Change that dated change in the lorebook first.`
			)
		case "off":
			return `${named} is switched off in the lorebook, so it is not in this session's story. Switch it on in the lorebook first.`
		case "off-for-a-while":
			return (
				`${named} is off for a while in the lorebook, and this session's story is at a point ` +
				`where it is off, so it is not in the story here. Change when it is off in the lorebook first.`
			)
	}
}
