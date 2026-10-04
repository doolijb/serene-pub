/**
 * Which scenes a graph build reads (plan A3, review round).
 *
 * A build reads ONE line's own writing and files what it finds on that line:
 * the scenes captured on it, never an ancestor's and never a sibling's. A scene
 * main holds is main's, whoever played it, and main's build reads it; its ties
 * reach a branch forked after it through the line. Reading it from the branch
 * instead would file main's story on the branch and stamp main's scene graphed,
 * so main's own build would never read it.
 *
 * - **Rebuild** reads main's scenes.
 * - **Extend graph** reads every session's scenes on the line the Graph lens is
 *   reading.
 * - **Extend from this session** reads that session's scenes on its line.
 *
 * Pure, so the build and the two places that count what it will read — a
 * session's workflow tab and the Graph lens — cannot disagree.
 */

/** What a build reads: one line, and for Extend from a session, that session. */
export interface GraphBuildScope {
	/** The line whose own scenes are read. Null is main. */
	branchId: number | null
	/** Extend from a session: its scenes only. Null reads every session's. */
	sessionId: number | null
}

/** Whether a build in this scope reads the scene (graphed or not). */
export function buildReadsScene(
	scene: { branchId?: number | null; sessionId?: number | null },
	scope: GraphBuildScope
): boolean {
	return (
		(scene.branchId ?? null) === scope.branchId &&
		(scope.sessionId === null || (scene.sessionId ?? null) === scope.sessionId)
	)
}

/**
 * What an Extend in this scope has still to read: the scenes it will read
 * (`ready`: summarized), the ones waiting for a summary first, and how many of
 * the ready ones have no cast worked out yet (about one extra model call each).
 */
export function extendCountsOf(
	scenes: readonly {
		branchId?: number | null
		sessionId?: number | null
		graphed?: boolean | null
		summary?: string | null
		castResolvedAt?: unknown
	}[],
	scope: GraphBuildScope
): { ready: number; unsummarized: number; unresolvedCast: number } {
	let ready = 0
	let unsummarized = 0
	let unresolvedCast = 0
	for (const scene of scenes) {
		if (scene.graphed || !buildReadsScene(scene, scope)) continue
		if (!scene.summary?.trim()) {
			unsummarized++
			continue
		}
		ready++
		if (scene.castResolvedAt == null) unresolvedCast++
	}
	return { ready, unsummarized, unresolvedCast }
}
