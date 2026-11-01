/**
 * How a session starts: the four creation modes in the person's words, the
 * list of sessions a branch or next chapter may follow, and the sentence that
 * says what a mode still lacks. A genre may propose a mode; it never locks one.
 */
import type { SessionCreationMode } from "@serene-pub/sdk"

type FollowRow = Sockets.Sessions.List.Response["sessionList"][number]

export const CREATION_MODE_WORDS: Readonly<
	Record<SessionCreationMode, { label: string; line: string }>
> = {
	new: {
		label: "New session",
		line: "A fresh story on the lorebook you choose. The world carries over; this session's own state starts empty."
	},
	"new-world": {
		label: "New world",
		line: "Copies the lorebook (or a starter lorebook) first, so this story changes its own copy of the world."
	},
	branch: {
		label: "Branch",
		line: "Picks up another session's history in a new session. The original stays exactly as it was."
	},
	"next-chapter": {
		label: "Next chapter",
		line: "Follows a session you're done with: it's closed out, and what its rules carry forward starts this one. Its messages stay behind."
	}
}

function stamp(v: unknown): number {
	if (v instanceof Date) return v.getTime()
	if (typeof v === "string" || typeof v === "number") {
		const t = new Date(v).getTime()
		return Number.isFinite(t) ? t : 0
	}
	return 0
}

/**
 * The sessions a start may follow: yours, of this genre, newest first. A next
 * chapter needs no attached lorebook: every session has a world (its own book
 * when none is attached), and the server shares that book to follow it.
 */
export function followableSessions(
	rows: readonly FollowRow[],
	ask: { genreId: string | null; mode: SessionCreationMode }
): FollowRow[] {
	return rows
		.filter((r) => r.isOwner && typeof r.id === "number" && r.genreId === ask.genreId)
		.sort((a, b) => stamp(b.updatedAt) - stamp(a.updatedAt))
}

/** What the mode still lacks, as one sentence (the server's own words), or null. */
export function creationModeBlocker(ask: {
	mode: SessionCreationMode
	from: number | null
	lorebookId: number | null
	starterKit: unknown | null
}): string | null {
	if (ask.mode === "new-world" && ask.lorebookId == null && ask.starterKit == null)
		return "Choose the world to copy."
	if (ask.mode === "branch" && ask.from == null) return "Choose the session to branch."
	if (ask.mode === "next-chapter" && ask.from == null)
		return "Choose the session this one follows."
	return null
}
