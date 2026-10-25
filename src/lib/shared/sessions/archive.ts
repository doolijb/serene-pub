/**
 * 🚧 **Archive, Close out and the catch-up offer** — the sentences and labels a
 * person reads (pr-6, rulings R-k and R-d, 2026-10-24). One copy of each: the
 * server answers with them and the client draws them by import, never retyped.
 *
 * R-k: "Archive = a FLAG (`archived_at`): read-only session (composer closed;
 * Back/Forward/Regenerate greyed; routines stop), listed under an Archived
 * section, reopenable (clears the flag). Close-out runs once on archive, in
 * Review." · R-d: "Close-out is (1) a manual action, and (2) optionally run on
 * session ARCHIVAL." · pass 9 S4: "the new session's first-run notice offers
 * *Catch up on <old session>*".
 *
 * ⚠ An **archived session** is not an archived lorebook ENTRY
 * (`lorebook_entries.archived`): always say which (NOMENCLATURE R3).
 */

/** Why everything that plays a session is refused or greyed while it is archived. */
export const SESSION_ARCHIVED_SENTENCE =
	"This session is archived. Its owner can unarchive it to play on."

export const SESSION_ARCHIVE_LABELS = Object.freeze({
	archive: "Archive",
	unarchive: "Unarchive",
	/** The sessions list's section. */
	group: "Archived",
	/** The mark beside an archived session's genre. */
	mark: "Archived"
})

/** Asked before Archive. */
export const SESSION_ARCHIVE_CONFIRM = Object.freeze({
	/** When the genre registers a close-out (`session.closeOutRegistered`). */
	withCloseOut:
		"Archive this session? It becomes read-only until you unarchive it. Anything played since its last scene is summarized as a closing scene for you to review.",
	plain: "Archive this session? It becomes read-only until you unarchive it."
})

export const SESSION_ARCHIVE_REFUSALS = Object.freeze({
	missing: "Session not found.",
	notOwner: "Only the session's owner can archive or unarchive it.",
	already: "This session is already archived.",
	notArchived: "This session isn't archived."
})

/** The owner's session-menu item that closes a session out. */
export const CLOSE_OUT_LABEL = "Close out"

/** Asked before Close out. */
export const CLOSE_OUT_CONFIRM =
	"Close out this session? What was played since its last scene becomes a closing scene, summarized for you to review before it goes into the lorebook."

export const CLOSE_OUT_REFUSALS = Object.freeze({
	missing: "Session not found.",
	notOwner: "Only the session's owner can close it out.",
	notRegistered: "This session's genre doesn't close sessions out.",
	busy: "Wait for the reply to finish.",
	nothing:
		"Everything played here is in a scene already, so there is nothing to close out."
})

/**
 * 🚧 The catch-up offer (pass 9 S4): an older session of the same owner on the
 * same lorebook line whose tail never reached the lorebook. On the new
 * session's payload as `session.catchUp` while the new one has not played.
 */
export interface CatchUpOffer {
	/** The older session whose tail the lorebook lacks. */
	fromSessionId: number
	fromSessionName: string
	/** How many of its lines a close-out would summarize. */
	lines: number
}

/** The offer's one line. */
export const catchUpNotice = (o: { fromSessionName: string; lines: number }): string =>
	`${o.fromSessionName} has ${o.lines === 1 ? "a line" : `${o.lines} lines`} the lorebook doesn't have yet.`

/** The offer's button. */
export const catchUpLabel = (o: { fromSessionName: string }): string =>
	`Catch up on ${o.fromSessionName}`
