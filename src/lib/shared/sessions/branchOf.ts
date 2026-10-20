/**
 * 🚧 The branch marker (DC walk 6, 2026-10-17): a branched session names the
 * session and line it was branched from, in its own `metadata.branchOf`, so
 * the header and the session panel can say *Branch of Crawl Six*. Written by
 * `branchSession` (`server/sessions/branch.ts`); read here, by both sides.
 * The name is the parent's as it was at the branch — a parent renamed or
 * deleted later still reads as what it was called.
 */

export const BRANCH_OF_KEY = "branchOf"

export interface BranchOf {
	/** The session it was branched from (it may since have been deleted). */
	sessionId: number
	/** That session's name at the branch. */
	name: string | null
	/** The last message the branch kept, in the parent. */
	messageId: number
}

/** The marker a session's metadata holds, or null for a session that is no branch. */
export function branchOf(metadata: unknown): BranchOf | null {
	if (!metadata || typeof metadata !== "object") return null
	const v = (metadata as Record<string, unknown>)[BRANCH_OF_KEY]
	if (!v || typeof v !== "object") return null
	const { sessionId, name, messageId } = v as Record<string, unknown>
	if (typeof sessionId !== "number" || typeof messageId !== "number") return null
	return { sessionId, name: typeof name === "string" ? name : null, messageId }
}

/** The metadata with the marker set — a branch of a branch names its own parent. */
export function withBranchOf(metadata: unknown, marker: BranchOf): Record<string, unknown> {
	const base =
		metadata && typeof metadata === "object" && !Array.isArray(metadata)
			? (metadata as Record<string, unknown>)
			: {}
	return { ...base, [BRANCH_OF_KEY]: marker }
}

/** What the marker says on screen: "Branch of Crawl Six". */
export function branchOfLabel(marker: BranchOf | null): string | null {
	if (!marker) return null
	const name = marker.name?.trim()
	return name ? `Branch of ${name}` : "A branch"
}
