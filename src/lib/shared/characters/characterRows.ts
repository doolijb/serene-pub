/**
 * 🚧 The Characters view's rows (plan §34.4; owner 2026-11-05: one list, one
 * row per character — "the cast badge is probably redundant, any card that's
 * been used will be a cast" → one badge, **Card**, plus a reach line).
 *
 * A row is a **character**: a card and every cast member linked to it, or one
 * cast member with no card. The server builds the rows
 * (`server/cast/characterRows.ts`) and pages them over 🚧 `characters:page`;
 * nothing here reads or writes anything. ⚠ Not `characters:list` (the card
 * library, unpaged) and not a cast member as read (`MemberAsRead`, one
 * member on one reading).
 */
import type { MediaFrame } from "$lib/shared/media/frame"

/** 🚧 Where a character lives, as the asker may see it: the row's reach line. */
export interface CharacterRowReach {
	/** Lorebooks the asker may read that hold a cast member of this character; 0 reads "Not in a lorebook yet". */
	lorebookCount: number
	/** The one lorebook when `lorebookCount` is 1, else null; `sessionId` is set when that book is a session's own notes. */
	lorebook: {
		id: number
		name: string
		sessionId: number | null
		sessionName: string | null
	} | null
}

/** 🚧 One character in the Characters view: a card and its cast members, or one card-less cast member. */
export interface CharacterRow {
	/** 🚧 Stable identity of the row across pages and re-asks; opaque — read `cardId` / `castMemberId`, never parse it. */
	rowKey: string
	/** True when the row has a card the asker may see (the **Card** badge). */
	hasCard: boolean
	/** The card (`characters.id`) on a card row; null on a cast member's row. */
	cardId: number | null
	/** The cast member (`lorebook_bindings.id`) on a cast member's row; null on a card row. */
	castMemberId: number | null
	/** The card is the asker's own (Copy to my characters is offered where it isn't, or where there is no card). */
	cardIsMine: boolean
	/** The name the row is shown by: the card's current version's, or the cast member's at its lorebook's present. */
	shownName: string
	/** 🚧 The nickname the row is shown by first: the card's current version's on a card row, the cast member's as read on a cast member's row; null when none. */
	nickname: string | null
	/** The lead line under the name; "" when there is none. */
	summary: string
	/** The face's revision-bearing address; null when the character wears none. */
	face: { uuid: string; rev: number; frame: MediaFrame | null } | null
	reach: CharacterRowReach
	/** True when a cast member of this character tells some of it in their own words (a card-less member always); false when every one follows its card. */
	hasOwnWords: boolean
	/** The asker's own card is a favourite; false on every other row. */
	isFavorite: boolean
	/** The asker's own card is a persona; false on every other row. */
	isPersona: boolean
	/** The asker's own card is their default persona; false on every other row. */
	isDefaultPersona: boolean
	/** The asker's own card's embedding model (the row's indexing badge); null on every other row. */
	embeddingModel: string | null
	/** The asker's own card's library folder; null on every other row. */
	folderId: number | null
	/** The card is shared with the asker by its owner (a share row); false on every other row. */
	isSharedWithMe: boolean
	/** The owner's name on a shared card's row; null on every other row. */
	ownerName: string | null
	/** On a card row, one listed cast member of it the asker may read (a readable book's before a story's notes, then the lowest id); null on a cast member's row and on a card row with no member in reach. */
	readableMember: { castMemberId: number; lorebookId: number } | null
	/** The card's tags; [] on a cast member's row. */
	tags: { name: string; colorPreset: string | null }[]
}

/** 🚧 What narrows a `characters:page` read. Absent keys narrow nothing. */
export interface CharacterRowsFilters {
	/** true = card rows only; false = cast member rows only. */
	hasCard?: boolean
	/** Rows with a cast member in this lorebook (one the asker may read). */
	lorebookId?: number
	/** Rows with a cast member in this session's own notes or the lorebook it reads (a session the asker owns or plays in). */
	sessionId?: number
	/** "card" = every cast member follows its card; "own" = at least one tells it in their own words. */
	follows?: "card" | "own"
	/** The asker's favourite cards only. */
	favorites?: boolean
	/** The asker's persona cards only. */
	personas?: boolean
	/** Card rows carrying every one of these tag names (case-insensitive). */
	tags?: string[]
	/** Also list characters kept only in the notes of sessions the asker owns or plays in. */
	inMyStories?: boolean
	/** Name search (case-insensitive, anywhere in the stored name; a card row also matches any of its tag names). */
	q?: string
}

/**
 * 🚧 The refusal `characters:page:error` carries for an out-of-date cursor. The
 * Characters view hears it and asks for the first page again, without a toast.
 */
export const CHARACTER_ROWS_STALE_CURSOR =
	"That page of characters is out of date. Ask for the first page again."

/** The most rows one page holds; a larger `limit` is read as this. */
export const CHARACTER_ROWS_MAX_LIMIT = 100
/** The page size when none is asked for. */
export const CHARACTER_ROWS_DEFAULT_LIMIT = 50
