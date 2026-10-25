/**
 * 🚧 The branch marker (DC walk 6, 2026-10-17): a branched session names the
 * session and line it was branched from, in the session row's three
 * `branch_of_*` columns, so the header and the session panel can say *Branch
 * of Crawl Six*. Written by `branchSession` (`server/sessions/branch.ts`);
 * read with `branchOfSession`.
 * The name is the parent's as it was at the branch — a parent renamed or
 * deleted later still reads as what it was called.
 */

export interface BranchOf {
	/** The session it was branched from (it may since have been deleted). */
	sessionId: number
	/** That session's name at the branch. */
	name: string | null
	/** The last message the branch kept, in the parent. */
	messageId: number
}

/**
 * 🚧 The marker a session row holds (pr-6s2 C4: its three `branch_of_*`
 * columns), or null for a session that is no branch (either id null).
 */
export function branchOfSession(
	row:
		| {
				branchOfSessionId?: number | null
				branchOfMessageId?: number | null
				branchOfName?: string | null
		  }
		| null
		| undefined
): BranchOf | null {
	if (!row) return null
	const { branchOfSessionId: sessionId, branchOfMessageId: messageId, branchOfName: name } = row
	if (typeof sessionId !== "number" || typeof messageId !== "number") return null
	return { sessionId, name: typeof name === "string" ? name : null, messageId }
}

/** What the marker says on screen: "Branch of Crawl Six". */
export function branchOfLabel(marker: BranchOf | null): string | null {
	if (!marker) return null
	const name = marker.name?.trim()
	return name ? `Branch of ${name}` : "A branch"
}
